# SLYK-0140 — Agent schema: 7 tables, 3 enums, first agent migration

**Phase:** 0 — Foundations
**Type:** Feature (backend)
**Depends on:** SLYK-0100

## Description

Fill `backend/src/db/schema/agent.ts` with every enum, table, and index from
`04-schema.md`, then generate + apply the first agent migration.

**Enums:** `pipelineStateEnum` (15 values), `onboardingStateEnum` (10),
`messageAuthorRoleEnum` (3).

**Tables:**

1. `agentTokens` — tokenHash (unique), name, projectId (nullable, cascade),
   createdBy, revokedAt, createdAt.
2. `pipelineJobs` — ticketId PK (cascade), projectId, state, priority,
   attempts, leaseOwnerId, leaseExpiresAt, agentIssueId, agentBackend,
   githubPrNumber, githubPrSha, needsPmAttention, traceId, timestamps.
3. `pipelineEvents` — ticketId (cascade), fromState (nullable), toState,
   detail jsonb (stores dispatcher blobs verbatim, incl. MERGING decision
   log), traceId, createdAt.
4. `agentMessages` — ticketId (cascade), authorRole, authorUserId (nullable),
   body, agentSessionId, idempotencyKey (unique where non-null), readAt,
   createdAt.
5. `onboardingEvents` — projectId (cascade), fromState, toState, detail
   jsonb, createdAt.
6. `notificationPreferences` — composite PK (userId, projectId), three
   boolean flags defaulting true, timestamps.
7. `projectAgentMeta` — projectId PK (cascade to projects), the full
   `projectAgentColumns` set from `04-schema.md` (slug unique, subdomain,
   sourceMode, githubRepo, githubRepoCreated, stack, teamKey, agentBackend,
   initialAgentContext, lxcCtid, lanIp, systemdService, zoraxyProxyId,
   onboardingState, onboardingError, onboardedAt), timestamps. Separate 1:1
   table — do NOT alter the core `projects` table.

**Indexes** (per `04-schema.md` Indexes section): pipeline lease composite,
needsPmAttention partial, pipelineEvents ticket+created, agentMessages
ticket+created, agentMessages idempotency partial, onboardingEvents
project+created.

**Migration:** `npm run db:generate:agent` → single `.sql` covering all
tables/enums/indexes. **Watch the drizzle-kit enum-partial-index `$1`
placeholder bug** — reconcile to literal values before applying. Apply via
`npm run db:migrate` in agent mode only.

**Tests** (`backend/src/db/schema/agent.test.ts`) per `04-schema.md` Test
fixtures: enum values match spec; FK cascades (delete ticket → job+events+
messages gone; delete project → meta+onboarding events+notification prefs
gone); unique constraints (tokenHash, slug); composite PK on
notificationPreferences; idempotencyKey duplicate rejection; defaults
(sourceMode='new', onboardingState='PENDING', githubRepoCreated=false,
needsPmAttention=false, prefs true).

## Acceptance criteria

- [ ] `npm run db:generate:agent` produces one migration; applies cleanly in
      agent mode.
- [ ] Plain mode: migrate → `\dt` shows ONLY core tables — none of the 7
      agent tables.
- [ ] Agent mode: `\dt` shows all core + all 7 agent tables.
- [ ] All `agent.test.ts` fixture cases pass.
- [ ] No changes to `schema/core.ts` or core migrations.
- [ ] `make typecheck` green (schema/index.ts still compiles both modes).

## References

- `docs/agentic-automation/04-schema.md` (complete source of truth)
- `docs/agentic-automation/02-dual-mode.md` Layer 1, anti-patterns
- Repo memory: drizzle-kit `$1` placeholder bug on enum partial indexes

## Dependencies

- SLYK-0100 (schema/ + migrations/ split exists)
