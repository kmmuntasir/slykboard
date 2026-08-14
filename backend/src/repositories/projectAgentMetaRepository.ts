import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { onboardingEvents, projectAgentMeta } from '../db/schema';

// SLYK-0190 — ALL ProjectAgentMeta access for the onboarding flow lives here
// (mirrors membershipService's ownership rule for project_members). The
// repositories/ layer was empty until now; 11-existing-patterns.md names this
// file as its first intended resident. Callers pass a tx for anything that
// must share a wider transaction; single-row reads/writes default to `db`.

// Drizzle tx client alias — same idiom as onboardingEventService.ts.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ProjectAgentMetaRow = typeof projectAgentMeta.$inferSelect;
export type ProjectAgentMetaInsert = typeof projectAgentMeta.$inferInsert;

/** Insert the 1:1 meta row. Caller owns transactionality (onboarding tx). */
export function insertMeta(tx: Tx, values: ProjectAgentMetaInsert): Promise<ProjectAgentMetaRow[]> {
  return tx.insert(projectAgentMeta).values(values).returning();
}

/** Meta row by core project id (ticket webhook payload source), or null. */
export async function findMetaByProjectId(projectId: string): Promise<ProjectAgentMetaRow | null> {
  const [row] = await db
    .select()
    .from(projectAgentMeta)
    .where(eq(projectAgentMeta.projectId, projectId))
    .limit(1);
  return row ?? null;
}

/** Meta row by slug (the admin/dispatcher-facing identifier), or null. */
export async function findMetaBySlug(slug: string): Promise<ProjectAgentMetaRow | null> {
  const [row] = await db
    .select()
    .from(projectAgentMeta)
    .where(eq(projectAgentMeta.slug, slug))
    .limit(1);
  return row ?? null;
}

/** Any meta row already claiming this subdomain (slug may differ). */
export async function findSubdomainOwner(subdomain: string): Promise<ProjectAgentMetaRow | null> {
  const [row] = await db
    .select()
    .from(projectAgentMeta)
    .where(eq(projectAgentMeta.subdomain, subdomain))
    .limit(1);
  return row ?? null;
}

/**
 * Persist a dispatcher failure: onboardingState = FAILED + the dispatcher's
 * message on onboardingError (05-backend-routes.md § behavior step 4). Runs
 * on `db` — by the time this runs the creation transaction has committed, so
 * it must be its own write, not part of the rolled-back one.
 */
export async function markOnboardingFailed(projectId: string, errorText: string): Promise<void> {
  await db
    .update(projectAgentMeta)
    .set({ onboardingState: 'FAILED', onboardingError: errorText })
    .where(eq(projectAgentMeta.projectId, projectId));
}

/**
 * SLYK-0210 — decommission start, inside the caller's transaction: flip
 * onboardingState to DECOMMISSIONING and append the audit event (03-security
 * § Decommission safety layer 5). The initiating admin's id rides the event
 * detail (OnboardingEvents has no user column); createdAt is the timestamp.
 * fromState is the meta's previous state so the timeline stays truthful,
 * including manual retries from DECOMMISSIONING (layer 4).
 */
export async function markDecommissioningInTx(
  tx: Tx,
  args: {
    projectId: string;
    fromState: ProjectAgentMetaRow['onboardingState'];
    initiatedBy: string;
  },
): Promise<void> {
  await tx
    .update(projectAgentMeta)
    .set({ onboardingState: 'DECOMMISSIONING' })
    .where(eq(projectAgentMeta.projectId, args.projectId));
  await tx.insert(onboardingEvents).values({
    projectId: args.projectId,
    fromState: args.fromState,
    toState: 'DECOMMISSIONING',
    detail: { initiatedBy: args.initiatedBy },
  });
}

// SLYK-0230 — read side for the admin onboarding timeline. Full OnboardingEvents
// rows in ascending createdAt order (timeline render order). The timeline page
// caps polling client-side (React Query refetchInterval) and the log is bounded
// by the lifecycle itself (≤ ~12 states + decommission audit), so unlike the
// pipeline view there is no server-side limit to apply.

export type OnboardingEventRow = typeof onboardingEvents.$inferSelect;

/** All onboarding events for a project, asc by createdAt. */
export async function listEventsByProjectId(
  tx: Tx,
  projectId: string,
): Promise<OnboardingEventRow[]> {
  return tx
    .select()
    .from(onboardingEvents)
    .where(eq(onboardingEvents.projectId, projectId))
    .orderBy(asc(onboardingEvents.createdAt));
}
