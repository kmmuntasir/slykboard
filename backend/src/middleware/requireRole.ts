import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import type { AuthenticatedUser } from '../types/express';

// F07 D7: role-gate middleware. Must run AFTER authenticate (which sets req.user).
// Throws FORBIDDEN (403) if req.user.role is not in the allowed set.
// Usage: router.delete('/tickets/:id', authenticate, requireRole('ADMIN'), handler)
export function requireRole(...allowedRoles: AuthenticatedUser['role'][]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      // Defensive — requireRole must be mounted after authenticate.
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required');
    }
    if (!allowedRoles.includes(req.user.role)) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        `This action requires ${allowedRoles.join(' or ')} role`,
      );
    }
    next();
  };
}
