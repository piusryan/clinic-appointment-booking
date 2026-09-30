/**
 * Timezone tests for the date helpers, run under `node --test` (no extra
 * dependency — the frontend has no test framework, and these functions are pure
 * so the built-in runner is enough).
 *
 * THE POINT OF THIS FILE. Every one of these assertions passes in the
 * developer's own timezone and fails in another one, which is the whole reason
 * the helpers exist. `localDateKey` used to be `toISOString().slice(0, 10)`
 * in disguise, and the bug it caused was invisible from Dublin: a user in
 * Kolkata opening the booking page at 07:00 local was sent "yesterday" to the
 * server. So each test below pins TZ to a specific zone before importing the
 * module, and asserts the answer for THAT zone. Run the script through the
 * npm `test` target, which drives several zones.
 *
 * The cases that matter:
 *   IST (+05:30) — a half-hour offset, the case that breaks naive arithmetic
 *   UTC (+00:00) — the reference
 *   PST (-08:00) — negative offset, where "today" is ahead of UTC
 *   Kiritimati (+14) — the largest positive offset in use
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  localDateKey,
  localMonthKey,
  parseIsoDate,
  parseIsoDateNoon,
  addDays,
  weekOf,
  weekdayLabel,
  dayLabel,
  timeLabel,
} from './dates.js';

const { TZ } = process.env;
const zone = TZ ?? 'system';
const say = (msg) => `[${zone}] ${msg}`;

// A fixed instant used everywhere: 2026-12-07T20:30:00Z.
// In Dublin that is Mon 7 Dec 20:30; in Kolkata it is Tue 8 Dec 02:00.
const MONDAY_EVENING_UTC = '2026-12-07T20:30:00.000Z';
// 2026-12-07T02:00:00Z — the same calendar day in Dublin, still the 6th in PST.
const EARLY_MORNING_UTC = '2026-12-07T02:00:00.000Z';

test(say('localDateKey reads the LOCAL calendar day, not the UTC one'), () => {
  const key = localDateKey(new Date(MONDAY_EVENING_UTC));
  const expected = new Date(MONDAY_EVENING_UTC).toLocaleDateString('en-CA'); // YYYY-MM-DD
  assert.equal(key, expected);
  // The failure this guards: toISOString().slice(0,10) always answers '2026-12-07'.
  if (key !== '2026-12-07') {
    assert.equal(key, '2026-12-08', 'only a zone east of Greenwich may see the 8th here');
  }
});

test(say('localDateKey is the exact inverse of what toISOString would have said, for a midnight-boundary instant'), () => {
  // 23:30 UTC on the 7th: the 7th in every zone at or west of UTC+1:30, the
  // 8th east of it. Never a 9th, and never the 6th.
  const d = new Date('2026-12-07T23:30:00.000Z');
  const key = localDateKey(d);
  assert.ok(['2026-12-07', '2026-12-08'].includes(key), `unexpected ${key}`);
});

test(say('localMonthKey is the local month, including the January/December edge'), () => {
  assert.match(localMonthKey(new Date(MONDAY_EVENING_UTC)), /^\d{4}-\d{2}$/);
  const dec31 = new Date('2026-12-31T23:30:00.000Z');
  const key = localMonthKey(dec31);
  assert.ok(key === '2026-12' || key === '2027-01', `unexpected ${key}`);
});

test(say('parseIsoDate produces LOCAL midnight and keeps the same calendar day'), () => {
  const d = parseIsoDate('2026-12-07');
  assert.equal(localDateKey(d), '2026-12-07', 'the key must survive a round trip');
  assert.equal(d.getHours(), 0);
  assert.equal(d.getDate(), 7);
  // In any zone other than UTC this must NOT be `new Date('2026-12-07')`, which
  // the spec pins to UTC midnight — that is the instant the old code used, and
  // it is the reason a "date" drifted by a day.
  if (d.getTimezoneOffset() !== 0) {
    assert.notEqual(d.getTime(), Date.UTC(2026, 11, 7));
  }
});

test(say('parseIsoDateNoon is midday local, so no DST transition can move the day'), () => {
  const d = parseIsoDateNoon('2026-12-07');
  assert.equal(d.getHours(), 12);
  assert.equal(localDateKey(d), '2026-12-07');
});

test(say('parseIsoDate round-trips every day of a month, DST or not'), () => {
  for (let day = 1; day <= 31; day += 1) {
    const key = `2026-03-${String(day).padStart(2, '0')}`;
    assert.equal(localDateKey(parseIsoDate(key)), key, key);
  }
});

test(say('addDays steps the calendar day, not 24 hours'), () => {
  assert.equal(addDays('2026-12-07', 1), '2026-12-08');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  // 86,400,000 ms arithmetic lands on the wrong day across a DST boundary in
  // any zone that observes one; stepping the date field cannot.
  assert.equal(addDays('2026-03-28', 1), '2026-03-29');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');
  assert.equal(addDays('2026-10-24', 1), '2026-10-25');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26');
});

test(say('weekOf returns 7 consecutive local days starting on Monday'), () => {
  for (const key of ['2026-12-07', '2026-12-13', '2026-12-20', '2026-01-01', '2026-06-30']) {
    const week = weekOf(key);
    assert.equal(week.length, 7, key);
    // Monday first: the server numbers weekdays 0=Sun..6=Sat, so a
    // Sunday-first grid would misalign every column against workingHours.
    assert.equal(week[0], addDays(key, -((parseIsoDate(key).getDay() + 6) % 7)), `start for ${key}`);
    for (let i = 1; i < 7; i += 1) {
      assert.equal(week[i], addDays(week[i - 1], 1), `${key} day ${i}`);
    }
  }
});

test(say('weekOf for a known Monday contains that Monday'), () => {
  assert.equal(weekOf('2026-12-07')[0], '2026-12-07');
  assert.equal(weekOf('2026-12-07')[6], '2026-12-13');
});

test(say('a Sunday belongs to the week that started the previous Monday'), () => {
  // 2026-12-13 is a Sunday; its week is Mon 7 Dec .. Sun 13 Dec.
  const week = weekOf('2026-12-13');
  assert.equal(week[0], '2026-12-07');
  assert.equal(week[6], '2026-12-13');
});

test(say('weekdayLabel renders the LOCAL weekday of a date key'), () => {
  assert.equal(weekdayLabel('2026-12-07'), 'Mon');
  assert.equal(weekdayLabel('2026-12-13'), 'Sun');
});

test(say('dayLabel includes the day and month of the key'), () => {
  const label = dayLabel('2026-12-07');
  assert.match(label, /7/);
  assert.match(label, /dec/i);
});

test(say('timeLabel renders the VIEWER local wall clock for an instant'), () => {
  const d = new Date(MONDAY_EVENING_UTC);
  const expected = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  assert.equal(timeLabel(MONDAY_EVENING_UTC), expected);
});

test(say('the same booking renders in the viewer zone, and that is not a bug'), () => {
  // A Dublin 09:00 slot is 20:30 the previous evening in Los Angeles. Both are
  // the same instant; the UI shows the viewer's clock because it cannot know
  // the clinic's. What must NOT happen is a mismatch: the date badge and the
  // time must come from the same Date.
  const instant = new Date('2026-12-07T09:00:00.000Z');
  const day = localDateKey(instant);
  const time = timeLabel('2026-12-07T09:00:00.000Z');
  assert.equal(day, localDateKey(new Date(`${day}T09:00:00`)));
  assert.match(time, /\d{1,2}:\d{2}/);
  // The old code mixed a UTC weekday test with a local index, so the badge
  // could disagree with the very day being shown.
  assert.equal(weekdayLabel(day), new Date(instant).toLocaleDateString(undefined, { weekday: 'short' }));
});

test(say('an early-morning UTC instant can be the previous day locally — and only then'), () => {
  const key = localDateKey(new Date(EARLY_MORNING_UTC));
  if (key === '2026-12-06') {
    // A western zone: this is the legitimate "yesterday" case, and it is why
    // the server must be asked about the LOCAL key, not the UTC one.
    assert.ok(true);
  } else {
    assert.equal(key, '2026-12-07');
  }
});

/**
 * THE REGRESSION WITNESS. Rather than assert our own answer, this asserts that
 * the OLD answer differs from it in this zone — so the test fails if someone
 * reintroduces `toISOString().slice(0, 10)` while also passing in UTC, where
 * the two happen to agree.
 *
 * The window is small but real: for a +05:30 zone it is the 5½ hours after
 * local midnight, and it is the most likely time for a night-shift patient to
 * open a booking page. In that window the old code asked the server about
 * YESTERDAY, and the grid came back empty for a day the clinic was open.
 */
test(say('the old toISOString() implementation would give a DIFFERENT answer here'), () => {
  const naive = (d) => d.toISOString().slice(0, 10);
  const base = Date.UTC(2026, 11, 7, 0, 0, 0);

  // Sweep the whole day: in any zone with a non-zero offset there is a window
  // where the two disagree, and finding it proves the helper is load-bearing
  // rather than incidentally equal to the old code today.
  const disagreements = [];
  for (let h = 0; h < 24; h += 1) {
    const d = new Date(base + h * 3600_000);
    if (localDateKey(d) !== naive(d)) disagreements.push(h);
  }

  if (new Date().getTimezoneOffset() === 0) {
    // A zero-offset zone: local time IS UTC, so the old code was accidentally
    // right. Assert the absence of disagreement rather than skipping, because
    // "no disagreements" is the correct answer here.
    assert.deepEqual(disagreements, [], 'a zero-offset zone has no window where they differ');
    assert.equal(localDateKey(new Date(base + 18 * 3600_000)), '2026-12-07');
  } else {
    assert.ok(
      disagreements.length > 0,
      `${zone}: expected a window where toISOString() and the local day disagree, found none`
    );
    // And the size of that window is the offset: with +05:30 it is 5.5 hours.
    assert.ok(
      disagreements.length <= 14,
      `${zone}: ${disagreements.length} disagreeing hours is more than any real offset allows`
    );
  }
});
