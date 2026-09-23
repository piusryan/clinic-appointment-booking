import type { Types } from 'mongoose';
import Holiday from '../models/holiday.model';
import { notFound, conflict } from '../utils/errors';

/** Normalise a YYYY-MM-DD string to a UTC-midnight Date. */
export function calendarDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** For a clinic-wide closure omit doctorId (null). */
export async function addHoliday(input: { doctorId?: string | null; date: string }): Promise<{ id: string; date: string }> {
  const date = calendarDate(input.date);
  // Explicit guard so a duplicate closure is always a clean 409 regardless of
  // how the unique index treats null doctor values (Mongo treats multiple
  // nulls in a unique compound index as distinct). The index still backstops
  // the per-doctor race in production.
  const existing = await Holiday.findOne({ doctor: input.doctorId ?? null, date });
  if (existing) throw conflict('A holiday already covers that date');

  try {
    const doc = await Holiday.create({ doctor: input.doctorId ?? null, date });
    return { id: String(doc._id), date: input.date };
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw conflict('A holiday already covers that date');
    throw err;
  }
}

export async function listHolidays(input: { doctorId?: string; from?: string; to?: string }): Promise<Array<{ id: string; date: string; doctor: string | null }>> {
  const q: Record<string, unknown> = {};
  if (input.doctorId) q.$or = [{ doctor: input.doctorId }, { doctor: null }];
  else q.doctor = null;

  const range: Record<string, unknown> = {};
  if (input.from) range.$gte = calendarDate(input.from);
  if (input.to) range.$lt = new Date(calendarDate(input.to).getTime() + 86_400_000);
  if (Object.keys(range).length) q.date = range;

  const rows = await Holiday.find(q).sort({ date: 1 });
  return rows.map((h) => ({ id: String(h._id), date: h.date.toISOString().slice(0, 10), doctor: h.doctor ? String(h.doctor) : null }));
}

export async function removeHoliday(id: string): Promise<void> {
  const doc = await Holiday.findById(id);
  if (!doc) throw notFound('Holiday not found');
  await doc.deleteOne();
}

export type HolidayDoc = TypeHoliday & { _id: unknown };
type TypeHoliday = { doctor: Types.ObjectId | null; date: Date };