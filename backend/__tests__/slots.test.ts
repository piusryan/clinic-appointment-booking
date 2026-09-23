import Holiday from '../src/models/holiday.model';
import { slotInstantsFor } from '../src/services/slot.service';
import { startDb, stopDb, api, bearer, FIXED_MONDAY, seedAdmin, seedDoctor } from './helpers';

describe('slot generation — derived, hard parts', () => {
  beforeAll(startDb);
  afterAll(stopDb);

  it('non-even division: 09:00–10:20 with 30-min slots yields 2 slots ending at 10:00', async () => {
    const doctor = { workingHours: [{ day: 1, start: '09:00', end: '10:20' as const }], slotMinutes: 30 };
    const slots = slotInstantsFor(doctor, FIXED_MONDAY);
    expect(slots).toHaveLength(2);
    expect(slots[0].startsAt.toISOString()).toBe('2026-12-07T09:00:00.000Z');
    expect(slots[0].endsAt.toISOString()).toBe('2026-12-07T09:30:00.000Z');
    expect(slots[1].endsAt.toISOString()).toBe('2026-12-07T10:00:00.000Z');
    expect(slots[1].startsAt.toISOString()).toBe('2026-12-07T09:30:00.000Z');
  });

  it('09:00–17:15 at 30 min drops the trailing 15-minute stub', async () => {
    const doctor = { workingHours: [{ day: 1, start: '09:00', end: '17:15' }], slotMinutes: 30 };
    const slots = slotInstantsFor(doctor, FIXED_MONDAY);
    // 495 minutes of capacity / 30 = 16.5 -> 16 full 30-min slots fit
    // (09:00..17:00); the trailing 15 minutes (17:00..17:15) are dropped.
    expect(slots).toHaveLength(16);
    expect(slots[0].startsAt.toISOString()).toBe('2026-12-07T09:00:00.000Z');
    expect(slots[15].startsAt.toISOString()).toBe('2026-12-07T16:30:00.000Z');
    expect(slots[15].endsAt.toISOString()).toBe('2026-12-07T17:00:00.000Z');
  });

  it('no working hours for a weekday -> no slots (Sundays off)', async () => {
    const doctor = { workingHours: [{ day: 1, start: '09:00', end: '17:00' }], slotMinutes: 30 };
    expect(slotInstantsFor(doctor, '2026-12-06')).toHaveLength(0); // Sunday
  });

  it('a holiday removes the whole day from the API grid', async () => {
    const admin = await seedAdmin();
    const doctor = await seedDoctor({ email: 'dr.hol@test.io', password: 'DrPass1' });
    await Holiday.create({ doctor: null, date: new Date(Date.UTC(2026, 11, 7)) }); // clinic-wide

    const res = await api().get(`/api/doctors/${doctor._id}/slots?date=${FIXED_MONDAY}`).set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.slots).toHaveLength(0);
  });

  it('month calendar: open Mondays carry slot counts, Sundays are closed', async () => {
    const admin = await seedAdmin('caladmin@test.io', 'CalPass1');
    const doctor = await seedDoctor({ email: 'dr.cal@test.io', password: 'DrPass1' });

    const res = await api().get(`/api/doctors/${doctor._id}/calendar?month=2026-12`).set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.month).toBe('2026-12');
    expect(res.body.days).toHaveLength(31);

    const monday = res.body.days.find((d: { date: string }) => d.date === '2026-12-07');
    expect(monday.open).toBe(true);
    expect(monday.total).toBe(16); // 09:00-17:00 @ 30 min
    expect(monday.available).toBe(16);

    const sunday = res.body.days.find((d: { date: string }) => d.date === '2026-12-06');
    expect(sunday.open).toBe(false);
    expect(sunday.total).toBe(0);
  });

  it('month calendar flags clinic holidays', async () => {
    const admin = await seedAdmin('calholadmin@test.io', 'CalPass1');
    const doctor = await seedDoctor({ email: 'dr.calhol@test.io', password: 'DrPass1' });
    await Holiday.create({ doctor: null, date: new Date(Date.UTC(2026, 11, 14)) }); // a Monday

    const res = await api().get(`/api/doctors/${doctor._id}/calendar?month=2026-12`).set(bearer(admin));
    expect(res.status).toBe(200);
    const flagged = res.body.days.find((d: { date: string }) => d.date === '2026-12-14');
    expect(flagged.holiday).toBe(true);
  });
});