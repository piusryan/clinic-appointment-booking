import type { Request, Response } from 'express';
import * as doctorService from '../services/doctor.service';
import * as slotService from '../services/slot.service';
import * as appointmentService from '../services/appointment.service';
import { logRead } from '../services/audit.service';
import type { CreateDoctorPayload, UpdateDoctorPayload } from '../../../shared/types';
import type { Types } from 'mongoose';

type Id = string | Types.ObjectId;

export async function index(req: Request, res: Response): Promise<void> {
  const speciality = typeof req.query.speciality === 'string' ? req.query.speciality : undefined;
  res.status(200).json({ doctors: await doctorService.listDoctors(speciality) });
}

export async function show(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.status(200).json({ doctor: await doctorService.getDoctor(req.params.id) });
}

export async function create(req: Request<unknown, unknown, CreateDoctorPayload>, res: Response): Promise<void> {
  res.status(201).json({ doctor: await doctorService.createDoctor(req.body) });
}

export async function update(req: Request<{ id: string }, unknown, UpdateDoctorPayload>, res: Response): Promise<void> {
  const payload: UpdateDoctorPayload = {
    ...(req.body.name !== undefined && { name: String(req.body.name) }),
    ...(req.body.speciality !== undefined && { speciality: String(req.body.speciality) }),
    ...(req.body.slotMinutes !== undefined && { slotMinutes: Number(req.body.slotMinutes) }),
    ...(Array.isArray(req.body.workingHours) && { workingHours: req.body.workingHours }),
  };
  res.status(200).json({ doctor: await doctorService.updateDoctor(req.params.id, payload) });
}

export async function remove(req: Request<{ id: string }>, res: Response): Promise<void> {
  await doctorService.deleteDoctor(req.params.id);
  res.status(204).end();
}

/** Free availability for a day — never reveals occupants. */
export async function slots(req: Request<{ id: string }>, res: Response): Promise<void> {
  const date = (req.query.date as string | undefined) ?? slotService.dateKeyOf(new Date());
  const doctor = await doctorService.getDoctor(req.params.id as Id);
  const grid = await slotService.getAvailability(doctor, String(req.params.id), date);
  await logRead({
    actor: req.user!,
    action: 'slots.read',
    targetDoctor: String(req.params.id),
    resourceId: String(req.params.id),
    ip: req.ip,
  });
  res.status(200).json({ slots: grid, doctor });
}

/** Month-wide availability summary for the booking calendar. */
export async function calendar(req: Request<{ id: string }>, res: Response): Promise<void> {
  const month = (req.query.month as string | undefined) ?? new Date().toISOString().slice(0, 7);
  const doctor = await doctorService.getDoctor(req.params.id as Id);
  const days = await slotService.monthCalendar(doctor, String(req.params.id), month);
  await logRead({
    actor: req.user!,
    action: 'calendar.read',
    targetDoctor: String(req.params.id),
    resourceId: String(req.params.id),
    ip: req.ip,
  });
  res.status(200).json({ month, days });
}

/** Doctor's own schedule / receptionist day view. Guarded by ownsDoctorSchedule. */
export async function schedule(req: Request<{ id: string }>, res: Response): Promise<void> {
  const date = typeof req.query.date === 'string' ? req.query.date : undefined;
  const rows = await appointmentService.getSchedule(req.params.id, date);
  await logRead({
    actor: req.user!,
    action: 'schedule.read',
    targetDoctor: req.params.id,
    resourceId: req.params.id,
    ip: req.ip,
  });
  res.status(200).json({ schedule: rows });
}