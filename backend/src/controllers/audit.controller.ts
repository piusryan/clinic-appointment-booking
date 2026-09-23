import type { Request, Response } from 'express';
import User from '../models/user.model';
import { listAudits } from '../services/audit.service';

/**
 * GET /api/audit — admin-only trail read.
 * Query: ?role=&action=&patientId=&page=&perPage=
 */
export async function index(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string | undefined>;
  const page = q.page ? Number(q.page) : 1;
  const perPage = q.perPage ? Number(q.perPage) : 25;

  const result = await listAudits({
    filter: {
      ...(q.role ? { role: q.role } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.patientId ? { patientId: q.patientId } : {}),
    },
    page,
    perPage,
  });

  // Enrich with actor emails in one query (audit trail is admin-only).
  const actorIds = [...new Set(result.logs.map((l) => l.actorId))];
  if (actorIds.length) {
    const users = await User.find({ _id: { $in: actorIds } }).select('email').lean();
    const emailBy = new Map(users.map((u) => [String(u._id), u.email]));
    for (const l of result.logs) l.actorEmail = emailBy.get(l.actorId);
  }

  res.status(200).json(result);
}
