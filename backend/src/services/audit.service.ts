import { Types } from 'mongoose';
import AuditLog from '../models/audit.model';
import type { RequestUser } from '../types/auth.types';

/**
 * Healthcare read-access audit. Reactionless: the HTTP handler never knows
 * the audit failed, but the write itself is durable. Something is always
 * better than nothing — a failed audit log must not take down the read it
 * is documenting.
 */
export async function logRead(input: {
  actor: RequestUser;
  action: 'appointment.read' | 'schedule.read' | 'patient.read' | 'slots.read' | 'calendar.read';
  targetPatient?: string;
  targetDoctor?: string;
  resourceId?: string;
  ip?: string;
}): Promise<void> {
  try {
    await AuditLog.create({
      actorId: input.actor.id,
      actorRole: input.actor.role,
      action: input.action,
      targetPatient: input.targetPatient as unknown as Types.ObjectId,
      targetDoctor: input.targetDoctor as unknown as Types.ObjectId,
      resource: input.action.split('.')[0] === 'patient' ? 'patient' : input.action.split('.')[0],
      resourceId: input.resourceId,
      ip: input.ip,
    });
  } catch {
    // Swallow — auditing must not break the medical transaction it protects.
  }
}

export interface AuditLogView {
  id: string;
  actorId: string;
  actorRole: string;
  actorEmail?: string;
  action: string;
  resource: string;
  resourceId?: string;
  targetDoctor?: string;
  targetPatient?: string;
  ip?: string;
  createdAt: string;
}

export interface AuditPage {
  logs: AuditLogView[];
  total: number;
  page: number;
  pages: number;
}

/**
 * Admin-only read of the audit trail, newest-first, with filters and
 * pagination. Returns a page of logs and the total count so the UI can
 * render pager controls.
 */
export async function listAudits(input: {
  filter?: { role?: string; action?: string; patientId?: string };
  page?: number;
  perPage?: number;
}): Promise<AuditPage> {
  const page = Math.max(1, input.page ?? 1);
  const perPage = Math.min(100, Math.max(1, input.perPage ?? 25));

  const q: Record<string, unknown> = {};
  if (input.filter?.role) q.actorRole = input.filter.role;
  if (input.filter?.action) q.action = input.filter.action;
  if (input.filter?.patientId) q.targetPatient = input.filter.patientId;

  const [total, docs] = await Promise.all([
    AuditLog.countDocuments(q),
    AuditLog.find(q)
      .sort({ createdAt: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
      .lean(),
  ]);

  const logs: AuditLogView[] = docs.map((d) => ({
    id: String(d._id),
    actorId: String(d.actorId),
    actorRole: d.actorRole,
    action: d.action,
    resource: d.resource,
    resourceId: d.resourceId,
    targetDoctor: d.targetDoctor ? String(d.targetDoctor) : undefined,
    targetPatient: d.targetPatient ? String(d.targetPatient) : undefined,
    ip: d.ip,
    createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : new Date().toISOString(),
  }));

  return { logs, total, page, pages: Math.max(1, Math.ceil(total / perPage)) };
}
