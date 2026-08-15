# SLYK-0330 — `GET`/`POST /api/v1/me/tickets/:id/messages` (PM reply)

**Phase:** 2 — PM ↔ Agent Chat
**Type:** Feature (backend)
**Depends on:** SLYK-0320, SLYK-0260, SLYK-0180

## Description

User-facing chat thread endpoints on the agent user router.

### GET `/api/v1/me/tickets/:id/messages`

1. Ticket access check (`getTicketForUser`) → 404.
2. Return `{ messages: [rows asc], ticketState: <job state or null> }` —
   `ticketState` included so the UI can gate the input box.
3. Mark unread AGENT messages `readAt = now()` on fetch (PM saw them).

### POST `/api/v1/me/tickets/:id/messages`

Zod: `{ body: 1..4000 }`.

Behavior (service transaction per `11` skeleton):
1. Access check + job lookup.
2. Verify `PipelineJobs.state ∈ {AGENT_RUNNING, AGENT_WAITING}` → else
   `409` "agent not listening" (envelope code `CONFLICT` or a
   `PRECONDITION_FAILED`-style code — match existing enum conventions).
3. Insert `AgentMessages` row: authorRole 'PM', authorUserId = req.user.id.
4. Clear `needsPmAttention` (SLYK-0260 set it on AGENT_WAITING).
5. After commit: POST dispatcher `/webhooks/ticket-events`
   `{eventType: 'pm_reply', ticketId, agentSessionId (from latest AGENT
   message), body, idempotencyKey}` per `07`.
6. Return 201 with the row.

**Delivery-failure path** (`07` failure table): reply persists (PM sees
it) but if dispatcher ultimately unreachable, the message needs a "not
delivered" indicator. Implement minimal version: dispatcherClient throw →
respond 201 with `{...row, delivered: false}` + background retry job
(every 30s up to 10 min, then mark permanently failed — a simple
`deliveredAt`/`deliveryFailedAt` pair on AgentMessages or an in-memory
retry queue; pick the in-memory queue, DB columns stay as-is) + SSE
`message` event so open tabs update.

## Acceptance criteria

- [ ] GET returns messages asc + ticketState; marks readAt.
- [ ] POST in AGENT_WAITING: row inserted, needsPmAttention cleared,
      signed pm_reply dispatched (mock 202), 201.
- [ ] POST when state is DONE/PR_OPEN/…: 409, no insert, no webhook.
- [ ] POST when dispatcher down: row persists, `delivered: false` in
      response, retry fires (fake timers), SSE frame still sent.
- [ ] body length + empty rejected; non-member 404; plain 501.
- [ ] readAt only touched on GET by a project member.

## References

- `docs/agentic-automation/05-backend-routes.md` § me messages routes
- `docs/agentic-automation/07-dispatcher-contract.md` (pm_reply payload,
  failure table)
- `docs/agentic-automation/11-existing-patterns.md` (agentMessageService
  skeleton)

## Dependencies

- SLYK-0320 (messages table in use + repository exists)
- SLYK-0260 (job state + needsPmAttention semantics)
- SLYK-0180 (dispatcherClient)
