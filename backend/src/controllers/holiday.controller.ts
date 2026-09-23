import type { Request, Response } from 'express';
import * as holidayService from '../services/holiday.service';
import type { HolidayPayload } from '../../../shared/types';

export async function index(req: Request, res: Response): Promise<void> {
  const doctorId = typeof req.query.doctorId === 'string' ? req.query.doctorId : undefined;
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  res.status(200).json({ holidays: await holidayService.listHolidays({ doctorId, from, to }) });
}

export async function create(req: Request<unknown, unknown, HolidayPayload>, res: Response): Promise<void> {
  const { date, doctorId } = req.body as HolidayPayload & { doctorId?: string };
  const holiday = await holidayService.addHoliday({
    date: String(date),
    doctorId: doctorId === undefined ? null : String(doctorId),
  });
  res.status(201).json({ holiday });
}

export async function remove(req: Request<{ id: string }>, res: Response): Promise<void> {
  await holidayService.removeHoliday(req.params.id);
  res.status(204).end();
}