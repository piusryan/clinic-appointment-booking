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

  it('reschedule returns the UPDATED appointment (200 + body), not an empty shell', async () => {
    const slots = await grid();
    const tok = await tokenForPatient(patientA as never);
    const created = await book(tok, String(doctor._id), String(patientA.patientId), slots[0].startsAt).expect(201);

    const res = await api()
      .patch(`/api/appointments/${created.body.appointment.id}/reschedule`)
      .set(bearer(tok))
      .send({ newStartsAt: slots[1].startsAt });

    expect(res.status).toBe(200);
    expect(res.body.appointment.id).toBe(created.body.appointment.id);
    expect(new Date(res.body.appointment.startsAt).toISOString()).toBe(slots[1].startsAt);
    expect(res.body.appointment.doctor.name).toBeTruthy();
    expect(res.body.appointment.patient.name).toBeTruthy();
  });

  it('rescheduling to the same instant is a 400, not a no-op 200', async () => {
    const slots = await grid();
    const tok = await tokenForPatient(patientA as never);
    const created = await book(tok, String(doctor._id), String(patientA.patientId), slots[0].startsAt).expect(201);
    const res = await api()
      .patch(`/api/appointments/${created.body.appointment.id}/reschedule`)
      .set(bearer(tok))
      .send({ newStartsAt: slots[0].startsAt });
    expect(res.status).toBe(400);
  });

  it('rescheduling a cancelled appointment -> 422', async () => {
    const slots = await grid();
    const tok = await tokenForPatient(patientA as never);
    const created = await book(tok, String(doctor._id), String(patientA.patientId), slots[0].startsAt).expect(201);
    await api().patch(`/api/appointments/${created.body.appointment.id}/cancel`).set(bearer(tok)).expect(204);
    const res = await api()
      .patch(`/api/appointments/${created.body.appointment.id}/reschedule`)
      .set(bearer(tok))
      .send({ newStartsAt: slots[1].startsAt });
    expect(res.status).toBe(422);
  });

  // ---- the doctor lifecycle verb: PATCH /:id/status -------------------------

  describe('PATCH /api/appointments/:id/status (doctor marks the visit)', () => {
    const attend = async () => {
      const slots = await grid();
      const patientTok = await tokenForPatient(patientA as never);
      const created = await book(patientTok, String(doctor._id), String(patientA.patientId), slots[0].startsAt).expect(201);
      return { id: created.body.appointment.id, slots, patientTok };
    };

    it('attending doctor marks completed -> 204 and the status is persisted', async () => {
      const { id } = await attend();
      await api().patch(`/api/appointments/${id}/status`).set(bearer(await tokenForDoctor(doctor as never))).send({ status: 'completed' }).expect(204);

      const rows = await Appointment.findById(id);
      expect(rows?.status).toBe('completed');
    });

    it('attending doctor marks no-show -> 204 and the status is persisted', async () => {
      const { id } = await attend();
      await api().patch(`/api/appointments/${id}/status`).set(bearer(await tokenForDoctor(doctor as never))).send({ status: 'no-show' }).expect(204);

      const rows = await Appointment.findById(id);
      expect(rows?.status).toBe('no-show');
    });

    it('admin may mark status on any appointment', async () => {
      const { id } = await attend();
      await api().patch(`/api/appointments/${id}/status`).set(bearer(adminBearer)).send({ status: 'completed' }).expect(204);
    });

    it('a PATIENT cannot mark their own visit completed -> 403', async () => {
      const { id, patientTok } = await attend();
      const res = await api().patch(`/api/appointments/${id}/status`).set(bearer(patientTok)).send({ status: 'completed' });
      expect(res.status).toBe(403);
    });

    it('a receptionist cannot mark status -> 403 (matrix: doctor or admin only)', async () => {
      const { id } = await attend();
      const res = await api()
        .patch(`/api/appointments/${id}/status`)
        .set(bearer(await seedReceptionist()))
        .send({ status: 'completed' });
      expect(res.status).toBe(403);
    });

    it('a doctor who is not the attending one -> 403', async () => {
      const { id } = await attend();
      const other = await seedDoctor({ email: 'dr.unrelated@test.io', password: 'DrPass1' });
      const res = await api()
        .patch(`/api/appointments/${id}/status`)
        .set(bearer(await tokenForDoctor(other as never)))
        .send({ status: 'completed' });
      expect(res.status).toBe(403);
    });

    it('an unauthenticated caller -> 401, not 403', async () => {
      const { id } = await attend();
      const res = await api().patch(`/api/appointments/${id}/status`).send({ status: 'completed' });
      expect(res.status).toBe(401);
    });

    it('marking a cancelled appointment -> 422 (a state-machine rule, not a race)', async () => {
      const { id, patientTok } = await attend();
      await api().patch(`/api/appointments/${id}/cancel`).set(bearer(patientTok)).expect(204);
      const res = await api()
        .patch(`/api/appointments/${id}/status`)
        .set(bearer(await tokenForDoctor(doctor as never)))
        .send({ status: 'completed' });
      // 422, matching cancel and reschedule, which enforce the same
      // "only a booked appointment may transition" rule.
      expect(res.status).toBe(422);
    });

    it('marking it twice -> 422', async () => {
      const { id } = await attend();
      const doc = await tokenForDoctor(doctor as never);
      await api().patch(`/api/appointments/${id}/status`).set(bearer(doc)).send({ status: 'completed' }).expect(204);
      const again = await api().patch(`/api/appointments/${id}/status`).set(bearer(doc)).send({ status: 'no-show' });
      expect(again.status).toBe(422);
    });

    it('an unknown appointment id -> 404 (a valid 24-hex id that does not exist)', async () => {
      const res = await api()
        .patch('/api/appointments/000000000000000000000001/status')
        .set(bearer(adminBearer))
        .send({ status: 'completed' });
      expect(res.status).toBe(404);
    });

    it('a terminal status frees the slot back into the grid (partial index only covers `booked`)', async () => {
      const { id, slots } = await attend();
      await api()
        .patch(`/api/appointments/${id}/status`)
        .set(bearer(await tokenForDoctor(doctor as never)))
        .send({ status: 'no-show' })
        .expect(204);

      const after = await grid();
      expect(after.find((s: { startsAt: string }) => s.startsAt === slots[0].startsAt).available).toBe(true);
    });
  });

  it('reads of an appointment are audited with the reader identity', async () => {    const [slot] = await grid();
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