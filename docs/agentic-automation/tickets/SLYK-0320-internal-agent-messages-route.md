# SLYK-0320 — `POST /api/v1/internal/jobs/:ticketId/messages` (idempotent)

**Phase:** 2 — PM ↔ Agent Chat
**Type:** Feature (backend)
**Depends on:** SLYK-0140, SLYK-0270

## Description

Dispatcher forwards agent utterances here. Replaces the stub.

**Files:** `internal.routes.ts` + `internal.schema.ts`,
`backend/src/repositories/agentMessageRepository.ts`,
`backend/src/services/agentMessageService.ts` (pattern:
`commentService.ts` per `04-schema.md` note).

**Zod:** `{ authorRole: 'AGENT' | 'SYSTEM' (never PM), body: string
(1..4000), agentSessionId?: string, idempotencyKey?: string (uuid), traceId?:
uuid }`.

**Behavior:**

1. Job lookup by ticketId → 404 if not in pipeline.
2. **Idempotency** — if `idempotencyKey` present and an `AgentMessages`
   row with the same key exists, return `201` with the EXISTING row (no
   duplicate insert) — dispatcher retry safety per `07` § Retry semantics.
3. Insert message (authorUserId null; persist agentSessionId; store
   idempotencyKey).
4. Emit SSE `message` event: `{id, authorRole, body, createdAt}` per
   `05` events spec.
5. State coupling: dispatcher already flips AGENT_WAITING via the state
   endpoint — server does NOT second-guess message content (no
   question-detection heuristics server-side).
6. Return 201 with the row.

## Acceptance criteria

- [ ] Signed happy path: row inserted, SSE frame emitted, 201.
- [ ] Duplicate idempotencyKey: 201 with original row, no second insert
      (row count assert).
- [ ] `authorRole: 'PM'` rejected 400 (dispatcher may not impersonate PM).
- [ ] body >4000 chars → 400; unknown ticket → 404; unsigned → 401;
      SYSTEM allowed and persisted.
- [ ] agentSessionId persisted for later PM-reply routing.

## References

- `docs/agentic-automation/05-backend-routes.md` § jobs/:ticketId/messages
- `docs/agentic-automation/07-dispatcher-contract.md` § Retry semantics
- `docs/agentic-automation/04-schema.md` (AgentMessages + idempotency
  index)

## Dependencies

- SLYK-0140 (AgentMessages table)
- SLYK-0270 (SSE emitter to push on)
