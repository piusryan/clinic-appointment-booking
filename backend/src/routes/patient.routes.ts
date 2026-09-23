import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/patient.controller';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate, isObjectId } from '../middleware/validate';

const router = Router();

// Patient records are sensitive medical data: admin/receptionist only, and
// every individual read is written to the audit trail.
router.get('/', authenticate, authorize('admin', 'receptionist'), asyncHandler(ctrl.index));
router.get('/:id', authenticate, authorize('admin', 'receptionist'), validate('params', isObjectId('id')), asyncHandler(ctrl.show));
router.post('/', authenticate, authorize('admin'), asyncHandler(ctrl.create));
router.patch('/:id', authenticate, authorize('admin'), validate('params', isObjectId('id')), asyncHandler(ctrl.update));
router.delete('/:id', authenticate, authorize('admin'), validate('params', isObjectId('id')), asyncHandler(ctrl.remove));

export const patientRoutes: Router = router;
