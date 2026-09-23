import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/doctor.controller';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { ownsDoctorSchedule } from '../middleware/ownership';
import { validate, isObjectId, isCalendarDate, isYearMonth, isString, bodyHas, optional } from '../middleware/validate';

const router = Router();

// Browse: every authenticated role may list doctors and read a doctor.
router.get('/', authenticate, authorize('patient', 'doctor', 'receptionist', 'admin'), asyncHandler(ctrl.index));
router.get('/:id', authenticate, authorize('patient', 'doctor', 'receptionist', 'admin'), validate('params', isObjectId('id')), asyncHandler(ctrl.show));

// Free availability grid — availability only, never the occupant.
router.get('/:id/slots', authenticate, authorize('patient', 'doctor', 'receptionist', 'admin'), validate('params', isObjectId('id')), validate('query', optional(isCalendarDate('date'))), asyncHandler(ctrl.slots));

// Month-wide calendar summary for the booking calendar view.
router.get('/:id/calendar', authenticate, authorize('patient', 'doctor', 'receptionist', 'admin'), validate('params', isObjectId('id')), validate('query', optional(isYearMonth('month'))), asyncHandler(ctrl.calendar));

// The doctor's own schedule (and receptionist day view). Patients are 403
// here: this is the closed IDOR — enumerating a doctor's patient list.
router.get('/:id/schedule', authenticate, ownsDoctorSchedule, validate('params', isObjectId('id')), asyncHandler(ctrl.schedule));

// Staff management is admin-only.
router.post('/', authenticate, authorize('admin'), validate('body', bodyHas(['name', 'speciality', 'slotMinutes']), isString('name'), isString('speciality')), asyncHandler(ctrl.create));
router.patch('/:id', authenticate, authorize('admin'), validate('params', isObjectId('id')), asyncHandler(ctrl.update));
router.delete('/:id', authenticate, authorize('admin'), validate('params', isObjectId('id')), asyncHandler(ctrl.remove));

export const doctorRoutes: Router = router;
