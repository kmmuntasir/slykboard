import { Router } from 'express';
import { success, ErrorCode } from '../utils/envelope';
import { AppError } from '../utils/appError';
import { validateRequest } from '../middleware/validateRequest';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import * as projectService from '../services/projectService';
import { createProjectBodySchema, slugParamSchema } from './projects.schema';

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
