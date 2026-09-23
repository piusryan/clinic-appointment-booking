import Appointment from '../src/models/appointment.model';
import AuditLog from '../src/models/audit.model';
import {
  startDb,
  stopDb,
  resetDb,
  api,
  bearer,
  FIXED_MONDAY,
  seedAdmin,
  seedDoctor,
  seedPatient,
  seedReceptionist,
  tokenForPatient,
  tokenForDoctor,
} from './helpers';

describe('appointments — the hard core under authentication', () => {
  beforeAll(startDb);
  afterAll(stopDb);
  beforeEach(resetDb);

  let adminBearer: string;
  let doctor: { _id: unknown; email: string };
  let patientA: { patientId: string };
  let patientB: { patientId: string };

  const book = (token: string, doctorId: string, patientId: string, startsAt: string) =>
    api().post('/api/appointments').set(bearer(token)).send({ doctorId, patientId, startsAt });

  beforeEach(async () => {
    adminBearer = await seedAdmin();
    doctor = await seedDoctor({ email: 'dr.main@test.io', password: 'DrPass1' });
    patientA = await seedPatient('a@test.io');
    patientB = await seedPatient('b@test.io');
  });

  const grid = async () => {
    const res = await api().get(`/api/doctors/${doctor._id}/slots?date=${FIXED_MONDAY}`).set(bearer(adminBearer));
    return res.body.slots;
  };

  it('book a free slot -> 201', async () => {
    const [slot] = await grid();
    const res = await book(await tokenForPatient(patientA as never), String(doctor._id), String(patientA.patientId), slot.startsAt);
    expect(res.status).toBe(201);
    expect(res.body.appointment.status).toBe('booked');
    expect(new Date(res.body.appointment.endsAt) > new Date(res.body.appointment.startsAt)).toBe(true);
  });

  it('two sequential bookings of one slot -> second gets 409', async () => {
    const [slot] = await grid();
    await book(await tokenForPatient(patientA as never), String(doctor._id), String(patientA.patientId), slot.startsAt).expect(201);
    const res = await book(await tokenForPatient(patientB as never), String(doctor._id), String(patientB.patientId), slot.startsAt);
    expect(res.status).toBe(409);
  });

  it('outside working hours -> 422', async () => {
    const outside = '2026-12-07T18:00:00.000Z'; // clinic closes 17:00 local
    const res = await book(await tokenForPatient(patientA as never), String(doctor._id), String(patientA.patientId), outside);
    expect(res.status).toBe(422);
  });

  it('unknown doctor -> 404', async () => {
    const [slot] = await grid();
    const res = await book(await tokenForPatient(patientA as never), '000000000000000000000001', String(patientA.patientId), slot.startsAt);
    expect(res.status).toBe(404);
  });

  it('cancel frees the slot: rebooking the same start works again', async () => {
    const [slot] = await grid();
    const tok = await tokenForPatient(patientA as never);
    const created = await book(tok, String(doctor._id), String(patientA.patientId), slot.startsAt).expect(201);
    const id = created.body.appointment.id;

    await api().patch(`/api/appointments/${id}/cancel`).set(bearer(tok)).expect(204);
    expect((await grid()).find((s: { startsAt: string }) => s.startsAt === slot.startsAt).available).toBe(true);

    await book(await tokenForPatient(patientB as never), String(doctor._id), String(patientB.patientId), slot.startsAt).expect(201);
  });

  it('cancelling twice -> 409', async () => {
    const [slot] = await grid();
    const tok = await tokenForPatient(patientA as never);
    const created = await book(tok, String(doctor._id), String(patientA.patientId), slot.startsAt).expect(201);
    const id = created.body.appointment.id;
    await api().patch(`/api/appointments/${id}/cancel`).set(bearer(tok)).expect(204);
    const again = await api().patch(`/api/appointments/${id}/cancel`).set(bearer(tok));
    expect(again.status).toBe(409);
  });

  it('reschedule moves atomically; a taken target -> 409; outside hours -> 422', async () => {
    const slots = await grid();
    const tok = await tokenForPatient(patientA as never);
    const created = await book(tok, String(doctor._id), String(patientA.patientId), slots[0].startsAt).expect(201);
    const id = created.body.appointment.id;

    // to the next free slot
    await api()
      .patch(`/api/appointments/${id}/reschedule`)
      .set(bearer(tok))
      .send({ newStartsAt: slots[1].startsAt })
      .expect(200);

    // now try to reschedule patient A into B's slot
    const bTok = await tokenForPatient(patientB as never);
    await book(bTok, String(doctor._id), String(patientB.patientId), slots[2].startsAt).expect(201);
    const clash = await api()
      .patch(`/api/appointments/${id}/reschedule`)
      .set(bearer(tok))
      .send({ newStartsAt: slots[2].startsAt });
    expect(clash.status).toBe(409);

    const outside = await api()
      .patch(`/api/appointments/${id}/reschedule`)
      .set(bearer(tok))
      .send({ newStartsAt: '2026-12-07T21:00:00.000Z' });
    expect(outside.status).toBe(422);
  });

  it('ownership: a patient reading another appointment -> 403 (fixed IDOR)', async () => {
    const [slot] = await grid();
    const created = await book(await tokenForPatient(patientA as never), String(doctor._id), String(patientA.patientId), slot.startsAt).expect(201);
    const id = created.body.appointment.id;

    const res = await api().get(`/api/appointments/${id}`).set(bearer(await tokenForPatient(patientB as never)));
    expect(res.status).toBe(403);
  });

  it('ownership: cancelling a stranger’s appointment -> 403', async () => {
    const [slot] = await grid();
    const created = await book(await tokenForPatient(patientA as never), String(doctor._id), String(patientA.patientId), slot.startsAt).expect(201);
    const res = await api()
      .patch(`/api/appointments/${created.body.appointment.id}/cancel`)
      .set(bearer(await tokenForPatient(patientB as never)));
    expect(res.status).toBe(403);
  });

  it('a doctor unrelated to the appointment cannot cancel it -> 403', async () => {
    const [slot] = await grid();
    const created = await book(await tokenForPatient(patientA as never), String(doctor._id), String(patientA.patientId), slot.startsAt).expect(201);
    const otherDoctor = await seedDoctor({ email: 'dr.other@test.io', password: 'DrPass1' });
    const res = await api()
      .patch(`/api/appointments/${created.body.appointment.id}/cancel`)
      .set(bearer(await tokenForDoctor(otherDoctor as never)));
    expect(res.status).toBe(403);
  });

  it('a patient cannot book for a different patient -> 403', async () => {
    const [slot] = await grid();
    const res = await book(await tokenForPatient(patientA as never), String(doctor._id), String(patientB.patientId), slot.startsAt);
    expect(res.status).toBe(403);
  });

  it('a receptionist may book on behalf of any patient', async () => {
    const [slot] = await grid();
    const recep = await seedReceptionist();
    const res = await api()
      .post('/api/appointments')
      .set(bearer(recep))
      .send({ doctorId: String(doctor._id), patientId: String(patientB.patientId), startsAt: slot.startsAt });
    expect(res.status).toBe(201);
  });

  it('reads of an appointment are audited with the reader identity', async () => {
    const [slot] = await grid();
    const created = await book(await tokenForPatient(patientA as never), String(doctor._id), String(patientA.patientId), slot.startsAt).expect(201);
    await api().get(`/api/appointments/${created.body.appointment.id}`).set(bearer(adminBearer)).expect(200);
    const logs = await AuditLog.find({ resource: 'appointment', resourceId: String(created.body.appointment.id) });
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(String(logs[0].actorRole)).toBe('admin');
  });

  it(`THE RACE: 50 concurrent authenticated bookings at one slot -> exactly 1 x 201, 49 x 409`, async () => {
    const slot = (await grid())[0];
    const count = 50;
    const racers: Array<{ patientId: string; token: string }> = [];
    for (let i = 0; i < count; i += 1) {
      const p = await seedPatient(`race-${i}@test.io`);
      racers.push({ patientId: String(p.patientId), token: await tokenForPatient(p as never) });
    }

    const statuses = await Promise.all(
      racers.map((r) => book(r.token, String(doctor._id), r.patientId, slot.startsAt).then((res) => res.status))
    );

    const created = statuses.filter((s) => s === 201).length;
    const conflicts = statuses.filter((s) => s === 409).length;
    expect(created).toBe(1);
    expect(conflicts).toBe(49);
    const rows = await Appointment.countDocuments({ status: 'booked', startsAt: new Date(slot.startsAt) });
    expect(rows).toBe(1); // the invariant is physical, not just on paper
  });
});