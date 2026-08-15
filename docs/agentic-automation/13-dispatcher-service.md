# 13 — Dispatcher Service (M1 + M4)

> Build book for `dispatcher/` — the orchestrating service of the pipeline.
> Companion docs: `07` (wire contract with slykboard — already implemented on
> the slykboard side, treat it as frozen), `14` (agent backends), `12` (master
> plan). Upstream reference: `homelab-setup/AUTOMATION-PLAN.md` §3.7, §4, §5.

## 1. Responsibilities

The dispatcher owns everything slykboard deliberately doesn't:

1. **Queue** — per-project FIFO with `FOR UPDATE SKIP LOCKED` leasing (§5).
2. **Agent dispatch** — translate slykboard tickets into Linear-shape signed
   webhooks for Cyrus via the `AgentBackend` interface (doc `14`).
3. **Status bridge** — poll Cyrus `/status`, write state + agent messages back
   to slykboard's internal API (never directly to slykboard's DB).
4. **Onboarding orchestrator** — LXC → GitHub → agent → Zoraxy → smoke (§7).
5. **Mergebot** — GitHub PR webhooks, auto-merge on green, AI rebase on
   conflict, retry budget, decision log (§8, lands in M4).
6. **Escalation fan-out** — Slack/email when tickets exhaust retry budgets.

## 2. Non-responsibilities

- No PM-facing UI (slykboard renders everything).
- No Anthropic key — the Cyrus LXC owns Claude spend; dispatcher only triggers
  sessions over SSH/HTTP.
- No writes to slykboard's Postgres tables except the lease columns (§5
  contract).
- No DNS management — Cloudflare wildcard already routes `*.kmlab.dev`; Zoraxy
  proxy creation is the only routing step.

## 3. Layout

```
dispatcher/
  src/
    index.ts                    # boot: env validate → express → lease loop → pollers
    config/env.ts               # zod schema, fail-fast (mirror backend/src/config/env.ts)
    config/logger.ts            # pino, same shape as backend
    db/client.ts                # pg Pool → slykboard's Postgres (schema from its migrations)
    routes/
      webhooks.ts               # POST /webhooks/ticket-events, /webhooks/pm-action/need-human-help
      onboarding.ts             # POST /onboard, POST /decommission
      github.ts                 # POST /webhooks/github        (M4)
      deploy.ts                 # POST /webhooks/deploy        (M5 — GitHub Actions reports here)
    services/
      queue.ts                  # lease loop (2s tick), per-project parallelism gate
      slykboardClient.ts        # signed state/message/onboarding-event writes (X-Dispatcher-Signature)
      agentChat.ts              # /status poller (2s) + pending-utterance extraction
      onboarding.ts             # ProjectOnboardingService state machine (§7)
      mergebot.ts               # (M4) green-check detection, gh pr merge --rebase, escalation
      githubAppClient.ts        # App JWT → installation token; repo create/protect/webhook
      zoraxyClient.ts           # proxy host CRUD
      proxmoxClient.ts          # SSH wrappers for gh-deploy-lxc / gh-deploy-snap
    agents/
      types.ts                  # AgentBackend interface (verbatim from upstream §3.7.2)
      index.ts                  # getAgent(project) — global default + per-project override
      cyrus/                    # (M2, doc 14)
  test/                         # vitest, co-located; mock-slykboard harness (§9)
  Dockerfile                    # node:24-slim, tsx runtime (same pattern as backend/)
  docker-compose.dispatcher.prod.yml
  README.md                     # deployment guide — separate service (doc 17 §1)
  .env.example
```

Conventions: identical to backend/ (npm only, layered route→service→repo,
rebase-merge, `SLYK-NNN:` commits, vitest co-located). Reuse patterns from
`11-existing-patterns.md` where they apply.

## 4. Environment

`.env.example` — validated by zod at boot; agent mode is implicit (dispatcher
is meaningless without its secrets; every var below is required except noted):

```bash
# ── slykboard contract ───────────────────────────────────────────────
SLYKBOARD_BASE_URL=https://slykboard.kmlab.dev   # internal API base
SLYKBOARD_DISPATCHER_TOKEN=<64-hex>              # same value slykboard has (both directions)
SLYKBOARD_SCHEMA_VERSION_REQUIRED=1              # boot gate: must equal slykboard /api/health schemaVersion

# ── Postgres (slykboard's DB — dispatcher connects for leasing only) ─
DATABASE_URL=postgres://dispatcher:<pw>@<host>:5432/slykboard

# ── Cyrus (default agent backend) ────────────────────────────────────
CYRUS_BASE_URL=http://<cyrus-lxc>:3000
LINEAR_WEBHOOK_SECRET=<copied from ~/.cyrus/.env — symmetric shared secret>
DISPATCHER_SSH_KEY=/run/secrets/cyrus_ssh_key    # mounted file, not env value
CYRUS_SSH_USER=cyrus-runner
AGENT_BACKEND=cyrus                               # global default; per-project override lives in DB

# ── GitHub App ──────────────────────────────────────────────────────
GITHUB_APP_ID=...
GITHUB_APP_PRIVATE_KEY_FILE=/run/secrets/gh_app_key
GITHUB_ORG=<org>
GITHUB_WEBHOOK_SECRET=<random>                    # verifies GitHub → dispatcher webhooks (M4)
DISPATCHER_PUBLIC_URL=https://dispatcher.kmlab.dev

# ── Infra ───────────────────────────────────────────────────────────
PROXMOX_HOST_LAN=192.168.31.200
PROXMOX_SSH_USER=gh-deploy
PROXMOX_SSH_KEY=/run/secrets/proxmox_ssh_key
ZORAXY_BASE_URL=https://zoraxy.kmlab.dev
ZORAXY_API_KEY=<key>

# ── Optional ────────────────────────────────────────────────────────
SLACK_ALERT_WEBHOOK=                              # escalation fan-out
```

**Secret-handling rule:** everything above with `_FILE` or `_KEY` is a mounted
file (Docker secrets / systemd `LoadCredential`), never an env value, never in
git. The deployment guide (doc `17`) lists the exact mounts.

Boot sequence: validate env → verify slykboard health
(`GET /api/health`, assert `agentMode === true` and `schemaVersion ===
SLYKBOARD_SCHEMA_VERSION_REQUIRED` — doc 07 § Versioning) → verify DB
connection + one lease probe → start HTTP + loops. Fail-fast on any mismatch.

## 5. Queue — lease loop and the two-writer contract

Tick every 2s (interval from `QUEUE_TICK_MS`, default 2000):

```sql
-- lease next ready job, atomically (upstream plan §4.3, adapted)
UPDATE "PipelineJobs"
   SET "state" = 'AGENT_RUNNING',
       "lease_owner_id" = $1,
       "lease_expires_at" = now() + interval '15 minutes'
 WHERE "ticket_id" = (
   SELECT "ticket_id" FROM "PipelineJobs"
    WHERE "state" = 'QUEUED'
      AND ("lease_expires_at" IS NULL OR "lease_expires_at" < now())
      AND "project_id" NOT IN (               -- serial-per-project (§5.1)
        SELECT "project_id" FROM "PipelineJobs"
         WHERE "state" IN ('AGENT_RUNNING','AGENT_WAITING','PR_OPEN','CI_RUNNING',
                           'MERGING','CONFLICT_RETRY','DEPLOYING')
      )
    ORDER BY "priority" DESC, "created_at"
    FOR UPDATE SKIP LOCKED
    LIMIT 1
 )
RETURNING *;
```

This SQL exists on the dispatcher side only. **Two-writer contract** (the
load-bearing rule; also listed in doc `12` §7 risks):

| Writer | May write |
|---|---|
| Dispatcher (direct SQL) | **only** `lease_owner_id`, `lease_expires_at` — never `state`, never events |
| Slykboard internal API | `state`, `PipelineEvents`, `AgentMessages`, kanban column, SSE, emails |

So the loop is: lease SQL → `POST /api/v1/internal/jobs/:ticketId/state` with
`{state: AGENT_RUNNING}` → `agent.dispatchTask(...)` (doc 14). If the state
write fails, the lease write rolls back conceptually (re-lease will retry);
never dispatch without the state write succeeding — the PM timeline and the
queue must never diverge.

### 5.1 Per-project serial default, parallelism opt-in

Default: one active ticket per project (the `NOT IN` subquery above). Opt-in
later via a `parallelism` column on `ProjectAgentMeta` (M6+; AI rebase becomes
mandatory when >1 — already delivered in M4).

### 5.2 Lease expiry / crash recovery

A dispatcher crash leaves jobs leased for ≤15 min; the tick's
`lease_expires_at < now()` clause re-leases them. On re-lease after crash,
re-emit AGENT_RUNNING via the state API (idempotent on slykboard's side only
if the transition matrix allows; if the ticket already advanced — e.g. Cyrus
opened the PR while the dispatcher was down — the reconciler on slykboard's
side already converged, and the lease loop's state write will 400 harmlessly;
log-and-skip 400s from the state API in the loop, they mean "stale view").

### 5.3 AGENT_WAITING pausing

`AGENT_WAITING` is in the active-states list — a paused ticket still blocks
its project's queue (correct: the agent holds a worktree). It unblocks when
the PM replies (chat bridge flips it back to AGENT_RUNNING, doc `14` §5) or
the 72h timeout (doc `14` §6) escalates to BLOCKED_HUMAN.

## 6. HTTP surface (dispatcher exposes)

All verified with the same HMAC scheme as slykboard (`X-Slykboard-Signature`
inbound; the mock already implements this — the real dispatcher matches it byte
for byte, since slykboard's tests pin the behavior):

| Endpoint | Purpose | Notes |
|---|---|---|
| `POST /webhooks/ticket-events` | ticket_created / pm_reply / queue_for_agent intake | Respond `202 {acceptedAt}`. Idempotent on `idempotencyKey` (dedupe set, 24h TTL). |
| `POST /onboard` | start onboarding orchestration | `202 {orchestratorId}`; validation errors `400`; slug collision `409`. |
| `POST /decommission` | start teardown | `202`. Idempotent per project. |
| `POST /webhooks/pm-action/need-human-help` | escalation from slykboard's button | `202`; fans out to Slack/alerts. |
| `GET /jobs/:ticketId/state` | reconciler fallback read | `{state, detail?, traceId?}` — exact shape slykboard's `pipelineReconciler` parses. `404` if unknown. |
| `GET /healthz` | liveness | aggregates agent backend `health()` + DB ping. |
| `GET /metrics` | Prometheus text | (M6, doc 18) |
| `POST /webhooks/github` | PR/check events | (M4) HMAC with `GITHUB_WEBHOOK_SECRET`. |
| `POST /webhooks/deploy` | GitHub Actions deploy status | (M5) — drives DEPLOYING→DONE/FAILED_DEPLOY. |

`ticket_created` handling: insert nothing (slykboard already inserted the
PipelineJobs row at BACKLOG — the payload is the notification). Record
`agentIssueId = ticket.id` mapping (dispatcher-owned table, §10) and return
202. The queue leases it when its project is free. `queue_for_agent` is the
PM's explicit nudge — same effect, state already QUEUED on slykboard's side.

`pm_reply` handling: forward to `agent.sendReply(...)` immediately (chat
bridge, doc `14` §5). Never queued.

## 7. Onboarding orchestrator (M3)

State machine — every transition = slykboard state API call
(`POST /api/v1/internal/projects/:slug/onboarding/events`) + local progress
record. Resumable: each step checks "did I already do this?" before acting
(upstream §3.6.5).

```
PENDING → PROVISIONING_LXC → WIRING_GITHUB → WIRING_AGENT → WIRING_ZORAXY → SMOKE_TEST → LIVE
   any step ──error──▶ FAILED (onboardingError set; slykboard UI offers retry-from-last-step)
   LIVE ──decommission──▶ DECOMMISSIONING → DECOMMISSIONED
```

| Step | Action | Idempotency check |
|---|---|---|
| PROVISIONING_LXC | SSH `gh-deploy-lxc create <slug> <cores> <ram> <disk>` → parse `<ctid> <ip>`; then `gh-deploy-lxc bootstrap <slug> <stack>` | `ProjectAgentMeta.lxcCtid` set? skip |
| WIRING_GITHUB Path A (`source_mode=new`) | GitHub App: create repo from `project-template` stack dir → fill `githubRepo` → push AGENTS.md + `.deploy-target.json` + workflow files (doc 15) → add repo webhook → branch protection | repo exists? adopt |
| WIRING_GITHUB Path B (`existing`) | validate URL (SSH/HTTPS github.com only) → verify App installed → webhook (skip if present) → open onboarding PR (never direct push) → **wait for merge** before WIRING_AGENT | PR merged? skip |
| WIRING_AGENT | `getAgent(project).registerRepo({repoUrl, teamKey, projectSlug})` — Cyrus impl SSHes `cyrus self-add-repo` (doc 14 §4) | `cyrus list-repos --json` contains URL? skip |
| WIRING_ZORAXY | `POST {root: "<subdomain>.kmlab.dev", ip: "<lan-ip>:<port>", tls: true}` → store proxy id | existing proxy with same root? adopt |
| SMOKE_TEST | poll `https://<subdomain>.kmlab.dev/api/health` 3s/90s → LIVE | already LIVE? skip |

Decommission runs the mirror in reverse: Zoraxy proxy delete → agent
deregister → LXC destroy (`gh-deploy-lxc destroy`) → repo delete **only if
`githubRepoCreated`** (slykboard sends the flag; it is the gate). Every step
idempotent; "already gone" = success.

Port defaults per stack: `node-express` 3000, `next` 3000, `python-fastapi`
8000, `go` 8080, `static` 8080 (caddy). Recorded in `.deploy-target.json`.

## 8. Mergebot (M4)

Entry: `POST /webhooks/github` (HMAC-verified with `GITHUB_WEBHOOK_SECRET`).

1. `pull_request.opened/synchronize` where head branch belongs to a known
   ticket (branch name `tickets/<agentIssueId>-*` — Cyrus's convention; match,
   don't parse PR bodies) → state `PR_OPEN` → CI starts → `CI_RUNNING`.
2. `check_suite.completed` / `check_run.completed` all-success on the head sha
   → query required checks via App API → **all green** → `MERGING`:
   - Populate the **decision log** in the MERGING state-write `detail`
     (`checksPassed`, `checksFailed`, `coverageDelta`, `diffSize`,
     `touchedSensitivePaths` — schema documented in `04-schema.md`; slykboard
     stores verbatim; this is the Phase-6.5 baseline).
   - `gh pr merge <n> --rebase --delete-branch` (App installation token).
   - Success → GitHub push event on `main` → deploy.yml runs (M5); state
     `DEPLOYING` written on deploy-start webhook.
   - Merge failure (non-FF / conflict) → `CONFLICT_RETRY` +
     `agent.rebaseConflicts(...)` (doc `14` §7). Resolved → push → CI re-runs →
     back to step 2. Give-up or 3rd failure → `FAILED_CONFLICT` →
     `BLOCKED_HUMAN` + `agent.markBlocked` + Slack alert with PR link.
3. CI failed → attempts < 3: re-dispatch to agent with failure context (the
   agent gets the CI log in the task description); attempts ≥ 3 →
   `FAILED_CI` → `BLOCKED_HUMAN`.
4. Migrations safety: if the PR touches `migrations/` (path list in the PR
   files API) → **never** auto-rebase conflicts there; escalate immediately
   (upstream §5.4). Code-owner protection on `infra/` + `migrations/` is set
   during onboarding (doc 15 §4).

Single-flight guard: one mergebot action per ticket at a time (in-process
lock keyed by ticketId; GitHub retries and racing check events are the norm).

## 9. Testing strategy

Same tiered approach as slykboard used:

1. **Unit** — queue SQL against a real Postgres (the backend test suite's
   docker-compose pattern), state-machine wiring, idempotency dedupe, env
   validation. Agent backend always a mock implementing `AgentBackend`.
2. **Contract harness (`test/slykboardHarness.ts`)** — spin the *real*
   slykboard backend (it's in the repo!) on a test port + test DB, point the
   dispatcher at it. This is the monorepo payoff: end-to-end contract tests
   without shipping a contract-fuzzer. Reuse `backend/tools/mock-dispatcher`'s
   *scenario fixtures* (they encode the full wire behavior — run them against
   the real dispatcher as golden tests).
3. **Cyrus mock (`test/mocks/cyrus.ts`)** — `/linear-webhook` that verifies
   Linear-Signature + `/status` that serves scripted utterances. Validates the
   emitter's signature scheme byte-for-byte before M2's spike touches the real
   Cyrus.

The existing mock dispatcher is **not** deleted: it stays the slykboard-side
dev tool (doc `10`), and its scenarios become the golden set both directions
must pass.

## 10. Dispatcher-owned storage

The dispatcher creates **one** schema of its own in the same Postgres
(`dispatcher` schema via `search_path` — upstream §4.1):

```
dispatch_mappings(ticket_id uuid PK, agent_issue_id text, project_slug text,
                  agent_session_id text, created_at, updated_at)
dispatch_log(id bigserial PK, kind text, payload jsonb, created_at)  -- audit
onboarding_progress(slug PK, step text, last_error text, resumed_count int, ...)
```

Lease columns live in slykboard's tables (§5); everything else the dispatcher
needs to remember lives in its own schema. `dispatch_log` is append-only
audit — never read on hot paths.

## 11. Milestone M1 scope check

M1 delivers §3 (layout), §4 (env), §5 (queue), §6 minus github/deploy routes,
§9 test tiers 1–3, §10 schema. Onboarding endpoints accept + `202` and
persist progress but return `FAILED: not-implemented` per-step until M3
(slykboard's UI already renders FAILED + retry correctly — free stubs).
Mergebot routes 404 until M4. **Drill:** real dispatcher passes every
mock-dispatcher scenario against real slykboard (doc `19` §2).
