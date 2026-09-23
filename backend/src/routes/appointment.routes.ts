import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/appointment.controller';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { ownsAppointment, patientWithinScope } from '../middleware/ownership';
import { bookingLimiter } from '../middleware/rateLimit';
import { validate, isObjectId, isIsoDate, isEnum } from '../middleware/validate';

const router = Router();

// The permission model of the whole appointment surface, readable in one file:
router.get('/', authenticate, authorize('patient', 'doctor', 'receptionist', 'admin'), asyncHandler(ctrl.index));
router.get('/:id', authenticate, authorize('patient', 'doctor', 'receptionist', 'admin'), ownsAppointment, validate('params', isObjectId('id')), asyncHandler(ctrl.show));

// Booking: patients may only book for themselves (patientWithinScope), staff
// for anyone. wallet-grade rate limit because an authenticated booking flood
// is a valid DoS even with perfect authz.
router.post(
  '/',
  authenticate,
  authorize('patient', 'receptionist', 'admin'),
  patientWithinScope,
  bookingLimiter,
  validate('body', isObjectId('doctorId'), isObjectId('patientId'), isIsoDate('startsAt')),
  asyncHandler(ctrl.book)
);

router.patch(
  '/:id/cancel',
  authenticate,
  authorize('patient', 'doctor', 'receptionist', 'admin'),
  ownsAppointment,
  bookingLimiter,
  validate('params', isObjectId('id')),
  asyncHandler(ctrl.cancel)
);

router.patch(
  '/:id/reschedule',
  authenticate,
  authorize('patient', 'receptionist', 'admin'),
  ownsAppointment,
  bookingLimiter,
  validate('params', isObjectId('id')),
  validate('body', isIsoDate('newStartsAt')),
  asyncHandler(ctrl.reschedule)
);

// Doctor lifecycle actions: only the attending doctor (ownership middleware)
// or admin may mark a visit completed / no-show.
router.patch(
  '/:id/status',
  authenticate,
  authorize('doctor', 'admin'),
  ownsAppointment,
  validate('params', isObjectId('id')),
  validate('body', isEnum('status', ['completed', 'no-show'])),
  asyncHandler(ctrl.status)
);

export const appointmentRoutes: Router = router;
