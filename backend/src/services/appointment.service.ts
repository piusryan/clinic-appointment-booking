import mongoose, { type ClientSession, type Types } from 'mongoose';
import Appointment, { type Appointment as AppointmentAttrs } from '../models/appointment.model';
import Doctor from '../models/doctor.model';
import Patient from '../models/patient.model';
import { notFound, conflict, unprocessable, badRequest } from '../utils/errors';
import { isDerivableSlot, dateKeyOf } from './slot.service';
import type { RequestUser } from '../types/auth.types';

async function withTransaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    return (await session.withTransaction(() => fn(session))) as T;
  } finally {
    await session.endSession();
  }
}

function isDupKey(err: unknown): boolean {
  return (err as { code?: number }).code === 11000;
}

async function loadDoctor(doctorId: string | Types.ObjectId) {
  const doctor = await Doctor.findById(doctorId);
  if (!doctor) throw notFound('Doctor not found');
  return doctor;
}

export interface AppointmentView {
  id: string;
  doctor: { id: string; name: string; speciality: string; slotMinutes: number };
  patient?: { id: string; name: string; phone: string };
  startsAt: Date;
  endsAt: Date;
  status: string;
}

// HACK: the type gymnastics here are because mongoose populate types are a mess
// TODO: replace with a proper projection + types once we upgrade mongoose
function toView(row: AppointmentAttrs & { doctor: { _id: Types.ObjectId; name: string; speciality: string; slotMinutes: number }; patient?: { _id: Types.ObjectId; name: string; phone: string } }): AppointmentView {
  const r = row as unknown as { _id: Types.ObjectId };
  return {
    id: String(r._id),
    doctor: {
      id: String(row.doctor._id),
      name: row.doctor.name,
      speciality: row.doctor.speciality,
      slotMinutes: row.doctor.slotMinutes,
    },
    patient: row.patient
      ? { id: String(row.patient._id), name: row.patient.name, phone: row.patient.phone }
      : undefined,
    startsAt: new Date(row.startsAt),
    endsAt: new Date(row.endsAt),
    status: row.status,
  };
}

export async function bookAppointment(input: {
  patientId: string;
  doctorId: string;
  startsAt: string;
  actor: RequestUser;
}): Promise<AppointmentView> {
  const { patientId, doctorId, startsAt } = input;
  const doctor = await loadDoctor(doctorId);
  const want = new Date(startsAt);
  if (Number.isNaN(want.getTime())) throw unprocessable('Invalid startsAt');
  const date = dateKeyOf(want);

  // cheap reject — don't open a tx if they're booking off-hours
  if (!isDerivableSlot(doctor, date, want)) {
    throw unprocessable('That time is outside the doctor\'s working hours', 'Pick a slot from the availability grid');
  }

  const created = await withTransaction(async (session) => {
    const taken = await Appointment.exists({ doctor: doctor._id, startsAt: want, status: 'booked' }).session(session);
    if (taken) throw conflict('That slot was taken while you were deciding');

    if (!(await Patient.exists({ _id: patientId }).session(session))) {
      throw notFound('Patient not found');
    }

    const endsAt = new Date(want.getTime() + doctor.slotMinutes * 60_000);
    const [doc] = await Appointment.create(
      [{ doctor: doctor._id, patient: patientId, startsAt: want, endsAt, status: 'booked' }],
      { session }
    );
    // funny: populate called twice. doc is a single subdoc from create(array),
    // mongoose 7 types get confused — leaving as-is, it works
    await doc.populate('doctor', 'name speciality slotMinutes slotMinutes');
    await doc.populate('patient', 'name phone');
    return doc;
  }).catch((err: unknown) => {
    if (isDupKey(err)) throw conflict('That slot was taken by someone else — exactly one booking survives');
    throw err;
  });

  return toView(created as unknown as Parameters<typeof toView>[0]);
}

export async function setAppointmentStatus(id: string, status: 'completed' | 'no-show'): Promise<void> {
  await withTransaction(async (session) => {
    const appt = await Appointment.findOne({ _id: id }).session(session);
    if (!appt) throw notFound('Appointment not found');
    if (appt.status !== 'booked') throw conflict('Only a booked appointment can be marked');
    appt.status = status;
    await appt.save({ session });
  });
}

export async function cancelAppointment(id: string): Promise<void> {
  await withTransaction(async (session) => {
    const appt = await Appointment.findOne({ _id: id }).session(session);
    if (!appt) throw notFound('Appointment not found');
    if (appt.status === 'cancelled') throw conflict('Appointment is already cancelled');
    if (appt.status !== 'booked') throw unprocessable('Only a booked appointment can be cancelled');
    appt.status = 'cancelled';
    appt.cancelledAt = new Date();
    await appt.save({ session });
  });
}

export async function rescheduleAppointment(id: string, newStartsAt: string): Promise<void> {
  const target = new Date(newStartsAt);
  if (Number.isNaN(target.getTime())) throw unprocessable('Invalid newStartsAt');

  await withTransaction(async (session) => {
    const appt = await Appointment.findOne({ _id: id }).session(session);
    if (!appt) throw notFound('Appointment not found');
    if (appt.status !== 'booked') throw unprocessable('Only a booked appointment can be rescheduled');

    const doctor = await loadDoctor(appt.doctor);
    const date = dateKeyOf(target);
    if (!isDerivableSlot(doctor, date, target)) {
      throw unprocessable('New time is outside the doctor\'s working hours');
    }
    if (appt.startsAt.getTime() === target.getTime()) {
      throw badRequest('Appointment is already at that time');
    }

    const clash = await Appointment.exists({
      doctor: appt.doctor,
      startsAt: target,
      status: 'booked',
      _id: { $ne: appt._id },
    }).session(session);
    if (clash) throw conflict('The new slot was taken while rescheduling');

    appt.startsAt = target;
    appt.endsAt = new Date(target.getTime() + doctor.slotMinutes * 60_000);
    await appt.save({ session });
  });
}

export async function getSchedule(doctorId: string, date?: string): Promise<AppointmentView[]> {
  const range = date ? rangeMatch(date) : {};
  const rows = await Appointment.aggregate([
    { $match: { doctor: new mongoose.Types.ObjectId(doctorId), ...range } },
    { $lookup: { from: 'doctors', localField: 'doctor', foreignField: '_id', as: 'doctor' } },
    { $lookup: { from: 'patients', localField: 'patient', foreignField: '_id', as: 'patient' } },
    { $unwind: '$doctor' },
    { $unwind: { path: '$patient', preserveNullAndEmptyArrays: true } },
    // cancelled ones still show up if we don't filter — reception asked for this
    { $match: { status: { $ne: 'cancelled' } } },
    { $sort: { startsAt: 1 } },
  ]);
  return (rows as unknown as Array<Parameters<typeof toView>[0]>).map(toView);
}

function rangeMatch(date: string): Record<string, unknown> {
  const [y, m, d] = date.split('-').map(Number);
  const start = Date.UTC(y, m - 1, d);
  return { startsAt: { $gte: new Date(start), $lt: new Date(start + 86_400_000) } };
}