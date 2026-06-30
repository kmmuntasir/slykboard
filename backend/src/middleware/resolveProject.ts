import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { projects } from '../db/schema';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { isProjectMember, getMemberRole } from '../services/membershipService';
import { getTicket } from '../services/ticketService';
import { getLabel } from '../services/labelService';
import { getComment } from '../services/commentService';
import type { ProjectRow } from '../services/projectService';

// SLYK-01 Task I — slug-less project resolvers for routes keyed by ticket/label
// id (e.g. /api/tickets/:ticketId, /api/labels/:labelId). Each factory:
//   1. Loads the entity by id. A genuinely missing row → NOT_FOUND (the only
//      404 these middleware emit). Per plan §Edge Cases, once the row exists the
//      access decision is non-revealing FORBIDDEN.
//   2. Resolves the entity's project by id, then runs the SAME membership
//      decision as requireProjectMember (Platform-Admin bypass OR a real
//      project_members row), attaching req.project + req.projectMember so
//      downstream handlers and requireProjectAdmin work unchanged.
//   3. Throws the byte-identical non-revealing FORBIDDEN
//      'You do not have access to this project' for both missing-project and
//      non-member (anti-oracle; matches routes/report.routes.test.ts:150).
//
// `req.params.ticketId` / `req.params.id` must be Zod-validated BEFORE these
// run — mount `validateRequest` first.
const PROJECT_ACCESS_DENIED = 'You do not have access to this project';

// Shared membership decision given a resolved project row. Returns the
// projectMember sentinel to attach ('PROJECT_ADMIN' | 'MEMBER' | null) or
// throws the non-revealing FORBIDDEN. The role read runs inside a tx per the
// membershipService tx-idiom. Exported for reuse by requireProjectMember-style
// gates that already hold a project row.
async function authorizeProjectAccess(
  project: ProjectRow,
  userId: string,
  isPlatformAdmin: boolean,
): Promise<'PROJECT_ADMIN' | 'MEMBER' | null> {
  if (isPlatformAdmin) {
    return null; // PA bypass sentinel.
  }
  // DEL-04: non-revealing deny for deactivated projects. A non-PA caller must
  // not distinguish a deactivated project from an inaccessible one, so this
  // throws the byte-identical FORBIDDEN literal used by the membership deny
  // below. Runs AFTER the PA bypass and BEFORE the membership probe — matching
  // projectService.getProjectBySlug exactly.
  if (project.isActive === false) {
    throw new AppError(ErrorCode.FORBIDDEN, PROJECT_ACCESS_DENIED);
  }
  const member = await db.transaction((tx) => isProjectMember(tx, project.id, userId));
  if (!member) {
    throw new AppError(ErrorCode.FORBIDDEN, PROJECT_ACCESS_DENIED);
  }
  const role = await db.transaction((tx) => getMemberRole(tx, project.id, userId));
  return role;
}

// Resolve the project row owning a given projectId, then run the membership
// decision. A missing project row (inconsistent state — the FK should prevent
// it) is treated as non-revealing FORBIDDEN, never 404, to preserve the
// anti-oracle guarantee.
async function resolveAndAuthorize(
  projectId: string,
  userId: string,
  isPlatformAdmin: boolean,
): Promise<{ project: ProjectRow; projectMember: 'PROJECT_ADMIN' | 'MEMBER' | null }> {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row) {
    throw new AppError(ErrorCode.FORBIDDEN, PROJECT_ACCESS_DENIED);
  }
  const projectMember = await authorizeProjectAccess(row, userId, isPlatformAdmin);
  return { project: row, projectMember };
}

// For /api/tickets/:ticketId* — resolves the ticket, then its project + membership.
// Reads req.params.ticketId. Mount AFTER validateRequest (ticketIdParam).
export function resolveTicketProject() {
  return async function resolveTicketProjectMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!req.user) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required');
    }
    const ticketId = req.params.ticketId as string;
    const ticket = await getTicket(ticketId);
    if (!ticket) {
      // No row at all → the only NOT_FOUND these middleware emit.
      throw new AppError(ErrorCode.NOT_FOUND, 'Ticket not found');
    }
    const { project, projectMember } = await resolveAndAuthorize(
      ticket.projectId,
      req.user.id,
      req.user.isPlatformAdmin,
    );
    req.project = project;
    req.projectMember = projectMember;
    next();
  };
}

// For /api/labels/:id PATCH/DELETE — resolves the label, then its project +
// membership. Reads req.params.id (labelId). Mount AFTER validateRequest
// (labelIdParam) and compose with requireProjectAdmin() for write paths.
export function resolveLabelProject() {
  return async function resolveLabelProjectMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!req.user) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required');
    }
    const labelId = req.params.id as string;
    const label = await getLabel(labelId);
    if (!label) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Label not found');
    }
    const { project, projectMember } = await resolveAndAuthorize(
      label.projectId,
      req.user.id,
      req.user.isPlatformAdmin,
    );
    req.project = project;
    req.projectMember = projectMember;
    next();
  };
}

// For /api/tickets/:ticketId/comments/:commentId PATCH/DELETE — resolves the
// comment, then its ticket, then the ticket's project + membership. Reads
// req.params.commentId. Mount AFTER validateRequest (commentIdParam) and compose
// with requireProjectAdmin()/authorship checks for write paths. Comments do not
// carry a projectId directly, so the ticket is loaded first (via the existing
// getTicket helper) to recover the owning project.
export function resolveCommentProject() {
  return async function resolveCommentProjectMiddleware(
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!req.user) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required');
    }
    const commentId = req.params.commentId as string;
    const comment = await getComment(commentId);
    if (!comment) {
      // No row at all → the only NOT_FOUND these middleware emit.
      throw new AppError(ErrorCode.NOT_FOUND, 'Comment not found');
    }
    const ticket = await getTicket(comment.ticketId);
    if (!ticket) {
      // Inconsistent state — the comment→ticket FK should prevent this. Treated
      // as non-revealing FORBIDDEN (never 404) to preserve the anti-oracle
      // guarantee, matching resolveAndAuthorize's missing-project handling.
      throw new AppError(ErrorCode.FORBIDDEN, PROJECT_ACCESS_DENIED);
    }
    const { project, projectMember } = await resolveAndAuthorize(
      ticket.projectId,
      req.user.id,
      req.user.isPlatformAdmin,
    );
    req.project = project;
    req.projectMember = projectMember;
    next();
  };
}
