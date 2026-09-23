import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';

function tooMany(_req: Request, res: Response): void {
  res.status(429).json({ error: 'TooManyRequests', message: 'Too many requests — slow down and try again shortly' });
}

/**
 * Rate limiting is on sensitive/state-changing endpoints, not just login.
 * An authenticated script hammering bookings is a valid attack even with
 * perfect authorization (brief §6), so bookings are keyed by USER, not IP.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: tooMany,
});

export const bookingLimiter = rateLimit({
  // Deliberately generous burst headroom so the 50-simultaneous-proof gets
  // measured for what it is (1 x 201, 49 x 409) and not for rate limiting —
  // while still throttling a hostile flood. Lower in production if desired.
  windowMs: 60 * 1000,
  limit: 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anon',
  handler: tooMany,
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: tooMany,
});