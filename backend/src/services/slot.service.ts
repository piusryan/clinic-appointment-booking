import type { Types } from 'mongoose';
import Appointment from '../models/appointment.model';
import Holiday from '../models/holiday.model';
import type { Doctor } from '../models/doctor.model';
import { config } from '../config';
import { dayStartUtc, dateInTz, wallToUtc, weekdayOf } from '../utils/tz';
export { dayStartUtc };
import type { SlotDTO } from '../../../shared/types';

export interface SlotInstant {
  startsAt: Date;
  endsAt: Date;
}

const DAY_MS = 86_400_000;

/**
 * All times are UTC instants. Working hours are clinic-local wall clock.
 * Slot instants are DERIVED, never stored: generate from
 *   workingHours - holidays - booked appointments.
 */
export function slotInstantsFor(doctor: Pick<Doctor, 'workingHours' | 'slotMinutes'>, date: string): SlotInstant[] {
  const tz = config.clinicTz;
  const weekday = weekdayOf(date, tz);
  const windows = doctor.workingHours.filter((w) => w.day === weekday);
  if (windows.length === 0) return [];

  const dayStart = dayStartUtc(date, tz).getTime();
  const nextDay = dayStart + DAY_MS;

  const instants: SlotInstant[] = [];
  for (const win of windows) {
    let t = wallToUtc(date, win.start, tz).getTime();
    const end = wallToUtc(date, win.end, tz).getTime();
    const step = doctor.slotMinutes * 60_000;
    // Non-divisible tail: only full slots that fit inside the window are
    // produced. A 09:00-17:15 window at 30-minute slots drops the last
    // 15 minutes rather than inventing a partial appointment.
    while (t + step <= end) {
      instants.push({ startsAt: new Date(t), endsAt: new Date(t + step) });
      t += step;
    }
    void nextDay;
  }
  return instants;
}

export async function isHoliday(doctorId: string | Types.ObjectId, date: string): Promise<boolean> {
  const tz = config.clinicTz;
  const d = dayStartUtc(date, tz);
  const found = await Holiday.exists({
    date: { $gte: d, $lt: new Date(d.getTime() + DAY_MS) },
    $or: [{ doctor: null }, { doctor: doctorId }],
  });
  return Boolean(found);
}

/** Set of slot startsAt (epoch ms) currently occupied by a BOOKED appointment. */
export async function occupiedStarts(doctorId: string | Types.ObjectId, date: string): Promise<Set<number>> {
  const tz = config.clinicTz;
  const dayStart = dayStartUtc(date, tz).getTime();
  const rows = await Appointment.find({
    doctor: doctorId,
    status: 'booked',
    startsAt: { $gte: new Date(dayStart), $lt: new Date(dayStart + DAY_MS) },
  }).select({ startsAt: 1, _id: 1 });

  return new Set(rows.map((r) => new Date(r.startsAt).getTime()));
}

/**
 * The full availability grid for a doctor on a calendar date.
 * Availability ONLY — the returned slots never reveal the occupant
 * (free-slot enumeration IDOR rule in section 6).
 */
export async function getAvailability(doctor: Pick<Doctor, 'workingHours' | 'slotMinutes'>, doctorId: string, date: string): Promise<SlotDTO[]> {
  if (await isHoliday(doctorId, date)) return [];
  const occupied = await occupiedStarts(doctorId, date);
  return slotInstantsFor(doctor, date).map((s) => ({
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    available: !occupied.has(s.startsAt.getTime()),
  }));
}

/** Used by the booking service to cheaply confirm a requested start is derivable. */
export function isDerivableSlot(doctor: Pick<Doctor, 'workingHours' | 'slotMinutes'>, date: string, startsAt: Date): boolean {
  const wanted = startsAt.getTime();
  return slotInstantsFor(doctor, date).some((s) => s.startsAt.getTime() === wanted);
}

/** The date string (YYYY-MM-DD) a UTC instant falls on, in the clinic tz. */
export function dateKeyOf(instant: Date): string {
  return dateInTz(instant, config.clinicTz);
}

export interface MonthDaySummary {
  date: string;
  weekday: number;
  open: boolean;
  holiday: boolean;
  total: number;
  available: number;
}

/**
 * Month-wide availability summary used by the booking calendar. Every day in
 * the month (clinic zone) is evaluated: open if the doctor has scheduled
 * working hours, holiday if a clinic/doctor closure covers it, and slot
 * counts net of already-booked appointments. Batched into two range queries
 * so a 28-31 day month costs 2 queries, not 60.
 */
export async function monthCalendar(
  doctor: Pick<Doctor, 'workingHours' | 'slotMinutes'>,
  doctorId: string | Types.ObjectId,
  month: string
): Promise<MonthDaySummary[]> {
  const tz = config.clinicTz;
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

  const days: string[] = [];
  for (let d = 1; d <= daysInMonth; d += 1) {
    days.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  }

  const from = dayStartUtc(days[0], tz);
  const to = new Date(from.getTime() + days.length * DAY_MS);

  const holidays = await Holiday.find({
    date: { $gte: from, $lt: to },
    $or: [{ doctor: null }, { doctor: doctorId }],
  }).select({ date: 1, _id: 0 });
  const holidayDates = new Set(holidays.map((h) => h.date.toISOString().slice(0, 10)));

  const appts = await Appointment.find({
    doctor: doctorId,
    status: 'booked',
    startsAt: { $gte: from, $lt: to },
  }).select({ startsAt: 1, _id: 0 });
  const occupied = new Set(appts.map((a) => new Date(a.startsAt).getTime()));

  return days.map((date) => {
    const instants = slotInstantsFor(doctor, date);
    let available = 0;
    for (const s of instants) if (!occupied.has(s.startsAt.getTime())) available += 1;
    return {
      date,
      weekday: weekdayOf(date, tz),
      open: instants.length > 0,
      holiday: holidayDates.has(date),
      total: instants.length,
      available,
    };
  });
}