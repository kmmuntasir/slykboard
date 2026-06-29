import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

type Middleware = (req: Request, _res: Response, next: NextFunction) => void;

// SLYK-01 Task D: placeholder platform-admin gate kept for compile continuity.
// Batch 3 (Task I) replaces all call sites with requirePlatformAdmin /
// requireProjectAdmin, renames this file to requirePlatformAdmin.ts, and deletes
// the `requireRole` alias. Must run AFTER authenticate (which sets req.user).
export function requirePlatformAdmin(): Middleware {
  return function platformAdminGate(req: Request, _res: Response, next: NextFunction): void {
    if (!req.user) {
      // Defensive — must be mounted after authenticate.
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required');
    }
    if (!req.user.isPlatformAdmin) {
      throw new AppError(ErrorCode.FORBIDDEN, 'This action requires Platform Admin');
    }
    next();
  };
}

// Backwards-compatible alias so existing `requireRole('ADMIN')` call sites keep
// compiling during the rename window. The legacy role args are accepted and
// IGNORED — every gate is a platform-admin gate until Task I swaps in the
// project-scoped gates. Removed in Batch 3.
export function requireRole(..._legacyRoles: unknown[]): Middleware {
  return requirePlatformAdmin();
}
