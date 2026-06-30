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
