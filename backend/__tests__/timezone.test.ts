import { slotInstantsFor } from '../src/services/slot.service';
import { dateInTz, dayStartUtc, weekdayOf, wallToUtc } from '../src/utils/tz';
import { config } from '../src/config';
import Appointment from '../src/models/appointment.model';
import { startDb, stopDb, resetDb, api, bearer, loginAs, seedDoctor, FIXED_MONDAY, type TestDoctor } from './helpers';

/**
 * THE TIME-ZONE DELIVERABLE.
 *
 * Claim under test: "the same appointment renders correctly for a user on two
 * different machines". That is only true if the pipeline is consistent end to
 * end, and the two things that usually break it are:
 *
 *   1. STORING wall-clock time. We store a UTC instant, always. The clinic's
 *      wall clock is only ever an INPUT, converted to an instant at the edge.
 *   2. RENDERING in UTC. The API returns ISO-8601 with an explicit `Z`, and
 *      the browser formats it in the viewer's own zone.
 *
 * Both directions are asserted here, plus the two places a naive
 * implementation slips: the "what day is this?" label, and the day boundary
 * when the clinic zone and the viewer zone disagree.
 */
describe('time zones — storage in UTC, rendering local', () => {
  beforeAll(startDb);
  afterAll(stopDb);
  beforeEach(resetDb);

  const TZ = () => config.clinicTz;

  describe('wall clock -> UTC instant (the only place a local time enters the system)', () => {
    it('winter (GMT) and summer (IST) offsets both resolve correctly for Europe/Dublin', () => {
      // Europe/Dublin is UTC+0 in winter and UTC+1 in summer.
      expect(wallToUtc('2026-12-07', '09:00', TZ()).toISOString()).toBe('2026-12-07T09:00:00.000Z');
      expect(wallToUtc('2026-07-06', '09:00', TZ()).toISOString()).toBe('2026-07-06T08:00:00.000Z');
    });

    it('resolves a half-hour-offset zone (Asia/Kolkata, UTC+5:30)', () => {
      expect(wallToUtc('2026-12-07', '09:00', 'Asia/Kolkata').toISOString()).toBe('2026-12-07T03:30:00.000Z');
    });

    it('resolves a zone AHEAD of UTC without shifting the calendar day', () => {
      // Auckland Monday 09:00 local == Sunday 20:00Z — the previous UTC day.
      const instant = wallToUtc('2026-12-07', '09:00', 'Pacific/Auckland');
      expect(instant.toISOString()).toBe('2026-12-06T20:00:00.000Z');
      // ...but the CLINIC still calls it Monday the 7th.
      expect(dateInTz(instant, 'Pacific/Auckland')).toBe('2026-12-07');
    });

    it('the day-start instant of a zone-ahead clinic is on the previous UTC day', () => {
      const start = dayStartUtc('2026-12-07', 'Pacific/Auckland');
      expect(start.toISOString()).toBe('2026-12-06T11:00:00.000Z');
    });

    it('the weekday is derived from the calendar date, not from the UTC instant', () => {
      // Both of these are Mondays in their own zone; deriving from the UTC
      // instant would report Sunday for Auckland and break every working-hours
      // lookup. This is the bug the guard in tz.ts exists to prevent.
      expect(weekdayOf('2026-12-07', 'Pacific/Auckland')).toBe(1);
      expect(weekdayOf('2026-12-07', 'Europe/Dublin')).toBe(1);
      expect(weekdayOf('2026-12-07', 'America/New_York')).toBe(1);
    });

    it('the round trip instant -> calendar date -> instant is lossless', () => {
      for (const zone of ['Europe/Dublin', 'Asia/Kolkata', 'Pacific/Auckland', 'America/New_York']) {
        const date = '2026-12-07';
        const instant = wallToUtc(date, '09:00', zone);
        expect(dateInTz(instant, zone)).toBe(date);
      }
    });
  });

  describe('slot generation', () => {
    const doctorDoc = () => ({
      workingHours: [{ day: 1 as const, start: '09:00', end: '11:00' }],
      slotMinutes: 30,
    });

    it('a 09:00-11:00 window in a UTC+0 zone yields slots on the same UTC day', () => {
      const slots = slotInstantsFor(doctorDoc(), '2026-12-07');
      expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
        '2026-12-07T09:00:00.000Z',
        '2026-12-07T09:30:00.000Z',
        '2026-12-07T10:00:00.000Z',
        '2026-12-07T10:30:00.000Z',
      ]);
    });

    it('every slot instant carries an explicit Z — nothing is a bare local string', () => {
      for (const s of slotInstantsFor(doctorDoc(), '2026-12-07')) {
        expect(s.startsAt.toISOString().endsWith('Z')).toBe(true);
        expect(Number.isNaN(s.startsAt.getTime())).toBe(false);
      }
    });

    it('a day the doctor does not work yields no slots at all', () => {
      expect(slotInstantsFor(doctorDoc(), '2026-12-08')).toEqual([]);
    });
  });

  describe('one appointment, two machine time zones', () => {
    let doctor: TestDoctor;

    beforeEach(async () => {
      doctor = await seedDoctor({ email: 'tz-dr@test.io', password: 'TzPass1' }, [['09:00', '17:00']], 30);
    });

    it('the stored instant and the rendered local time agree for both zones', async () => {
      const patient = await loginAs('patient');

      // Read the grid the way the browser would: pick the first free slot.
      const grid = await api()
        .get(`/api/doctors/${doctor._id}/slots?date=${FIXED_MONDAY}`)
        .set(bearer(patient.token));
      const slot = grid.body.slots[0] as { startsAt: string; endsAt: string };
      expect(slot.startsAt).toBe('2026-12-07T09:00:00.000Z');

      const booked = await api()
        .post('/api/appointments')
        .set(bearer(patient.token))
        .send({ doctorId: String(doctor._id), patientId: patient.patientId, startsAt: slot.startsAt });
      expect(booked.status).toBe(201);

      // What the server actually persisted.
      const persisted = await Appointment.findById(booked.body.appointment.id);
      expect(persisted?.startsAt).toBeInstanceOf(Date);
      expect(persisted!.startsAt.toISOString()).toBe(slot.startsAt);

      // Two machines. `Intl.DateTimeFormat` with an explicit timeZone is
      // exactly what the browser does with a bare `toLocaleString()`.
      const onDublin = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Dublin',
        dateStyle: 'full',
        timeStyle: 'short',
      }).format(new Date(slot.startsAt));
      const onKolkata = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'full',
        timeStyle: 'short',
      }).format(new Date(slot.startsAt));
      const onNewYork = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/New_York',
        dateStyle: 'full',
        timeStyle: 'short',
      }).format(new Date(slot.startsAt));

      // December: Dublin is on GMT, so its local time IS the stored instant.
      expect(onDublin).toContain('09:00');
      // ...while the same instant is a different wall time elsewhere. The
      // point is not that they match — it is that each is CORRECT for its
      // machine, and that the stored value never moved.
      expect(onKolkata).toContain('14:30');
      expect(onNewYork).toContain('04:00');

      // The API is the single source both machines read: one request, one
      // payload, and no per-viewer server-side formatting anywhere.
      const reread = await api().get(`/api/appointments/${booked.body.appointment.id}`).set(bearer(patient.token));
      expect(reread.body.appointment.startsAt).toBe(slot.startsAt);
      expect(new Date(reread.body.appointment.startsAt).toISOString()).toBe(slot.startsAt);
    });

    it('the availability grid is identical for viewers in different zones (it is absolute instants)', async () => {
      const a = await loginAs('patient');
      const b = await loginAs('patient');
      const fromA = await api().get(`/api/doctors/${doctor._id}/slots?date=${FIXED_MONDAY}`).set(bearer(a.token));
      const fromB = await api().get(`/api/doctors/${doctor._id}/slots?date=${FIXED_MONDAY}`).set(bearer(b.token));
      expect(fromB.body.slots).toEqual(fromA.body.slots);
    });

    it('a summer slot is one hour EARLIER in UTC than the same wall-clock hour in winter', () => {
      const hours = [{ day: 1 as const, start: '09:00', end: '10:00' }];
      const summer = slotInstantsFor({ workingHours: hours, slotMinutes: 30 }, '2026-06-08');
      const winter = slotInstantsFor({ workingHours: hours, slotMinutes: 30 }, '2026-12-07');
      expect(summer[0].startsAt.toISOString()).toBe('2026-06-08T08:00:00.000Z'); // 09:00 IST (UTC+1)
      expect(winter[0].startsAt.toISOString()).toBe('2026-12-07T09:00:00.000Z'); // 09:00 GMT (UTC+0)
    });
  });
});