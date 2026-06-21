import type { Request, Response, NextFunction } from 'express';
import { verifyJwt } from '../utils/jwt';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// D12: reads Authorization: Bearer <jwt> (case-insensitive scheme).
// On success, attaches req.user = { id, email, role }.
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing or invalid token');
  }

  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing or invalid token');
  }
  const token = match[1]!;

  try {
    const payload = await verifyJwt(token);
    req.user = { id: payload.sub, email: payload.email, role: payload.role };
    next();
  } catch {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing or invalid token');
  }
}
