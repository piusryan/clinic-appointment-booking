import { rateLimitConfig, resetRateLimits } from '../src/middleware/rateLimit';
import { startDb, stopDb, resetDb, api, bearer, loginAs, FIXED_MONDAY } from './helpers';

/**
 * Rate limiting is asserted here, in isolation, with the ceilings pinned low
 * and the counters cleared — so this test owns the 429 while the rest of the
 * suite runs with the ceilings raised (see __tests__/setup-env.ts).
 */
describe('rate limiting (brief §6: an authenticated flood is still a DoS)', () => {
  beforeAll(startDb);
  afterAll(stopDb);
  beforeEach(resetDb);

  const defaults = { ...rateLimitConfig };

  beforeEach(() => {
    resetRateLimits();
  });

  afterEach(() => {
    Object.assign(rateLimitConfig, defaults);
    resetRateLimits();
  });

  it('login: 5 attempts in 15 minutes, then 429 with the standard error shape', async () => {
    rateLimitConfig.login = 5;
    resetRateLimits();

    for (let i = 0; i < 5; i += 1) {
      await api().post('/api/auth/login').send({ email: 'nobody@test.io', password: 'nope' });
    }
    const blocked = await api().post('/api/auth/login').send({ email: 'nobody@test.io', password: 'nope' });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('TooManyRequests');
    expect(blocked.body.message).toMatch(/too many login attempts/i);
    // Same header contract as every other error in the API.
    expect(blocked.headers['x-error-code']).toBe('TooManyRequests');
  });

  it('the login budget is per-IP, so a locked-out IP also loses VALID credentials', async () => {
    // The documented trade-off of an IP-keyed login limiter: the counter is on
    // the endpoint, not on authentication success, so burning the budget with
    // bad passwords locks out the IP and the real patient below cannot log in
    // from it. Fixing it means keying on email — which lets an attacker lock
    // a victim out deliberately. The 15-minute window is the mitigation.
    rateLimitConfig.login = 2;
    resetRateLimits();

    const patient = await loginAs('patient');
    // 1 login so far (inside loginAs). This is the 2nd, and the last allowed.
    const allowed = await api().post('/api/auth/login').send({ email: patient.email, password: patient.password });
    expect(allowed.status).toBe(200);

    for (let i = 0; i < 2; i += 1) {
      await api().post('/api/auth/login').send({ email: 'nobody@test.io', password: 'nope' });
    }

    const blocked = await api().post('/api/auth/login').send({ email: patient.email, password: patient.password });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('TooManyRequests');
  });

  it('bookings are keyed by AUTHENTICATED USER, not IP: one account cannot exhaust a shared budget', async () => {
    rateLimitConfig.booking = 2;
    resetRateLimits();

    const doctor = await loginAs('doctor');
    const slots = await api()
      .get(`/api/doctors/${doctor.doctorId}/slots?date=${FIXED_MONDAY}`)
      .set(bearer(doctor.token));
    const grid = slots.body.slots as { startsAt: string }[];

    // One patient spends the whole per-user budget...
    const hog = await loginAs('patient');
    await api()
      .post('/api/appointments')
      .set(bearer(hog.token))
      .send({ doctorId: doctor.doctorId, patientId: hog.patientId, startsAt: grid[0].startsAt })
      .expect(201);
    await api()
      .post('/api/appointments')
      .set(bearer(hog.token))
      .send({ doctorId: doctor.doctorId, patientId: hog.patientId, startsAt: grid[1].startsAt })
      .expect(201);
    const third = await api()
      .post('/api/appointments')
      .set(bearer(hog.token))
      .send({ doctorId: doctor.doctorId, patientId: hog.patientId, startsAt: grid[2].startsAt });
    expect(third.status).toBe(429);

    // ...and a different account, from the SAME ip, still books fine.
    const other = await loginAs('patient');
    const res = await api()
      .post('/api/appointments')
      .set(bearer(other.token))
      .send({ doctorId: doctor.doctorId, patientId: other.patientId, startsAt: grid[3].startsAt });
    expect(res.status).toBe(201);
  });
});
