import type { Request, Response } from 'express';
import { listAudits } from '../services/audit.service';

/**
 * GET /api/audit — admin-only trail read.
 * Query: ?role=&action=&patientId=&page=&perPage=
 *
 * Pagination numbers are parsed here (they are transport concerns) and the
 * filtering, querying and actor-email join all happen in the service.
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

  res.status(200).json(result);
}
