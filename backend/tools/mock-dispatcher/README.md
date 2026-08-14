# Mock Dispatcher

Standalone HTTP server pretending to be the dispatcher — contract-test
harness for slykboard's agent mode per
[`docs/agentic-automation/10-mock-dispatcher.md`](../../../docs/agentic-automation/10-mock-dispatcher.md).
**Not part of the runtime backend bundle** (`backend/tsconfig.json` keeps
`tools/` out of `dist/`).

Current scope: **SLYK-0220 Phase 0.5** — HMAC round-trip, `202` stubs, and
the **scenario engine**: `--scenario=<name>` replays scripted
onboarding/decommission callbacks to slykboard's `/api/v1/internal` routes.
Ticket-event `state_update.*` streaming arrives with SLYK-0300 (Phase 1),
messages with SLYK-0360 (Phase 2), latency/rate-limit profiles with Phase 5.

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

## Scenarios (SLYK-0220)

`--scenario=<name>` loads `scenarios/<name>.json` and replays its scripted
callback stream when slykboard calls `/onboard` or `/decommission`. One
process runs one scenario; unset → `202` stubs only (skeleton behavior).
`--slykboard-url=<url>` sets the base URL for outbound callbacks
(default `http://localhost:3000`).

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

Slykboard's meta reaches `LIVE` with `onboardedAt` set. The scenario file
also carries the Phase-1 `ticketCreatedStateSequence` per doc 10 — the
mock ignores it until SLYK-0300 implements ticket-event emission.

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
| `POST /webhooks/ticket-events`       | `202 {acceptedAt}`              |
| `POST /webhooks/pm-action/need-human-help` | `202`                     |
| `GET /admin/next-status`             | local control — see above       |

Invalid or missing `X-Slykboard-Signature` → `401`.

Outbound (mock → slykboard, signed with `X-Dispatcher-Signature`):

| Method + path | Purpose |
|---|---|
| `POST /api/v1/internal/projects/:slug/onboarding/events` | Stream onboarding lifecycle (Phase 0.5) |
| `POST /api/v1/internal/jobs/:ticketId/state` | Phase 1 (SLYK-0300) |

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
  "ticketCreatedStateSequence": []
}
```

The mock sleeps `delayMs` before each callback. `fromState` is derived
(seed: `PENDING` for onboard, `DECOMMISSIONING` for decommission, then the
previous step's `toState`) unless a step sets it explicitly. Steps without
`detail` fall back to the matching `fixtures/onboarding_event.*.json`
template.

## Layout

```
tools/mock-dispatcher/
  README.md       # this file
  index.ts        # the server itself (Express, single file)
  sign.ts         # shared HMAC sign/verify helpers
  scenarios/
    happy-path.json   # onboard → LIVE (+ Phase-1 ticket sequence, unused until SLYK-0300)
    decommission.json # DECOMMISSIONING → DECOMMISSIONED
  fixtures/       # onboarding_event payload templates (detail fallback)
  .token          # generated on first run (gitignored)
  state.json      # runtime: append-only log of received calls (gitignored)
```
