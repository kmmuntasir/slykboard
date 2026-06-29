import type { Request, Response, NextFunction } from 'express';
import { db } from '../db/client';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { getProjectBySlug } from '../services/projectService';
import { getMemberRole } from '../services/membershipService';

// SLYK-01 Task I — project-membership gate (zero-arg factory). Replaces the
// creator-or-admin heuristic with real `project_members` rows.
//
// Must run AFTER `authenticate` (sets req.user). Resolves the project by
// `req.params.slug` AND authorizes in one step via the non-revealing
// `getProjectBySlug(slug, userId, isPlatformAdmin)` contract: unknown slug and
// non-member are indistinguishable — both throw the byte-identical FORBIDDEN
// 'You do not have access to this project' (anti-oracle; matches
// routes/report.routes.test.ts:150). On success attaches:
//   - req.project     : the resolved ProjectRow
//   - req.projectMember: 'PROJECT_ADMIN' | 'MEMBER' for real members;
//                        null for the Platform-Admin bypass (sentinel: "not a
//                        real member, PA override in effect").
//
// Usage: router.get('/:slug/board', authenticate, requireProjectMember(), handler)
export function requireProjectMember() {
  return async function projectMemberGate(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    // Defense in depth — must be mounted after authenticate. Checked BEFORE the
    // DB lookup so unauthenticated requests never hit the DB.
    if (!req.user) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required');
    }

    const slug = req.params.slug as string;
    // Resolves + authorizes in one call. For non-PA non-members and unknown
    // slugs this throws the non-revealing FORBIDDEN — no 404 is ever emitted.
    const project = await getProjectBySlug(slug, req.user.id, req.user.isPlatformAdmin);
    // Defense in depth: getProjectBySlug's user-scoped overload guarantees a
    // non-null row (it throws FORBIDDEN on not-found). The guard exists purely
    // to narrow the nullable return type and is unreachable in practice.
    if (!project) {
      throw new AppError(ErrorCode.FORBIDDEN, 'You do not have access to this project');
    }

    // Platform-Admin bypass: global visibility, no real membership row. Attach
    // the project but mark the member context as the null sentinel so downstream
    // requireProjectAdmin can still admit PAs while real members are tier-checked.
    if (req.user.isPlatformAdmin) {
      req.project = project;
      req.projectMember = null;
      next();
      return;
    }

    // Real member path. getProjectBySlug already guaranteed membership for
    // non-PA users (it would have thrown FORBIDDEN otherwise), so getMemberRole
    // cannot return null here. The role read runs inside a tx per the
    // membershipService tx-idiom so it composes with the caller's read scope.
    const role = await db.transaction((tx) => getMemberRole(tx, project.id, req.user!.id));
    req.project = project;
    req.projectMember = role;
    next();
  };
}
