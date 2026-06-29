import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

type Middleware = (req: Request, _res: Response, next: NextFunction) => void;

// SLYK-01 Task I — Platform-Admin gate. Zero-arg factory returning an Express
// middleware. Must be mounted AFTER `authenticate` (which populates req.user
// from the JWT `pa` claim). Rejects non-platform-admins with a FORBIDDEN that
// is specific to the platform-admin tier (this gate is NOT project-scoped, so
// the non-revealing project-access wording does not apply here).
export function requirePlatformAdmin(): Middleware {
  return function platformAdminGate(req: Request, _res: Response, next: NextFunction): void {
    // Defense in depth — requirePlatformAdmin must be mounted after authenticate.
    if (!req.user) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required');
    }
    if (!req.user.isPlatformAdmin) {
      throw new AppError(ErrorCode.FORBIDDEN, 'This action requires Platform Admin');
    }
    next();
  };
}

// SLYK-01 Task I — TEMPORARY compat alias. The file was renamed from
// `requireRole.ts`; projects.routes.ts (owned by Task K) still imports
// `requireRole`. The alias preserves the old call shape (`requireRole('ADMIN')`)
// so the build stays green until Task K sweeps that call site to
// `requirePlatformAdmin()`. Legacy role args are accepted and IGNORED — every
// gate is a platform-admin gate. REMOVED in Task K.
export function requireRole(..._legacyRoles: unknown[]): Middleware {
  return requirePlatformAdmin();
}
