# SLYK-0280 — `GET /api/v1/me/tickets/:id/pipeline`

**Phase:** 1 — Pipeline State + SSE
**Type:** Feature (backend)
**Depends on:** SLYK-0260

## Description

Read endpoint feeding the Pipeline tab. On the user-facing agent router
(`requireAgentMode, authenticate`).

**Behavior:**

1. Access check via `ticketService.getTicketForUser` (project member) —
   404 otherwise.
2. Load `PipelineJobs` by ticketId → 404 if no row (plain-mode ticket /
   not queued).
3. Load last 50 `PipelineEvents` for the ticket (desc, or asc — pick asc
   for timeline rendering; cap 50).
4. Response envelope per `05-backend-routes.md`:
   `{ job: {ticketId, state, attempts, githubPrNumber, githubPrSha,
   traceId, updatedAt}, events: [{id, fromState, toState, detail,
   createdAt}] }`.

**Tests:** member sees job + events; non-member 404; no-job 404; events
capped at 50 (seed 60, assert 50); detail blob passed through verbatim
(mergebot-shape jsonb survives round-trip — Phase 6.5 depends on it).

## Acceptance criteria

- [ ] Response shape matches `05` exactly (field names, envelope).
- [ ] 404 paths covered.
- [ ] 50-event cap enforced.
- [ ] jsonb detail round-trips byte-equal.
- [ ] Plain mode → 501.

## References

- `docs/agentic-automation/05-backend-routes.md` § me/tickets/:id/pipeline
- `docs/agentic-automation/04-schema.md` (detail jsonb contract)
- `docs/agentic-automation/11-existing-patterns.md` (getTicketForUser reuse)

## Dependencies

- SLYK-0260 (jobs + events being written)
