/**
 * Zone math for slot generation.
 *
 * The clinic expresses its working hours in a fixed IANA zone (CLINIC_TZ).
 * A wall-clock moment like "2026-09-01 14:30" has to be turned into a UTC
 * instant so that appointments are *stored* in UTC (module 5 rule) while the
 * *frontend* renders them back in the viewer's local zone.
 *
 * There is no built-in "wall time in zone Z -> UTC instant" primitive, so we
 * solve the offset iteratively: format a guess as the zone's wall clock,
 * measure the gap, apply it to the next guess, and repeat. The offset is
 * stable after 1-2 iterations (DST boundaries included — at worst we pick one
 * of the two possible interpretations of an ambiguous fold hour, which is
 * fine for a clinic's opening windows).
 */

export function getZoneOffsetMs(instant: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(instant));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const wallAsUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second)
  );
  return wallAsUtc - instant;
}

/** Convert a calendar date + "HH:MM" wall-clock start (clinic zone) to a UTC Date. */
export function wallToUtc(date: string, hhmm: string, tz: string): Date {
  const b = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!b) throw new Error(`Invalid date: ${date}`);
  const m = hhmm.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!m) throw new Error(`Invalid time: ${hhmm}`);
  const wallAsUtc = Date.UTC(
    Number(b[1]),
    Number(b[2]) - 1,
    Number(b[3]),
    Number(m[1]),
    Number(m[2]),
    0
  );

  let guess = wallAsUtc;
  for (let i = 0; i < 3; i += 1) {
    const offset = getZoneOffsetMs(guess, tz);
    const next = wallAsUtc - offset;
    if (getZoneOffsetMs(next, tz) === offset) {
      guess = next;
      break;
    }
    guess = next;
  }
  return new Date(guess);
}

/** The UTC instant of "start of calendar day `date`" in the clinic zone. */
export function dayStartUtc(date: string, tz: string): Date {
  return wallToUtc(date, '00:00', tz);
}

/** Weekday (0-6) of a calendar date, in the clinic zone. */
export function weekdayOf(date: string, tz: string): number {
  return dayStartUtc(date, tz).getUTCDay();
}

/** Format a UTC instant as "YYYY-MM-DD" in `tz`. */
export function dateInTz(instant: Date, tz: string): string {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}