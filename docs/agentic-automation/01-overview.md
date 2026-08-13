# 01 — System Overview

## Components in the pipeline

```
                        ┌─────────────────────────────────────────┐
   PM (browser) ──────▶ │  slykboard.kmlab.dev                    │
                        │  (this repo, agent mode)                │
                        │  • kanban (always)                      │
                        │  • onboarding form (agent mode)         │
                        │  • pipeline status UI (agent mode)      │
                        │  • PM↔agent chat (agent mode)           │
                        │  • internal API for dispatcher          │
                        └───────────────┬─────────────────────────┘
                                        │ POST /api/v1/internal/webhooks/ticket-events
                                        │ (slykboard → dispatcher when PM creates ticket)
                                        ▼
                        ┌─────────────────────────────────────────┐
                        │  dispatcher.kmlab.dev (separate repo)   │
                        │  • task queue (Postgres FOR UPDATE SKIP LOCKED)
                        │  • mergebot (gh pr merge --rebase)       │
                        │  • AI rebase trigger (delegates to agent)│
                        │  • onboarding orchestrator              │
                        │  • Linear-shape webhook emitter         │
                        │  • agent abstraction (§3.7 of plan)      │
                        └───┬─────────────────┬─────────────┬─────┘
                            │                 │             │
            task dispatch      PR webhook     POST state
            (HMAC-signed,      from GitHub    writeback to
            Linear-shape)                     slykboard
                            │                 │             │
                            ▼                 │             │
                ┌────────────────────┐        │             │
                │  Cyrus LXC         │        │             │
                │  (default agent,   │        │             │
                │   stock binary)    │        │             │
                │  • /linear-webhook │        │             │
                │  • worktree /task  │        │             │
                │  • Claude session  │        │             │
                │  • opens PR via gh │        │             │
                │  • AI rebase       │        │             │
                └─────────┬──────────┘        │             │
                          │ PR opened         │             │
                          ▼                   │             │
                ┌─────────────────────────────┘             │
                │                                            │
                ▼                                            │
   ┌────────────────────────────────────────┐               │
   │  GitHub Actions (cloud)                │               │
   │  • CI: lint/test/build (in cloud)      │               │
   │  • Deploy: SSH via jumphost → LXC      │               │
   └─────────────┬──────────────────────────┘               │
                 │ deploy status                            │
                 ▼                                          │
            dispatcher → POST /api/v1/internal/jobs/:id/state
                                        │
                                        ▼
                                   slykboard (this repo)
                                   PM sees column move
```

## Slykboard's role, concretely

Slykboard is **state + UI**. It does not:

- Talk to Cyrus.
- Talk to GitHub directly (except for the existing OAuth login flow).
- Run any queue loop or schedule any agent work.
- Hold any agent credential beyond the dispatcher HMAC token.
- Spawn any process, worktree, or LXC.

Slykboard **does**:

- Render the PM-facing UI (kanban + pipeline panel + chat + onboarding).
- Persist pipeline state written by the dispatcher (status transitions,
  events timeline, agent messages).
- Emit a self-webhook to the dispatcher when a PM-created ticket should
  enter the pipeline.
- Receive dispatcher webhooks for state updates.
- Receive PM↔agent chat messages from the dispatcher and persist them.
- Send PM-authored chat messages to the dispatcher for forwarding to
  the agent.
- Expose admin-only project onboarding + decommission endpoints that
  trigger the dispatcher.

## Data flow — single ticket lifecycle

1. **PM creates ticket in slykboard** (existing kanban form, unchanged).
2. **Slykboard backend** (agent mode) — on ticket creation, insert a row
   into `PipelineJobs` with `state = 'BACKLOG'`. Fire-and-forget POST
   to dispatcher `/webhooks/ticket-events` with the ticket payload +
   HMAC signature.
3. **Dispatcher** leases the job, calls the agent backend
   (default: Cyrus) to dispatch the task. Updates slykboard via
   `POST /api/v1/internal/jobs/:ticketId/state` with the new state
   (`AGENT_RUNNING`).
4. **Cyrus** opens a PR. GitHub fires a PR webhook to the dispatcher.
   Dispatcher updates slykboard: `state = 'PR_OPEN'`.
5. CI runs (in GitHub Actions cloud). Dispatcher updates slykboard:
   `state = 'CI_RUNNING'` then `MERGING` or `FAILED_CI`.
6. Mergebot merges (or AI-rebases on conflict). Dispatcher updates:
   `DEPLOYING`.
7. GitHub Actions deploy job pushes to LXC. Smoke test passes →
   dispatcher updates: `DONE`. PM sees ticket auto-move to "Done"
   column.
8. If anything fails terminally → `BLOCKED_HUMAN`. PM sees red badge +
   "Need human help" button.

## Data flow — PM↔agent chat

For slykboard-origin tickets only (Linear-origin tickets keep their
Linear chat threads; not our concern).

1. **Agent emits a question mid-task.** Dispatcher polls agent
   `/status` (Cyrus impl), extracts the question, writes it to
   slykboard via `POST /api/v1/internal/jobs/:ticketId/messages` with
   `authorRole = 'AGENT'`. Also flips ticket to `AGENT_WAITING`.
2. **Slykboard persists the message**, renders it in the chat panel.
3. **PM replies** in the chat UI. Slykboard POSTs to dispatcher
   `/webhooks/ticket-events` with `eventType = 'pm_reply'` + the
   message body. Dispatcher forwards to the agent. Ticket flips back
   to `AGENT_RUNNING`.
4. Repeat until agent finishes or escalates.

## Data flow — project onboarding

1. **Admin PM clicks "Add project"** in slykboard UI. Fills the form
   (see `06-frontend-ui.md`).
2. **Slykboard** creates a `Projects` row with onboarding columns
   (`onboardingState = 'PENDING'`, `sourceMode`, etc.). POSTs to
   dispatcher `/onboard` with the full form payload + HMAC.
3. **Dispatcher** runs the orchestrator: LXC → GitHub → Agent repo-add
   → Zoraxy → smoke. After each step, dispatcher POSTs to slykboard
   `/api/v1/internal/projects/:slug/onboarding/events` with the state
   transition.
4. **Slykboard** renders the timeline in the UI.
5. On `LIVE`, slykboard unlocks the project for ticket creation.
6. Decommission is the reverse — admin clicks "Remove", confirms with
   the project slug, dispatcher tears down.

## What goes in this repo (slykboard)

- Drizzle schema additions (gated migration), see `04-schema.md`.
- Express routes under `/api/v1/internal/*` + `/api/v1/projects/:slug/onboard`,
  see `05-backend-routes.md`.
- React pages + components (feature-gated), see `06-frontend-ui.md`.
- Dispatcher client (HMAC-signed HTTP), see `07-dispatcher-contract.md`.
- Migration runner update for conditional schema.
- Tests for all of the above.

## What does NOT go in this repo

- Anything Cyrus-specific beyond reading Cyrus's expected payload
  shape for documentation.
- Anything that holds Anthropic keys, SSH keys, GitHub App keys,
  Zoraxy keys, Proxmox access.
- Any background worker / queue loop / cron.
- Any deploy workflow file (those live in target project repos, not
  slykboard).
- Any LXC creation, Zoraxy API client, GitHub App client.
