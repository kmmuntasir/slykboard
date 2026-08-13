# 05 — Backend Routes (Agent Mode)

All routes below are mounted in agent mode only (see `02-dual-mode.md`).
Two mount points:

- `/api/v1/internal/*` — dispatcher callbacks. Auth: `agentTokenAuth`
  middleware (HMAC signature from dispatcher).
- `/api/v1/admin/*` — admin UI actions. Auth: `requirePlatformAdmin`
  middleware (existing `is_platform_admin = true`).
- `/api/v1/me/*` — user-facing routes that have agent-mode additions
  (chat, ticket pipeline view). Auth: existing `authenticate`.

**Layered rule** (from `AGENTS.md`): Route → Controller → Service →
Repository. No skipping layers. Transactions in services.

## `/api/v1/internal/*` — dispatcher callbacks

### POST `/api/v1/internal/webhooks/ticket-events`

Slykboard **emits** this on ticket creation (see "Outbound" below); it
does **not** consume this path. Listed here for symmetry — dispatcher
exposes the inverse.

### POST `/api/v1/internal/jobs/:ticketId/state`

Dispatcher updates pipeline state for a ticket.

**Request:**
```json
{
  "state": "AGENT_RUNNING",
  "detail": { "prNumber": 123, "sha": "abc1234", "attempt": 1 },
  "traceId": "9b7c..."
}
```

**Auth:** HMAC signature in `X-Dispatcher-Signature` header.

**Validation** (Zod):
```ts
const stateUpdateSchema = z.object({
  state: z.enum([
    'BACKLOG','QUEUED','AGENT_RUNNING','AGENT_WAITING','PR_OPEN',
    'CI_RUNNING','MERGING','CONFLICT_RETRY','DEPLOYING','DONE',
    'FAILED_AGENT','FAILED_CI','FAILED_CONFLICT','FAILED_DEPLOY',
    'BLOCKED_HUMAN',
  ]),
  detail: z.record(z.unknown()).optional(),
  traceId: z.string().uuid().optional(),
});
```

**Behavior:**
1. Load `PipelineJobs` row by `ticketId`. If not found, return `404`.
2. In a transaction:
   - Insert previous state into `PipelineEvents` (`fromState = current`,
     `toState = body.state`, `detail`, `traceId`).
   - Update `PipelineJobs.state = body.state`, bump `updatedAt`.
   - If `body.state === 'DONE'`, also update the core `Tickets` row:
     set `statusColumn = 'Done'` (drives kanban column move).
   - If `body.state === 'AGENT_WAITING'`, set
     `PipelineJobs.needsPmAttention = true` (drives UI badge + optional
     email notification). Cleared when PM posts a reply (see
     `POST /api/v1/me/tickets/:id/messages`) or dispatcher transitions
     out of `AGENT_WAITING`.
3. Return `200 OK` with the updated job row.

**Errors:**
- `400` — invalid state name, malformed detail.
- `401` — missing/invalid HMAC signature.
- `404` — ticket not in pipeline (PM created ticket in plain mode by
  mistake, or `SLYKBOARD_AGENT_MODE` flipped off mid-pipeline).

### POST `/api/v1/internal/jobs/:ticketId/messages`

Dispatcher forwards an agent utterance (from `/status` polling of
Cyrus) into the PM↔agent chat thread.

**Request:**
```json
{
  "authorRole": "AGENT",
  "body": "Should I add a confirm dialog before deleting the user?",
  "agentSessionId": "cyrus-session-abc",
  "traceId": "9b7c..."
}
```

`authorRole` is `"AGENT"` or `"SYSTEM"` (never `"PM"` — PM messages
originate from the frontend, see "Outbound" below).

**Behavior:**
1. Insert into `AgentMessages` with `ticketId`, `authorRole`, `body`,
   `agentSessionId`.
2. If `authorRole === 'AGENT'` and the message looks like a question
   (heuristic: ends with `?`, or starts with "Should", "Do you want",
   "Which"), dispatcher should already have flipped state to
   `AGENT_WAITING` via the state endpoint. Server does not second-guess.
3. Emit a Server-Sent-Events push to connected PM browser tabs (see
   `/api/v1/me/tickets/:id/events` below).
4. Return `201 Created` with the inserted message row.

### GET `/api/v1/internal/projects/:slug/deploy-target`

Dispatcher reads deploy target config for a project (used during
onboarding + deploy).

**Response:**
```json
{
  "lxcCtid": 142,
  "lanIp": "192.168.31.142",
  "systemdService": "inventory-tracker-backend",
  "subdomain": "inventory-tracker",
  "stack": "node-express"
}
```

**Behavior:**
1. Load `Projects` + `ProjectAgentMeta` joined on id where `slug = :slug`.
2. If `onboardingState !== 'LIVE'`, return `409 Conflict` (project not
   ready for deploys).
3. Otherwise return the deploy target fields.

### POST `/api/v1/internal/projects/:slug/onboarding/events`

Dispatcher appends an onboarding lifecycle event.

**Request:**
```json
{
  "fromState": "PROVISIONING_LXC",
  "toState": "WIRING_GITHUB",
  "detail": { "ctid": 142, "lanIp": "192.168.31.142" }
}
```

**Behavior:**
1. Load `ProjectAgentMeta` by slug.
2. In a transaction:
   - Insert into `OnboardingEvents`.
   - Update `ProjectAgentMeta.onboardingState = body.toState`.
   - If `body.toState === 'LIVE'`, set `onboardedAt = now()`.
   - If `body.toState === 'FAILED'`, set `onboardingError = body.detail.error`.
3. Return `200 OK`.

## `/api/v1/admin/*` — admin UI actions

All routes require `is_platform_admin = true` on the session user.

### POST `/api/v1/admin/projects` — create + start onboarding

Creates a project row + ProjectAgentMeta row + kicks off the
dispatcher orchestrator.

**Request:**
```json
{
  "name": "Inventory Tracker",
  "slug": "inventory-tracker",
  "subdomain": "inventory-tracker",
  "sourceMode": "new",
  "githubRepo": null,
  "stack": "node-express",
  "agentBackend": null,
  "visibility": "internal",
  "initialAgentContext": "This project manages warehouse inventory..."
}
```

**Validation:**
- `name` — non-empty, ≤200 chars.
- `slug` — `/^[a-z0-9-]+$/`, unique.
- `subdomain` — `/^[a-z0-9-]+$/`, unique, not in a reserved list
  (`api`, `www`, `admin`, `dispatcher`, `cyrus`, etc.).
- `sourceMode` — `'new'` or `'existing'`.
- `githubRepo` — required when `sourceMode === 'existing'`. Validate
  matches `^git@github\.com:[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+\.git$`
  (SSH) OR `^https://github\.com/[a-zA-Z0-9_-]+/[a-zA-Z0-9_.-]+\.git$`
  (HTTPS). When `sourceMode === 'new'`, must be null (dispatcher fills
  it post-creation).
- `stack` — enum: `node-express`, `next`, `python-fastapi`, `go`,
  `static`.
- `agentBackend` — nullable, or one of the registered backends
  (`cyrus`, future: `deckmate`, etc.). Null = global default.
- `visibility` — `'internal'` (default) or `'public'`.
- `initialAgentContext` — nullable, ≤10,000 chars.

**Behavior:**
1. In a transaction:
   - Insert into core `Projects` (existing table; reuse name + description fields).
   - Insert into `ProjectAgentMeta` with all agent columns, `onboardingState = 'PENDING'`.
2. POST to dispatcher `/onboard` with the full payload (signed with
   `SLYKBOARD_DISPATCHER_TOKEN`). See `07-dispatcher-contract.md`.
3. If dispatcher returns `202 Accepted`, return `201 Created` with the
   project row.
4. If dispatcher returns error, mark
   `onboardingState = 'FAILED'` with the error message, return `502`
   to the admin.

### POST `/api/v1/admin/projects/:slug/decommission`

Triggers dispatcher teardown. See `03-security.md` for safety layers.

**Request:**
```json
{
  "confirmSlug": "inventory-tracker"
}
```

**Behavior:**
1. Validate `confirmSlug === project.slug`. Mismatch → `400`.
2. Update `ProjectAgentMeta.onboardingState = 'DECOMMISSIONING'`.
3. POST to dispatcher `/decommission` with `{ projectId, repoUrl, lxcCtid, zoraxyProxyId, githubRepoCreated }`.
4. Return `202 Accepted` — frontend polls project status until
   `onboardingState === 'DECOMMISSIONED'`.

### POST `/api/v1/admin/agent-tokens` — generate HMAC token

Admin generates a new dispatcher HMAC token.

**Request:**
```json
{
  "name": "dispatcher-prod",
  "projectId": null
}
```

**Behavior:**
1. Generate `crypto.randomBytes(32).toString('hex')` (64 hex chars).
2. Compute `sha256(rawToken)`.
3. Insert into `AgentTokens` with `tokenHash`, `name`, `projectId`,
   `createdBy = req.user.id`.
4. Return the raw token **once**:
   ```json
   { "token": "abc123...", "id": "uuid", "name": "dispatcher-prod" }
   ```
5. UI shows the token once with a copy button + warning that it
   cannot be retrieved again.

### DELETE `/api/v1/admin/agent-tokens/:id`

Revoke a token.

**Behavior:**
1. Set `revokedAt = now()` on the token row.
2. Return `204 No Content`.

## `/api/v1/me/*` — user-facing routes (agent-mode additions)

### GET `/api/v1/me/tickets/:id/pipeline`

Returns the pipeline state + recent events for the ticket detail page's
Pipeline tab.

**Response:**
```json
{
  "job": {
    "ticketId": "uuid",
    "state": "MERGING",
    "attempts": 0,
    "githubPrNumber": 123,
    "githubPrSha": "abc1234",
    "traceId": "9b7c...",
    "updatedAt": "2026-08-13T..."
  },
  "events": [
    {
      "id": "uuid",
      "fromState": "PR_OPEN",
      "toState": "CI_RUNNING",
      "detail": { "durationMs": 4123 },
      "createdAt": "2026-08-13T..."
    }
    // ... up to 50 most recent
  ]
}
```

Returns `404` if ticket is not in the pipeline (plain-mode ticket or
not yet queued).

### GET `/api/v1/me/tickets/:id/messages`

Returns the chat thread for the ticket.

**Response:**
```json
{
  "messages": [
    {
      "id": "uuid",
      "authorRole": "AGENT",
      "authorUserId": null,
      "body": "Should I add a confirm dialog?",
      "agentSessionId": "cyrus-session-abc",
      "readAt": null,
      "createdAt": "2026-08-13T..."
    }
  ],
  "ticketState": "AGENT_WAITING"
}
```

`ticketState` is included so the frontend can disable the input box
when the agent has finished.

### POST `/api/v1/me/tickets/:id/messages`

PM posts a reply.

**Request:**
```json
{
  "body": "Yes, add a confirm dialog with Cancel as default."
}
```

**Validation:**
- `body` — non-empty, ≤4000 chars.

**Behavior:**
1. Verify the ticket's `PipelineJobs.state` is `AGENT_RUNNING` or
   `AGENT_WAITING`. Otherwise return `409` (agent not listening).
2. Insert into `AgentMessages` with `authorRole = 'PM'`,
   `authorUserId = req.user.id`.
3. POST to dispatcher `/webhooks/ticket-events` with payload
   `{ eventType: 'pm_reply', ticketId, agentSessionId, body }`
   (signed with `SLYKBOARD_DISPATCHER_TOKEN`).
4. Return `201 Created` with the inserted message.

### GET `/api/v1/me/tickets/:id/events` (Server-Sent Events)

Long-lived SSE connection for live updates on a ticket (pipeline
state changes, new chat messages). Frontend opens one per ticket
detail page.

**Events:**
```
event: state
data: {"state":"CI_RUNNING","traceId":"9b7c..."}

event: message
data: {"id":"uuid","authorRole":"AGENT","body":"...","createdAt":"..."}
```

Implementation: in-memory `EventEmitter` per ticket. Dispatcher
callbacks (`POST /api/v1/internal/jobs/:id/state` and `/messages`)
emit on the emitter; SSE route subscribes. Phase 1 simple impl —
scale later with Redis pub/sub if needed.

## Outbound — slykboard → dispatcher

### POST `<dispatcher>/webhooks/ticket-events`

Emitted on:
- Ticket creation in agent mode (slykboard auto-inserts
  `PipelineJobs` row with `state = 'BACKLOG'`, then emits this).
- PM chat reply (above).
- PM explicit "Start work" action (sets `state = 'QUEUED'`).

**Payload — ticket creation:**
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
    "description": "Allow users to bulk-import inventory from a CSV file...",
    "priority": "HIGH",
    "labels": ["feature"],
    "createdAt": "2026-08-13T..."
  }
}
```

**Payload — PM reply:**
```json
{
  "eventType": "pm_reply",
  "ticketId": "uuid",
  "agentSessionId": "cyrus-session-abc",
  "body": "Yes, add a confirm dialog."
}
```

Signed with `X-Slykboard-Signature` header (HMAC-SHA256 hex of raw
body, key = `SLYKBOARD_DISPATCHER_TOKEN`).

## Pipeline state transitions (legal map)

`POST /api/v1/internal/jobs/:ticketId/state` validates against the
matrix below. Illegal transitions return `400 INVALID_STATE_TRANSITION`
with `{details: {from, to}}`.

Rows = `fromState`, columns = `toState`. ✓ = legal, · = rejected.

| from \ to | BACKLOG | QUEUED | AGENT_RUN | AGENT_WAIT | PR_OPEN | CI_RUN | MERGING | CONFLICT | DEPLOY | DONE | FAIL_AGENT | FAIL_CI | FAIL_CONFLICT | FAIL_DEPLOY | BLOCKED |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **BACKLOG**        | · | ✓ | · | · | · | · | · | · | · | · | · | · | · | · | · |
| **QUEUED**         | · | · | ✓ | · | · | · | · | · | · | · | ✓ | · | · | · | · |
| **AGENT_RUNNING**  | · | · | · | ✓ | ✓ | · | · | · | · | · | ✓ | · | · | · | · |
| **AGENT_WAITING**  | · | · | ✓ | · | · | · | · | · | · | · | ✓ | · | · | · | · |
| **PR_OPEN**        | · | · | · | · | · | ✓ | · | · | · | · | · | · | · | · | · |
| **CI_RUNNING**     | · | · | · | · | · | · | ✓ | · | · | · | · | ✓ | · | · | · |
| **MERGING**        | · | · | · | · | · | · | · | ✓ | · | ✓ | · | · | · | · | · |
| **CONFLICT_RETRY** | · | · | · | · | · | · | ✓ | · | · | · | · | · | ✓ | · | · |
| **DEPLOYING**      | · | · | · | · | · | · | · | · | · | ✓ | · | · | · | ✓ | · |
| **DONE**           | · | · | · | · | · | · | · | · | · | · | · | · | · | · | · |
| **FAILED_AGENT**   | · | ✓ | · | · | · | · | · | · | · | · | · | · | · | · | ✓ |
| **FAILED_CI**      | · | ✓ | · | · | · | · | · | · | · | · | · | · | · | · | ✓ |
| **FAILED_CONFLICT**| · | ✓ | · | · | · | · | · | · | · | · | · | · | · | · | ✓ |
| **FAILED_DEPLOY**  | · | ✓ | · | · | · | · | · | · | · | · | · | · | · | · | ✓ |
| **BLOCKED_HUMAN**  | · | ✓ | · | · | · | · | · | · | · | · | · | · | · | · | · |

Invariants:

- **`DONE`, `DECOMMISSIONED`** are terminal — no transitions out.
- **`BLOCKED_HUMAN`** can only resume to `QUEUED` (full pipeline
  restart) — dispatcher must re-acknowledge via the ticket webhook.
- **`FAILED_*`** states retry to `QUEUED` (next attempt bumps
  `PipelineJobs.attempts`) OR escalate to `BLOCKED_HUMAN`. No direct
  `FAILED_*` → running-state jumps; the queue loop must re-pick them.
- **`AGENT_WAITING`** can transition to `AGENT_RUNNING` (PM replied,
  agent resumed) or `FAILED_AGENT` (timeout). Cannot skip directly to
  `PR_OPEN` — only the agent decides when work is ready for PR.
- **Auto-retry cap**: `attempts` counter on `PipelineJobs` drives max
  retries (default 3). On exceeding cap, dispatcher must transition to
  `BLOCKED_HUMAN` instead of `QUEUED`.

Implementation: encode as a `Set<string>` of `"${from}->${to}"` in
`backend/src/services/pipelineStateService.ts` + unit-test every cell
of the matrix above.

## Error envelope (consistent across all routes)

```json
{
  "error": {
    "code": "INVALID_STATE_TRANSITION",
    "message": "Cannot transition from DONE to MERGING",
    "details": { "from": "DONE", "to": "MERGING" }
  }
}
```

HTTP status reflects the error class (`400`, `401`, `403`, `404`,
`409`, `500`, `502`). `code` is a machine-readable SCREAMING_SNAKE
identifier the frontend can switch on.

## OpenAPI

TBD in Phase 0 — generate OpenAPI spec from Zod schemas + Express
route definitions. Host at `/api/v1/openapi.json` (admin-only).
