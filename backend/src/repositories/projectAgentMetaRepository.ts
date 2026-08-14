import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { projectAgentMeta } from '../db/schema';

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
