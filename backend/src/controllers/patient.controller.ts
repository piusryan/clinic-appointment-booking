import type { Request, Response } from 'express';
import * as patientService from '../services/patient.service';
import { logRead } from '../services/audit.service';
import type { CreatePatientPayload, UpdatePatientPayload } from '../../../shared/types';

export async function index(req: Request, res: Response): Promise<void> {
  const phone = typeof req.query.phone === 'string' ? req.query.phone : undefined;
  const page = Number(req.query.page ?? 1);
  const perPage = Number(req.query.perPage ?? 50);
  const result = await patientService.listPatients(phone, page, perPage);
  res.status(200).json({ patients: result.patients, total: result.total, page: result.page, perPage: result.perPage, pages: result.pages });
}

/** Sensitive record: every read is audited with the reader's identity. */
export async function show(req: Request<{ id: string }>, res: Response): Promise<void> {
  const patient = await patientService.getPatient(req.params.id);
  await logRead({
    actor: req.user!,
    action: 'patient.read',
    targetPatient: patient.id,
    resourceId: patient.id,
    ip: req.ip,
  });
  res.status(200).json({ patient });
}

export async function create(req: Request<unknown, unknown, CreatePatientPayload>, res: Response): Promise<void> {
  res.status(201).json({ patient: await patientService.createPatient(req.body) });
}

export async function update(req: Request<{ id: string }, unknown, UpdatePatientPayload>, res: Response): Promise<void> {
  const payload: UpdatePatientPayload = {
    ...(req.body.name !== undefined && { name: String(req.body.name) }),
    ...(req.body.phone !== undefined && { phone: String(req.body.phone) }),
  };
  res.status(200).json({ patient: await patientService.updatePatient(req.params.id, payload) });
}

export async function remove(req: Request<{ id: string }>, res: Response): Promise<void> {
  await patientService.deletePatient(req.params.id);
  res.status(204).end();
}