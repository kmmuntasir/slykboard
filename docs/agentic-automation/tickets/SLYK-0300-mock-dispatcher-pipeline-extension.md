# SLYK-0300 — Mock dispatcher: ticket-events + state stream

**Phase:** 1 — Pipeline State + SSE
**Type:** Tooling
**Depends on:** SLYK-0170, SLYK-0260, SLYK-0290

## Description

Phase 1 slice of the mock per `10-mock-dispatcher.md` Implementation order:
`/webhooks/ticket-events` handling + `state_update.*` emission.

1. **`ticket_created` handling** — on signed POST, start streaming the
   scenario's `ticketCreatedStateSequence` callbacks to slykboard
   `POST /api/v1/internal/jobs/:ticketId/state`, each after its `delayMs`
   sleep, each signed. Happy-path sequence per the `10` scenario example:
   QUEUED → AGENT_RUNNING (detail.agentSessionId) → PR_OPEN (prNumber,
   sha) → CI_RUNNING → MERGING (full decision-log detail blob per
   `04-schema.md` mergebot shape) → DEPLOYING → DONE.
2. **`queue_for_agent` handling** — emit `state_update.queued` then
   `agent_running`.
3. **`pm_reply` handling** — log only for now (Phase 2 slice = SLYK-0360).
4. **Scenarios added:**
   - `agent-waiting.json` — mid-task question + resume (state part;
     message emission arrives in SLYK-0360; define the AGENT_WAITING→
     AGENT_RUNNING sequence now).
   - `failed-ci-retry.json` — FAILED_CI → QUEUED → CI_RUNNING → MERGING →
      DONE (attempts bump visible).
   - `blocked-human.json` — FAILED_* over cap → BLOCKED_HUMAN.
5. **Fixtures** — all `state_update.*.json` templates from the `10` layout.
6. **Test integration** — e2e Vitest in
   `backend/src/routes/internal.routes.test.ts` style: bring up mock on
   random port, env-point slykboard at it, create ticket via API, assert
   states propagate to DONE + ticket column flips to Done.

## Acceptance criteria

- [ ] Happy path e2e: ticket create → mock streams 7 states → slykboard
      job DONE + ticket in Done column.
- [ ] `failed-ci-retry`: attempts counter increments; eventually DONE.
- [ ] `blocked-human`: terminal BLOCKED_HUMAN.
- [ ] All callbacks signed (zero 401s from slykboard).
- [ ] Scenario files + fixtures match `10` layout exactly.

## References

- `docs/agentic-automation/10-mock-dispatcher.md` (scenario shape,
  Phase 1 order)
- `docs/agentic-automation/09-implementation-phases.md` Phase 1 smoke tests

## Dependencies

- SLYK-0170 (skeleton)
- SLYK-0260 (state endpoint to call)
- SLYK-0290 (ticket_created arrives from slykboard)
