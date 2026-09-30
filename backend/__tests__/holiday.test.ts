import { resetDb, seedDoctor, startDb, stopDb, api, bearer, loginAs, FIXED_MONDAY, type TestDoctor } from './helpers';
import * as holidayService from '../src/services/holiday.service';
import Appointment from '../src/models/appointment.model';

let doctor: TestDoctor;

beforeAll(async () => {
  await startDb();
});

afterAll(async () => {
  await stopDb();
});

beforeEach(async () => {
  await resetDb();
  doctor = await seedDoctor({ email: 'holiday-dr@test.io', password: 'HolidayPass1' }, [['09:00', '17:00']], 30);
});

describe('holiday.service', () => {
  it('adds a clinic-wide closure', async () => {
    const h = await holidayService.addHoliday({ doctorId: null, date: '2026-12-25' });
    expect(h.id).toBeTruthy();
    expect(h.date).toBe('2026-12-25');

    const list = await holidayService.listHolidays({});
    expect(list).toHaveLength(1);
    expect(list[0].doctor).toBeNull();
  });

  it('adds a per-doctor closure', async () => {
    const h = await holidayService.addHoliday({ doctorId: String(doctor._id), date: '2026-12-26' });
    expect(h.id).toBeTruthy();

    const list = await holidayService.listHolidays({ doctorId: String(doctor._id) });
    expect(list).toHaveLength(1);
    expect(String(list[0].doctor)).toBe(String(doctor._id));
  });

  it('rejects a duplicate closure on the same date', async () => {
    await holidayService.addHoliday({ doctorId: null, date: '2026-12-25' });
    await expect(holidayService.addHoliday({ doctorId: null, date: '2026-12-25' })).rejects.toThrow(/already covers/i);
  });

  it('allows the same date for different scopes (clinic + doctor)', async () => {
    await holidayService.addHoliday({ doctorId: null, date: '2026-12-25' });
    const per = await holidayService.addHoliday({ doctorId: String(doctor._id), date: '2026-12-25' });
    expect(per.id).toBeTruthy();
  });

  it('filters by date range', async () => {
    await holidayService.addHoliday({ doctorId: null, date: '2026-12-24' });
    await holidayService.addHoliday({ doctorId: null, date: '2026-12-25' });

    const dec25 = await holidayService.listHolidays({ from: '2026-12-25', to: '2026-12-25' });
    expect(dec25).toHaveLength(1);
    expect(dec25[0].date).toBe('2026-12-25');

    const decRange = await holidayService.listHolidays({ from: '2026-12-24', to: '2026-12-30' });
    expect(decRange).toHaveLength(2);
  });

  it('removes a holiday', async () => {
    const h = await holidayService.addHoliday({ doctorId: null, date: '2026-12-31' });
    await holidayService.removeHoliday(h.id);
    const list = await holidayService.listHolidays({});
    expect(list).toHaveLength(0);
  });

  it('throws 404 when removing an unknown holiday', async () => {
    await expect(holidayService.removeHoliday('000000000000000000000000')).rejects.toMatchObject({ status: 404 });
  });
});

/**
 * The route-level CRUD. Holidays are a primary resource (admin creates
 * closures, the slot engine reads them), so they get the same HTTP coverage as
 * doctors and patients: authorization, status codes, and the effect on the
 * availability grid.
 */
describe('holiday routes — /api/holidays', () => {
  let admin: string;
  let receptionist: string;
  let patient: string;

  beforeEach(async () => {
    admin = (await loginAs('admin')).token;
    receptionist = (await loginAs('receptionist')).token;
    patient = (await loginAs('patient')).token;
  });

  it('admin creates a clinic-wide closure -> 201, doctor is null', async () => {
    const res = await api().post('/api/holidays').set(bearer(admin)).send({ date: '2026-12-25' });
    expect(res.status).toBe(201);
    expect(res.body.holiday.date).toBe('2026-12-25');
    expect(res.body.holiday.doctor).toBeNull();
  });

  it('admin creates a per-doctor closure -> 201, doctor is set', async () => {
    const res = await api()
      .post('/api/holidays')
      .set(bearer(admin))
      .send({ date: '2026-12-26', doctorId: String(doctor._id) });
    expect(res.status).toBe(201);
    expect(String(res.body.holiday.doctor)).toBe(String(doctor._id));
  });

  it('a duplicate closure on the same date -> 409', async () => {
    await api().post('/api/holidays').set(bearer(admin)).send({ date: '2026-12-25' }).expect(201);
    const res = await api().post('/api/holidays').set(bearer(admin)).send({ date: '2026-12-25' });
    expect(res.status).toBe(409);
  });

  it('a receptionist may READ closures but not create one -> 403', async () => {
    await api().post('/api/holidays').set(bearer(admin)).send({ date: '2026-12-25' }).expect(201);

    const list = await api().get('/api/holidays').set(bearer(receptionist));
    expect(list.status).toBe(200);
    expect(list.body.holidays).toHaveLength(1);

    const create = await api().post('/api/holidays').set(bearer(receptionist)).send({ date: '2026-12-26' });
    expect(create.status).toBe(403);
  });

  it('a patient can neither read nor write closures -> 403 (and 403, not 401: it IS authenticated)', async () => {
    const list = await api().get('/api/holidays').set(bearer(patient));
    expect(list.status).toBe(403);
    expect(list.body.error).toBe('Forbidden');

    const create = await api().post('/api/holidays').set(bearer(patient)).send({ date: '2026-12-25' });
    expect(create.status).toBe(403);
  });

  it('an anonymous caller -> 401', async () => {
    expect((await api().get('/api/holidays')).status).toBe(401);
    expect((await api().post('/api/holidays').send({ date: '2026-12-25' })).status).toBe(401);
  });

  it('filters by doctorId and by date range', async () => {
    await api().post('/api/holidays').set(bearer(admin)).send({ date: '2026-12-24' }).expect(201);
    await api().post('/api/holidays').set(bearer(admin)).send({ date: '2026-12-25' }).expect(201);
    await api()
      .post('/api/holidays')
      .set(bearer(admin))
      .send({ date: '2026-12-28', doctorId: String(doctor._id) })
      .expect(201);

    const ranged = await api().get('/api/holidays?from=2026-12-25&to=2026-12-25').set(bearer(admin));
    expect(ranged.body.holidays).toHaveLength(1);
    expect(ranged.body.holidays[0].date).toBe('2026-12-25');

    // A doctor filter WIDENS rather than narrows: this doctor's own closure
    // plus every clinic-wide closure that also applies to them. Hiding a
    // clinic holiday from a doctor would be the bug.
    const perDoctor = await api().get(`/api/holidays?doctorId=${doctor._id}`).set(bearer(admin));
    expect(perDoctor.body.holidays).toHaveLength(3);
    expect(perDoctor.body.holidays.map((h: { date: string }) => h.date)).toEqual([
      '2026-12-24',
      '2026-12-25',
      '2026-12-28',
    ]);
    expect(perDoctor.body.holidays.filter((h: { doctor: string | null }) => h.doctor !== null)).toHaveLength(1);
  });

  it('DELETE removes the closure -> 204, and removing it twice -> 404', async () => {
    const created = await api().post('/api/holidays').set(bearer(admin)).send({ date: '2026-12-31' }).expect(201);
    const id = created.body.holiday.id;

    await api().delete(`/api/holidays/${id}`).set(bearer(admin)).expect(204);
    expect((await api().get('/api/holidays').set(bearer(admin))).body.holidays).toHaveLength(0);

    const again = await api().delete(`/api/holidays/${id}`).set(bearer(admin));
    expect(again.status).toBe(404);
  });

  it('a patient cannot delete a closure -> 403', async () => {
    const created = await api().post('/api/holidays').set(bearer(admin)).send({ date: '2026-12-30' }).expect(201);
    const res = await api().delete(`/api/holidays/${created.body.holiday.id}`).set(bearer(patient));
    expect(res.status).toBe(403);
  });

  it('a malformed id -> 400', async () => {
    const res = await api().delete('/api/holidays/nope').set(bearer(admin));
    expect(res.status).toBe(400);
  });

  it('a closure empties the availability grid, and removing it restores it', async () => {
    const open = await api().get(`/api/doctors/${doctor._id}/slots?date=${FIXED_MONDAY}`).set(bearer(admin));
    expect(open.body.slots.length).toBeGreaterThan(0);

    const created = await api().post('/api/holidays').set(bearer(admin)).send({ date: FIXED_MONDAY }).expect(201);
    const closed = await api().get(`/api/doctors/${doctor._id}/slots?date=${FIXED_MONDAY}`).set(bearer(admin));
    expect(closed.body.slots).toEqual([]);

    await api().delete(`/api/holidays/${created.body.holiday.id}`).set(bearer(admin)).expect(204);
    const reopened = await api().get(`/api/doctors/${doctor._id}/slots?date=${FIXED_MONDAY}`).set(bearer(admin));
    expect(reopened.body.slots.length).toBe(open.body.slots.length);
  });

  it('a booking on a closed day is rejected by the write path, not just hidden by the grid', async () => {
    await api().post('/api/holidays').set(bearer(admin)).send({ date: FIXED_MONDAY }).expect(201);
    const p = await loginAs('patient');
    const res = await api()
      .post('/api/appointments')
      .set(bearer(p.token))
      .send({
        doctorId: String(doctor._id),
        patientId: p.patientId,
        startsAt: `${FIXED_MONDAY}T09:00:00.000Z`,
      });
    // The grid is empty for a closed day, so a well-behaved client never gets
    // here. A hand-written request does, and must still be refused.
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/closed/i);
    expect(await Appointment.countDocuments()).toBe(0);
  });

  it('moving an existing booking onto a closed day is also refused', async () => {
    const p = await loginAs('patient');
    const grid = await api()
      .get(`/api/doctors/${doctor._id}/slots?date=${FIXED_MONDAY}`)
      .set(bearer(admin))
      .expect(200);
    const booked = await api()
      .post('/api/appointments')
      .set(bearer(p.token))
      .send({
        doctorId: String(doctor._id),
        patientId: p.patientId,
        startsAt: (grid.body.slots[0] as { startsAt: string }).startsAt,
      })
      .expect(201);

    await api().post('/api/holidays').set(bearer(admin)).send({ date: FIXED_MONDAY }).expect(201);

    const res = await api()
      .patch(`/api/appointments/${booked.body.appointment.id}/reschedule`)
      .set(bearer(p.token))
      .send({ newStartsAt: `${FIXED_MONDAY}T14:00:00.000Z` });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/closed/i);
  });

  it('the month calendar reports the day as a holiday', async () => {
    await api().post('/api/holidays').set(bearer(admin)).send({ date: FIXED_MONDAY }).expect(201);
    const cal = await api().get(`/api/doctors/${doctor._id}/calendar?month=2026-12`).set(bearer(admin));
    const day = (cal.body.days as { date: string; holiday: boolean; open: boolean }[]).find(
      (d) => d.date === FIXED_MONDAY
    );
    expect(day?.holiday).toBe(true);
  });
});
