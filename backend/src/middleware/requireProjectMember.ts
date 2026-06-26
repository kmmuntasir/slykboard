import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { getProjectBySlug } from '../services/projectService';

// F47: project-membership gate. Path B (owner-approved, no DB migration):
// membership = req.user.id === project.creatorId || req.user.role === 'ADMIN'.
// There is no projectMembers table and no migration; this middleware is the
// creator-or-admin gate until a proper membership table is introduced.
//
// Must run AFTER authenticate (which sets req.user). Looks up the project by
// `req.params.slug`, attaches it to req.project on success, and throws
// FORBIDDEN for non-members and unknown slugs alike. The FORBIDDEN message is
// deliberately non-revealing (no 404 / "not found") so an attacker cannot
// distinguish "slug does not exist" from "you are not a member".
//
// Usage: router.get('/:slug/board', authenticate, requireProjectMember, handler)
export async function requireProjectMember(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  // Defense in depth — requireProjectMember must be mounted after authenticate.
  // Checked BEFORE the DB lookup so unauthenticated requests never hit the DB.
  if (!req.user) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required');
  }

  const slug = req.params.slug as string;
  const project = await getProjectBySlug(slug);

  // Non-revealing message: hide existence of the project.
  if (!project) {
    throw new AppError(ErrorCode.FORBIDDEN, 'You do not have access to this project');
  }

  const isMember = req.user.id === project.creatorId || req.user.role === 'ADMIN';
  if (!isMember) {
    throw new AppError(ErrorCode.FORBIDDEN, 'You do not have access to this project');
  }

  req.project = project;
  next();
}
