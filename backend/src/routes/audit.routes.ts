import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/audit.controller';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate, isEnum, optional, isString } from '../middleware/validate';

const router = Router();

router.get(
  '/',
  authenticate,
  authorize('admin'),
  validate(
    'query',
    optional(isEnum('role', ['patient', 'doctor', 'receptionist', 'admin'])),
    optional(isString('page')),
    optional(isString('perPage'))
  ),
  asyncHandler(ctrl.index)
);

export const auditRoutes: Router = router;
