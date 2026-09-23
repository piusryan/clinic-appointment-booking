import type { NextFunction, Request, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import User from '../models/user.model';
import { config } from '../config';
import { unauthorized } from '../utils/errors';
import type { RequestUser } from '../types/auth.types';
import type { Role } from '../../../shared/types';

interface AccessPayload extends JwtPayload {
  sub: string;
  role: Role;
  tv: number;
}

/**
 * Verifies the Bearer access token, loads the user profile ids (patient/doctor)
 * and stamps req.user. A valid token for a deactivated/deleted account is
 * treated as Unauthorized, not Forbidden: the token's claim set refers to an
 * account that no longer carried that identity.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return next(unauthorized('Missing or malformed Authorization header'));
    }

    const token = header.slice('Bearer '.length);
    let payload: AccessPayload;
    try {
      payload = jwt.verify(token, config.accessTokenSecret) as AccessPayload;
    } catch {
      // Expired or tampered signature -> 401 (never details the reason).
      return next(unauthorized('Invalid or expired token'));
    }

    const user = await User.findById(payload.sub).populate('patient doctor').select('+passwordHash');
    if (!user || !user.isActive) {
      return next(unauthorized('Account no longer active'));
    }

    const reqUser: RequestUser = {
      id: String(user._id),
      email: user.email,
      role: user.role,
      tv: user.refreshTokenVersion,
    };
    const patient = user.patient as unknown as { _id?: unknown } | null;
    const doctor = user.doctor as unknown as { _id?: unknown } | null;
    if (patient && patient._id) reqUser.patientId = String(patient._id);
    if (doctor && doctor._id) reqUser.doctorId = String(doctor._id);

    req.user = reqUser;
    next();
  } catch (err) {
    next(err);
  }
}