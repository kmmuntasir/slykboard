// Agent-mode schema per docs/agentic-automation/04-schema.md (SLYK-0140).
// Table objects are inert at import; schema/index.ts re-exports them in both
// modes. Migration gating lives in src/db/migrate.ts (agent folder only runs
// when SLYKBOARD_AGENT_MODE=true — 02-dual-mode.md Layer 1).
import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { projects, tickets, users } from './core';

// ─────────────────────────────────────────────────────────────────────
// Pipeline state — written by dispatcher, drives PM UI
// ─────────────────────────────────────────────────────────────────────
export const pipelineStateEnum = pgEnum('PipelineState', [
  'BACKLOG', // PM created, not queued
  'QUEUED', // dispatcher acknowledged
  'AGENT_RUNNING', // Cyrus picked up
  'AGENT_WAITING', // agent asked PM a question (chat) — paused
  'PR_OPEN', // PR exists on GitHub
  'CI_RUNNING', // CI workflow in progress
  'MERGING', // mergebot attempting merge
  'CONFLICT_RETRY', // AI rebase in progress
  'DEPLOYING', // CI/CD runner pushing to LXC
  'DONE', // deployed + smoke-tested
  'FAILED_AGENT', // agent couldn't complete
  'FAILED_CI', // CI failed >N times
  'FAILED_CONFLICT', // AI rebase exhausted retries
  'FAILED_DEPLOY', // deploy failed, rolled back
  'BLOCKED_HUMAN', // escalated
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
  'PM', // the human stakeholder
  'AGENT', // Cyrus/Claude speaking (forwarded by dispatcher)
  'SYSTEM', // pipeline status messages (PR opened, CI failed) — read-only
]);

// ─────────────────────────────────────────────────────────────────────
// AgentTokens — HMAC tokens for dispatcher↔slykboard auth at the API
// layer (separate from session JWTs). Admin creates these in the UI;
// stored sha256-hashed.
// ─────────────────────────────────────────────────────────────────────
export const agentTokens = pgTable('AgentTokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique(), // sha256(raw token)
  name: text('name').notNull(), // "dispatcher-prod", "dispatcher-staging"
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }), // null = platform-wide
  createdBy: uuid('created_by').references(() => users.id),
  revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────────────
// PipelineJobs — one row per non-DONE ticket. Dispatcher's queue
// primitive. Concurrency via FOR UPDATE SKIP LOCKED (plan §4.3).
// ─────────────────────────────────────────────────────────────────────
export const pipelineJobs = pgTable(
  'PipelineJobs',
  {
    ticketId: uuid('ticket_id')
      .primaryKey()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    state: pipelineStateEnum('state').default('BACKLOG').notNull(),
    priority: integer('priority').default(0).notNull(),
    attempts: integer('attempts').default(0).notNull(),
    leaseOwnerId: text('lease_owner_id'), // dispatcher pod id (future HA)
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true, mode: 'date' }),
    agentIssueId: text('agent_issue_id'), // stable id used in Linear-shape webhook's data.id
    agentBackend: text('agent_backend'), // snapshot of projects.agent_backend at dispatch time
    githubPrNumber: integer('github_pr_number'),
    githubPrSha: text('github_pr_sha'),
    needsPmAttention: boolean('needs_pm_attention').default(false).notNull(), // set true on AGENT_WAITING, cleared on PM reply or state exit
    traceId: text('trace_id'), // uuid v4, propagated across services for observability
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  () => ({
    // Dispatcher's lease query.
    stateLeaseIdx: index('idx_pipeline_jobs_state_lease').using(
      'btree',
      sql`state, lease_expires_at, priority DESC, created_at`,
    ),
    // UI "needs PM attention" badge query. Partial index with a boolean
    // literal — drizzle-kit emits $1 placeholders for `eq()` here (open bug
    // #4790, memory drizzle-partial-index-enum-dollar1); raw `= true` keeps
    // it a literal in the generated SQL.
    needsPmAttentionIdx: index('idx_pipeline_jobs_needs_pm_attention')
      .using('btree', sql`needs_pm_attention`)
      .where(sql`needs_pm_attention = true`),
  }),
);

// ─────────────────────────────────────────────────────────────────────
// PipelineEvents — append-only event log per ticket. Drives the
// pipeline timeline in the PM UI.
// ─────────────────────────────────────────────────────────────────────
export const pipelineEvents = pgTable(
  'PipelineEvents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
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
  },
  () => ({
    // UI timeline query.
    ticketCreatedIdx: index('idx_pipeline_events_ticket_created').using(
      'btree',
      sql`ticket_id, created_at`,
    ),
  }),
);

// ─────────────────────────────────────────────────────────────────────
// AgentMessages — PM ↔ agent chat thread on a ticket (slykboard-origin
// only; Linear-origin tickets keep their Linear threads).
// Structural template: Comments table (core.ts).
// ─────────────────────────────────────────────────────────────────────
export const agentMessages = pgTable(
  'AgentMessages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    authorRole: messageAuthorRoleEnum('author_role').notNull(),
    authorUserId: uuid('author_user_id').references(() => users.id), // null when AGENT or SYSTEM
    body: text('body').notNull(), // markdown, ≤4000 chars
    agentSessionId: text('agent_session_id'), // for routing PM replies
    // Required when authorRole=AGENT (dispatcher forwards with key for dedup).
    // Null for PM (slykboard-generated) + SYSTEM. Unique where non-null.
    idempotencyKey: text('idempotency_key'),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  () => ({
    // UI chat thread query.
    ticketCreatedIdx: index('idx_agent_messages_ticket_created').using(
      'btree',
      sql`ticket_id, created_at`,
    ),
    // Inbound dedup lookup (dispatcher retry safety). IS NULL keeps the
    // predicate literal-safe (no $1 placeholder — see pipelineJobs note).
    idempotencyIdx: uniqueIndex('idx_agent_messages_idempotency')
      .using('btree', sql`idempotency_key`)
      .where(sql`idempotency_key IS NOT NULL`),
  }),
);

// ─────────────────────────────────────────────────────────────────────
// OnboardingEvents — append-only onboarding lifecycle log per project.
// Drives the onboarding timeline in the admin UI.
// ─────────────────────────────────────────────────────────────────────
export const onboardingEvents = pgTable(
  'OnboardingEvents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    fromState: onboardingStateEnum('from_state'),
    toState: onboardingStateEnum('to_state').notNull(),
    detail: jsonb('detail'), // {ctid, lanIp, repoUrl, proxyHostId, error, ...}
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  () => ({
    // UI timeline query.
    projectCreatedIdx: index('idx_onboarding_events_project_created').using(
      'btree',
      sql`project_id, created_at`,
    ),
  }),
);

// ─────────────────────────────────────────────────────────────────────
// NotificationPreferences — per-user, per-project email opt-ins.
// Composite PK = one row per (user, project). Default row created lazily
// on first interaction with all three flags true.
// ─────────────────────────────────────────────────────────────────────
export const notificationPreferences = pgTable(
  'NotificationPreferences',
  {
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
  },
  // Composite PK handles uniqueness + lookup (no extra index needed).
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.projectId] }),
  }),
);

// ─────────────────────────────────────────────────────────────────────
// ProjectAgentMeta — 1:1 agent columns for a project. Separate table so
// core `Projects` is never ALTERed and plain-mode queries never see
// agent columns (04-schema.md "Why a separate 1:1 table").
// ─────────────────────────────────────────────────────────────────────
export const projectAgentColumns = {
  // ── Onboarding form fields ──
  slug: text('slug').notNull().unique(), // URL-safe, also teamKey seed
  subdomain: text('subdomain').notNull(), // <sub>.kmlab.dev
  sourceMode: text('source_mode').notNull().default('new'), // 'new' | 'existing'
  githubRepo: text('github_repo'), // SSH URL strongly preferred; HTTPS accepted. Null until WIRING_GITHUB in 'new' mode.
  githubRepoCreated: boolean('github_repo_created').default(false).notNull(),
  stack: text('stack').notNull(), // 'node-express' | 'next' | 'python-fastapi' | 'go' | 'static'
  teamKey: text('team_key').notNull(), // UPPER(slug), Cyrus routing key
  agentBackend: text('agent_backend'), // null = global default; per-project override
  initialAgentContext: text('initial_agent_context'), // becomes AGENTS.md seed

  // ── Provisioning outputs (filled by dispatcher via internal API) ──
  lxcCtid: integer('lxc_ctid'),
  lanIp: text('lan_ip'),
  systemdService: text('systemd_service'),
  zoraxyProxyId: text('zoraxy_proxy_id'),

  // ── Onboarding lifecycle ──
  onboardingState: onboardingStateEnum('onboarding_state').default('PENDING').notNull(),
  onboardingError: text('onboarding_error'),
  onboardedAt: timestamp('onboarded_at', { withTimezone: true, mode: 'date' }),
};

export const projectAgentMeta = pgTable('ProjectAgentMeta', {
  projectId: uuid('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  ...projectAgentColumns,
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
