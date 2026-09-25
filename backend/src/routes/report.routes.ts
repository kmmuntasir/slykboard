import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { requireProjectMember } from '../middleware/requireProjectMember';
import { validateRequest } from '../middleware/validateRequest';
import { success } from '../utils/envelope';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import * as reportService from '../services/reportService';
import * as columnTimeService from '../services/columnTimeService';
import { slugParamSchema } from './projects.schema';
import { parseTicketDisplayId } from '../utils/parseTicketDisplayId';

// F48 D2: report query validation happens at the route edge via validateRequest
// — malformed period/offset/member/source/type produce 400 VALIDATION_FAILED
// instead of a ZodError falling through to INTERNAL_ERROR. Shared filters
// first; the hierarchy + column-time routes extend with their display ids.
// period defaults to 'weekly'; offset defaults to 0 (applied by the handlers).
const reportFilterQuerySchema = z.object({
  period: z.enum(['weekly', 'monthly']).optional(),
  offset: z.coerce.number().int().optional(),
  member: z.uuid().optional(),
  source: z.enum(['auto', 'manual']).optional(),
  // FR-06.3: filter entries by their ticket's type before aggregation.
  type: z.enum(['EPIC', 'STORY', 'TASK', 'SUBTASK']).optional(),
});

// CR-04 / CR-05: `node` addresses the subtree root by display id (SLYK-42);
// `ticket` (entries route) narrows the raw list to one row's subtree.
const hierarchyQuerySchema = reportFilterQuerySchema.extend({
  node: z.string().min(1),
  ticket: z.string().min(1).optional(),
});

// CR-08: column-time addresses its subject by display id (`ticket`) — no node.
const columnTimeQuerySchema = reportFilterQuerySchema.extend({
  ticket: z.string().min(1),
});

// F48 D2: lenient legacy parse for the ticket-summary route (no filters there).
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
  validateRequest({ params: slugParamSchema, query: reportFilterQuerySchema }),
  requireProjectMember(),
  async (req, res) => {
    // CR-06: optional member/source filters narrow the report AND its
    // per-ticket breakdown in one pass; FR-06.3 adds the ticket-type filter.
    const q = req.query as unknown as z.infer<typeof reportFilterQuerySchema>;
    const report = await reportService.getTimeReport({
      period: q.period ?? 'weekly',
      offset: q.offset ?? 0,
      projectId: req.project!.id,
      memberId: q.member ?? null,
      source: q.source ?? null,
      type: q.type ?? null,
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

/** Map the edge-validated query onto the service args (defaults applied). */
function hierarchyArgs(query: z.infer<typeof hierarchyQuerySchema>): {
  period: 'weekly' | 'monthly';
  offset: number;
  memberId: string | null;
  source: 'auto' | 'manual' | null;
} {
  return {
    period: query.period ?? 'weekly',
    offset: query.offset ?? 0,
    memberId: query.member ?? null,
    source: query.source ?? null,
  };
}

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

projectReportsRouter.get(
  '/:slug/reports/time/rollup',
  authenticate,
  validateRequest({ params: slugParamSchema, query: hierarchyQuerySchema }),
  requireProjectMember(),
  async (req, res) => {
    const q = req.query as unknown as z.infer<typeof hierarchyQuerySchema>;
    const { period, offset, memberId, source } = hierarchyArgs(q);
    const nodeId = await resolveNode(req.project!, q.node);
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
  validateRequest({ params: slugParamSchema, query: hierarchyQuerySchema }),
  requireProjectMember(),
  async (req, res) => {
    const q = req.query as unknown as z.infer<typeof hierarchyQuerySchema>;
    const { period, offset, memberId, source } = hierarchyArgs(q);
    const nodeId = await resolveNode(req.project!, q.node);
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
  validateRequest({ params: slugParamSchema, query: hierarchyQuerySchema }),
  requireProjectMember(),
  async (req, res) => {
    const q = req.query as unknown as z.infer<typeof hierarchyQuerySchema>;
    const { period, offset, memberId, source } = hierarchyArgs(q);
    const nodeId = await resolveNode(req.project!, q.node);
    let ticketId: string | null = null;
    if (q.ticket) {
      ticketId = await resolveNode(req.project!, q.ticket);
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

// ----------------------------------------------------------------------------
// CR-08: per-column residence + tracked time for one ticket.
// `ticket` addresses the subject by display id; `period`/`offset` clip the
// window (omitted = the ticket's whole lifetime); `member`/`source` filter the
// TRACKED metric only — residence is member-independent wall-clock.
// ----------------------------------------------------------------------------
projectReportsRouter.get(
  '/:slug/reports/column-time',
  authenticate,
  validateRequest({ params: slugParamSchema, query: columnTimeQuerySchema }),
  requireProjectMember(),
  async (req, res) => {
    const q = req.query as unknown as z.infer<typeof columnTimeQuerySchema>;
    const ticketId = await resolveNode(req.project!, q.ticket);
    const report = await columnTimeService.getColumnTimeReport({
      projectId: req.project!.id,
      ticketId,
      // period omitted = lifetime view
      period: q.period ?? null,
      offset: q.offset ?? 0,
      memberId: q.member ?? null,
      source: q.source ?? null,
    });
    res.json(success(report));
  },
);
