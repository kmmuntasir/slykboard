import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireRole } from '../middleware/requireRole';
import { validateRequest } from '../middleware/validateRequest';
import { success } from '../utils/envelope';
import { slugParam, labelIdParam, createLabelBody, updateLabelBody } from './labels.schema';
import { listLabels, createLabel, updateLabel, deleteLabel } from '../services/labelService';

// Nested under /api/projects/:slug — list + create. Routes defined with full
// /:slug/labels path so we can bare-mount via projectsRouter.use(projectLabelsRouter).
export const projectLabelsRouter = Router();

projectLabelsRouter.get(
  '/:slug/labels',
  authenticate,
  validateRequest({ params: slugParam }),
  async (req, res) => {
    const { slug } = req.params as { slug: string };
    const rows = await listLabels(slug);
    res.json(success(rows));
  },
);

projectLabelsRouter.post(
  '/:slug/labels',
  authenticate,
  requireRole('ADMIN'),
  validateRequest({ params: slugParam, body: createLabelBody }),
  async (req, res) => {
    const { slug } = req.params as { slug: string };
    const body = req.body as { name: string; color: string };
    const created = await createLabel({ projectSlug: slug, name: body.name, color: body.color });
    res.status(201).json(success(created));
  },
);

// Flat under /api/labels/:id — update + delete.
export const labelsRouter = Router();

labelsRouter.patch(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateRequest({ params: labelIdParam, body: updateLabelBody }),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const patch = req.body as { name?: string; color?: string };
    const { new: updated } = await updateLabel({ labelId: id, patch });
    res.json(success(updated));
  },
);

labelsRouter.delete(
  '/:id',
  authenticate,
  requireRole('ADMIN'),
  validateRequest({ params: labelIdParam }),
  async (req, res) => {
    const { id } = req.params as { id: string };
    const removed = await deleteLabel(id);
    res.json(success(removed));
  },
);
