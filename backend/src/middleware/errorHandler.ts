import type { NextFunction, Request, Response } from 'express';
import {
  AppError,
  NotFoundError,
  BadRequestError,
  ConflictError,
  InternalServerError,
} from '../utils/errors';
import { config } from '../config';

interface MongoErrorLike {
  name?: string;
  code?: number;
  errors?: Record<string, { message?: string }>;
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`No route for ${req.method} ${req.path}`));
}

/** "email: must be a valid email, phone: is required" — for non-production. */
function validationSummary(err: unknown): string | undefined {
  const errors = (err as { errors?: Record<string, { message?: string }> }).errors;
  if (!errors) return undefined;
  const parts = Object.entries(errors).map(([path, detail]) => `${path}: ${detail?.message ?? 'invalid'}`);
  return parts.length ? parts.join('; ') : undefined;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  // Anything the app threw is already an AppError subclass; anything else came
  // out of Mongoose or Node, and is translated into the SAME hierarchy here so
  // the response shape is identical no matter where the failure originated.
  const appError: AppError = isAppError(err) ? err : translate(err);

  if (appError.status >= 500) {
    console.error(`[${req.requestId ?? '-'}] ${err instanceof Error ? err.stack : String(err)}`);
  }

  sendError(res, appError);
}

/**
 * The ONE place an error body is written. `errorHandler` uses it, and so does
 * anything that has to answer with an error without going through the
 * throw/catch chain — currently the rate limiters, which is why a 429 has the
 * identical `{ error, message }` shape and `X-Error-Code` header as a 409.
 */
export function sendError(res: Response, appError: AppError): void {
  res
    .status(appError.status)
    .set('X-Error-Code', appError.code)
    .json({
      error: appError.code,
      message: appError.message,
      ...(appError.details && config.env !== 'production' ? { details: appError.details } : {}),
    });
}

/** Driver/ODM failures → the app's error classes. */
function translate(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const name = (err as MongoErrorLike).name;

  if (name === 'CastError') return new BadRequestError('Malformed id');
  if (name === 'ValidationError') {
    // The offending fields are named so the client can highlight them, but
    // only outside production: in prod the body is the fixed shape below.
    return new BadRequestError('Validation failed', config.env !== 'production' ? validationSummary(err) : undefined);
  }
  if ((err as MongoErrorLike).code === 11000) {
    // Backstop: the booking path catches E11000 itself to attach a slot-
    // specific message, but any other uncaught duplicate lands here.
    return new ConflictError('That slot is already taken');
  }
  return new InternalServerError('Something went wrong', config.env !== 'production' && err instanceof Error ? err.stack : undefined);
}