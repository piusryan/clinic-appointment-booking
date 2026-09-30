/**
 * lib/dates.js — every "today" and every YYYY-MM-DD in the UI comes from here.
 *
 * The bug this exists to prevent: a date is a CALENDAR concept (no zone, no
 * time), but the natural JavaScript way to build one is `new Date()`, which
 * invents a timezone, and then `toISOString()`, which converts to UTC. Those
 * two steps disagree by the viewer's UTC offset, so a user in Dublin picks
 * "today" and the request asks the server about yesterday after 23:00 local —
 * or the grid silently shifts by a day for anyone east of Greenwich.
 *
 * The rule used throughout: the VIEWER'S local date is the source of truth for
 * display and for choosing a day, and the server's UTC instants are the source
 * of truth for what actually happens. `localDateKey` and `parseIsoDate` are the
 * only sanctioned bridges between the two. Never `toISOString().slice(0,10)` on
 * a `Date` that came from a user-visible date, and never `new Date(y,m,d)` for
 * a calendar day.
 */

/** Local YYYY-MM-DD for a Date, or for "now" when given nothing. */
export function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse a YYYY-MM-DD into a LOCAL Date at midnight. Never UTC. */
export function parseIsoDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Parse a YYYY-MM-DD into a LOCAL Date at midday.
 *
 * Preferred wherever the Date is only a formatting carrier (Saka captions,
 * month headers). Midnight does not exist on spring-forward days in some
 * zones, and 00:00 can shift the calendar day out from under a formatter;
 * midday never does, because no DST transition happens at 12:00.
 */
export function parseIsoDateNoon(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** Local YYYY-MM for a Date, or for "now". */
export function localMonthKey(date = new Date()) {
  return `${localDateKey(date).slice(0, 7)}`;
}

/** Add days to a YYYY-MM-DD key, staying in local time. */
export function addDays(key, days) {
  const d = parseIsoDate(key);
  d.setDate(d.getDate() + days);
  return localDateKey(d);
}

/**
 * The seven YYYY-MM-DD keys of the week that CONTAINS `key`, Monday first.
 *
 * Monday-first matches the clinic's working-hours index, where weekday 1 is
 * Monday, so column N of the grid lines up with the doctor's schedule. A
 * Sunday-first grid would silently misalign the whole week.
 */
export function weekOf(key) {
  const start = parseIsoDate(key);
  const weekday = (start.getDay() + 6) % 7; // Mon=0 … Sun=6
  start.setDate(start.getDate() - weekday);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return localDateKey(d);
  });
}

/** Short weekday label for a key, e.g. "Mon". Local, no UTC round trip. */
export function weekdayLabel(key) {
  return parseIsoDate(key).toLocaleDateString(undefined, { weekday: 'short' });
}

/** "Mon 7 Dec" style label for a key. */
export function dayLabel(key) {
  return parseIsoDate(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * Local wall-clock label for an ISO UTC instant, e.g. "09:30".
 *
 * Rendered with the viewer's own locale/timezone on purpose: an instant is an
 * absolute moment, so showing it in the viewer's zone is the only non-lying
 * option. A clinic in Dublin showing 09:00 to a viewer in Tokyo is correct —
 * it IS 09:00 in Dublin, and the viewer is being told what time it is for them.
 */
export function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Full local rendering of an instant, for tooltips and list rows. */
export function dateTimeLabel(iso) {
  return new Date(iso).toLocaleString();
}
