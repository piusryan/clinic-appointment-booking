import { startDb, stopDb, resetDb, api, bearer, FIXED_MONDAY, seedAdmin, seedDoctor, seedPatient, tokenForPatient } from './helpers';

const WORKING = [{ day: 1, start: '09:00', end: '17:00' }];

describe('doctors CRUD + slots (module 4 verbs + hard-core surface)', () => {
  beforeAll(startDb);
  afterAll(stopDb);
  beforeEach(resetDb);

  it('full CRUD lifecycle as admin: 201 -> 200 -> 200 -> 204 -> 404', async () => {
    const admin = await seedAdmin();
    const create = await api()
      .post('/api/doctors')
      .set(bearer(admin))
      .send({ name: 'Dr CRUD', speciality: 'Derm', workingHours: WORKING, slotMinutes: 30 });
    expect(create.status).toBe(201);
    const id = create.body.doctor.id;

    const list = await api().get('/api/doctors').set(bearer(admin));
    expect(list.status).toBe(200);
    expect(list.body.doctors.some((d: { id: string }) => d.id === id)).toBe(true);

    const one = await api().get(`/api/doctors/${id}`).set(bearer(admin));
    expect(one.status).toBe(200);

    const upd = await api().patch(`/api/doctors/${id}`).set(bearer(admin)).send({ slotMinutes: 20 });
    expect(upd.status).toBe(200);
    expect(upd.body.doctor.slotMinutes).toBe(20);

    await api().delete(`/api/doctors/${id}`).set(bearer(admin)).expect(204);
    expect((await api().get(`/api/doctors/${id}`).set(bearer(admin))).status).toBe(404);
  });

  it('a patient cannot create doctors -> 403', async () => {
    const p = await seedPatient('nope@test.io');
    const res = await api()
      .post('/api/doctors')
      .set(bearer(await tokenForPatient(p)))
      .send({ name: 'Dr Sneak', speciality: 'X', workingHours: WORKING, slotMinutes: 30 });
    expect(res.status).toBe(403);
  });

  it('slots endpoint returns a derived grid and marks taken slots unavailable', async () => {
    const admin = await seedAdmin();
    const doctor = await seedDoctor({ email: 'dr.grid@test.io', password: 'DrPass1' });
    const p = await seedPatient('grid@test.io');

    const before = await api().get(`/api/doctors/${doctor._id}/slots?date=${FIXED_MONDAY}`).set(bearer(admin));
    expect(before.status).toBe(200);
    const free = before.body.slots.filter((s: { available: boolean }) => s.available).length;
    expect(free).toBeGreaterThan(0);

    const target = before.body.slots[0];
    await api()
      .post('/api/appointments')
      .set(bearer(await tokenForPatient(p)))
      .send({ doctorId: String(doctor._id), patientId: String(p.patientId), startsAt: target.startsAt })
      .expect(201);

    const after = await api().get(`/api/doctors/${doctor._id}/slots?date=${FIXED_MONDAY}`).set(bearer(admin));
    const slot = after.body.slots.find((s: { startsAt: string }) => s.startsAt === target.startsAt);
    expect(slot.available).toBe(false);
  });

  it('slots response never reveals the occupant (free-slot enumeration rule)', async () => {
    const admin = await seedAdmin();
    // Doctor email distinct from the booking patient so the two cannot be
    // confused: seedDoctor names the doctor "Dr <email>".
    const doctor = await seedDoctor({ email: 'dr.public.grid@test.io', password: 'DrPass1' });
    const p = await seedPatient('occupant.hidden@test.io');
    const before = await api().get(`/api/doctors/${doctor._id}/slots?date=${FIXED_MONDAY}`).set(bearer(admin));
    await api()
      .post('/api/appointments')
      .set(bearer(await tokenForPatient(p)))
      .send({ doctorId: String(doctor._id), patientId: String(p.patientId), startsAt: before.body.slots[0].startsAt })
      .expect(201);
    const after = await api().get(`/api/doctors/${doctor._id}/slots?date=${FIXED_MONDAY}`).set(bearer(admin));
    // The occupant's identity must not appear anywhere in the availability grid.
    expect(JSON.stringify(after.body)).not.toContain('occupant.hidden@test.io');
    expect(JSON.stringify(after.body.slots)).not.toContain('occupant');
  });

  it('IDOR: a patient querying a doctor they do not practise for gets 403 on /schedule', async () => {
    const doctor = await seedDoctor({ email: 'dr.priv@test.io', password: 'DrPass1' });
    const p = await seedPatient('snoop@test.io');
    const res = await api().get(`/api/doctors/${doctor._id}/schedule`).set(bearer(await tokenForPatient(p)));
    expect(res.status).toBe(403);
  });
});