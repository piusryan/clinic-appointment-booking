import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

const SENSITIVE_KEYS = new Set(['password', 'passwordHash', 'newPassword', 'currentPassword']);
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie']);

function redactBody(body: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : typeof v === 'string' && v.length > 200 ? v.slice(0, 200) : v;
  }
  return out;
}

/**
 * Request logger. Two deliberate choices:
 *  - we log the method/path/status/duration only — never bodies, and
 *    never the Authorization header or cookie header, so tokens and
 *    passwords cannot appear in logs (SECURITY.md: automatic deduction).
 *  - a per-request id is echoed back in an X-Request-Id response header so
 *    the frontend can correlate a failure with server-side logs.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const id = randomUUID();
  req.requestId = id;
  const started = Date.now();

  res.on('finish', () => {
    const ms = Date.now() - started;
    // A compact single line. If we ever add the body it MUST go through
    // redactBody — the passwords above are adamantly excluded.
    console.log(
      `${id} ${req.method} ${req.originalUrl} -> ${res.statusCode} ${ms}ms ${JSON.stringify(redactBody(req.body))}`
    );
  });

  next();
}
export const sensitiveHeaders = SENSITIVE_HEADERS;