import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/holiday.controller';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate, isObjectId, isCalendarDate, bodyHas, optional } from '../middleware/validate';

const router = Router();

// `doctorId` is a filter that reaches Mongoose, so it gets the same 24-hex
// treatment as a path param: without it a crafted `?doctorId={$ne:null}` would
// be cast by the driver rather than rejected at the edge with a 400.
router.get(
  '/',
  authenticate,
  authorize('admin', 'receptionist'),
  validate('query', optional(isObjectId('doctorId')), optional(isCalendarDate('from')), optional(isCalendarDate('to'))),
  asyncHandler(ctrl.index)
);
router.post('/', authenticate, authorize('admin'), validate('body', bodyHas(['date']), isCalendarDate('date')), asyncHandler(ctrl.create));
router.delete('/:id', authenticate, authorize('admin'), validate('params', isObjectId('id')), asyncHandler(ctrl.remove));

export const holidayRoutes: Router = router;
