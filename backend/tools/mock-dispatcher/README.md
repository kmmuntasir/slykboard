# Mock Dispatcher (skeleton)

Standalone HTTP server pretending to be the dispatcher — contract-test
harness for slykboard's agent mode per
[`docs/agentic-automation/10-mock-dispatcher.md`](../../../docs/agentic-automation/10-mock-dispatcher.md).
**Not part of the runtime backend bundle** (`backend/tsconfig.json` keeps
`tools/` out of `dist/`).

Current scope: **SLYK-0170 Phase 0 skeleton** — HMAC round-trip + `202`
stubs. Scenario replay, outbound callbacks, and failure injection arrive
with SLYK-0220/0300/0360.

## Run

```bash
# Terminal 1: start mock dispatcher (port 4001 by default)
cd backend
npm run mock:dispatcher

# With a port override:
npm run mock:dispatcher -- --port=4002

# Terminal 2: start slykboard backend in agent mode pointing at mock
cd backend
SLYKBOARD_AGENT_MODE=true \
SLYKBOARD_DISPATCHER_URL=http://localhost:4001 \
SLYKBOARD_DISPATCHER_TOKEN=$(cat tools/mock-dispatcher/.token) \
npm run dev

# Terminal 3: drive UI / curl, watch mock log (state.json)
```

`tools/mock-dispatcher/.token` is generated on first run via
`crypto.randomBytes(32).toString('hex')` and reused thereafter. Both
processes must use the same value (mock reads its own file; slykboard
reads the env var).

## Endpoints (skeleton — all verify HMAC, log to `state.json`, return `202`)

| Method + path                        | Response                        |
| ------------------------------------ | ------------------------------- |
| `POST /onboard`                      | `202 {orchestratorId}`          |
| `POST /decommission`                 | `202`                           |
| `POST /webhooks/ticket-events`       | `202 {acceptedAt}`              |
| `POST /webhooks/pm-action/need-human-help` | `202`                     |

Invalid or missing `X-Slykboard-Signature` → `401`.

Every received call (valid or rejected) is appended to `state.json` as one
JSON line: `{at, method, path, signatureValid, body}`.

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

Outbound (mock → slykboard) callbacks will use the same HMAC scheme via
the exported `sign()` helper in [`sign.ts`](./sign.ts) — slykboard's
`agentTokenAuth` middleware accepts them because the scheme is identical.

## Scenarios (stub — SLYK-0220+)

`npm run mock:dispatcher:scenario -- --scenario=happy-path` currently
errors with "no scenarios registered yet". Scenario files
(`scenarios/*.json`) and payload templates (`fixtures/*.json`) arrive with
Phase 0.5/1/2/5.

## Layout

```
tools/mock-dispatcher/
  README.md       # this file
  index.ts        # the server itself (Express, single file)
  sign.ts         # shared HMAC sign/verify helpers
  scenarios/      # canned behavior scripts (SLYK-0220+)
  fixtures/       # payload templates (SLYK-0220+)
  .token          # generated on first run (gitignored)
  state.json      # runtime: append-only log of received calls (gitignored)
```
