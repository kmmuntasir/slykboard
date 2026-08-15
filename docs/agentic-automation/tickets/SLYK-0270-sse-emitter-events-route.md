# SLYK-0270 — SSE emitter + `GET /api/v1/me/tickets/:id/events`

**Phase:** 1 — Pipeline State + SSE
**Type:** Feature (backend)
**Depends on:** SLYK-0260

## Description

In-memory per-ticket `EventEmitter` + the user-facing SSE route pushing
`state` (and later `message`) events to PM browser tabs.

1. **Emitter** — `backend/src/services/sseEmitter.ts`: thin wrapper over
   Node `EventEmitter`, keyed by ticketId, `emit(ticketId, {type, data})` /
   `on(ticketId, cb)` / `off(ticketId, cb)` + listener cleanup. Wire the
   emit seam left by SLYK-0260 (state changes now push
   `event: state` with `{state, traceId}`).

2. **Route** — `GET /api/v1/me/tickets/:id/events` in
   `backend/src/routes/agent-chat.routes.ts` (user-facing router; mounts
   under `/api/v1/me` with `requireAgentMode, authenticate` — NOT the
   HMAC-gated internal router). Implementation sketch in
   `11-existing-patterns.md` § SSE:

   - Headers: `text/event-stream`, `no-cache`, `keep-alive`,
     `X-Accel-Buffering: no`.
   - `retry: 5000` first write.
   - Heartbeat `: ping` every 15s.
   - Subscribe to emitter for `req.params.id`.
   - On `req.close`: clearInterval + unsubscribe.
   - Idle-connection close after 5 min (risk-table mitigation) — end the
     response; EventSource auto-reconnects via retry hint.
   - Access check: reuse `ticketService.getTicketForUser` semantics so
     only project members subscribe (404 for outsiders).

3. **Mount** the agent-chat router in `index.ts`'s agent-mode block:
   `app.use('/api/v1/me', requireAgentMode, authenticate, agentChatRouter)`.

4. **HA note** — v1 invariant: single-pod deployment (documented in
   `11-existing-patterns.md` § SSE). Redis pub/sub is the Phase 6.5 path;
   keep the emitter interface shaped so it can swap.

5. **Tests** — supertest: SSE endpoint returns 200 + correct headers;
   state change via internal route (signed) produces `event: state` frame
   on a connected client (use a raw http server or supertest's streaming);
   heartbeat written; connection close unsubscribes (no listener leak —
   assert emitter listener count).

## Acceptance criteria

- [ ] Headers + retry hint exactly as specified.
- [ ] State transition via internal endpoint appears as SSE frame within
      the same process.
- [ ] Heartbeat every 15s (test with fake timers).
- [ ] Client disconnect removes listener (no leak across 50 connect/
      disconnect cycles).
- [ ] Non-member/nonexistent ticket → 404 before stream opens.
- [ ] Plain mode → 501; unauthenticated → 401.

## References

- `docs/agentic-automation/11-existing-patterns.md` § SSE (implementation +
  HA story)
- `docs/agentic-automation/05-backend-routes.md` § events SSE route
- `docs/agentic-automation/09-implementation-phases.md` risk table (SSE
  leak mitigation)

## Dependencies

- SLYK-0260 (state writes exist to emit from)
