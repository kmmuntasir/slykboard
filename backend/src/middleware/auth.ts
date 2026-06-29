import type { Request, Response, NextFunction } from 'express';
import { verifyJwt } from '../utils/jwt';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { findUserTokenVersion } from '../services/tokenVersion';

// D12: reads Authorization: Bearer <jwt> (case-insensitive scheme).
// On success, attaches req.user = { id, email, isPlatformAdmin }.
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

  let payload;
  try {
    payload = await verifyJwt(token);
  } catch {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing or invalid token');
  }

  // F07 D3: compare JWT `ver` to DB tokenVersion. Mismatch → 401 (hard
  // mid-session invalidation). Covers: logout (bumped), future F25 role demotion.
  // F07 M3: verifyJwt guarantees `ver` is a finite number, so this `!==` compare
  // is strict-numeric and never compares against `undefined`.
  const dbTokenVersion = await findUserTokenVersion(payload.sub);
  if (dbTokenVersion === undefined || dbTokenVersion !== payload.ver) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Token version mismatch');
  }

  req.user = { id: payload.sub, email: payload.email, isPlatformAdmin: payload.pa };
  next();
}
