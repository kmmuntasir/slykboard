# SLYK-0290 — Auto-queue on ticket creation + `queue_for_agent` endpoint

**Phase:** 1 — Pipeline State + SSE
**Type:** Feature (backend)
**Depends on:** SLYK-0260, SLYK-0180

## Description

### 1. Auto-queue hook in `ticketService.create`

Per `11-existing-patterns.md` § Existing ticket creation flow: after the
core ticket insert commits, when `SLYKBOARD_AGENT_MODE === 'true'`:

1. Insert `PipelineJobs` row: `{ticketId, projectId, state: 'BACKLOG',
   agentBackend: projectMeta?.agentBackend ?? null, traceId:
   crypto.randomUUID()}`.
2. Fire-and-forget outbound webhook AFTER commit (never inside the
   transaction — don't hold the DB connection over HTTP):
   `postToDispatcher('/webhooks/ticket-events', { eventType:
   'ticket_created', idempotencyKey, ticket: {...} })` with the full
   payload per `07-dispatcher-contract.md` (id, projectId, projectSlug,
   teamKey from ProjectAgentMeta — UPPER(slug), agentBackend, number,
   title, description, priority, labels[], createdAt). Failure path per
   `07` failure table: dispatcherClient retries 3×; after that ticket
   stays in kanban with job left at BACKLOG + admin-visible error (log +
   surface badge comes with SLYK-0310).
3. Plain mode: zero changes — no job row, no webhook (test this).

### 2. `POST /api/v1/me/tickets/:id/queue` (PM "Start work")

**Doc gap:** `06-frontend-ui.md` PipelinePanel empty state ("Queue for
agent" button) + `07`'s `queue_for_agent` event have no consuming endpoint
in `05`. This ticket adds it: user-facing agent router, `authenticate` +
ticket access check.

Behavior: verify job exists and state === BACKLOG (or FAILED_*/BLOCKED_HUMAN
→ QUEUED per matrix — PM-initiated retry), transition via the SLYK-0260
service path (validates matrix), then emit
`{eventType: 'queue_for_agent', idempotencyKey, ticketId}` to dispatcher.
409 when the current state can't legally go to QUEUED.

## Acceptance criteria

- [ ] Agent mode: creating a ticket inserts a BACKLOG job row + fires the
      signed webhook (mock 202); payload matches `07` field-for-field.
- [ ] Plain mode: ticket creation inserts NO job row, fires nothing.
- [ ] Webhook failure: ticket still created, job stays BACKLOG, error
      logged with traceId; no unhandled rejection.
- [ ] `/queue`: BACKLOG→QUEUED works, event emitted, SSE state frame
      sent; illegal-source state → 409; no job → 404; plain → 501.
- [ ] Existing ticket-creation tests unaffected (agent-mode logic isolated
      behind env check + test env defaults plain).

## References

- `docs/agentic-automation/11-existing-patterns.md` § ticket creation flow
- `docs/agentic-automation/07-dispatcher-contract.md` (ticket_created +
  queue_for_agent payloads, failure table)
- `docs/agentic-automation/09-implementation-phases.md` Phase 1 smoke tests

## Dependencies

- SLYK-0260 (job write path + transition service)
- SLYK-0180 (dispatcherClient with retry)
