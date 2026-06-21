import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// Catches unmatched routes. Registered immediately BEFORE errorHandler.
// We throw AppError so the centralized errorMiddleware shapes the response —
// single serialization path (envelope + logging) for all errors.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function notFound(req: Request, _res: Response, _next: NextFunction): never {
  throw new AppError(ErrorCode.NOT_FOUND, `Resource not found: ${req.method} ${req.path}`);
}
