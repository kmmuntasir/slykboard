# 09 — Implementation Phases

Build order. Each phase ships standalone value. Within slykboard,
phases align with the upstream plan's Phase 0 / 0.5 / 1 / 2 / 5
(dispatcher owns the others).

**Total estimate:** ~3 weekends of focused work inside this repo.
The dispatcher (separate repo) ships in parallel on its own schedule.

## Phase 0 — Foundations (1 weekend)

**Goal:** plain-mode contract preserved + agent schema in place +
`SLYKBOARD_AGENT_MODE` toggle wired end-to-end.

### Tasks

- [ ] Create `backend/src/db/schema/agent.ts` with all enums + tables
      from `04-schema.md`. Export only when agent mode.
- [ ] Update `backend/src/db/schema/index.ts` to conditionally
      re-export agent tables based on env.
- [ ] Split migrations into `backend/src/db/migrations/core/` (move
      existing) + `backend/src/db/migrations/agent/` (new).
- [ ] Update `backend/src/db/migrate.ts` to run agent migrations only
      when `SLYKBOARD_AGENT_MODE=true` (see `02-dual-mode.md`).
- [ ] Add `requireAgentMode` middleware at
      `backend/src/middleware/agentMode.ts`.
- [ ] Add `agentTokenAuth` middleware at
      `backend/src/middleware/agentToken.ts` (HMAC verify, raw body
      capture pattern from `03-security.md`).
- [ ] Add `runtimeConfig` endpoint integration — `/api/v1/me` returns
      `{agentMode: boolean, dispatcherUrl: string|null}`.
- [ ] Frontend: `useRuntimeConfig` Zustand store, populated from `/me`
      response. Default `{agentMode: false, dispatcherUrl: null}`.
- [ ] Add `/api/v1/internal/*` route mounting point with stub handlers
      returning `501` until Phase 1.
- [ ] Add `/api/v1/admin/*` route mounting point with stub handlers.

### Smoke tests

- `SLYKBOARD_AGENT_MODE=false` (or unset): `npm run db:migrate` then
  `\dt` in psql — only core tables. Server boots. `/api/v1/internal/*`
  returns `501`. Frontend renders no agent UI.
- `SLYKBOARD_AGENT_MODE=true`: migrate — agent tables created. Server
  boots. `/api/v1/internal/*` returns `401` without signature (routes
  exist but auth fails — expected). Frontend `useRuntimeConfig.agentMode`
  is `true`.

### Acceptance

Plain-mode self-host user can `docker compose up` without setting
`SLYKBOARD_AGENT_MODE` and gets a working kanban. Agent mode is
theoretically reachable but no functionality yet.

## Phase 0.5 — Onboarding MVP (1 weekend)

**Goal:** admin can submit the onboarding form; dispatcher (mock or
real) receives it; onboarding timeline renders.

### Tasks

- [ ] Implement `POST /api/v1/admin/projects` route with full Zod
      validation per `05-backend-routes.md`.
- [ ] Implement `POST /api/v1/admin/projects/:slug/decommission` with
      three-word destructive confirmation.
- [ ] Implement `POST /api/v1/internal/projects/:slug/onboarding/events`
      (dispatcher callback).
- [ ] Implement `GET /api/v1/internal/projects/:slug/deploy-target`.
- [ ] Implement `dispatcherClient` service (`backend/src/services/dispatcherClient.ts`)
      with HMAC signing + retry.
- [ ] Frontend: `<OnboardingForm>` with source mode toggle, SSH/HTTPS
      URL validation UI hints.
- [ ] Frontend: `<OnboardingTimeline>` polling project events.
- [ ] Frontend: `<DecommissionDialog>` with slug-match gate.
- [ ] Frontend: `/admin/onboarding`, `/admin/projects/:slug`,
      `/admin/projects` pages.
- [ ] Tests for all routes (HMAC verify, validation, state machine
      transitions) + components (toggle UX, dialog gate).

### Smoke tests

- Submit onboarding form with mock dispatcher returning `202`. Project
  row created with `onboardingState = 'PENDING'`. Timeline page polls.
- Submit with mock dispatcher streaming onboarding events; timeline
  updates live until `LIVE`.
- Submit decommission with wrong slug — `400`. With correct slug —
  `202`, state moves to `DECOMMISSIONING` then `DECOMMISSIONED`.
- Plain mode: hitting `/api/v1/admin/projects` returns `501`.

### Acceptance

Admin can drive a full onboarding → decommission cycle in the UI
(against a mock or real dispatcher). No pipeline functionality yet —
just project lifecycle.

## Phase 1 — Pipeline State + Internal API (1 weekend)

**Goal:** dispatcher can write pipeline state for tickets; PM sees
the Pipeline tab populate.

### Tasks

- [ ] Implement `POST /api/v1/internal/jobs/:ticketId/state` with
      state machine validation.
- [ ] Implement `GET /api/v1/me/tickets/:id/pipeline`.
- [ ] Implement `GET /api/v1/me/tickets/:id/events` SSE endpoint.
- [ ] Frontend: `<PipelinePanel>` rendering events timeline.
- [ ] Frontend: Pipeline tab on ticket detail page (agent mode only).
- [ ] Frontend: `<FailedPipelineBadge>` on kanban card + ticket
      header.
- [ ] Auto-queue on ticket creation: when a PM creates a ticket in
      agent mode, slykboard inserts `PipelineJobs` row with `state =
      BACKLOG` and fires `POST <dispatcher>/webhooks/ticket-events`.
- [ ] Add the `state → plain English` map at
      `frontend/src/constants/pipelineStates.ts`.
- [ ] SSE emitter wiring: dispatcher callback emits on per-ticket
      EventEmitter; SSE route subscribes.

### Smoke tests

- Mock dispatcher posts state transitions for a ticket; frontend
  Pipeline tab updates live via SSE.
- State transition validation: posting `DONE → MERGING` returns `400`.
- Creating a ticket in agent mode fires the outbound webhook.
- Plain mode: ticket creation does not insert a `PipelineJobs` row.

### Acceptance

PM creates ticket → sees "Task queued" appear automatically in the
Pipeline tab → state updates flow in as (mock or real) dispatcher
processes the work.

## Phase 2 — PM ↔ Agent Chat (3–4 days)

**Goal:** PM can chat with the agent mid-task.

### Tasks

- [ ] Implement `POST /api/v1/internal/jobs/:ticketId/messages`
      (dispatcher forwards agent utterance).
- [ ] Implement `GET /api/v1/me/tickets/:id/messages`.
- [ ] Implement `POST /api/v1/me/tickets/:id/messages` (PM reply —
      validates ticket state, forwards to dispatcher).
- [ ] Frontend: `<AgentChatPanel>` with markdown rendering
      (`react-markdown` + `rehype-sanitize`).
- [ ] Frontend: Chat tab on ticket detail page.
- [ ] Input box enable/disable based on `pipelineJobs.state`.
- [ ] SSE event: `message` (alongside `state`).
- [ ] Email notification on `AGENT_WAITING` (if PM opted in).

### Smoke tests

- Mock dispatcher posts an `AGENT` message → appears in chat panel
  live via SSE.
- PM replies → message persisted + posted to dispatcher. Ticket state
  was `AGENT_WAITING`, allowed. If state was `DONE`, reply rejected
  with `409`.
- Markdown renders safely (script tag in body is escaped).

### Acceptance

PM can have a back-and-forth conversation with the agent mid-task.
Notifications fire when agent asks a question.

## Phase 5 — Polish + Notifications + Admin Tools (3–4 days)

**Goal:** production-quality UX, observability hooks, admin tooling.

### Tasks

- [ ] `<AgentTokenGenerateDialog>` — generate + show-once flow.
- [ ] `/admin/tokens` page — list, revoke.
- [ ] `<NotificationPreferences>` per-project per-user (3 booleans).
- [ ] Email service integration (use whatever slykboard already uses).
- [ ] `<NeedHumanHelp>` button — POST to dispatcher escalation webhook
      (optional Slack webhook if env set).
- [ ] Rate limiting on `/api/v1/admin/projects` (1/10s/admin) +
      `/api/v1/me/tickets/:id/messages` (30/min/user).
- [ ] Structured logging (`pino`) on all dispatcher calls — direction,
      path, status, duration, traceId.
- [ ] OpenAPI spec generated from Zod schemas; served at
      `/api/v1/openapi.json` (admin-only).
- [ ] Project admin dashboard (`/admin/projects`) with filters by
      onboarding state, search.
- [ ] Frontend polling reconciliation: every 60s, for any
      non-terminal-state ticket, query dispatcher `GET /jobs/:id/state`
      as a fallback for missed webhooks.

### Smoke tests

- Generate token → shown once → on page refresh, not retrievable.
- Revoke token → subsequent dispatcher calls with that token fail.
- Rate limit: 11th onboarding request within 10s returns `429`.
- OpenAPI spec renders correctly.

### Acceptance

Admin tools complete. Observability hooks in place. System is
production-ready for the homelab.

## Phase 6+ — Stretch (optional, later)

Not in initial build:

- Per-project parallelism (currently serial-per-project).
- Slack SSO + DM notifications.
- Predictive cost dashboard (Anthropic spend per project — handled
  mostly by dispatcher, but slykboard renders).
- Auto-generated test coverage enforcement (branch protection rule).
- Multi-agent backend support beyond Cyrus (requires dispatcher work
  first; slykboard only needs the `agentBackend` dropdown, which is
  already in v1).
- Migration to Gitea (move GitHub out of the loop).

## Phase 6.5 — Production-readiness gate (post-research, before real users)

> Scoped only once research findings justify it. The current deployment
> is a research/dev sandbox — trusted single-operator PM input, test
> Linear account, single-host network. Several items below are
> *deliberately deferred* under those assumptions during the research
> phase; they become hard requirements before real users, real Linear
> workspace, or real production data touch this pipeline. Full
> rationale + revisit triggers:
> [`homelab-setup/RESEARCH-SCOPE-MEMO.md`](../../../homelab-setup/RESEARCH-SCOPE-MEMO.md).

**Slykboard-side work** (dispatcher has its own parallel list):

- [ ] **Store mergebot decision log on every `MERGING` event** —
      extend `POST /api/v1/internal/jobs/:ticketId/state` to accept
      the documented fields in `detail` (see `04-schema.md`). Add Zod
      validation for the mergebot shape when `toState === 'MERGING'`.
      Slykboard does not interpret the fields — just store + expose
      via `GET /api/v1/me/tickets/:id/pipeline`.
- [ ] **Expose mergebot decision log in admin UI** — on the ticket
      detail page, when an admin views a `MERGING`-or-later event in
      the Pipeline panel, render the decision log fields (checks
      passed/failed, coverage delta, diff size, sensitive-path flags).
      Members can see a redacted version (omit `checksFailed` detail
      beyond count). This is the baseline the future AI-reviewer layer
      gets validated against ("would the new reviewer have caught what
      shipped during the no-review era?").
- [ ] **Re-evaluate prompt-injection tolerance** — only relevant once
      ticket authorship extends beyond the current trusted PM set. If
      triggered, add: ticket description sanitization pass at
      `POST /api/v1/me/tickets` (strip control chars, cap length
      tighter, optionally scan for known injection patterns). Today
      slykboard forwards PM text verbatim to dispatcher; that contract
      must not change without this checklist item being addressed.
- [ ] **Re-key `LINEAR_WEBHOOK_SECRET`** — slykboard doesn't hold this
      secret, but slykboard's `teamKey` values map to Cyrus workspaces
      keyed off the same Linear secret. If the secret rotates on the
      Cyrus side, dispatcher coordinates — slykboard is unaffected,
      but verify by sending one test ticket through end-to-end.
- [ ] **Migration-bearing rollback drill** — slykboard owns the DB
      migrations (core + agent). Verify that a deploy that applies an
      agent migration, then fails smoke test, rolls back cleanly.
      Mechanism: dispatcher snapshot-rolls the LXC, but the Postgres
      migration is one-way. Drill: in dev, intentionally write a bad
      migration, run the deploy, watch it fail, prove the rollback
      path doesn't leave the DB in an inconsistent state. Document
      the recovery procedure before this is needed in prod.
- [ ] **Cost circuit-breaker surface** — dispatcher enforces the cap,
      but slykboard renders spend state. Add `ProjectAgentMeta.
      spendTodayCents` + `spendCapCents` (updated by dispatcher
      callback), show in admin dashboard, surface "paused — cap hit"
      badge on ticket cards when cap breached. (Most of the work is
      dispatcher-side; slykboard just displays state.)

**Cross-ref:** for the dispatcher-side Phase 6.5 items (AI code-review
agent, VAPT scanning agent, actual cap enforcement), see the
homelab-setup memo linked above.

## What ships when (cross-service summary)

| Phase | Slykboard ships | Dispatcher ships | Cyrus |
|---|---|---|---|
| 0 | Dual-mode schema, env gating, stub routes | — | — |
| 0.5 | Onboarding UI + decommission + internal callback endpoints | Onboarding orchestrator + LXC/GitHub/Zoraxy/Agent wiring | Unchanged |
| 1 | Pipeline state UI + SSE + outbound ticket webhook | Queue loop + Linear-shape emitter + state callbacks | Stock |
| 2 | Chat UI + message endpoints | Mergebot (populates `MERGING` decision log fields) + AI rebase + `/status` polling + Comment.create emitter | Stock |
| 5 | Polish + admin tools + observability | GitHub Actions deploy + rollback drill | Stock |
| 6.5 | Decision log admin UI + spend display + sanitization drill (conditional) | AI reviewer + VAPT scan + cost cap enforcement (conditional) | Unchanged |

Slykboard is not blocked by dispatcher work in any phase — each phase
can ship with a mock dispatcher. Real integration testing happens
when both services ship the same phase.

## Definition of done per phase

A phase is "done" when:

1. All tasks checked.
2. Smoke tests pass.
3. Plain-mode contract verified (if applicable).
4. Tests added (Vitest, co-located, ≥80% line coverage on business
   logic).
5. PR opened against `main`, reviewed, rebased + merged.
6. No regression in existing kanban functionality (run full existing
   test suite + manual smoke of board / ticket / comment flows).

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Conditional migration runner breaks existing installs | Test against a clone of the production DB before each release; ship Phase 0 with extra manual verification. |
| HMAC signing bug causes dispatcher↔slykboard auth failure | Integration test that signs + verifies round-trip; test against real dispatcher in staging. |
| SSE connection leak (PM opens many tabs) | Heartbeat every 15s; server closes idle connections after 5 min; client auto-reconnects. |
| PM chat input XSS via markdown | `rehype-sanitize` strips dangerous tags; CSP headers; manual test with adversarial input. |
| `traceId` propagation breaks observability | Integration test asserts traceId present in every cross-service call's logs. |
| Source-mode toggle confuses PMs | Default to "New from template" (most common path); inline help text on the toggle. |
| Decommission deletes wrong repo | Three-word destructive confirmation + idempotent teardown + audit log review before enabling in production. |
