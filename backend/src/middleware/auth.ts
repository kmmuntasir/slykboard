import type { Request, Response, NextFunction } from 'express';
import { verifyJwt } from '../utils/jwt';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { findUserTokenVersion } from '../services/tokenVersion';

// D12: reads Authorization: Bearer <jwt> (case-insensitive scheme).
// SLYK-0310: the EventSource API cannot set headers, so the same JWT may also
// ride the `access_token` query param (checked only when the header is absent;
// the header stays the primary path everywhere else). On success, attaches
// req.user = { id, email, isPlatformAdmin }.
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  const match = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
  const queryToken = req.query?.access_token;
  const token = match?.[1] ?? (typeof queryToken === 'string' && queryToken ? queryToken : null);
  if (!token) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Missing or invalid token');
  }

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
