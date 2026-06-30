import { Router } from 'express';
import { z } from 'zod';
import { success, ErrorCode } from '../utils/envelope';
import { AppError } from '../utils/appError';
import { validateRequest } from '../middleware/validateRequest';
import { authenticate } from '../middleware/auth';
import { requirePlatformAdmin } from '../middleware/requirePlatformAdmin';
import { requireProjectMember } from '../middleware/requireProjectMember';
import * as projectService from '../services/projectService';
import * as boardService from '../services/boardService';
import * as ticketService from '../services/ticketService';
import {
  createProjectBodySchema,
  slugParamSchema,
  createTicketBody,
  ticketDisplayIdParamSchema,
  updateProjectBodySchema,
} from './projects.schema';
import { parseTicketDisplayId } from '../utils/parseTicketDisplayId';
import { projectLabelsRouter } from './labels.routes';
import { projectReportsRouter } from './report.routes';
import { projectMembersRouter } from './projectMembers.routes';

export const projectsRouter = Router();

// SLYK-01 Task J/K: membership-scoped listing. A Platform Admin sees every
// project; a Member sees only projects where they have a project_members row.
projectsRouter.get('/', authenticate, async (req, res) => {
  const rows = await projectService.listProjects(req.user!.id, req.user!.isPlatformAdmin);
  res.json(success(rows));
});

// SLYK-01 Task K: requireProjectMember resolves + authorizes in one step via
// the non-revealing getProjectBySlug(slug, uid, pa) contract — unknown slug and
// non-member are indistinguishable (both throw the identical FORBIDDEN). The
// handler reads the pre-resolved req.project; no separate 404 path exists.
projectsRouter.get(
  '/:slug',
  authenticate,
  validateRequest({ params: slugParamSchema }),
  requireProjectMember(),
  async (req, res) => {
    res.json(success(req.project));
  },
);

// F09 D-Slug-Route: spec's GET /projects/:id/board → :slug (project URL
// identifier). SLYK-01 Task K: membership-gated by requireProjectMember.
projectsRouter.get(
  '/:slug/board',
  authenticate,
  validateRequest({ params: slugParamSchema }),
  requireProjectMember(),
  async (req, res) => {
    const slug = req.params.slug as string;
    const filters = {
      search: req.query.search as string | undefined,
      assignee: req.query.assignee as string | undefined,
      priority: req.query.priority as string | undefined,
      label: req.query.label as string | undefined,
    };
    const board = await boardService.getBoard(slug, filters);
    res.json(success(board));
  },
);

// F12 D6: nested POST /:slug/tickets — binds slug, mirrors GET /:slug/board.
// SLYK-01 Task K: any project member may create tickets (REQ-3.3).
projectsRouter.post(
  '/:slug/tickets',
  authenticate,
  validateRequest({ params: slugParamSchema, body: createTicketBody }),
  requireProjectMember(),
  async (req, res) => {
    const { slug } = req.params as z.infer<typeof slugParamSchema>;
    const body = req.body as z.infer<typeof createTicketBody>;
    const ticket = await ticketService.createTicket({
      slug,
      creatorId: req.user!.id,
      ...body,
    });
    res.status(201).json(success(ticket));
  },
);

// F30 D-Display-Id-Lookup: human-readable ticket detail route
// GET /api/projects/:slug/tickets/:displayId (e.g. /api/projects/SLYK/tickets/SLYK-4).
// SLYK-01 Task K: membership-gated by requireProjectMember (matches GET
// /:slug/board). D5: a malformed displayId (e.g. 'SLYK-abc') is a 404, NOT a
// 400 — Zod only checks non-emptiness; parseTicketDisplayId does the format
// check and returns null → NOT_FOUND. D3: a prefix mismatch (path slug ≠
// displayId slug, e.g. /SLYK/.../PX-4) is also null → NOT_FOUND. Both happen
// BEFORE the service is called, so a malformed ref never touches the DB.
projectsRouter.get(
  '/:slug/tickets/:displayId',
  authenticate,
  validateRequest({ params: ticketDisplayIdParamSchema }),
  requireProjectMember(),
  async (req, res) => {
    const { slug, displayId } = req.params as z.infer<typeof ticketDisplayIdParamSchema>;
    const parsed = parseTicketDisplayId(displayId, slug);
    if (!parsed) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Ticket not found');
    }
    const ticket = await ticketService.getTicketByNumber(parsed.slug, parsed.ticketNumber);
    if (!ticket) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Ticket not found');
    }
    res.json(success(ticket));
  },
);

// SLYK-01 Task K (resolved decision): project creation is Platform-Admin only.
projectsRouter.post(
  '/',
  authenticate,
  requirePlatformAdmin(),
  validateRequest({ body: createProjectBodySchema }),
  async (req, res) => {
    const project = await projectService.createProject({
      name: req.body.name,
      slug: req.body.slug,
      columns: req.body.columns,
      creatorId: req.user!.id,
    });
    res.status(201).json(success(project));
  },
);

// SLYK-01 Task K (resolved decision): project rename/columns is Platform-Admin
// ONLY (no Project Admin rename). Slug is NOT editable. Service blocks removing
// a column that still holds live (non-deleted) tickets.
projectsRouter.patch(
  '/:slug',
  authenticate,
  requirePlatformAdmin(),
  validateRequest({ params: slugParamSchema, body: updateProjectBodySchema }),
  async (req, res) => {
    const { slug } = req.params as z.infer<typeof slugParamSchema>;
    const body = req.body as z.infer<typeof updateProjectBodySchema>;
    const updated = await projectService.updateProject({
      slug,
      name: body.name,
      columns: body.columns,
    });
    res.json(success(updated));
  },
);

// F14: project-scoped label routes (/:slug/labels) mounted on projectsRouter.
projectsRouter.use(projectLabelsRouter);

// F48: project-scoped report routes (/:slug/reports/{time,tickets}) mounted on
// projectsRouter. Membership-gated by requireProjectMember (F47). Mirrors the
// projectLabelsRouter bare-mount pattern.
projectsRouter.use(projectReportsRouter);

// SLYK-01 Task L: project-scoped member-management routes
// (/:slug/members...) mounted on projectsRouter. GET roster gated by
// requireProjectMember; write routes additionally by requireProjectAdmin.
// Mirrors the projectLabelsRouter / projectReportsRouter bare-mount pattern.
projectsRouter.use(projectMembersRouter);
