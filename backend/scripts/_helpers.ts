/**
 * Shared helpers for the proof scripts: date/window maths kept out of the
 * demonstrations themselves so the scripts read like evidence, not infrastructure.
 */
export { dateKeyOf, slotInstantsFor } from '../src/services/slot.service';

export function weekdaysFromDate(dateStr: string, weekday: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  const delta = (weekday - day.getUTCDay() + 7) % 7;
  const next = new Date(day.getTime() + (delta === 0 ? 7 : delta) * 86_400_000);
  return next.toISOString().slice(0, 10);
}