/**
 * utils/errors.ts — the application's error model.
 *
 * Two shapes are exported deliberately:
 *
 *  1. `AppError` — the base class. Everything the HTTP layer understands
 *     derives from it, so `errorHandler` needs exactly one `instanceof` check
 *     and every endpoint answers with the same `{ error, message, details? }`
 *     body (SECURITY.md §8).
 *
 *  2. A small inheritance hierarchy, one class per HTTP status the API can
 *     produce. The class owns its status + machine-readable `code`, so a
 *     service states the *meaning* of a failure (`throw new NotFoundError(...)`)
 *     and never a number. Adding a status means adding one class here, not
 *     editing a switch in the error handler.
 *
 * The `badRequest()` / `notFound()` / ... factory functions are kept because
 * they read better at the throw site than `new ConflictError(...)`; each one
 * simply constructs the matching class, so the hierarchy and the factories can
 * never drift apart.
 */

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: string;
  readonly isAppError = true;

  constructor(status: number, code: string, message: string, details?: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 400 — the request itself is malformed (fails `validate()`). */
export class BadRequestError extends AppError {
  constructor(message: string, details?: string) {
    super(400, 'BadRequest', message, details);
  }
}

/** 401 — "who are you?" No token, or a token that does not verify. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'Unauthorized', message);
  }
}

/** 403 — "are you allowed to?" Authenticated, but not permitted. */
export class ForbiddenError extends AppError {
  constructor(message = 'Not allowed') {
    super(403, 'Forbidden', message);
  }
}

/** 404 — the addressed resource does not exist (or route is unmapped). */
export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, 'NotFound', message);
  }
}

/** 409 — the request is valid but collides with current state (E11000 included). */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, 'Conflict', message);
  }
}

/** 422 — syntactically fine, semantically impossible (off-hours, bad state transition). */
export class UnprocessableError extends AppError {
  constructor(message: string, details?: string) {
    super(422, 'UnprocessableContent', message, details);
  }
}

/** 429 — a rate limiter tripped. */
export class TooManyRequestsError extends AppError {
  constructor(message = 'Too many requests') {
    super(429, 'TooManyRequests', message);
  }
}

/**
 * 500 — the last resort. Never constructed in a service on purpose: a service
 * throws something specific, and anything genuinely unexpected is translated
 * into this by `errorHandler`. The stack is only attached outside production.
 */
export class InternalServerError extends AppError {
  constructor(message = 'Something went wrong', details?: string) {
    super(500, 'InternalServerError', message, details);
  }
}

export const badRequest = (message: string, details?: string) => new BadRequestError(message, details);
export const unauthorized = (message?: string) => new UnauthorizedError(message);
export const forbidden = (message?: string) => new ForbiddenError(message);
export const notFound = (message?: string) => new NotFoundError(message);
export const conflict = (message: string) => new ConflictError(message);
export const unprocessable = (message: string, details?: string) => new UnprocessableError(message, details);
export const tooManyRequests = (message?: string) => new TooManyRequestsError(message);
