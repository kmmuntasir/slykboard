# 07 — Dispatcher ↔ Slykboard Contract

Slykboard talks to exactly one external service in agent mode: the
**dispatcher**. Every other system (Cyrus, GitHub, Zoraxy, Proxmox,
Anthropic) is reached by the dispatcher, never by slykboard.

## Connection details

```bash
# slykboard .env (agent mode only)
SLYKBOARD_AGENT_MODE=true
SLYKBOARD_DISPATCHER_URL=https://dispatcher.kmlab.dev
SLYKBOARD_DISPATCHER_TOKEN=<64-hex-char shared secret>
```

The token is a symmetric HMAC secret — same value in slykboard env
and dispatcher env. Generate once with:

```bash
openssl rand -hex 32
```

Operator copies it into both env files at install time. Rotate by
generating a new value, updating both envs, restarting both services.

## Auth — both directions

### Slykboard → Dispatcher (outbound)

Every outbound request includes:

```
Content-Type: application/json
X-Slykboard-Signature: <hex HMAC-SHA256 of raw body>
```

Signing key: `SLYKBOARD_DISPATCHER_TOKEN`. Sign over the **exact raw
bytes** of the JSON body — do not re-serialize the object inside the
client (key ordering differences would break the signature).

```ts
// backend/src/services/dispatcherClient.ts
import { createHmac } from 'node:crypto';

const TOKEN = process.env.SLYKBOARD_DISPATCHER_TOKEN!;
const BASE = process.env.SLYKBOARD_DISPATCHER_URL!;

export async function postToDispatcher<T>(path: string, body: unknown): Promise<T> {
  const raw = JSON.stringify(body);
  const sig = createHmac('sha256', TOKEN).update(raw).digest('hex');

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Slykboard-Signature': sig,
    },
    body: raw,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '(no body)');
    throw new DispatcherError(path, res.status, detail);
  }

  return res.status === 204 ? (undefined as T) : await res.json() as T;
}

export class DispatcherError extends Error {
  constructor(public path: string, public status: number, public detail: string) {
    super(`Dispatcher ${path} ${status}: ${detail}`);
  }
}
```

### Dispatcher → Slykboard (inbound)

Every inbound request from dispatcher to `/api/v1/internal/*` includes:

```
Content-Type: application/json
X-Dispatcher-Signature: <hex HMAC-SHA256 of raw body>
```

Verified by `agentTokenAuth` middleware (see `03-security.md` and
`05-backend-routes.md`). Same signing key, same scheme.

**Important:** capture the raw body **before** JSON parsing. Express
config:

```ts
app.use('/api/v1/internal',
  express.json({
    verify: (req: Request, _res, buf: Buffer) => {
      (req as any).rawBody = buf;
    },
    type: 'application/json',
  }),
  requireAgentMode,
  agentTokenAuth,
  internalRoutes,
);
```

## Endpoints — dispatcher exposes

Slykboard calls these on the dispatcher. Request/response shapes
slykboard must emit/consume.

### POST `/webhooks/ticket-events`

Slykboard emits when:
- PM creates a ticket in agent mode.
- PM replies in chat.
- PM explicitly queues a ticket for agent work.

**Request — ticket_created:**
```json
{
  "eventType": "ticket_created",
  "ticket": {
    "id": "uuid",
    "projectId": "uuid",
    "projectSlug": "inventory-tracker",
    "teamKey": "INVENTORYTRACKER",
    "agentBackend": null,
    "number": 42,
    "title": "Add CSV import",
    "description": "Allow users to bulk-import inventory from a CSV file.",
    "priority": "HIGH",
    "labels": ["feature"],
    "createdAt": "2026-08-13T12:34:56.789Z"
  }
}
```

**Request — pm_reply:**
```json
{
  "eventType": "pm_reply",
  "ticketId": "uuid",
  "agentSessionId": "cyrus-session-abc",
  "body": "Yes, add a confirm dialog."
}
```

**Request — queue_for_agent** (PM clicked "Start work"):
```json
{
  "eventType": "queue_for_agent",
  "ticketId": "uuid"
}
```

**Response:** `202 Accepted` with `{"acceptedAt": "<ISO 8601>"}`.

Slykboard treats anything other than `202` as a transient failure —
retry with exponential backoff (max 3 attempts over 60s, then mark
the ticket's pipeline job as `BACKLOG` and surface error to admin).

### POST `/onboard`

Slykboard emits when admin submits the onboarding form.

**Request:**
```json
{
  "project": {
    "id": "uuid",
    "slug": "inventory-tracker",
    "name": "Inventory Tracker",
    "subdomain": "inventory-tracker",
    "sourceMode": "new",
    "githubRepo": null,
    "stack": "node-express",
    "teamKey": "INVENTORYTRACKER",
    "agentBackend": null,
    "visibility": "internal",
    "initialAgentContext": "..."
  }
}
```

**Response:** `202 Accepted` with `{"orchestratorId": "uuid"}`.
Dispatcher runs asynchronously; slykboard learns of progress via
dispatcher's callbacks to `/api/v1/internal/projects/:slug/onboarding/events`.

If dispatcher returns `400` (validation failure) or `409` (slug
collision on its side), slykboard marks the project as `FAILED` with
the dispatcher's error message and surfaces it to the admin.

### POST `/decommission`

Slykboard emits when admin confirms decommission.

**Request:**
```json
{
  "projectId": "uuid",
  "slug": "inventory-tracker",
  "repoUrl": "git@github.com:org/inventory-tracker.git",
  "lxcCtid": 142,
  "zoraxyProxyId": "proxy-abc",
  "githubRepoCreated": true,
  "agentBackend": "cyrus"
}
```

**Response:** `202 Accepted`. Teardown is asynchronous; dispatcher
calls back to `/api/v1/internal/projects/:slug/onboarding/events`
with state transitions until `DECOMMISSIONED`.

### POST `/webhooks/pm-action/need-human-help`

Slykboard emits when PM clicks "Need human help" on a blocked ticket.

**Request:**
```json
{
  "ticketId": "uuid",
  "projectId": "uuid",
  "reason": "BLOCKED_HUMAN"
}
```

**Response:** `202 Accepted`. Dispatcher notifies the on-call channel
(Slack / email) per its own config.

## Endpoints — slykboard exposes

Dispatcher calls these on slykboard. All under `/api/v1/internal/*`,
all HMAC-verified. Full request/response shapes in
`05-backend-routes.md`.

| Method + path | Purpose |
|---|---|
| `POST /api/v1/internal/jobs/:ticketId/state` | Dispatcher updates pipeline state |
| `POST /api/v1/internal/jobs/:ticketId/messages` | Dispatcher forwards an agent utterance to the chat thread |
| `GET /api/v1/internal/projects/:slug/deploy-target` | Dispatcher reads deploy config |
| `POST /api/v1/internal/projects/:slug/onboarding/events` | Dispatcher appends onboarding lifecycle events |

## Retry semantics

### Slykboard → Dispatcher

- On `5xx` or network error: retry up to 3 times with exponential
  backoff (1s, 5s, 30s). After that, log + surface to admin.
- On `4xx`: do not retry — these are validation failures, retrying
  won't help. Log + surface to admin.
- Idempotency: every outbound payload includes an `idempotencyKey`
  (uuid v4) so retries don't double-execute on the dispatcher.

### Dispatcher → Slykboard

Dispatcher implements its own retry. Slykboard must be idempotent on
inbound calls:

- `POST /api/v1/internal/jobs/:ticketId/state` — same `state` written
  twice = no-op (the `PipelineEvents` insert can be deduped via
  `(ticketId, state, traceId)` unique constraint, or just allowed to
  duplicate — append-only log, harmless).
- `POST /api/v1/internal/jobs/:ticketId/messages` — include an
  `idempotencyKey` in the dispatcher payload; slykboard checks
  `AgentMessages.idempotencyKey` for duplicates before inserting.

## Versioning

Both services ship with a version string in `/api/health`:

```json
{
  "service": "slykboard",
  "version": "1.4.2",
  "agentMode": true,
  "schemaVersion": 1
}
```

Breaking changes to the contract (e.g. field rename, required field
added) bump `schemaVersion`. Dispatcher checks slykboard's
`schemaVersion` on boot and refuses to start if mismatched.

## Network

Dispatcher URL is LAN-internal (`https://dispatcher.kmlab.dev`) but
routed through Cloudflare Access for defense-in-depth. Slykboard
itself is also behind Cloudflare Access (in production).

Outbound HTTPS from slykboard to dispatcher uses standard `fetch`. No
custom CA, no mTLS — HMAC over HTTPS is the auth.

In development:
- Run dispatcher + slykboard both locally on different ports.
- Set `SLYKBOARD_DISPATCHER_URL=http://localhost:4001`.
- Both share the same `SLYKBOARD_DISPATCHER_TOKEN` value (any 64-char
  hex string for dev).

## Failure scenarios

| Scenario | Slykboard behavior |
|---|---|
| Dispatcher unreachable on ticket creation | Retry 3x over 60s. After that, ticket stays in kanban, marked with `pipelineState = BACKLOG` + a "dispatcher unavailable" badge. Admin can manually retry from the ticket page. |
| Dispatcher returns `4xx` on ticket creation | Log + alert admin. Ticket stays in `BACKLOG`. Likely cause: schema version mismatch. |
| Dispatcher unreachable on PM chat reply | Reply persists in `AgentMessages` (so PM sees it), but dispatcher never got it. Show "not delivered" indicator next to the message. Background retry every 30s until delivered or 10 min elapsed (then mark permanently failed). |
| Dispatcher webhook to slykboard fails | Dispatcher's problem. Slykboard will see state lag behind reality. Polling fallback in Phase 5: every 60s, slykboard queries dispatcher `GET /jobs/:ticketId/state` for any ticket in a non-terminal state, reconciles. |

## Observability

Slykboard logs every outbound + inbound dispatcher call:

```json
{
  "level": "info",
  "msg": "dispatcher call",
  "direction": "outbound",
  "path": "/webhooks/ticket-events",
  "method": "POST",
  "status": 202,
  "durationMs": 47,
  "ticketId": "uuid",
  "traceId": "9b7c..."
}
```

`traceId` propagates end-to-end: slykboard generates on outbound,
dispatcher passes to agent, agent writes back via state callbacks.
Phase 4 observability work binds this to Grafana traces.
