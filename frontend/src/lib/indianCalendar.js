/**
 * Indian-calendar helpers for the booking calendar.
 *
 *  1. Saka (Indian National Calendar) dates come straight from the browser's
 *     Intl engine via calendar: 'indian' — no hand-rolled lunar math.
 *  2. Festivals/occasions are a curated YYYY-MM-DD table (lunar dates move
 *     year by year; the entries below are the 2026 observed dates, and the
 *     fixed national holidays repeat every year).
 */

const SAKA_LONG = new Intl.DateTimeFormat('en-IN', {
  calendar: 'indian',
  day: 'numeric',
  month: 'long',
});
const SAKA_YEAR = new Intl.DateTimeFormat('en-IN', {
  calendar: 'indian',
  year: 'numeric',
});
const SAKA_MONTH = new Intl.DateTimeFormat('en-IN', {
  calendar: 'indian',
  month: 'long',
});

const pad = (n) => String(n).padStart(2, '0');
export const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

let sakaCache = new Map();
export function sakaCaption(dateStr) {
  if (sakaCache.has(dateStr)) return sakaCache.get(dateStr);
  const probe = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(probe.getTime())) return '';
  const parts = SAKA_LONG.formatToParts(probe);
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const caption = `${day} ${month}`;
  sakaCache.set(dateStr, caption);
  return caption;
}

export function sakaShort(dateStr) {
  return sakaCaption(dateStr).split(' ')[0];
}

export function sakaYearLabel(dateStr) {
  const probe = new Date(`${dateStr.slice(0, 7)}-15T12:00:00`);
  if (Number.isNaN(probe.getTime())) return '';
  return SAKA_YEAR.format(probe);
}

export function sakaMonthName(dateStr) {
  const probe = new Date(`${dateStr.slice(0, 7)}-15T12:00:00`);
  if (Number.isNaN(probe.getTime())) return '';
  return SAKA_MONTH.format(probe);
}

/** Fixed civil holidays that fall on the same Gregorian date every year. */
const YEARLY = {
  '01-01': ['New Year'],
  '01-26': ['Republic Day'],
  '08-15': ['Independence Day'],
  '10-02': ['Gandhi Jayanti'],
  '12-25': ['Christmas'],
};

/** Year-specific festival dates (lunar/solar calendars). 2026 observed dates. */
const FESTIVAL_CALENDAR = {
  '2026-01-14': ['Makar Sankranti', 'Pongal'],
  '2026-01-23': ['Vasant Panchami'],
  '2026-02-15': ['Maha Shivaratri'],
  '2026-03-04': ['Holi'],
  '2026-03-19': ['Ugadi', 'Gudi Padwa'],
  '2026-03-21': ['Eid ul-Fitr'],
  '2026-03-26': ['Rama Navami'],
  '2026-03-31': ['Mahavir Jayanti'],
  '2026-04-03': ['Good Friday'],
  '2026-04-05': ['Easter Sunday'],
  '2026-04-14': ['Vaisakhi'],
  '2026-04-15': ['Bohag Bihu'],
  '2026-05-01': ['Buddha Purnima'],
  '2026-05-27': ['Eid ul-Adha'],
  '2026-07-16': ['Rath Yatra'],
  '2026-08-26': ['Onam'],
  '2026-08-28': ['Raksha Bandhan'],
  '2026-09-04': ['Janmashtami'],
  '2026-09-14': ['Ganesh Chaturthi'],
  '2026-10-11': ['Navratri begins'],
  '2026-10-20': ['Dussehra'],
  '2026-11-08': ['Diwali'],
  '2026-11-15': ['Chhath Puja'],
  '2026-11-24': ['Guru Nanak Jayanti'],
};

/** Occasion name(s) for a YYYY-MM-DD string, deduped, in display order. */
export function indianOccasions(dateStr) {
  const y = dateStr.slice(0, 4);
  if (!/^\d{4}$/.test(y)) return [];
  const seen = new Set();
  const out = [];
  for (const name of [...(YEARLY[dateStr.slice(5)] ?? []), ...(FESTIVAL_CALENDAR[dateStr] ?? [])]) {
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

export function monthCaption(monthStr) {
  const probe = new Date(`${monthStr}-15T12:00:00`);
  const greg = probe.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  const saka = SAKA_MONTH.format(probe);
  const sakaYear = SAKA_YEAR.format(probe);
  return { greg, saka, sakaYear };
}

export function addMonths(monthStr, delta) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + delta);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];