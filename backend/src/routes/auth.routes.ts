import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as ctrl from '../controllers/auth.controller';
import { authenticate } from '../middleware/authenticate';
import { loginLimiter } from '../middleware/rateLimit';
import { validate, isString, isEmail, minLen, bodyHas } from '../middleware/validate';

const router = Router();

router.post('/register', validate('body', bodyHas(['email', 'password']), isEmail('email'), isString('password'), minLen('password', 8)), asyncHandler(ctrl.register));
router.post('/login', loginLimiter, validate('body', bodyHas(['email', 'password']), isEmail('email'), isString('password')), asyncHandler(ctrl.login));
router.post('/refresh', asyncHandler(ctrl.refresh));
router.post('/logout', asyncHandler(ctrl.logout));
router.get('/me', authenticate, asyncHandler(ctrl.me));
router.patch('/password', authenticate, validate('body', bodyHas(['currentPassword', 'newPassword']), isString('currentPassword'), isString('newPassword'), minLen('newPassword', 8)), asyncHandler(ctrl.changePassword));

export const authRoutes: Router = router;
