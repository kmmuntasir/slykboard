import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { requireProjectMember } from '../middleware/requireProjectMember';
import { validateRequest } from '../middleware/validateRequest';
import { success } from '../utils/envelope';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import * as reportService from '../services/reportService';
import { slugParamSchema } from './projects.schema';
import { parseTicketDisplayId } from '../utils/parseTicketDisplayId';

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
// CR-04 / CR-05: hierarchy roll-up + drill-down over a node's live subtree.
// All three share the period/offset window and the optional member/source
// filters; `node` addresses the root of the subtree by display id (SLYK-42),
// `ticket` (entries only) narrows the raw list to one row's subtree.
// ----------------------------------------------------------------------------

// displayId shape only — existence is resolved in the service (404 there).
const hierarchyQuerySchema = z.object({
  node: z.string().min(1),
  period: z.enum(['weekly', 'monthly']).optional(),
  offset: z.coerce.number().int().optional(),
  member: z.uuid().optional(),
  source: z.enum(['auto', 'manual']).optional(),
  ticket: z.string().min(1).optional(),
});

/** Resolve the `node` display id to a live ticket id inside the project. */
async function resolveNode(project: { id: string; slug: string }, node: string) {
  const parsed = parseTicketDisplayId(node, project.slug);
  if (!parsed) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `Invalid ticket reference '${node}'`, {
      details: { node },
    });
  }
  const row = await reportService.resolveLiveTicketByNumber(project.id, parsed.ticketNumber);
  if (!row) {
    throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${node}' not found`);
  }
  return row.id;
}

function hierarchyArgs(query: unknown): {
  period: 'weekly' | 'monthly';
  offset: number;
  memberId: string | null;
  source: 'auto' | 'manual' | null;
} {
  const parsed = hierarchyQuerySchema.parse(query ?? {});
  return {
    period: parsed.period ?? 'weekly',
    offset: parsed.offset ?? 0,
    memberId: parsed.member ?? null,
    source: parsed.source ?? null,
  };
}

projectReportsRouter.get(
  '/:slug/reports/time/rollup',
  authenticate,
  validateRequest({ params: slugParamSchema }),
  requireProjectMember(),
  async (req, res) => {
    const { period, offset, memberId, source } = hierarchyArgs(req.query);
    const nodeId = await resolveNode(
      req.project!,
      String((req.query as { node?: string }).node ?? ''),
    );
    res.json(
      success(
        await reportService.getNodeTimeRollup({
          projectId: req.project!.id,
          nodeId,
          period,
          offset,
          memberId,
          source,
        }),
      ),
    );
  },
);

projectReportsRouter.get(
  '/:slug/reports/time/breakdown',
  authenticate,
  validateRequest({ params: slugParamSchema }),
  requireProjectMember(),
  async (req, res) => {
    const { period, offset, memberId, source } = hierarchyArgs(req.query);
    const nodeId = await resolveNode(
      req.project!,
      String((req.query as { node?: string }).node ?? ''),
    );
    res.json(
      success(
        await reportService.getNodeTimeBreakdown({
          projectId: req.project!.id,
          nodeId,
          period,
          offset,
          memberId,
          source,
        }),
      ),
    );
  },
);

projectReportsRouter.get(
  '/:slug/reports/time/entries',
  authenticate,
  validateRequest({ params: slugParamSchema }),
  requireProjectMember(),
  async (req, res) => {
    const { period, offset, memberId, source } = hierarchyArgs(req.query);
    const nodeId = await resolveNode(
      req.project!,
      String((req.query as { node?: string }).node ?? ''),
    );
    const rawTicket = (req.query as { ticket?: string }).ticket;
    let ticketId: string | null = null;
    if (rawTicket) {
      ticketId = await resolveNode(req.project!, rawTicket);
    }
    res.json(
      success(
        await reportService.getNodeTimeEntries({
          projectId: req.project!.id,
          nodeId,
          period,
          offset,
          memberId,
          source,
          ticketId,
        }),
      ),
    );
  },
);
