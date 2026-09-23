import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncHandler = (req: any, res: any, next: NextFunction) => Promise<void>;

/** Wrap async route handlers so rejected promises reach the error handler. */
export function asyncHandler(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}
