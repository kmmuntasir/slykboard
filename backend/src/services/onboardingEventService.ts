import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { onboardingEvents, projectAgentMeta, projects } from '../db/schema';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import type { OnboardingEventBody } from '../routes/internal.schema';

// SLYK-0200 — dispatcher callbacks for the onboarding lifecycle
// (docs/agentic-automation/05-backend-routes.md § internal routes).
// OnboardingEvents is an append-only log: duplicate same-state POSTs append
// rows by design (idempotency is the dispatcher's job, not ours).

// Local alias mirroring timerService.ts — the drizzle tx client type.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type OnboardingEventRow = typeof onboardingEvents.$inferSelect;

// Deploy-target response shape (five fields, snake→camel per doc example).
export interface DeployTarget {
  lxcCtid: number | null;
  lanIp: string | null;
  systemdService: string | null;
  subdomain: string;
  stack: string;
}

// Shared meta lookup: ProjectAgentMeta by slug, or null when absent.
async function findMetaBySlug(tx: Tx, slug: string) {
  const [row] = await tx
    .select({ projectId: projectAgentMeta.projectId })
    .from(projectAgentMeta)
    .where(eq(projectAgentMeta.slug, slug))
    .limit(1);
  return row ?? null;
}

// POST /api/v1/internal/projects/:slug/onboarding/events — append an event
// and advance meta in ONE transaction so the log and the current state can
// never disagree. LIVE stamps onboardedAt; FAILED persists the error text.
export async function recordOnboardingEvent(args: {
  slug: string;
  body: OnboardingEventBody;
}): Promise<OnboardingEventRow> {
  const { slug, body } = args;

  return db.transaction(async (tx) => {
    const meta = await findMetaBySlug(tx, slug);
    if (!meta) {
      throw new AppError(ErrorCode.NOT_FOUND, `Project '${slug}' not found`, {
        details: { slug },
      });
    }

    const patch: Partial<typeof projectAgentMeta.$inferInsert> = {
      onboardingState: body.toState,
    };
    if (body.toState === 'LIVE') {
      patch.onboardedAt = new Date();
    }
    if (body.toState === 'FAILED') {
      patch.onboardingError = detailErrorText(body.detail);
    }

    await tx
      .update(projectAgentMeta)
      .set(patch)
      .where(eq(projectAgentMeta.projectId, meta.projectId));

    const [event] = await tx
      .insert(onboardingEvents)
      .values({
        projectId: meta.projectId,
        fromState: body.fromState,
        toState: body.toState,
        detail: body.detail ?? null,
      })
      .returning();
    return event!;
  });
}

// detail.error per doc: { error: "..." } | undefined. Non-string values are
// stringified so onboardingError (text column) can always accept them.
function detailErrorText(detail: OnboardingEventBody['detail']): string | null {
  if (detail?.error === undefined) return null;
  return typeof detail.error === 'string' ? detail.error : JSON.stringify(detail.error);
}

// GET /api/v1/internal/projects/:slug/deploy-target — join projects + meta on
// id where slug matches. Non-LIVE projects are not deployable (409).
export async function getDeployTarget(slug: string): Promise<DeployTarget> {
  const [row] = await db
    .select({
      onboardingState: projectAgentMeta.onboardingState,
      lxcCtid: projectAgentMeta.lxcCtid,
      lanIp: projectAgentMeta.lanIp,
      systemdService: projectAgentMeta.systemdService,
      subdomain: projectAgentMeta.subdomain,
      stack: projectAgentMeta.stack,
    })
    .from(projects)
    .innerJoin(projectAgentMeta, eq(projectAgentMeta.projectId, projects.id))
    .where(eq(projectAgentMeta.slug, slug))
    .limit(1);

  if (!row) {
    throw new AppError(ErrorCode.NOT_FOUND, `Project '${slug}' not found`, {
      details: { slug },
    });
  }
  if (row.onboardingState !== 'LIVE') {
    throw new AppError(ErrorCode.CONFLICT, 'Project is not ready for deploys', {
      details: { slug, onboardingState: row.onboardingState },
    });
  }

  return {
    lxcCtid: row.lxcCtid,
    lanIp: row.lanIp,
    systemdService: row.systemdService,
    subdomain: row.subdomain,
    stack: row.stack,
  };
}
