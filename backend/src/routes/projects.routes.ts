import { Router } from 'express';
import { z } from 'zod';
import { success, ErrorCode } from '../utils/envelope';
import { AppError } from '../utils/appError';
import { validateRequest } from '../middleware/validateRequest';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import * as projectService from '../services/projectService';
import * as boardService from '../services/boardService';
import * as ticketService from '../services/ticketService';
import {
  createProjectBodySchema,
  slugParamSchema,
  createTicketBody,
  updateProjectBodySchema,
} from './projects.schema';
import { projectLabelsRouter } from './labels.routes';

export const projectsRouter = Router();

// F08: any authenticated user can list projects (D-ProjectMembers: no membership yet).
projectsRouter.get('/', authenticate, async (_req, res) => {
  const rows = await projectService.listProjects();
  res.json(success(rows));
});

// F08: any authenticated user can fetch a project by slug.
projectsRouter.get(
  '/:slug',
  authenticate,
  validateRequest({ params: slugParamSchema }),
  async (req, res) => {
    const slug = req.params.slug as string;
    const project = await projectService.getProjectBySlug(slug);
    if (!project) {
      throw new AppError(ErrorCode.NOT_FOUND, `Project '${slug}' not found`);
    }
    res.json(success(project));
  },
);

// F09 D-Slug-Route: spec's GET /projects/:id/board → :slug (project URL identifier).
// Any authenticated user (D-ProjectMembers: no membership yet).
projectsRouter.get(
  '/:slug/board',
  authenticate,
  validateRequest({ params: slugParamSchema }),
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
// Any authenticated user (REQ-3.3). TODO(F17): per-column permission check.
projectsRouter.post(
  '/:slug/tickets',
  authenticate,
  validateRequest({ params: slugParamSchema, body: createTicketBody }),
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

// F08 D-Who-Creates: ADMIN-only. First mount of requireRole (F07 shipped it unmounted).
projectsRouter.post(
  '/',
  authenticate,
  requireRole('ADMIN'),
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

// F27 T1: rename project + manage columns (admin-only). Slug is NOT editable.
// Service blocks removing a column that still holds live (non-deleted) tickets.
projectsRouter.patch(
  '/:slug',
  authenticate,
  requireRole('ADMIN'),
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
