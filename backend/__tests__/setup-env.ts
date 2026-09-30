/**
 * __tests__/setup-env.ts — jest `setupFiles` entry.
 *
 * `config.ts` refuses to boot without real JWT secrets (there is no fallback
 * string in source, on purpose). The test harness therefore mints a random
 * secret per run instead of hard-coding one, so `npm test` works on a fresh
 * clone with no backend/.env present and no secret ever lives in the repo.
 *
 * `dotenv.config()` (called by config.ts) does not overwrite variables that
 * are already set, so these win over any local .env.
 *
 * The rate-limit ceilings are raised here because every test now logs in
 * through the REAL `POST /api/auth/login` — the 50-way race test alone needs 50
 * logins, which a 5-per-15-minutes login limiter would (correctly) reject. The
 * limiter behaviour itself is asserted in `__tests__/rateLimit.test.ts`, which
 * pins the limits back down and clears the counters.
 */
import { randomBytes } from 'crypto';

function ensure(name: string): void {
  if (!process.env[name]) process.env[name] = randomBytes(32).toString('hex');
}

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
ensure('JWT_ACCESS_SECRET');
ensure('JWT_REFRESH_SECRET');
process.env.RATE_LIMIT_LOGIN ??= '5000';
process.env.RATE_LIMIT_BOOKING ??= '100000';
process.env.RATE_LIMIT_API ??= '100000';

export {};
