import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/errors';
import { config } from '../config';

interface MongoErrorLike {
  name?: string;
  code?: number;
  errors?: Record<string, { message?: string }>;
  path?: string;
  value?: unknown;
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

function mongoCode(err: unknown): number | undefined {
  return (err as MongoErrorLike).code;
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, 'NotFound', `No route for ${req.method} ${req.path}`));
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  let status: number;
  let code: string;
  let message: string;
  let details: string | undefined;

  if (isAppError(err)) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else {
    const name = (err as MongoErrorLike).name;
    const dup = mongoCode(err) === 11000;
    if (name === 'CastError') {
      status = 400;
      code = 'BadRequest';
      message = 'Malformed id';
    } else if (name === 'ValidationError') {
      status = 400;
      code = 'BadRequest';
      // TODO: surface actual validation errors? currently swallowed
      message = 'Validation failed';
    } else if (dup) {
      // backstop — appointment service catches dupes first, but any other uncaught E11000 lands here
      status = 409;
      code = 'Conflict';
      message = 'That slot is already taken';
    } else {
      status = 500;
      code = 'InternalServerError';
      message = 'Something went wrong';
      // console.error already below — keeping stack trace for local dev
      if (config.env !== 'production' && err instanceof Error) {
        details = err.stack;
      }
    }
  }

  if (status >= 500) {
    // eslint-disable-next-line no-console
    console.error(`[${req.requestId ?? '-'}] ${err instanceof Error ? err.stack : String(err)}`);
  }

  res
    .status(status)
    .set('X-Error-Code', code)
    .json({
      error: code,
      message,
      ...(details && config.env !== 'production' ? { details } : {}),
    });
}