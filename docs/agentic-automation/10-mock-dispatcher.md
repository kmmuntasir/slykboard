# 10 — Mock Dispatcher Contract

> **Required for testing every phase.** Phases 0.5, 1, 2, 5 all claim
> "ships with a mock dispatcher" — this doc defines what that means so
> every test runs against the same contract.

## What the mock is

A standalone Node script that pretends to be the dispatcher. Listens
on a configurable port, accepts the four outbound endpoints slykboard
calls (`/onboard`, `/decommission`, `/webhooks/ticket-events`,
`/webhooks/pm-action/need-human-help`), verifies HMAC signatures with
the same shared token, and emits the inbound callbacks slykboard
expects (`POST /api/v1/internal/*`).

Lives at `backend/tools/mock-dispatcher/` — **not** part of the
runtime backend bundle. Started on demand via `npm run mock:dispatcher`
from `backend/`.

## Why a real mock, not a unit-test stub

Phase 0.5 through Phase 2 each ship without a real dispatcher. But
the contract slykboard implements (HMAC sign outbound, verify inbound,
retry on 5xx, idempotency keys) is non-trivial. A real HTTP mock
exercises the entire stack — `dispatcherClient.ts`, `agentTokenAuth`
middleware, SSE emitter, raw-body capture. Unit-test stubs miss
serialization bugs that only surface when the bytes hit the wire.

## Layout

```
backend/tools/mock-dispatcher/
  README.md                     # how to run, common scenarios
  index.ts                      # the server itself (Express, single file)
  scenarios/                    # canned behavior scripts
    happy-path.json             # full lifecycle: onboard → ticket → PR → merge → deploy
    agent-waiting.json          # mid-task question, PM replies, agent resumes
    failed-ci-retry.json        # CI fails twice, succeeds third attempt
    blocked-human.json          # escalates after retry cap
    decommission.json           # full teardown sequence
  fixtures/                     # payload templates (HMAC-signed at runtime)
    ticket_created.request.json
    pm_reply.request.json
    state_update.agent_running.json
    state_update.agent_waiting.json
    state_update.pr_open.json
    state_update.ci_running.json
    state_update.merging.json
    state_update.done.json
    state_update.failed_ci.json
    state_update.blocked_human.json
    message.agent.json
    message.system.json
    onboarding_event.provisioning_lxc.json
    onboarding_event.wiring_github.json
    onboarding_event.wiring_agent.json
    onboarding_event.wiring_zoraxy.json
    onboarding_event.smoke_test.json
    onboarding_event.live.json
    onboarding_event.failed.json
  state.json                   # runtime: write-only log of received calls
```

## Running it

```bash
# Terminal 1: start mock dispatcher (port 4001 by default)
cd backend
npm run mock:dispatcher

# Terminal 2: start slykboard backend in agent mode pointing at mock
cd backend
SLYKBOARD_AGENT_MODE=true \
SLYKBOARD_DISPATCHER_URL=http://localhost:4001 \
SLYKBOARD_DISPATCHER_TOKEN=$(cat tools/mock-dispatcher/.token) \
npm run dev

# Terminal 3: drive UI / curl, watch mock log
```

`tools/mock-dispatcher/.token` is generated on first run via
`crypto.randomBytes(32).toString('hex')` and reused thereafter. Both
processes must use the same value (mock reads its own file; slykboard
reads the env var).

## `npm run mock:dispatcher` script

Add to `backend/package.json`:

```json
{
  "mock:dispatcher": "tsx tools/mock-dispatcher/index.ts",
  "mock:dispatcher:scenario": "tsx tools/mock-dispatcher/index.ts --scenario"
}
```

`--scenario=<name>` loads `scenarios/<name>.json` and replays the
scripted state sequence in response to slykboard's outbound calls.

## Endpoints mock must implement

Inbound (slykboard → mock, signed with `X-Slykboard-Signature`):

| Method + path | Behavior |
|---|---|
| `POST /onboard` | Verify sig, save orchestratorId, return `202 {orchestratorId}`. If `--scenario` set, immediately start streaming `onboarding_event.*` callbacks to slykboard at 1s intervals. |
| `POST /decommission` | Verify sig, return `202`. Stream `DECOMMISSIONING` → `DECOMMISSIONED` events. |
| `POST /webhooks/ticket-events` | Verify sig. Look at `eventType`: `ticket_created` → start streaming `state_update.*` callbacks; `pm_reply` → log, optionally emit `state_update.agent_running` after 2s; `queue_for_agent` → emit `state_update.queued` then `agent_running`. Return `202 {acceptedAt}`. |
| `POST /webhooks/pm-action/need-human-help` | Verify sig, log, return `202`. |

Outbound (mock → slykboard, signed with `X-Dispatcher-Signature`):

| Method + path | Purpose |
|---|---|
| `POST /api/v1/internal/jobs/:ticketId/state` | Emit state transitions per scenario. |
| `POST /api/v1/internal/jobs/:ticketId/messages` | Emit agent chat messages. |
| `POST /api/v1/internal/projects/:slug/onboarding/events` | Stream onboarding lifecycle. |
| `GET /api/v1/internal/projects/:slug/deploy-target` | Return canned deploy config. |

Mock must use the same HMAC scheme (`createHmac('sha256', token).update(rawBody).digest('hex')`)
so slykboard's `agentTokenAuth` middleware accepts its callbacks.

## Scenario file shape

```json
{
  "name": "happy-path",
  "description": "Onboard → create ticket → full pipeline → DONE",
  "onboardReply": { "status": 202, "body": { "orchestratorId": "mock-orch-001" } },
  "onboardingEvents": [
    { "delayMs": 1000, "toState": "PROVISIONING_LXC", "detail": { "ctid": 999, "lanIp": "192.168.31.999" } },
    { "delayMs": 1000, "toState": "WIRING_GITHUB" },
    { "delayMs": 1000, "toState": "WIRING_AGENT" },
    { "delayMs": 1000, "toState": "WIRING_ZORAXY" },
    { "delayMs": 1000, "toState": "SMOKE_TEST" },
    { "delayMs": 1000, "toState": "LIVE", "detail": { "deployedAt": "2026-08-13T12:00:00Z" } }
  ],
  "ticketCreatedStateSequence": [
    { "delayMs": 500,  "state": "QUEUED" },
    { "delayMs": 1500, "state": "AGENT_RUNNING", "detail": { "agentSessionId": "mock-cyrus-001" } },
    { "delayMs": 2000, "state": "PR_OPEN",         "detail": { "prNumber": 137, "sha": "abc1234" } },
    { "delayMs": 1500, "state": "CI_RUNNING" },
    { "delayMs": 3000, "state": "MERGING",         "detail": { "checksPassed": ["lint","test","build"], "checksFailed": [], "coverageDelta": {"files":2,"lines":24}, "diffSize": {"filesChanged":3,"insertions":120,"deletions":15}, "touchedSensitivePaths": {"infra":false,"migrations":false,"deployConfig":false} } },
    { "delayMs": 800,  "state": "DEPLOYING" },
    { "delayMs": 1500, "state": "DONE",            "detail": { "deployedAt": "2026-08-13T12:30:00Z" } }
  ]
}
```

Each scenario file tells the mock what to do when slykboard emits each
outbound event type. Mock replays the sequence, sleeping `delayMs`
between callbacks.

## HMAC verification helper

Mock verifies inbound signatures from slykboard:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifySig(req, token): boolean {
  const sig = req.header('X-Slykboard-Signature');
  if (!sig) return false;
  const expected = createHmac('sha256', token).update(req.rawBody).digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Raw body capture needed too — same Express `express.json({verify: ...})`
pattern slykboard uses.

## Test integration

Vitest tests in `backend/src/services/dispatcherClient.test.ts` use
`supertest` to hit the mock directly (no port binding) — verifies
slykboard's outbound signing + retry logic.

End-to-end agent-mode tests in `backend/src/routes/internal.routes.test.ts`
bring up the mock on a random port, point slykboard at it via env, drive
HTTP against slykboard, and assert state changes propagate.

## Failure injection

Mock supports `?status=500` query param on outbound slykboard endpoints
to test retry logic:

```bash
# Tell mock to return 500 on next onboard call
curl http://localhost:4001/admin/next-status?path=/onboard&status=500

# Slykboard should retry 3x with backoff, then mark onboarding FAILED
```

This drives the failure-mode smoke tests in `09-implementation-phases.md`
Phase 0.5 + 1.

## What the mock does NOT do

- Talk to Cyrus (no Linear-shape webhook emission).
- Talk to GitHub (no PR creation).
- Talk to Proxmox / Zoraxy / LXC (no real onboarding).
- Persist state across restarts (`state.json` is log-only).
- Run multiple scenarios simultaneously (one process, one scenario).

It's a contract-test harness, not a development environment. For
real dispatcher behavior, run the actual dispatcher (separate repo).

## Implementation order

Phase 0.5 starts: build mock with `/onboard` + onboarding event stream
+ `/decommission`. Covers the onboarding MVP smoke tests.

Phase 1 extends: add `/webhooks/ticket-events` + state_update stream +
`/api/v1/internal/jobs/:ticketId/state` emission. Covers pipeline state
smoke tests.

Phase 2 extends further: add pm_reply handling + agent message emission
+ `/api/v1/internal/jobs/:ticketId/messages`. Covers chat smoke tests.

Phase 5 extends: rate-limit simulation, 500 injection, latency profiles.
Covers observability + retry smoke tests.
