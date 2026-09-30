import type { Request, Response } from 'express';
import * as appointmentService from '../services/appointment.service';
import { logRead } from '../services/audit.service';
import { unprocessable } from '../utils/errors';
import type { BookAppointmentPayload, ReschedulePayload } from '../../../shared/types';

/**
 * Controllers here do exactly three things: read the request, call a service,
 * send the response. No Mongoose import, no filter objects, no `user.role`
 * branches — the layering contract in DESIGN.md §6 is enforced by the fact that
 * none of the building blocks a query needs are even in scope.
 */

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
  const q = req.query as Record<string, string | undefined>;
  const rows = await appointmentService.listAppointmentsFor(req.user!, {
    doctorId: q.doctorId,
    patientId: q.patientId,
    status: q.status,
    from: q.from,
  });
  res.status(200).json({ appointments: rows });
}

export async function show(req: Request<{ id: string }>, res: Response): Promise<void> {
  const row = await appointmentService.getAppointment(req.params.id);
  // Ownership already passed in middleware (ownsAppointment); a medical read
  // is still audited, whoever performed it.
  await logRead({
    actor: req.user!,
    action: 'appointment.read',
    targetPatient: row.patientId,
    resourceId: row.id,
    ip: req.ip,
  });
  res.status(200).json({ appointment: row });
}

export async function cancel(req: Request<{ id: string }>, res: Response): Promise<void> {
  await appointmentService.cancelAppointment(req.params.id);
  res.status(204).end();
}

export async function status(
  req: Request<{ id: string }, unknown, { status: string }>,
  res: Response
): Promise<void> {
  // The route already validated the enum; this guard is the service-facing
  // contract check (the service only accepts the two terminal states).
  if (req.body.status !== 'completed' && req.body.status !== 'no-show') {
    throw unprocessable('status must be completed or no-show');
  }
  await appointmentService.setAppointmentStatus(req.params.id, req.body.status);
  res.status(204).end();
}

export async function reschedule(req: Request<{ id: string }, unknown, ReschedulePayload>, res: Response): Promise<void> {
  const appointment = await appointmentService.rescheduleAppointment(req.params.id, String(req.body.newStartsAt));
  res.status(200).json({ appointment });
}
