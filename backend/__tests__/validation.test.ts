import { startDb, stopDb, resetDb, api, bearer, loginAs, seedDoctor, FIXED_MONDAY } from './helpers';

/**
 * A real booked appointment. Three of these validation tests need to reach the
 * BODY validator, and the routes deliberately run the ownership guard first —
 * so a made-up id would answer 404 and the 400 path would go untested.
 */
async function bookSomething(): Promise<{
  patient: { token: string; patientId: string };
  admin: { token: string };
  appointmentId: string;
}> {
  const patient = await loginAs('patient');
  const admin = await loginAs('admin');
  const doctor = await seedDoctor({ email: 'valid-dr@test.io', password: 'ValidPass1' }, [['09:00', '17:00']], 30);

  const grid = await api()
    .get(`/api/doctors/${doctor._id}/slots?date=${FIXED_MONDAY}`)
    .set(bearer(admin.token))
    .expect(200);
  const booked = await api()
    .post('/api/appointments')
    .set(bearer(patient.token))
    .send({
      doctorId: String(doctor._id),
      patientId: patient.patientId,
      startsAt: (grid.body.slots[0] as { startsAt: string }).startsAt,
    })
    .expect(201);

  return { patient, admin, appointmentId: booked.body.appointment.id as string };
}

/**
 * The 400 path. Every one of these is rejected by `validate()` BEFORE any
 * service or Mongoose query runs, which is also what makes the NoSQL-injection
 * defence work: `{"email": {"$ne": null}}` fails `isEmail` because the value
 * is an object, not a string.
 */
describe('400 — request validation (brief §11.1 requires 400, 404 and 409)', () => {
  beforeAll(startDb);
  afterAll(stopDb);
  beforeEach(resetDb);

  it('register: missing fields -> 400 naming every offending field', async () => {
    const res = await api().post('/api/auth/register').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('BadRequest');
    // All failures at once, not one at a time: a client should not need five
    // round trips to discover a five-field mistake.
    expect(res.body.message).toMatch(/email/i);
    expect(res.body.message).toMatch(/password/i);
    expect(res.body.message).toMatch(/Missing field/i);
  });

  it('register: a NoSQL operator object in a string field -> 400, never a query', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ email: { $ne: null }, password: 'GoodPass1', name: 'Mallory', phone: '+353800000042' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/email must be a valid email/i);
  });

  it('register: malformed email -> 400', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ email: 'not-an-email', password: 'GoodPass1', name: 'A', phone: '+353800000043' });
    expect(res.status).toBe(400);
  });

  it('book: non-ObjectId doctorId -> 400 (the 24-hex rule blocks crafted operators)', async () => {
    const patient = await loginAs('patient');
    const res = await api()
      .post('/api/appointments')
      .set(bearer(patient.token))
      .send({ doctorId: { $ne: null }, patientId: patient.patientId, startsAt: '2026-12-07T09:00:00.000Z' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/doctorId must be a valid id/i);
  });

  it('book: unparseable startsAt -> 400 (not 422 — it is not a date at all)', async () => {
    const patient = await loginAs('patient');
    const doctor = await loginAs('doctor');
    const res = await api()
      .post('/api/appointments')
      .set(bearer(patient.token))
      .send({ doctorId: doctor.doctorId, patientId: patient.patientId, startsAt: 'tomorrow-ish' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/startsAt must be an ISO datetime/i);
  });

  it('book: a date with no time component parses, then fails the slot rule as 422', async () => {
    const patient = await loginAs('patient');
    const doctor = await loginAs('doctor');
    const res = await api()
      .post('/api/appointments')
      .set(bearer(patient.token))
      .send({ doctorId: doctor.doctorId, patientId: patient.patientId, startsAt: '2026-12-07' });
    // Deliberately NOT 400. "2026-12-07" is a real, parseable datetime, so the
    // 400 gate is not the right door; it is rejected one layer later because
    // 00:00 is not a bookable slot. 422 means "understood, but not allowed",
    // which is exactly true here.
    expect(res.status).toBe(422);
  });

  it('reschedule: missing newStartsAt -> 400', async () => {
    const { patient, appointmentId } = await bookSomething();
    const res = await api()
      .patch(`/api/appointments/${appointmentId}/reschedule`)
      .set(bearer(patient.token))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/newStartsAt/i);
  });

  it('a malformed id in the path -> 400, not 404 or 500', async () => {
    const admin = await loginAs('admin');
    const res = await api().get('/api/patients/not-an-object-id').set(bearer(admin.token));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('BadRequest');
  });

  it('holiday: date that is not YYYY-MM-DD -> 400', async () => {
    const admin = await loginAs('admin');
    const res = await api().post('/api/holidays').set(bearer(admin.token)).send({ date: '25/12/2026' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/date must be a YYYY-MM-DD date/i);
  });

  it('holiday: a formatted string that is not a real day -> 400', async () => {
    const admin = await loginAs('admin');
    // The shape is right and the calendar is wrong. A regex alone accepts both
    // of these, which is why the rule round-trips through UTC.
    for (const date of ['2026-13-45', '2026-02-30', '2026-00-10']) {
      const res = await api().post('/api/holidays').set(bearer(admin.token)).send({ date });
      expect(res.status).toBe(400);
    }
  });

  it('holiday: missing date -> 400', async () => {
    const admin = await loginAs('admin');
    const res = await api().post('/api/holidays').set(bearer(admin.token)).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Missing field: date/i);
  });

  it('slots: a calendar date that does not exist -> 400', async () => {
    const doctor = await loginAs('doctor');
    const res = await api()
      .get(`/api/doctors/${doctor.doctorId}/slots?date=2026-13-45`)
      .set(bearer(doctor.token));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/date must be a YYYY-MM-DD date/i);
  });

  it('calendar: month that is not YYYY-MM -> 400', async () => {
    const doctor = await loginAs('doctor');
    const res = await api()
      .get(`/api/doctors/${doctor.doctorId}/calendar?month=2026-13`)
      .set(bearer(doctor.token));
    expect(res.status).toBe(400);
  });

  it('status: an unknown transition value -> 400 from the enum rule', async () => {
    const { admin, appointmentId } = await bookSomething();
    const res = await api()
      .patch(`/api/appointments/${appointmentId}/status`)
      .set(bearer(admin.token))
      .send({ status: 'teleported' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/status must be one of completed, no-show/i);
  });

  it('the status enum is exactly the two clinician actions, so "booked" is a 400 too', async () => {
    const { admin, appointmentId } = await bookSomething();
    const res = await api()
      .patch(`/api/appointments/${appointmentId}/status`)
      .set(bearer(admin.token))
      .send({ status: 'booked' });
    // Not a 422: the route enum is the closed set of actions a clinician may
    // perform, and "booked" is not one of them. Anything outside the set is
    // malformed input (400), whatever the value happens to look like.
    expect(res.status).toBe(400);
  });

  it('a value inside the enum that is not legal FROM the current state -> 422, not 400', async () => {
    const { admin, appointmentId, patient } = await bookSomething();
    await api()
      .patch(`/api/appointments/${appointmentId}/cancel`)
      .set(bearer(patient.token))
      .expect(204);

    const res = await api()
      .patch(`/api/appointments/${appointmentId}/status`)
      .set(bearer(admin.token))
      .send({ status: 'completed' });
    // The 400/409/422 split in one place: "completed" is a legal value (not
    // 400), the appointment exists (not 404), and nothing is racing for it (so
    // not 409). 422 — understood, but the current state forbids it.
    expect(res.status).toBe(422);
  });

  it('every 400 carries the same error envelope and X-Error-Code header', async () => {
    const res = await api().post('/api/auth/register').send({});
    expect(res.body).toMatchObject({ error: 'BadRequest' });
    expect(typeof res.body.message).toBe('string');
    expect(res.headers['x-error-code']).toBe('BadRequest');
  });

  it('404 for an unknown route, in the same envelope', async () => {
    const res = await api().get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NotFound');
    expect(res.body.message).toMatch(/no route for GET \/api\/nope/i);
  });
});
