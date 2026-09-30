/**
 * __tests__/cancel-rebook.test.ts
 *
 * Proves that the partial unique index on appointments:
 *
 *   { doctor: 1, startsAt: 1 }, { status: 'booked' }
 *
 * …correctly ALLOWS a slot to be rebooked after it is cancelled.
 *
 * Without the `partialFilterExpression`, a cancelled row would hold the
 * (doctor, startsAt) key forever and the slot could never be rebooked —
 * which is wrong domain behaviour. With it, only 'booked' rows participate
 * in the uniqueness constraint, so cancellation genuinely frees the slot.
 *
 * Three progressions are tested:
 *   A. Cancel → rebook by a DIFFERENT patient  (the core invariant)
 *   B. Cancel → rebook by the SAME patient      (patient changed their mind)
 *   C. Cancel → attempt double-rebook           (only one of two concurrent
 *                                                rebookers can succeed)
 *
 * Additionally:
 *   D. The availability grid correctly reflects the freed slot
 *   E. A completed/no-show appointment also frees the slot for rebooking
 */
import Appointment from '../src/models/appointment.model';
import {
  startDb, stopDb, resetDb,
  api, bearer, loginAs, seedDoctor,
  FIXED_MONDAY,
} from './helpers';

beforeAll(startDb);
afterAll(stopDb);
beforeEach(resetDb);

// ─────────────────────────────────────────────────────────────────────────────
// Shared setup
// ─────────────────────────────────────────────────────────────────────────────
async function setup() {
  const admin  = await loginAs('admin');
  const doctor = await loginAs('doctor');

  const slots = await api()
    .get(`/api/doctors/${doctor.doctorId}/slots?date=${FIXED_MONDAY}`)
    .set(bearer(admin.token))
    .expect(200);

  const [slot0, slot1] = slots.body.slots as { startsAt: string }[];
  return { admin, doctor, slot0, slot1 };
}

function book(token: string, doctorId: string, patientId: string, startsAt: string) {
  return api()
    .post('/api/appointments')
    .set(bearer(token))
    .send({ doctorId, patientId, startsAt });
}

function cancel(token: string, appointmentId: string) {
  return api()
    .patch(`/api/appointments/${appointmentId}/cancel`)
    .set(bearer(token));
}

// ─────────────────────────────────────────────────────────────────────────────
// A. Cancel → rebook by a different patient
// ─────────────────────────────────────────────────────────────────────────────
describe('cancel → rebook (partial unique index)', () => {
  it('A: cancel frees the slot so a different patient can book it', async () => {
    const { doctor, slot0 } = await setup();
    const p1 = await loginAs('patient');
    const p2 = await loginAs('patient');

    // p1 books slot0
    const created = await book(p1.token, doctor.doctorId!, p1.patientId!, slot0.startsAt).expect(201);
    const id = created.body.appointment.id as string;

    // slot0 is now taken — p2 cannot book it
    await book(p2.token, doctor.doctorId!, p2.patientId!, slot0.startsAt).expect(409);

    // p1 cancels
    await cancel(p1.token, id).expect(204);

    // p2 can now book the same slot
    const rebooked = await book(p2.token, doctor.doctorId!, p2.patientId!, slot0.startsAt);
    expect(rebooked.status).toBe(201);
    expect(rebooked.body.appointment.status).toBe('booked');

    // Exactly one booked row for this slot in the DB
    const rows = await Appointment.find({ doctor: doctor.doctorId, startsAt: new Date(slot0.startsAt) });
    const booked = rows.filter(r => r.status === 'booked');
    const cancelled = rows.filter(r => r.status === 'cancelled');
    expect(booked).toHaveLength(1);
    expect(cancelled).toHaveLength(1);
    expect(String(booked[0].patient)).toBe(p2.patientId);
  });

  it('B: the same patient can rebook their own cancelled slot', async () => {
    const { doctor, slot0 } = await setup();
    const p1 = await loginAs('patient');

    const created = await book(p1.token, doctor.doctorId!, p1.patientId!, slot0.startsAt).expect(201);
    await cancel(p1.token, created.body.appointment.id as string).expect(204);

    // Same patient, same slot — should succeed
    const rebooked = await book(p1.token, doctor.doctorId!, p1.patientId!, slot0.startsAt);
    expect(rebooked.status).toBe(201);

    const rows = await Appointment.find({ doctor: doctor.doctorId, startsAt: new Date(slot0.startsAt) });
    expect(rows.filter(r => r.status === 'booked')).toHaveLength(1);
    expect(rows.filter(r => r.status === 'cancelled')).toHaveLength(1);
  });

  it('C: two patients race to rebook a cancelled slot — exactly one wins', async () => {
    const { doctor, slot0 } = await setup();
    const p1 = await loginAs('patient');
    const p2 = await loginAs('patient');
    const p3 = await loginAs('patient');

    // p1 books and cancels
    const created = await book(p1.token, doctor.doctorId!, p1.patientId!, slot0.startsAt).expect(201);
    await cancel(p1.token, created.body.appointment.id as string).expect(204);

    // p2 and p3 race to rebook simultaneously
    const [r2, r3] = await Promise.all([
      book(p2.token, doctor.doctorId!, p2.patientId!, slot0.startsAt),
      book(p3.token, doctor.doctorId!, p3.patientId!, slot0.startsAt),
    ]);

    const statuses = [r2.status, r3.status].sort();
    expect(statuses).toEqual([201, 409]);

    // Exactly one booked row
    const booked = await Appointment.find({
      doctor: doctor.doctorId,
      startsAt: new Date(slot0.startsAt),
      status: 'booked',
    });
    expect(booked).toHaveLength(1);
  });

  it('D: availability grid shows freed slot after cancellation', async () => {
    const { admin, doctor, slot0 } = await setup();
    const p1 = await loginAs('patient');

    // Book slot0
    const created = await book(p1.token, doctor.doctorId!, p1.patientId!, slot0.startsAt).expect(201);

    // Grid shows it as taken
    const before = await api()
      .get(`/api/doctors/${doctor.doctorId}/slots?date=${FIXED_MONDAY}`)
      .set(bearer(admin.token));
    const takenSlot = (before.body.slots as { startsAt: string; available: boolean }[])
      .find(s => s.startsAt === slot0.startsAt);
    expect(takenSlot?.available).toBe(false);

    // Cancel
    await cancel(p1.token, created.body.appointment.id as string).expect(204);

    // Grid now shows it as available
    const after = await api()
      .get(`/api/doctors/${doctor.doctorId}/slots?date=${FIXED_MONDAY}`)
      .set(bearer(admin.token));
    const freedSlot = (after.body.slots as { startsAt: string; available: boolean }[])
      .find(s => s.startsAt === slot0.startsAt);
    expect(freedSlot?.available).toBe(true);
  });

  it('E: a completed appointment also frees the slot (partial index — not just cancelled)', async () => {
    const { doctor, slot0 } = await setup();
    const patient = await loginAs('patient');

    // Book slot0
    const created = await book(patient.token, doctor.doctorId!, patient.patientId!, slot0.startsAt).expect(201);
    const id = created.body.appointment.id as string;

    // Doctor marks it completed
    await api()
      .patch(`/api/appointments/${id}/status`)
      .set(bearer(doctor.token))
      .send({ status: 'completed' })
      .expect(204);

    // Another patient should be able to rebook (status != 'booked', not in index)
    const p2 = await loginAs('patient');
    const rebooked = await book(p2.token, doctor.doctorId!, p2.patientId!, slot0.startsAt);
    expect(rebooked.status).toBe(201);
  });

  it('F: multiple cancel-rebook cycles work correctly', async () => {
    const { doctor, slot0 } = await setup();

    for (let cycle = 0; cycle < 3; cycle++) {
      const p = await loginAs('patient');
      const created = await book(p.token, doctor.doctorId!, p.patientId!, slot0.startsAt).expect(201);
      await cancel(p.token, created.body.appointment.id as string).expect(204);
    }

    // After 3 cancel cycles, a 4th patient can still book
    const final = await loginAs('patient');
    const res = await book(final.token, doctor.doctorId!, final.patientId!, slot0.startsAt);
    expect(res.status).toBe(201);

    const allRows = await Appointment.find({ doctor: doctor.doctorId, startsAt: new Date(slot0.startsAt) });
    expect(allRows.filter(r => r.status === 'booked')).toHaveLength(1);
    expect(allRows.filter(r => r.status === 'cancelled')).toHaveLength(3);
  });
});
