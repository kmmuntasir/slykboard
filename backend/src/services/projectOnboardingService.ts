import { db } from '../db/client';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { isReservedSlug, isValidSlug, normalizeSlug } from '../utils/slug';
import { logger } from '../config/logger';
import type { CreateAgentProjectBody } from '../routes/admin-agent.schema';
import {
  findMetaBySlug,
  findSubdomainOwner,
  insertMeta,
  markOnboardingFailed,
  type ProjectAgentMetaRow,
} from '../repositories/projectAgentMetaRepository';
import { DispatcherError, postToDispatcher } from './dispatcherClient';
import { addMemberInTx } from './membershipService';
import { getProjectBySlug, insertProjectInTx, type ProjectRow } from './projectService';

// SLYK-0190 — POST /api/v1/admin/projects: create the core project + agent
// meta in ONE transaction, then kick off the dispatcher orchestrator
// (docs/agentic-automation/05-backend-routes.md § admin routes, behavior 1–5).

// PG unique_violation. The DB constraints are the authoritative backstop for
// the two friendly pre-checks below (plain `projects` slug + meta slug).
const PG_UNIQUE_VIOLATION = '23505';

export interface CreatedAgentProject {
  project: ProjectRow;
  meta: ProjectAgentMetaRow;
}

export interface CreateAgentProjectInput {
  body: CreateAgentProjectBody;
  creatorId: string;
}

// The board lives on the PLAIN-mode slug alphabet (utils/slug.ts: uppercase,
// no hyphens, ≤16) — every /api/projects/:slug route validates that shape.
// Agent slugs are lowercase kebab, so the core row stores the mapped form
// ('inventory-tracker' → 'INVENTORYTRACKER'). teamKey is the same mapped
// string: 07-dispatcher-contract.md shows teamKey 'INVENTORYTRACKER' for
// projectSlug 'inventory-tracker' (UPPER(slug), hyphens dropped).
function mapCoreSlug(agentSlug: string): string {
  const coreSlug = normalizeSlug(agentSlug);
  if (!isValidSlug(coreSlug)) {
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      `Slug '${agentSlug}' cannot map to a board slug: after hyphens are removed it must be 2–16 letters and digits starting with a letter`,
      { details: { slug: agentSlug, mapped: coreSlug } },
    );
  }
  if (isReservedSlug(coreSlug)) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, `Slug '${coreSlug}' is reserved`, {
      details: { slug: agentSlug, mapped: coreSlug },
    });
  }
  return coreSlug;
}

/**
 * Create project + meta, then start onboarding:
 *
 * 1. Pre-checks (friendly CONFLICTs; DB unique constraints backstop races).
 * 2. One transaction: core project row (default columns + ticket sequence —
 *    reused from projectService so board flows work), a PROJECT_ADMIN
 *    membership row for the creating admin, and the ProjectAgentMeta row
 *    (onboardingState defaults to PENDING).
 * 3. AFTER commit: signed POST /onboard to the dispatcher. Never inside the
 *    tx — an HTTP call would pin the connection (11-existing-patterns.md).
 * 4. Dispatcher 4xx / unreachable-after-retries → meta marked FAILED with the
 *    dispatcher's message, UPSTREAM_FAILED (502) surfaced to the admin.
 */
export async function createAgentProject(
  input: CreateAgentProjectInput,
): Promise<CreatedAgentProject> {
  const { body, creatorId } = input;
  const coreSlug = mapCoreSlug(body.slug);

  // Friendly uniqueness pre-checks (issues CONFLICT; the DB remains the
  // authority under concurrency).
  if (await getProjectBySlug(coreSlug)) {
    throw new AppError(ErrorCode.CONFLICT, `Slug '${body.slug}' already exists`, {
      details: { slug: body.slug, mapped: coreSlug },
    });
  }
  if (await findMetaBySlug(body.slug)) {
    throw new AppError(ErrorCode.CONFLICT, `Slug '${body.slug}' already exists`, {
      details: { slug: body.slug },
    });
  }
  // No DB constraint covers subdomain uniqueness — this check is the only
  // guard (admin-only, low-concurrency flow).
  if (await findSubdomainOwner(body.subdomain)) {
    throw new AppError(ErrorCode.CONFLICT, `Subdomain '${body.subdomain}' is already in use`, {
      details: { subdomain: body.subdomain },
    });
  }

  let created: CreatedAgentProject;
  try {
    created = await db.transaction(async (tx) => {
      const project = await insertProjectInTx(tx, {
        name: body.name,
        slug: coreSlug,
        creatorId,
      });

      // Seed the creating admin as PROJECT_ADMIN so the project is usable by
      // the existing board/member flows even if their platform-admin flag is
      // later revoked (PA bypass is the other access path, not the only one).
      await addMemberInTx(tx, project.id, creatorId, 'PROJECT_ADMIN');

      const [meta] = await insertMeta(tx, {
        projectId: project.id,
        slug: body.slug,
        subdomain: body.subdomain,
        sourceMode: body.sourceMode,
        githubRepo: body.githubRepo,
        stack: body.stack,
        teamKey: coreSlug,
        agentBackend: body.agentBackend,
        initialAgentContext: body.initialAgentContext,
        // onboardingState intentionally omitted — column default PENDING.
      });
      if (!meta) {
        throw new AppError(ErrorCode.INTERNAL_ERROR, 'Failed to create project meta');
      }

      return { project, meta };
    });
  } catch (cause) {
    // Lost the uniqueness race anyway → same friendly CONFLICT as the
    // pre-checks. Any other error propagates untouched.
    const constraint = (cause as { constraint?: string })?.constraint;
    const code = (cause as { code?: string })?.code;
    if (code === PG_UNIQUE_VIOLATION && typeof constraint === 'string') {
      throw new AppError(ErrorCode.CONFLICT, `Slug '${body.slug}' already exists`, {
        details: { slug: body.slug, constraint },
        // Preserve the driver error for the error log.
        cause,
      });
    }
    throw cause;
  }

  // Contract payload per 07-dispatcher-contract.md § POST /onboard. The
  // dispatcherClient injects the idempotencyKey and signs the exact bytes.
  // visibility is request-only (no meta column) — forwarded, not persisted.
  try {
    await postToDispatcher('/onboard', {
      project: {
        id: created.project.id,
        slug: created.meta.slug,
        name: created.project.name,
        subdomain: created.meta.subdomain,
        sourceMode: created.meta.sourceMode,
        githubRepo: created.meta.githubRepo,
        stack: created.meta.stack,
        teamKey: created.meta.teamKey,
        agentBackend: created.meta.agentBackend,
        visibility: body.visibility,
        initialAgentContext: created.meta.initialAgentContext,
      },
    });
  } catch (cause) {
    // 4xx rejection or unreachable after 3 retries — both mean onboarding
    // cannot proceed. Persist FAILED + the dispatcher's message (best-effort;
    // a DB failure here must not mask the 502), then surface UPSTREAM_FAILED.
    const detail =
      cause instanceof DispatcherError || cause instanceof Error ? cause.message : String(cause);
    try {
      await markOnboardingFailed(created.meta.projectId, detail);
    } catch (markError) {
      logger.error({ err: markError }, 'failed to mark onboarding FAILED after dispatcher error');
    }
    throw new AppError(ErrorCode.UPSTREAM_FAILED, `Dispatcher onboarding failed: ${detail}`, {
      details: {
        slug: body.slug,
        dispatcherStatus: cause instanceof DispatcherError ? cause.status : undefined,
      },
      cause,
    });
  }

  return created;
}
