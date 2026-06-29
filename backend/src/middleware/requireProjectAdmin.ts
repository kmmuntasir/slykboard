import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// SLYK-01 Task I — Project-Admin tier gate (zero-arg factory). Must run AFTER
// `requireProjectMember()` (or a `resolveTicketProject()`/`resolveLabelProject()`
// resolver), which set req.user, req.project, and req.projectMember.
//
// Admits:
//   - Platform Admins (req.user.isPlatformAdmin === true), OR
//   - real PROJECT_ADMIN members (req.projectMember === 'PROJECT_ADMIN').
// Rejects everyone else (MEMBER tier, or the null PA-bypass sentinel held by a
// non-PA… which can't happen because the PA branch above covers it) with the
// SAME non-revealing FORBIDDEN used by requireProjectMember — so a MEMBER cannot
// tell that they're a member but lack the tier ('You do not have access to this
// project'). No 404 is ever emitted.
export function requireProjectAdmin() {
  return function projectAdminGate(req: Request, _res: Response, next: NextFunction): void {
    // Defense in depth — must be mounted after authenticate + requireProjectMember.
    if (!req.user) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required');
    }
    const isPA = req.user.isPlatformAdmin === true;
    const isProjectAdmin = req.projectMember === 'PROJECT_ADMIN';
    if (!isPA && !isProjectAdmin) {
      throw new AppError(ErrorCode.FORBIDDEN, 'You do not have access to this project');
    }
    next();
  };
}
