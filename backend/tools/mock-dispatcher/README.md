# Mock Dispatcher

Standalone HTTP server pretending to be the dispatcher — contract-test
harness for slykboard's agent mode per
[`docs/agentic-automation/10-mock-dispatcher.md`](../../../docs/agentic-automation/10-mock-dispatcher.md).
**Not part of the runtime backend bundle** (`backend/tsconfig.json` keeps
`tools/` out of `dist/`).

Current scope: **SLYK-0360 Phase 2** — HMAC round-trip, `202` stubs, the
**scenario engine** (SLYK-0220: `--scenario=<name>` replays scripted
onboarding/decommission callbacks), **ticket-event handling** (SLYK-0300:
a signed `ticket_created`/`queue_for_agent` webhook streams scripted
`state_update.*` callbacks to `/api/v1/internal/jobs/:ticketId/state`), and
**agent message emission + pm_reply** (SLYK-0360: message steps stream to
`/api/v1/internal/jobs/:ticketId/messages`; the agent-waiting scenario
pauses at `AGENT_WAITING` + a question and resumes when slykboard delivers
the PM's `pm_reply` webhook). Latency/rate-limit profiles arrive with
Phase 5.

## Run

```bash
# Terminal 1: start mock dispatcher (port 4001 by default)
cd backend
npm run mock:dispatcher

# With a port override:
npm run mock:dispatcher -- --port=4002
```

`tools/mock-dispatcher/.token` is generated on first run via
`crypto.randomBytes(32).toString('hex')` and reused thereafter. Both
processes must use the same value (mock reads its own file; slykboard
reads the env var).

```bash
# Terminal 2: start slykboard backend in agent mode pointing at mock
cd backend
SLYKBOARD_AGENT_MODE=true \
SLYKBOARD_DISPATCHER_URL=http://localhost:4001 \
SLYKBOARD_DISPATCHER_TOKEN=$(cat tools/mock-dispatcher/.token) \
npm run dev

# Terminal 3: drive UI / curl, watch mock log (state.json)
```

## Scenarios (SLYK-0220 / SLYK-0300)

`--scenario=<name>` loads `scenarios/<name>.json` and replays its scripted
callback stream when slykboard calls `/onboard`, `/decommission`, or
`/webhooks/ticket-events`. One process runs one scenario; unset → `202`
stubs only (skeleton behavior). `--slykboard-url=<url>` sets the base URL
for outbound callbacks (default `http://localhost:3000`).

### happy-path — onboard to LIVE

```bash
cd backend
npm run mock:dispatcher -- --scenario=happy-path
```

Then create a project (platform admin): the mock acks `POST /onboard`
with `202 {orchestratorId}` and immediately streams six signed
`onboarding_event` callbacks to
`POST /api/v1/internal/projects/:slug/onboarding/events` at ~1s intervals:

`PENDING → PROVISIONING_LXC → WIRING_GITHUB → WIRING_AGENT → WIRING_ZORAXY → SMOKE_TEST → LIVE`

Slykboard's meta reaches `LIVE` with `onboardedAt` set.

**Phase 1 (SLYK-0300):** the scenario's `ticketCreatedStateSequence` is live.
Create a ticket in an agent-mode project → slykboard auto-queues it (BACKLOG
job row + signed `ticket_created` webhook) → the mock acks `202` and streams
six signed `state_update` callbacks to
`POST /api/v1/internal/jobs/:ticketId/state`:

`BACKLOG → QUEUED → AGENT_RUNNING → PR_OPEN → CI_RUNNING → MERGING → DONE`

The job reaches `DONE` and the ticket auto-moves to the project's Done
column. (Note: `MERGING` goes straight to `DONE` — the 15×15 matrix in
05-backend-routes.md has no edge into `DEPLOYING`, so the doc-10 example's
`MERGING → DEPLOYING → DONE` hop is not replayable as written.)

### agent-waiting — mid-task question + PM reply + resume (full chat)

```bash
npm run mock:dispatcher -- --scenario=agent-waiting
```

Create a ticket → the mock streams to the pause point and asks:

`QUEUED → AGENT_RUNNING → AGENT_WAITING` + an **AGENT question message**
("should the CSV importer validate headers before inserting rows?") posted
to `/api/v1/internal/jobs/:ticketId/messages`.

`AGENT_WAITING` sets `needsPmAttention` (UI badge + SLYK-0350 creator email).
The stream now WAITS — the resume tail only fires when the PM replies via
`POST /api/v1/me/tickets/:id/messages` (slykboard delivers the signed
`pm_reply` webhook). Then:

`AGENT` ack message ("Got it — validating headers before insert. Resuming
work.") → `AGENT_RUNNING → PR_OPEN → CI_RUNNING → MERGING → DONE`

The PM reply clears `needsPmAttention`; the AGENT_WAITING exit clears it
again on the state path. A duplicate `pm_reply` webhook (same
`idempotencyKey` — slykboard's delivery queue retries) is acked `202` and
NOT re-streamed: inbound dedup is the dispatcher's job
(07-dispatcher-contract.md § Retry semantics).

### failed-ci-retry — one CI failure, then success

```bash
npm run mock:dispatcher -- --scenario=failed-ci-retry
```

`QUEUED → AGENT_RUNNING → PR_OPEN → CI_RUNNING → FAILED_CI → QUEUED → AGENT_RUNNING → PR_OPEN → CI_RUNNING → MERGING → DONE`

The `FAILED_CI → QUEUED` requeue bumps `PipelineJobs.attempts` 0 → 1 (visible
in the ticket's Pipeline tab); the second attempt merges and deploys.

### blocked-human — retry cap escalation

```bash
npm run mock:dispatcher -- --scenario=blocked-human
```

Three full attempts, each ending `FAILED_CI`:

- attempt 1: `… CI_RUNNING → FAILED_CI → QUEUED` (attempts 1)
- attempt 2: `… CI_RUNNING → FAILED_CI → QUEUED` (attempts 2)
- attempt 3: `… CI_RUNNING → FAILED_CI → BLOCKED_HUMAN`

The third failure is over the cap (3) so the only legal exit is
`BLOCKED_HUMAN` — terminal for auto-retry; the PM sees the red badge and
"Need human help".

### decommission — teardown to DECOMMISSIONED

```bash
cd backend
npm run mock:dispatcher -- --scenario=decommission
```

Trigger `POST /api/v1/admin/projects/:slug/decommission` (correct
`confirmSlug`): the mock acks `202`, then streams
`DECOMMISSIONING → DECOMMISSIONED` so meta reaches the terminal state.

### Failure injection (stub — exercised by SLYK-0410/0450)

```bash
# Arm: every /onboard call fails 500 until cleared — slykboard retries
# with backoff, then marks onboarding FAILED
curl "http://localhost:4001/admin/next-status?path=/onboard&status=500"

# Disarm
curl "http://localhost:4001/admin/next-status?path=/onboard&status=clear"
```

The override is **sticky until cleared** (not one-shot) so all of
slykboard's retry attempts fail — a one-shot would let retry #1 succeed
and never exercise the FAILED path. The signature gate still runs first
(an unsigned armed call gets `401`, not the injected status).

## Endpoints

Inbound (slykboard → mock, signed with `X-Slykboard-Signature`):

| Method + path                        | Response                        |
| ------------------------------------ | ------------------------------- |
| `POST /onboard`                      | `202 {orchestratorId}` (+ streams onboarding events when a scenario is loaded) |
| `POST /decommission`                 | `202` (+ streams teardown events when a scenario is loaded) |
| `POST /webhooks/ticket-events`       | `202 {acceptedAt}` (+ `ticket_created` streams the scenario's state/message sequence; `queue_for_agent` follows with `AGENT_RUNNING`; `pm_reply` streams the scenario's `pmReplySequence` when scripted — deduped on the webhook's `idempotencyKey` — else logs only) |
| `POST /webhooks/pm-action/need-human-help` | `202`                     |
| `GET /admin/next-status`             | local control — see above       |

Invalid or missing `X-Slykboard-Signature` → `401`.

Outbound (mock → slykboard, signed with `X-Dispatcher-Signature`):

| Method + path | Purpose |
|---|---|
| `POST /api/v1/internal/projects/:slug/onboarding/events` | Stream onboarding lifecycle (Phase 0.5) |
| `POST /api/v1/internal/jobs/:ticketId/state` | Stream ticket pipeline states (Phase 1, SLYK-0300) |
| `POST /api/v1/internal/jobs/:ticketId/messages` | Stream agent chat messages — question on `AGENT_WAITING`, ack on `pm_reply` (Phase 2, SLYK-0360) |

Every received call (valid or rejected) is appended to `state.json` as one
JSON line: `{at, method, path, signatureValid, body, injectedStatus?}`.

## Signing a manual request

Signature = hex HMAC-SHA256 of the **raw** request bytes, keyed by the
token in `.token`:

```bash
cd backend
TOKEN=$(cat tools/mock-dispatcher/.token)
BODY='{"eventType":"ticket_created","ticketId":"t1"}'
SIG=$(node -e "const c=require('crypto');process.stdout.write(c.createHmac('sha256',process.argv[1]).update(process.argv[2]).digest('hex'))" "$TOKEN" "$BODY")

curl -s -X POST http://localhost:4001/webhooks/ticket-events \
  -H "Content-Type: application/json" \
  -H "X-Slykboard-Signature: $SIG" \
  -d "$BODY"
# → 202 {"acceptedAt":"..."}

# Tamper the body with the same signature → 401
curl -s -X POST http://localhost:4001/webhooks/ticket-events \
  -H "Content-Type: application/json" \
  -H "X-Slykboard-Signature: $SIG" \
  -d '{"eventType":"ticket_created","ticketId":"EVIL"}'
# → 401 {"error":"Signature invalid"}
```

Outbound (mock → slykboard) callbacks use the same HMAC scheme via the
exported `sign()` helper in [`sign.ts`](./sign.ts) — slykboard's
`agentTokenAuth` middleware accepts them because the scheme is identical.

## Scenario file shape

```json
{
  "name": "happy-path",
  "onboardReply": { "status": 202, "body": { "orchestratorId": "mock-orch-001" } },
  "onboardingEvents": [
    { "delayMs": 1000, "toState": "PROVISIONING_LXC", "detail": { "ctid": 999 } },
    { "delayMs": 1000, "toState": "LIVE", "detail": { "deployedAt": "…" } }
  ],
  "decommissionEvents": [
    { "delayMs": 1000, "toState": "DECOMMISSIONING" },
    { "delayMs": 1000, "toState": "DECOMMISSIONED" }
  ],
  "ticketCreatedStateSequence": [
    { "delayMs": 500, "state": "QUEUED" },
    { "delayMs": 1500, "state": "AGENT_RUNNING", "detail": { "agentSessionId": "mock-cyrus-001" } }
  ],
  "pmReplySequence": [
    { "delayMs": 2000, "message": { "authorRole": "AGENT", "body": "Got it — resuming." } },
    { "delayMs": 1000, "state": "AGENT_RUNNING", "detail": { "resumedBy": "pm_reply" } }
  ]
}
```

The mock sleeps `delayMs` before each callback. For onboarding/decommission
steps `fromState` is derived (seed: `PENDING` for onboard,
`DECOMMISSIONING` for decommission, then the previous step's `toState`)
unless a step sets it explicitly. State steps POST only `{state, detail?}` —
slykboard derives `fromState` from the job row. Steps without `detail` fall
back to the matching `fixtures/onboarding_event.*.json` /
`fixtures/state_update.*.json` template. State values are validated against
the 15-value `PipelineState` enum at load; every edge must exist in the
15×15 matrix (05-backend-routes.md).

**Message steps** (SLYK-0360): a step keyed `message` instead of `state`
POSTs the `agentMessageBody` shape to `/api/v1/internal/jobs/:ticketId/messages`
— `{authorRole: "AGENT"|"SYSTEM", body, agentSessionId?, idempotencyKey}` —
with a fresh uuid `idempotencyKey` minted per emission. Fields the step
omits fall back to `fixtures/message.agent.json` / `message.system.json`
(`authorRole` defaults `AGENT`). In the `pmReplySequence`, ack messages with
no explicit `agentSessionId` inherit the one the `pm_reply` webhook carried
(routing the reply back to the session that asked). `pmReplySequence` is
optional — without it, `pm_reply` receipts are logged only (the pre-Phase-2
stub behavior, still used by scenarios that never pause).

## Layout

```
tools/mock-dispatcher/
  README.md       # this file
  index.ts        # the server itself (Express, single file)
  index.test.ts   # unit suite (supertest + transport double)
  sign.ts         # shared HMAC sign/verify helpers
  tsconfig.json   # referenced from backend/tsconfig.json (declarations only)
  scenarios/
    happy-path.json      # onboard → LIVE; ticket → DONE
    agent-waiting.json   # ticket pauses on a question, PM replies, DONE
    failed-ci-retry.json # one CI failure, requeue, DONE (attempts 1)
    blocked-human.json   # three failures over cap → BLOCKED_HUMAN
    decommission.json    # DECOMMISSIONING → DECOMMISSIONED
  fixtures/       # onboarding_event.* + state_update.* + message.* payload
                  # templates; pm_reply.request.json documents the inbound shape
  .token          # generated on first run (gitignored)
  state.json      # runtime: append-only log of received calls (gitignored)
```

E2E coverage: `backend/src/routes/internal.e2e.test.ts` boots the mock and
slykboard on paired random ports against the real test Postgres and asserts
all ticket scenarios propagate to their terminal states (happy-path +
failed-ci-retry → `DONE` with the kanban move; blocked-human →
`BLOCKED_HUMAN`), with zero `401`s on the mock's signed callbacks. The
SLYK-0360 suite drives the full agent-waiting chat round-trip: question
message → PM reply via `/api/v1/me/tickets/:id/messages` → ack + resume →
`DONE`, `needsPmAttention` cleared, and a duplicate message delivery (same
`idempotencyKey`) creating exactly ONE row.
