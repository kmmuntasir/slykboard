# SLYK-0360 — Mock dispatcher: pm_reply + agent message emission

**Phase:** 2 — PM ↔ Agent Chat
**Type:** Tooling
**Depends on:** SLYK-0300, SLYK-0320, SLYK-0330

## Description

Phase 2 slice of the mock per `10-mock-dispatcher.md` Implementation order:
pm_reply handling + agent message emission.

1. **`pm_reply` handling** — on signed POST: log, and per the
   `agent-waiting` scenario emit after ~2s: an AGENT message
   (fixtures `message.agent.json` / `message.system.json`) to
   `POST /api/v1/internal/jobs/:ticketId/messages` (with idempotencyKey),
   then a `state_update.agent_running` callback (agent resumed).
2. **`agent-waiting.json` scenario completed** — full flow: ticket_created
   → … → AGENT_RUNNING → AGENT_WAITING (state cb) → AGENT message (the
   question) → [wait for pm_reply] → PM reply received → AGENT
   acknowledgement message → AGENT_RUNNING → … → DONE.
3. **Fixtures** — `message.agent.json`, `message.system.json`,
   `pm_reply.request.json` per the `10` layout.
4. **E2E test** — `backend/src/routes/internal.routes.test.ts` extension:
   full chat round-trip. Create ticket (mock streams to AGENT_WAITING +
   question message) → PM replies via `/api/v1/me/tickets/:id/messages` →
   mock receives pm_reply, emits ack message + AGENT_RUNNING → assert
   message thread + state in slykboard; assert needsPmAttention cleared.

## Acceptance criteria

- [ ] Full `agent-waiting` scenario e2e passes: question appears, PM reply
      accepted, ack message + resume observed, DONE reached.
- [ ] Duplicate delivery (mock re-sends same idempotencyKey) creates ONE
      row.
- [ ] All callbacks signed.
- [ ] `happy-path` + other Phase 1 scenarios still pass (no regression).

## References

- `docs/agentic-automation/10-mock-dispatcher.md` (pm_reply behavior,
  Phase 2 order)
- `docs/agentic-automation/09-implementation-phases.md` Phase 2 smoke tests

## Dependencies

- SLYK-0300 (scenario engine + state stream)
- SLYK-0320 (messages endpoint)
- SLYK-0330 (PM reply endpoint the mock receives from)
