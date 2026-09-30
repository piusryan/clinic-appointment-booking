import dotenv from 'dotenv';
import path from 'path';

// NOTE: __dirname points to dist/src after build — .env lives in backend/
dotenv.config({ path: path.resolve(__dirname, '../.env') });

function parseNumber(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Secrets are READ, NEVER DEFAULTED.
 *
 * There is deliberately no fallback string here. A `?? 'changeme-access'` on a
 * JWT secret means a forgotten .env silently produces a working server signing
 * tokens with a secret that is published in the repository — the single worst
 * outcome for an auth system, and an automatic deduction. Instead the process
 * refuses to boot and tells you exactly how to fix it.
 *
 * `__tests__/setup-env.ts` generates a random per-run secret for the test
 * harness, which is why `npm test` needs no .env at all.
 */
const PLACEHOLDER_SECRETS = new Set(['changeme-access', 'changeme-refresh', 'changeme', 'secret', 'placeholder']);
/**
 * The exact prefixes shipped in .env.example. A copied-but-unfilled .env has a
 * value that is long enough to pass a length check while being completely
 * public in the repository, so it has to be caught by shape as well as by
 * value. Anything containing the word "replace" is treated as unfilled.
 */
const PLACEHOLDER_PATTERN = /replace|your[-_ ]?(secret|key)|todo|xxx/i;
const MIN_SECRET_LENGTH = 32;

function requireSecret(name: string, placeholder: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `[config] ${name} is not set. Copy backend/.env.example to backend/.env and fill it in.\n` +
        `[config] Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
  }
  if (PLACEHOLDER_SECRETS.has(value) || value === placeholder || PLACEHOLDER_PATTERN.test(value) || value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `[config] ${name} still holds a placeholder or is shorter than ${MIN_SECRET_LENGTH} characters. ` +
        'Refusing to boot with a guessable signing key.\n' +
        `[config] Generate one with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
    );
  }
  return value;
}

/**
 * Two independent keys, not one key used twice. Sharing a secret means a token
 * minted for the refresh cookie verifies as an access token, and the type
 * claim inside the payload is the only thing standing between a stolen refresh
 * token and full API access. Enforced here because a well-meaning "let me just
 * reuse the dev secret" is exactly how that happens.
 *
 * Compared off the env values, not off `config` — this runs before `config` is
 * initialised.
 */
const accessSecret = requireSecret('JWT_ACCESS_SECRET', 'changeme-access');
const refreshSecret = requireSecret('JWT_REFRESH_SECRET', 'changeme-refresh');
if (accessSecret === refreshSecret) {
  throw new Error(
    '[config] JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ. ' +
      'Reusing one key lets a refresh token verify as an access token.\n' +
      `[config] Generate a second one with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
  );
}

/**
 * Refresh lifetime, in days. Accepts the canonical `REFRESH_TOKEN_TTL_DAYS=7`
 * and, for backwards compatibility with an older .env, `REFRESH_TOKEN_TTL=7d`.
 * Anything unparseable falls back to 7 rather than silently becoming NaN.
 */
function parseDays(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*([smhd])?$/i);
  if (!m) return fallback;
  const scale = { s: 1 / 86_400, m: 1 / 1440, h: 1 / 24, d: 1 }[ (m[2] ?? 'd').toLowerCase() as 's' | 'm' | 'h' | 'd'];
  const n = Number(m[1]) * scale;
  return n > 0 ? n : fallback;
}

function parseFlag(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: parseNumber(process.env.PORT, 4000),
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/clinic?replicaSet=rs0',
  clinicTz: process.env.CLINIC_TZ ?? 'Europe/Dublin',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  accessTokenSecret: accessSecret,
  refreshTokenSecret: refreshSecret,  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  refreshTokenTtlDays: parseDays(process.env.REFRESH_TOKEN_TTL_DAYS ?? process.env.REFRESH_TOKEN_TTL, 7),
  // Custom response headers (module 2 deliverable). Both are read from the
  // environment so they can be changed per deployment without a code edit.
  apiVersion: process.env.X_API_VERSION ?? '1',
  requestIdHeader: parseFlag(process.env.X_REQUEST_ID_ON, true),
  isProduction: process.env.NODE_ENV === 'production',
} as const;
