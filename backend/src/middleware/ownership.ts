import type { NextFunction, Request, Response } from 'express';
import Appointment from '../models/appointment.model';
import { forbidden, notFound } from '../utils/errors';

/**
 * Per-project ownership guards. The permission model of the whole API remains
 * readable in the ROUTES file (guards declared there); this file holds the
 * implementations. Middleware is the right home: a role check written as an
 * `if` inside a controller would be a layering violation.
 *
 * 403 (not 404) on a foreign row is deliberate and is the demonstration of
 * the closed IDOR — see SECURITY.md before/after curls.
 */

/** Access to a single appointment by id. */
export async function ownsAppointment(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user;
    if (!user) return next(forbidden('Not authenticated'));

    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) return next(notFound('Appointment not found'));

    if (user.role === 'admin' || user.role === 'receptionist') return next();

    if (user.role === 'doctor' && appointment.doctor.toString() === user.doctorId) return next();
    if (user.role === 'patient' && appointment.patient.toString() === user.patientId) return next();

    return next(forbidden('Not your appointment'));
  } catch (err) {
    next(err);
  }
}

/** The doctor's schedule endpoint — patients must not enumerate it. */
export async function ownsDoctorSchedule(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.user;
    if (!user) return next(forbidden('Not authenticated'));

    if (user.role === 'admin' || user.role === 'receptionist') return next();

    if (user.role === 'doctor' && user.doctorId === req.params.id) return next();

    return next(forbidden('Only the doctor themselves may view their schedule'));
  } catch (err) {
    next(err);
  }
}

/** Patient scope: booking/rescheduling on behalf is the receptionist's job. */
export function patientWithinScope(req: Request, _res: Response, next: NextFunction): void {
  const user = req.user;
  if (!user) return next(forbidden('Not authenticated'));

  const targetPatientId = (req.body?.patientId ?? req.params.patientId) as string | undefined;
  if (user.role === 'admin' || user.role === 'receptionist') return next();
  if (user.role === 'patient') {
    if (!targetPatientId) return next(forbidden('Missing patientId'));
    if (targetPatientId === user.patientId) return next();
    return next(forbidden('Cannot act for another patient'));
  }
  next(forbidden('Not allowed'));
}