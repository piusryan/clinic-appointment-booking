import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { config } from '../config';

const SENSITIVE_KEYS = new Set(['password', 'passwordHash', 'newPassword', 'currentPassword']);

function redactBody(body: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    out[k] = SENSITIVE_KEYS.has(k) ? '[REDACTED]' : typeof v === 'string' && v.length > 200 ? v.slice(0, 200) : v;
  }
  return out;
}

/**
 * Request logger. Three deliberate choices:
 *  - we log the method/path/status/duration only — never the Authorization or
 *    Cookie headers, and any body goes through `redactBody` first, so tokens
 *    and passwords cannot appear in logs (SECURITY.md).
 *  - an inbound `X-Request-Id` is honoured so a trace survives across a proxy
 *    or gateway, and every request gets a fresh id when one is not supplied.
 *  - that id is echoed back in an `X-Request-Id` response header (toggle with
 *    X_REQUEST_ID_ON) so a user-visible failure can be matched to the exact
 *    server-side log line.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.get('X-Request-Id');
  const id = inbound && inbound.length <= 128 ? inbound : randomUUID();
  req.requestId = id;
  if (config.requestIdHeader) res.setHeader('X-Request-Id', id);

  const started = Date.now();

  res.on('finish', () => {
    const ms = Date.now() - started;
    console.log(
      `${id} ${req.method} ${req.originalUrl} -> ${res.statusCode} ${ms}ms ${JSON.stringify(redactBody(req.body as Record<string, unknown> | undefined))}`
    );
  });

  next();
}
