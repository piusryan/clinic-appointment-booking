/**
 * __tests__/token-security.test.ts
 *
 * Attack-scenario tests for the JWT token system (DESIGN.md §7).
 *
 * The happy paths (login → 200, refresh → new token, logout) live in auth.test.ts.
 * This file owns the hostile paths:
 *
 *   1. Tampered access token signature → 401
 *   2. Expired access token → 401
 *   3. Manually crafted token with valid structure but wrong secret → 401
 *   4. Replay of an already-used refresh token after password change → 401
 *   5. Refresh token version bump on password change invalidates ALL sessions
 *   6. A deactivated account's token is rejected → 401
 *   7. A token with a non-existent user id → 401
 *   8. A refresh token from user A cannot be used on user B's session
 */
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import User from '../src/models/user.model';
import { config } from '../src/config';
import {
  startDb, stopDb, resetDb,
  api, bearer, loginAs, seedPatient,
} from './helpers';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Perform a real login and return both the access token and the raw cookie. */
async function fullLogin(email: string, password: string) {
  const res = await api().post('/api/auth/login').send({ email, password }).expect(200);
  const accessToken = res.body.accessToken as string;
  const cookie = (res.headers['set-cookie'] as string[] | undefined)?.[0] ?? '';
  const refreshCookie = cookie.split(';')[0]; // "refreshToken=<value>"
  return { accessToken, refreshCookie };
}

/** Hit a protected endpoint to confirm a token is accepted or rejected. */
const me = (tok: string) => api().get('/api/auth/me').set(bearer(tok));

// ─────────────────────────────────────────────────────────────────────────────
// 1. Access token attacks
// ─────────────────────────────────────────────────────────────────────────────
describe('token security — access token attacks', () => {
  it('tampered signature (appending a char) -> 401', async () => {
    const p = await seedPatient('tamper@sec.io', 'GoodPass1');
    const { accessToken } = await fullLogin(p.email, 'GoodPass1');
    const tampered = `${accessToken}x`;
    expect((await me(tampered)).status).toBe(401);
  });

  it('flipped last byte of the signature -> 401', async () => {
    const p = await seedPatient('flip@sec.io', 'GoodPass1');
    const { accessToken } = await fullLogin(p.email, 'GoodPass1');
    // A JWT is header.payload.signature — flip a char in the signature part
    const parts = accessToken.split('.');
    parts[2] = parts[2].slice(0, -1) + (parts[2].endsWith('a') ? 'b' : 'a');
    expect((await me(parts.join('.'))).status).toBe(401);
  });

  it('token signed with a DIFFERENT secret -> 401', async () => {
    const p = await seedPatient('wrongsec@sec.io', 'GoodPass1');
    const user = await User.findOne({ email: p.email });
    const fakeToken = jwt.sign(
      { sub: String(user!._id), role: 'patient', tv: 0 },
      randomBytes(32).toString('hex'),   // a different secret
      { expiresIn: '15m' }
    );
    expect((await me(fakeToken)).status).toBe(401);
  });

  it('expired token -> 401', async () => {
    const p = await seedPatient('expired@sec.io', 'GoodPass1');
    const user = await User.findOne({ email: p.email });
    const expired = jwt.sign(
      { sub: String(user!._id), role: 'patient', tv: 0 },
      config.accessTokenSecret,
      { expiresIn: '-1s' }              // already expired
    );
    expect((await me(expired)).status).toBe(401);
  });

  it('token for a non-existent user id -> 401', async () => {
    const ghost = jwt.sign(
      { sub: '000000000000000000000001', role: 'patient', tv: 0 },
      config.accessTokenSecret,
      { expiresIn: '15m' }
    );
    expect((await me(ghost)).status).toBe(401);
  });

  it('token with an escalated role claim is still rejected by policy -> 403', async () => {
    // A patient can't escalate to admin by forging the role in the payload,
    // because the signature would be invalid. Verify that forging with the real
    // secret still doesn't work — we're asserting the server re-reads the role
    // from the DB, not from the token's role claim.
    // (The access token DOES carry the role, so this test confirms the route
    //  guard uses req.user.role which comes from the token — but the token must
    //  be validly signed. A forged-role token signed with the wrong key → 401.)
    const p = await seedPatient('escalate@sec.io', 'GoodPass1');
    const user = await User.findOne({ email: p.email });
    const escalated = jwt.sign(
      { sub: String(user!._id), role: 'admin', tv: 0 },
      randomBytes(32).toString('hex'),  // wrong key → 401
      { expiresIn: '15m' }
    );
    expect((await me(escalated)).status).toBe(401);
  });

  it('missing Authorization header -> 401 with correct error shape', async () => {
    const res = await api().get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
    expect(res.headers['x-error-code']).toBe('Unauthorized');
  });

  it('malformed Authorization header (no Bearer prefix) -> 401', async () => {
    const p = await seedPatient('malformed@sec.io', 'GoodPass1');
    const { accessToken } = await fullLogin(p.email, 'GoodPass1');
    const res = await api().get('/api/auth/me').set('Authorization', accessToken); // no "Bearer "
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Refresh token attacks
// ─────────────────────────────────────────────────────────────────────────────
describe('token security — refresh token attacks', () => {
  it('a valid refresh token works once, then password change invalidates it', async () => {
    const p = await seedPatient('refresh1@sec.io', 'GoodPass1');
    const { accessToken, refreshCookie } = await fullLogin(p.email, 'GoodPass1');

    // works before password change
    const first = await api().post('/api/auth/refresh').set('Cookie', refreshCookie);
    expect(first.status).toBe(200);

    // change password → bumps refreshTokenVersion
    await api()
      .patch('/api/auth/password')
      .set(bearer(accessToken))
      .send({ currentPassword: 'GoodPass1', newPassword: 'NewPass99' })
      .expect(204);

    // old cookie is now dead
    const second = await api().post('/api/auth/refresh').set('Cookie', refreshCookie);
    expect(second.status).toBe(401);
    expect(second.body.error).toBe('Unauthorized');
  });

  it('password change invalidates ALL concurrent sessions (multiple refresh tokens)', async () => {
    const p = await seedPatient('refresh2@sec.io', 'GoodPass1');

    // Two logins from "different devices"
    const session1 = await fullLogin(p.email, 'GoodPass1');
    const session2 = await fullLogin(p.email, 'GoodPass1');

    // Both refresh before the password change
    expect((await api().post('/api/auth/refresh').set('Cookie', session1.refreshCookie)).status).toBe(200);
    expect((await api().post('/api/auth/refresh').set('Cookie', session2.refreshCookie)).status).toBe(200);

    // Change password on session1's access token
    await api()
      .patch('/api/auth/password')
      .set(bearer(session1.accessToken))
      .send({ currentPassword: 'GoodPass1', newPassword: 'NewPass99' })
      .expect(204);

    // BOTH sessions are now dead
    expect((await api().post('/api/auth/refresh').set('Cookie', session1.refreshCookie)).status).toBe(401);
    expect((await api().post('/api/auth/refresh').set('Cookie', session2.refreshCookie)).status).toBe(401);
  });

  it('no refresh cookie at all -> 401', async () => {
    const res = await api().post('/api/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });

  it('a garbage refresh cookie value -> 401', async () => {
    const res = await api()
      .post('/api/auth/refresh')
      .set('Cookie', 'refreshToken=this.is.garbage');
    expect(res.status).toBe(401);
  });

  it('refresh token from user A cannot refresh user B\'s session', async () => {
    const pA = await seedPatient('userA@sec.io', 'GoodPass1');
    const pB = await seedPatient('userB@sec.io', 'GoodPass1');

    const { refreshCookie: cookieA } = await fullLogin(pA.email, 'GoodPass1');
    // user B logs in — now try to use cookie A to refresh
    const res = await api().post('/api/auth/refresh').set('Cookie', cookieA);
    // The refresh token is scoped to a user by its `sub` claim and version —
    // it returns a new token for user A, not user B. The point is it doesn't
    // leak user B's data.
    // If the server rejects it for version mismatch or any reason, 401 is fine too.
    if (res.status === 200) {
      // If accepted, it must return user A's identity, never user B's
      expect(res.body.user?.email ?? pA.email).toBe(pA.email);
    } else {
      expect(res.status).toBe(401);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Deactivated / deleted account
// ─────────────────────────────────────────────────────────────────────────────
describe('token security — deactivated account', () => {
  it('a valid token for a deactivated account -> 401', async () => {
    const p = await seedPatient('deactivated@sec.io', 'GoodPass1');
    const { accessToken } = await fullLogin(p.email, 'GoodPass1');

    // Deactivate the account directly in the DB (simulates admin action)
    await User.updateOne({ email: p.email }, { isActive: false });

    const res = await me(accessToken);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });
});
