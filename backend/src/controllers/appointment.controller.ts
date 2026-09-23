import type { Request, Response } from 'express';
import mongoose, { type Types } from 'mongoose';
import Appointment from '../models/appointment.model';
import * as appointmentService from '../services/appointment.service';
import { logRead } from '../services/audit.service';
import { notFound } from '../utils/errors';
import type { BookAppointmentPayload, ReschedulePayload } from '../../../shared/types';
import type { AppointmentView } from '../services/appointment.service';

interface PopulatedAppointment {
  _id: Types.ObjectId;
  startsAt: Date;
  endsAt: Date;
  status: string;
  doctor: { _id: Types.ObjectId; name: string; speciality: string; slotMinutes: number };
  patient?: { _id: Types.ObjectId; name: string; phone: string };
}

// duplicate of the one in service — see HACK note there. avoiding circular import
function toView(r: PopulatedAppointment): AppointmentView {
  return {
    id: String(r._id),
    doctor: { id: String(r.doctor._id), name: r.doctor.name, speciality: r.doctor.speciality, slotMinutes: r.doctor.slotMinutes },
    patient: r.patient ? { id: String(r.patient._id), name: r.patient.name, phone: r.patient.phone } : undefined,
    startsAt: new Date(r.startsAt),
    endsAt: new Date(r.endsAt),
    status: r.status,
  };
}

export async function book(req: Request<unknown, unknown, BookAppointmentPayload>, res: Response): Promise<void> {
  const created = await appointmentService.bookAppointment({
    patientId: String(req.body.patientId),
    doctorId: String(req.body.doctorId),
    startsAt: String(req.body.startsAt),
    actor: req.user!,
  });
  res.status(201).json({ appointment: created });
}

export async function index(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const rows = await listFor(user, req.query as Record<string, string | undefined>);
  res.status(200).json({ appointments: rows });
}

export async function show(req: Request<{ id: string }>, res: Response): Promise<void> {
  const row = await Appointment.findById(req.params.id)
    .populate('doctor', 'name speciality slotMinutes')
    .populate('patient', 'name phone');
  if (!row) throw notFound('Appointment not found');
  await logRead({
    actor: req.user!,
    action: 'appointment.read',
    targetPatient: String((row as unknown as PopulatedAppointment).patient?._id ?? row.patient),
    resourceId: String(row._id),
    ip: req.ip,
  });
  res.status(200).json({ appointment: toView(row as unknown as PopulatedAppointment) });
}

export async function cancel(req: Request<{ id: string }>, res: Response): Promise<void> {
  await appointmentService.cancelAppointment(req.params.id);
  res.status(204).end();
}

export async function status(req: Request<{ id: string }, unknown, { status: string }>, res: Response): Promise<void> {
  if (req.body.status !== 'completed' && req.body.status !== 'no-show') {
    res.status(422).json({ error: 'UnprocessableContent', message: 'status must be completed or no-show' });
    return;
  }
  await appointmentService.setAppointmentStatus(req.params.id, req.body.status);
  res.status(204).end();
}

export async function reschedule(req: Request<{ id: string }, unknown, ReschedulePayload>, res: Response): Promise<void> {
  await appointmentService.rescheduleAppointment(req.params.id, String(req.body.newStartsAt));
  // FIXME: avoid double-read — service already has the doc but doesn't return it
  const row = await Appointment.findById(req.params.id).populate('doctor', 'name speciality slotMinutes').populate('patient', 'name phone');
  res.status(200).json({ appointment: row ? toView(row as unknown as PopulatedAppointment) : undefined });
}

async function listFor(user: { role: string; patientId?: string; doctorId?: string }, q: Record<string, string | undefined>): Promise<AppointmentView[]> {
  const filter: Record<string, unknown> = {};
  const inQuery = (v: string | undefined): v is string => Boolean(v);
  if (user.role === 'patient') {
    filter.patient = new mongoose.Types.ObjectId(user.patientId);
  } else if (user.role === 'doctor') {
    filter.doctor = new mongoose.Types.ObjectId(user.doctorId!);
  } else {
    // staff can filter
    if (inQuery(q.doctorId)) filter.doctor = new mongoose.Types.ObjectId(q.doctorId);
    if (inQuery(q.patientId)) filter.patient = new mongoose.Types.ObjectId(q.patientId);
  }
  if (inQuery(q.status) && q.status !== 'all') filter.status = q.status;
  if (inQuery(q.from)) filter.startsAt = { $gte: new Date(q.from) };

  // NOTE: hard cap at 100 — reception asked for pagination but not yet
  const rows = await Appointment.find(filter)
    .sort({ startsAt: -1 })
    .limit(100)
    .populate('doctor', 'name speciality slotMinutes')
    .populate('patient', 'name phone');
  return rows.map((r) => toView(r as unknown as PopulatedAppointment));
}