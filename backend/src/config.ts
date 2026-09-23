import dotenv from 'dotenv';
import path from 'path';

// NOTE: __dirname points to dist/src after build — .env lives in backend/
dotenv.config({ path: path.resolve(__dirname, '../.env') });

function parseNumber(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: parseNumber(process.env.PORT, 4000),
  mongoUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/clinic',
  clinicTz: process.env.CLINIC_TZ ?? 'Europe/Dublin',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  // TODO: crash on startup if these are still default in prod
  accessTokenSecret: process.env.JWT_ACCESS_SECRET ?? 'changeme-access',
  refreshTokenSecret: process.env.JWT_REFRESH_SECRET ?? 'changeme-refresh',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? '15m',
  refreshTokenTtlDays: parseNumber(process.env.REFRESH_TOKEN_TTL_DAYS, 7),
  isProduction: process.env.NODE_ENV === 'production',
} as const;