import rateLimit, { MemoryStore } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { tooManyRequests } from '../utils/errors';
import { sendError } from './errorHandler';

/**
 * Limits are read per-request (not captured at module load) so the test suite
 * can raise them for functional tests and pin them low for the dedicated
 * rate-limit test. Production keeps the defaults below.
 */
export interface RateLimitConfig {
  /** /auth/login — per IP. */
  login: number;
  /** booking / cancel / reschedule — per AUTHENTICATED USER (see below). */
  booking: number;
  /** everything under /api — per IP. */
  api: number;
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const rateLimitConfig: RateLimitConfig = {
  login: intFromEnv('RATE_LIMIT_LOGIN', 5),
  booking: intFromEnv('RATE_LIMIT_BOOKING', 200),
  api: intFromEnv('RATE_LIMIT_API', 600),
};

const loginWindowMs = 15 * 60 * 1000;
const shortWindowMs = 60 * 1000;

function handler(message: string) {
  return (_req: Request, res: Response): void => sendError(res, tooManyRequests(message));
}

const loginMessage = 'Too many login attempts — try again in 15 minutes';
const bookingMessage = 'Too many booking attempts — slow down and try again shortly';
const apiMessage = 'Too many requests — slow down and try again shortly';

/**
 * Rate limiting is on sensitive/state-changing endpoints, not just login.
 * An authenticated script hammering bookings is a valid attack even with
 * perfect authorization (brief §6), so bookings are keyed by USER, not IP:
 * one account flooding cannot burn through a shared office/NAT budget, and a
 * single attacker cannot spread a flood across IPs to dodge an IP-keyed limit.
 */
/**
 * Explicit stores, so the counters are addressable. `resetAll` lives on the
 * STORE in express-rate-limit v7, not on the middleware, so a limiter built
 * with the default store cannot be cleared by tests.
 */
const loginStore = new MemoryStore();
const bookingStore = new MemoryStore();
const apiStore = new MemoryStore();

export const loginLimiter = rateLimit({
  windowMs: loginWindowMs,
  store: loginStore,
  limit: () => rateLimitConfig.login,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: handler(loginMessage),
});

export const bookingLimiter = rateLimit({
  // Deliberately generous burst headroom so the 50-simultaneous-proof gets
  // measured for what it is (1 x 201, 49 x 409) and not for rate limiting —
  // while still throttling a hostile flood. Lower in production if desired.
  windowMs: shortWindowMs,
  store: bookingStore,
  limit: () => rateLimitConfig.booking,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anon',
  handler: handler(bookingMessage),
});

export const apiLimiter = rateLimit({
  windowMs: shortWindowMs,
  store: apiStore,
  limit: () => rateLimitConfig.api,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: handler(apiMessage),
});

/** Test-only: clear the in-memory counters between rate-limit assertions. */
export function resetRateLimits(): void {
  for (const store of [loginStore, bookingStore, apiStore]) {
    store.resetAll();
  }
}
