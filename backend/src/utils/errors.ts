export class AppError extends Error {
  status: number;
  code: string;
  details?: string;
  isAppError = true;

  constructor(status: number, code: string, message: string, details?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: string) => new AppError(400, 'BadRequest', message, details);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'Unauthorized', message);
export const forbidden = (message = 'Not allowed') => new AppError(403, 'Forbidden', message);
export const notFound = (message = 'Not found') => new AppError(404, 'NotFound', message);
export const conflict = (message: string) => new AppError(409, 'Conflict', message);
export const unprocessable = (message: string, details?: string) => new AppError(422, 'UnprocessableContent', message, details);