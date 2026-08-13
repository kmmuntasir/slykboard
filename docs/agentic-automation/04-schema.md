# 04 — Schema Additions (Drizzle, Conditional Migration)

All definitions live under `backend/src/db/schema/agent.ts`. Imported
by `backend/src/db/schema/index.ts` only when `SLYKBOARD_AGENT_MODE=true`.
Migration files live under `backend/src/db/migrations/agent/` and run
only in agent mode (see `02-dual-mode.md` Layer 1).

**Conventions** (from existing `schema.ts`):

- Drizzle `pgTable` with snake_case column names (2nd arg), camelCase
  access keys (1st arg).
- UUIDs for primary keys, `defaultRandom()`.
- `timestamp` with `{ withTimezone: true, mode: 'date' }`.
- Foreign keys use `.references(() => <table>.id, { onDelete: 'cascade' })`.
- Enums via `pgEnum`.

## New enums

```ts
// backend/src/db/schema/agent.ts

import { pgEnum, pgTable, uuid, text, timestamp, integer, boolean, jsonb } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { projects, tickets, users } from './core';   // existing core tables

// ─────────────────────────────────────────────────────────────────────
// Pipeline state — written by dispatcher, drives PM UI
// ─────────────────────────────────────────────────────────────────────
export const pipelineStateEnum = pgEnum('PipelineState', [
  'BACKLOG',           // PM created, not queued
  'QUEUED',            // dispatcher acknowledged
  'AGENT_RUNNING',     // Cyrus picked up
  'AGENT_WAITING',     // agent asked PM a question (chat) — paused
  'PR_OPEN',           // PR exists on GitHub
  'CI_RUNNING',        // CI workflow in progress
  'MERGING',           // mergebot attempting merge
  'CONFLICT_RETRY',    // AI rebase in progress
  'DEPLOYING',         // CI/CD runner pushing to LXC
  'DONE',              // deployed + smoke-tested
  'FAILED_AGENT',      // agent couldn't complete
  'FAILED_CI',         // CI failed >N times
  'FAILED_CONFLICT',   // AI rebase exhausted retries
  'FAILED_DEPLOY',     // deploy failed, rolled back
  'BLOCKED_HUMAN',     // escalated
]);

// ─────────────────────────────────────────────────────────────────────
// Onboarding state — per-project lifecycle
// ─────────────────────────────────────────────────────────────────────
export const onboardingStateEnum = pgEnum('OnboardingState', [
  'PENDING',
  'PROVISIONING_LXC',
  'WIRING_GITHUB',
  'WIRING_AGENT',
  'WIRING_ZORAXY',
  'SMOKE_TEST',
  'LIVE',
  'FAILED',
  'DECOMMISSIONING',
  'DECOMMISSIONED',
]);

// ─────────────────────────────────────────────────────────────────────
// Chat author role — PM ↔ agent ↔ system messages on a ticket
// ─────────────────────────────────────────────────────────────────────
export const messageAuthorRoleEnum = pgEnum('MessageAuthorRole', [
  'PM',           // the human stakeholder
  'AGENT',        // Cyrus/Claude speaking (forwarded by dispatcher)
  'SYSTEM',       // pipeline status messages (PR opened, CI failed) — read-only
]);
```

## Projects table — additive columns

The existing `projects` table (in `schema/core.ts`) gains nullable
agent-mode columns. The migration that adds them lives in
`migrations/agent/` (only runs in agent mode). Existing plain-mode
installs never see these columns.

```ts
// backend/src/db/schema/agent.ts — continued

// Add columns to existing projects table via Drizzle's alter pattern.
// Migration: ALTER TABLE "Projects" ADD COLUMN ...
//
// In code, access via a re-exported `projectsWithAgent` view that
// composes the core columns + the agent columns. Plain-mode code only
// imports the core `projects` table; agent-mode code imports
// `projectsWithAgent`.

export const projectAgentColumns = {
  // ── Onboarding form fields ──
  slug: text('slug').notNull().unique(),                // URL-safe, also teamKey seed
  subdomain: text('subdomain').notNull(),               // <sub>.kmlab.dev
  sourceMode: text('source_mode').notNull().default('new'),  // 'new' | 'existing'
  githubRepo: text('github_repo'),                      // SSH URL strongly preferred; HTTPS accepted. Null until WIRING_GITHUB in 'new' mode.
  githubRepoCreated: boolean('github_repo_created').default(false).notNull(),
  stack: text('stack').notNull(),                       // 'node-express' | 'next' | 'python-fastapi' | 'go' | 'static'
  teamKey: text('team_key').notNull(),                  // UPPER(slug), Cyrus routing key
  agentBackend: text('agent_backend'),                  // null = global default; per-project override
  initialAgentContext: text('initial_agent_context'),   // becomes AGENTS.md seed

  // ── Provisioning outputs (filled by dispatcher via internal API) ──
  lxcCtid: integer('lxc_ctid'),
  lanIp: text('lan_ip'),
  systemdService: text('systemd_service'),
  zoraxyProxyId: text('zoraxy_proxy_id'),

  // ── Onboarding lifecycle ──
  onboardingState: onboardingStateEnum('onboarding_state').notNull().default('PENDING'),
  onboardingError: text('onboarding_error'),
  onboardedAt: timestamp('onboarded_at', { withTimezone: true, mode: 'date' }),
};

// Use Drizzle's table extending pattern or just ALTER in the migration
// and read columns via raw queries / a separate table object.
// Recommended: define projectsWithAgent as a separate pgTable that
// joins 1:1 with Projects on id.
export const projectAgentMeta = pgTable('ProjectAgentMeta', {
  projectId: uuid('project_id').primaryKey().references(() => projects.id, { onDelete: 'cascade' }),
  ...projectAgentColumns,
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).$onUpdate(() => new Date()).notNull(),
});
```

**Why a separate 1:1 table (`ProjectAgentMeta`) instead of ALTER-ing `Projects`?**

Two reasons:

1. **Migration isolation.** Core schema migrations stay clean. Agent
   migrations create a new table; plain-mode installs never see it.
   No risk of breaking the core migration runner.
2. **Plain-mode code clarity.** Plain-mode queries (`SELECT * FROM
   Projects`) never see agent columns. No accidental dependencies in
   plain-mode services.

The 1:1 join is cheap — every query that needs agent columns joins on
the primary key.

## New tables

```ts
// ─────────────────────────────────────────────────────────────────────
// AgentTokens — HMAC tokens for dispatcher↔slykboard auth at the API
// layer (separate from session JWTs). Admin creates these in the UI;
// stored sha256-hashed.
// ─────────────────────────────────────────────────────────────────────
export const agentTokens = pgTable('AgentTokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique(),     // sha256(raw token)
  name: text('name').notNull(),                         // "dispatcher-prod", "dispatcher-staging"
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),  // null = platform-wide
  createdBy: uuid('created_by').references(() => users.id),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────────────
// PipelineJobs — one row per non-DONE ticket. Dispatcher's queue
// primitive. Concurrency via FOR UPDATE SKIP LOCKED (see plan §4.3).
// ─────────────────────────────────────────────────────────────────────
export const pipelineJobs = pgTable('PipelineJobs', {
  ticketId: uuid('ticket_id').primaryKey().references(() => tickets.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  state: pipelineStateEnum('state').notNull().default('BACKLOG'),
  priority: integer('priority').default(0).notNull(),
  attempts: integer('attempts').default(0).notNull(),
  leaseOwnerId: text('lease_owner_id'),                 // dispatcher pod id (future HA)
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true, mode: 'date' }),
  agentIssueId: text('agent_issue_id'),                 // stable id used in Linear-shape webhook's data.id
  agentBackend: text('agent_backend'),                  // snapshot of projects.agent_backend at dispatch time
  githubPrNumber: integer('github_pr_number'),
  githubPrSha: text('github_pr_sha'),
  needsPmAttention: boolean('needs_pm_attention').default(false).notNull(),  // set true on AGENT_WAITING, cleared on PM reply or state exit
  traceId: text('trace_id'),                            // uuid v4, propagated across services for observability
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).$onUpdate(() => new Date()).notNull(),
});

// ─────────────────────────────────────────────────────────────────────
// PipelineEvents — append-only event log per ticket. Drives the
// pipeline timeline in the PM UI.
// ─────────────────────────────────────────────────────────────────────
export const pipelineEvents = pgTable('PipelineEvents', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  fromState: pipelineStateEnum('from_state'),
  toState: pipelineStateEnum('to_state').notNull(),
  // Free-form jsonb; shape depends on toState. Dispatcher populates,
  // slykboard stores verbatim. Documented shapes:
  //
  //  - any state: { traceId?, prNumber?, sha?, attempt?, error?, durationMs? }
  //
  //  - toState=MERGING (mergebot decision log — research-phase
  //    tracking hook, input to future Phase 6.5 AI-reviewer
  //    validation; see homelab-setup/RESEARCH-SCOPE-MEMO.md):
  //      {
  //        checksPassed: string[],          // required CI checks that passed
  //        checksFailed: string[],          // should be [] if auto-merge fired
  //        coverageDelta: { files: number, lines: number } | null,
  //        diffSize: { filesChanged: number, insertions: number, deletions: number },
  //        touchedSensitivePaths: { infra: boolean, migrations: boolean, deployConfig: boolean }
  //      }
  detail: jsonb('detail'),
  traceId: text('trace_id'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────────────
// AgentMessages — PM ↔ agent chat thread on a ticket (slykboard-origin
// only; Linear-origin tickets keep their Linear threads).
// Pattern follows existing `Comments` table + `commentService.ts` —
// read those first as a structural template. Differences: (1) authorRole
// enum vs single authorId FK; (2) idempotencyKey for dispatcher retry
// safety; (3) agentSessionId for routing PM replies to Cyrus.
// ─────────────────────────────────────────────────────────────────────
export const agentMessages = pgTable('AgentMessages', {
  id: uuid('id').primaryKey().defaultRandom(),
  ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  authorRole: messageAuthorRoleEnum('author_role').notNull(),
  authorUserId: uuid('author_user_id').references(() => users.id),  // null when AGENT or SYSTEM
  body: text('body').notNull(),                                       // markdown, ≤4000 chars
  agentSessionId: text('agent_session_id'),                           // for routing PM replies
  // Required when authorRole=AGENT (dispatcher forwards with key for dedup).
  // Null for PM (slykboard-generated) + SYSTEM. Unique where non-null.
  idempotencyKey: text('idempotency_key'),
  readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────────────
// OnboardingEvents — append-only onboarding lifecycle log per project.
// Drives the onboarding timeline in the admin UI.
// ─────────────────────────────────────────────────────────────────────
export const onboardingEvents = pgTable('OnboardingEvents', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  fromState: onboardingStateEnum('from_state'),
  toState: onboardingStateEnum('to_state').notNull(),
  detail: jsonb('detail'),                               // {ctid, lanIp, repoUrl, proxyHostId, error, ...}
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────────────
// NotificationPreferences — per-user, per-project email opt-ins.
// Three booleans covering the only states that trigger email (see
// 06-frontend-ui.md "Notifications"). Composite PK = one row per
// (user, project). Default row created lazily on first interaction
// (ticket view, project membership grant) with all three = true.
// ─────────────────────────────────────────────────────────────────────
export const notificationPreferences = pgTable('NotificationPreferences', {
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  notifyOnDone: boolean('notify_on_done').default(true).notNull(),
  notifyOnBlockedHuman: boolean('notify_on_blocked_human').default(true).notNull(),
  notifyOnAgentWaiting: boolean('notify_on_agent_waiting').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
```

## Indexes

```ts
// PipelineJobs — dispatcher's lease query
pipelineJobs.createIndex('idx_pipeline_jobs_state_lease', [sql`state, lease_expires_at, priority DESC, created_at`]);

// PipelineJobs — UI "needs PM attention" badge query
pipelineJobs.createIndex('idx_pipeline_jobs_needs_pm_attention', [sql`needs_pm_attention WHERE needs_pm_attention = true`]);

// PipelineEvents — UI timeline query
pipelineEvents.createIndex('idx_pipeline_events_ticket_created', [sql`ticket_id, created_at`]);

// AgentMessages — UI chat thread query
agentMessages.createIndex('idx_agent_messages_ticket_created', [sql`ticket_id, created_at`]);

// AgentMessages — inbound dedup lookup (dispatcher retry safety)
agentMessages.createIndex('idx_agent_messages_idempotency', [sql`idempotency_key WHERE idempotency_key IS NOT NULL`]);

// OnboardingEvents — UI timeline query
onboardingEvents.createIndex('idx_onboarding_events_project_created', [sql`project_id, created_at`]);

// NotificationPreferences — composite PK handles uniqueness + lookup
// (no extra index needed)

// ProjectAgentMeta — uniqueness (already on slug via .unique())
// No additional indexes needed; queries join on projectId (PK).
```

## Migration files

Drizzle-kit auto-generates filenames like `0000_<two_words>.sql` plus a
`meta/_journal.json` entry — do NOT hand-number migration files. After
the refactor in `00-refactor-plan.md`, the agent migration folder is
`backend/src/db/migrations/agent/`. Generate via:

```bash
npm run db:generate:agent
```

Drizzle-kit picks up `backend/drizzle.config.agent.ts` (created in
refactor Task 1) and writes one new `.sql` file + journal entry per
schema diff. Run as many times as needed during Phase 0 — each
iteration produces a new file. Order is enforced by the journal, not
filename prefixes.

Initial Phase-0 `db:generate:agent` run will emit a single `.sql` file
covering all 7 tables + 3 enums + indexes. Subsequent phases (1, 2, 5)
emit additional files as schema evolves. The pattern below shows the
*logical* content; drizzle-kit will likely collapse it into one file
on first generation:

```
backend/src/db/migrations/agent/
  meta/
    _journal.json
    0000_snapshot.json
  0000_<auto_generated_name>.sql    # creates:
    #   - PipelineState enum
    #   - OnboardingState enum
    #   - MessageAuthorRole enum
    #   - AgentTokens table
    #   - PipelineJobs table (with needs_pm_attention)
    #   - PipelineEvents table
    #   - AgentMessages table (with idempotency_key)
    #   - OnboardingEvents table
    #   - NotificationPreferences table
    #   - ProjectAgentMeta table
    #   - all indexes
```

## Plain-mode verification

After implementing, verify plain-mode contract:

```bash
# In a fresh DB with SLYKBOARD_AGENT_MODE=false (or unset)
SLYKBOARD_AGENT_MODE=false npm run db:migrate
psql $DATABASE_URL -c '\dt'
# Expected: only core tables (Users, Projects, ProjectMembers, Tickets,
# Labels, TicketLabels, ActivityLogs, TimeEntries, Comments,
# ProjectSequences). None of: AgentTokens, PipelineJobs, PipelineEvents,
# AgentMessages, OnboardingEvents, NotificationPreferences, ProjectAgentMeta.

# Then in agent mode
SLYKBOARD_AGENT_MODE=true npm run db:migrate
psql $DATABASE_URL -c '\dt'
# Expected: all core tables + all 7 agent tables.
```

## Test fixtures

Agent-mode tests live under `backend/src/db/schema/agent.test.ts` and
verify:

1. Enum values match the spec above.
2. Foreign keys cascade correctly (delete a ticket → pipeline job +
   events + messages gone; delete a project → meta + onboarding events
   + notification preferences gone).
3. Unique constraints (`AgentTokens.token_hash`, `ProjectAgentMeta.slug`).
4. Composite primary key on `NotificationPreferences` (one row per
   user × project).
5. Idempotency: inserting two `AgentMessages` rows with the same
   `idempotencyKey` rejects the second (use ON CONFLICT or check first).
6. Default values (`sourceMode = 'new'`, `onboardingState = 'PENDING'`,
   `githubRepoCreated = false`, `needsPmAttention = false`,
   notification prefs default true).
