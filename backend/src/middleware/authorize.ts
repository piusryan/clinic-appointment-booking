import type { NextFunction, Request, Response } from 'express';
import type { Role } from '../../../shared/types';
import { forbidden } from '../utils/errors';

/**
 * Role guard declared in the ROUTE, enforced in MIDDLEWARE — never as an
 * `if (user.role === ...)` inside a controller (layering contract).
 *
 * 403 is correct here: the caller IS authenticated (401 would mean "who are
 * you?"), they are just not permitted ("are you allowed to?") — module 10's
 * two-question distinction.
 */
export function authorize(...roles: Role[]): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    if (!req.user) {
      // authenticate must run first; treat as discovery bug rather than 500.
      return next(forbidden('Not authenticated'));
    }
    if (!roles.includes(req.user.role)) {
      return next(forbidden(`Role ${req.user.role} is not allowed here`));
    }
    next();
  };
}