import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requirePlatformAdmin } from '../middleware/requirePlatformAdmin';
import { requireProjectMember } from '../middleware/requireProjectMember';
import { validateRequest } from '../middleware/validateRequest';
import { success } from '../utils/envelope';
import * as reportService from '../services/reportService';
import { slugParamSchema } from './projects.schema';

// F48 D2: parse period/offset query params identically on both the scoped and
// the deprecated global routes, so behaviour is byte-identical apart from the
// project filter. period defaults to 'weekly'; offset defaults to 0.
function parseReportQuery(query: unknown): { period: 'weekly' | 'monthly'; offset: number } {
  const q = (query ?? {}) as Record<string, unknown>;
  const period = (q.period === 'monthly' ? 'monthly' : 'weekly') as 'weekly' | 'monthly';
  const offsetRaw = parseInt(typeof q.offset === 'string' ? q.offset : '', 10);
  const offset = Number.isFinite(offsetRaw) ? offsetRaw : 0;
  return { period, offset };
}

// ----------------------------------------------------------------------------
// F48: project-scoped report routes — /:slug/reports/{time,tickets}.
// Bare-mounted on projectsRouter (mirrors projectLabelsRouter) so the full path
// is /api/projects/:slug/reports/{time,tickets}. Membership-gated by F47's
// requireProjectMember (creator-or-admin), which resolves the slug and attaches
// req.project. The handler reads req.project.id — never re-resolves the slug.
// ----------------------------------------------------------------------------
export const projectReportsRouter = Router();

projectReportsRouter.get(
  '/:slug/reports/time',
  authenticate,
  validateRequest({ params: slugParamSchema }),
  requireProjectMember(),
  async (req, res) => {
    const { period, offset } = parseReportQuery(req.query);
    const report = await reportService.getTimeReport({
      period,
      offset,
      projectId: req.project!.id,
    });
    res.json(success(report));
  },
);

projectReportsRouter.get(
  '/:slug/reports/tickets',
  authenticate,
  validateRequest({ params: slugParamSchema }),
  requireProjectMember(),
  async (req, res) => {
    const { period, offset } = parseReportQuery(req.query);
    const report = await reportService.getTicketSummary({
      period,
      offset,
      projectId: req.project!.id,
    });
    res.json(success(report));
  },
);

// ----------------------------------------------------------------------------
// F23/F24 (DEPRECATED per F48 D2): global report routes — /api/reports/{time,tickets}.
// Still mounted and functional for one release to avoid breaking the live FE
// (F49 not yet landed) and any external consumers. SLYK-01 Task K (resolved
// decision): gated to Platform Admin within SLYK-01. Report scoping refactor is
// deferred to SLYK-16 (out of scope). Each handler logs a [DEPRECATED] warning.
// Behaviour is unchanged: no projectId filter (global aggregation).
// ----------------------------------------------------------------------------
export const reportRouter = Router();

reportRouter.get('/time', authenticate, requirePlatformAdmin(), async (req, res) => {
  console.warn(
    '[DEPRECATED] Global /reports/time route used — use /projects/:slug/reports/time instead.',
  );
  const { period, offset } = parseReportQuery(req.query);
  const report = await reportService.getTimeReport({ period, offset });
  res.json(success(report));
});

reportRouter.get('/tickets', authenticate, requirePlatformAdmin(), async (req, res) => {
  console.warn(
    '[DEPRECATED] Global /reports/tickets route used — use /projects/:slug/reports/tickets instead.',
  );
  const { period, offset } = parseReportQuery(req.query);
  const report = await reportService.getTicketSummary({ period, offset });
  res.json(success(report));
});
