import jwt from 'jsonwebtoken';
import User from '../src/models/user.model';
import { config } from '../src/config';
import { startDb, stopDb, resetDb, api, bearer, seedAdmin, seedPatient } from './helpers';

describe('auth (module 10: authentication)', () => {
  beforeAll(startDb);
  afterAll(stopDb);
  beforeEach(resetDb);

  const register = (body: unknown) => api().post('/api/auth/register').send(body);

  it('registers a patient -> 201, never leaks the hash', async () => {
    const res = await register({ email: 'a@b.io', password: 'GoodPass1', name: 'Ann', phone: '+353800000001' });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('a@b.io');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('409 on a duplicate email', async () => {
    await register({ email: 'a@b.io', password: 'GoodPass1', name: 'A', phone: '+353800000002' });
    const res = await register({ email: 'a@b.io', password: 'GoodPass2', name: 'B', phone: '+353800000003' });
    expect(res.status).toBe(409);
  });

  it('422 on a weak password (no digit / too short)', async () => {
    const res = await register({ email: 'weak@b.io', password: 'onlyletters', name: 'W', phone: '+353800000004' });
    expect(res.status).toBe(422);
  });

  it('login -> 200 with access token + httpOnly refresh cookie', async () => {
    const p = await seedPatient('login@test.io', 'GoodPass1');
    const res = await api().post('/api/auth/login').send({ email: p.email, password: 'GoodPass1' });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    const cookie = res.headers['set-cookie']?.find((c: string) => c.startsWith('refreshToken='));
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
  });

  it('uniform failure: wrong password and unknown email return the same 401 text', async () => {
    await seedPatient('known@test.io', 'GoodPass1');
    const wrongPw = await api().post('/api/auth/login').send({ email: 'known@test.io', password: 'nope' });
    const unknown = await api().post('/api/auth/login').send({ email: 'ghost@test.io', password: 'nope' });
    expect(wrongPw.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrongPw.body.message).toBe(unknown.body.message);
  });

  it('protected route -> 401 with no token', async () => {
    const res = await api().get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('authenticated /me -> 200 with the user', async () => {
    const p = await seedPatient('me@test.io');
    const res = await api().post('/api/auth/login').send({ email: p.email, password: 'Patient1a' });
    const me = await api().get('/api/auth/me').set(bearer(res.body.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('me@test.io');
  });

  it('an expired token is rejected -> 401', async () => {
    await seedPatient('cap@test.io');
    const user = await User.findOne({ email: 'cap@test.io' });
    const expired = jwt.sign({ sub: String(user!._id), role: 'patient' }, config.accessTokenSecret, { expiresIn: '-10s' });
    const res = await api().get('/api/auth/me').set(bearer(expired));
    expect(res.status).toBe(401);
  });

  it('a tampered signature is rejected -> 401', async () => {
    await seedPatient('sig@test.io');
    const user = await User.findOne({ email: 'sig@test.io' });
    const good = jwt.sign({ sub: String(user!._id), role: 'patient' }, config.accessTokenSecret, { expiresIn: '15m' });
    const bad = `${good}a`;
    const res = await api().get('/api/auth/me').set(bearer(bad));
    expect(res.status).toBe(401);
  });

  it('a token issued before a password change no longer refreshes', async () => {
    const p = await seedPatient('rotate@test.io', 'GoodPass1');
    const login = await api().post('/api/auth/login').send({ email: p.email, password: 'GoodPass1' });
    const refreshCookie = login.headers['set-cookie']?.[0].split(';')[0];
    expect(refreshCookie).toBeDefined();

    // refresh works before the password change
    const ok = await api().post('/api/auth/refresh').set('Cookie', refreshCookie!);
    expect(ok.status).toBe(200);

    // change password (increments refreshTokenVersion -> kills all sessions)
    await api()
      .patch('/api/auth/password')
      .set(bearer(login.body.accessToken))
      .send({ currentPassword: 'GoodPass1', newPassword: 'BrandNew1' })
      .expect(204);

    // the OLD refresh token no longer works
    const stale = await api().post('/api/auth/refresh').set('Cookie', refreshCookie!);
    expect(stale.status).toBe(401);
  });

  it('rate limits login: 5 attempts in 15 min, then 429', async () => {
    for (let i = 0; i < 5; i += 1) {
      await api().post('/api/auth/login').send({ email: 'nobody@test.io', password: 'nope' });
    }
    const res = await api().post('/api/auth/login').send({ email: 'nobody@test.io', password: 'nope' });
    expect(res.status).toBe(429);
  });

  it('seedToken helper gives a working admin token (loginAs pattern)', async () => {
    const admin = await seedAdmin();
    const res = await api().get('/api/auth/me').set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
  });
});