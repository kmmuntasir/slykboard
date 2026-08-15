# SLYK-0310 — Pipeline tab, `<PipelinePanel>`, `<FailedPipelineBadge>`

**Phase:** 1 — Pipeline State + SSE
**Type:** Feature (frontend)
**Depends on:** SLYK-0270, SLYK-0280, SLYK-0290, SLYK-0160

## Description

Agent-mode ticket-detail Pipeline tab + kanban failure badges.

1. **`frontend/src/constants/pipelineStates.ts`** — the full 15-state →
   plain-English map from `06-frontend-ui.md` (single source; shared by
   panel + badge).

2. **`frontend/src/api/pipeline.ts` + `hooks/usePipeline.ts`** — per
   `11-existing-patterns.md`: `useQuery` on
   `GET /api/v1/me/tickets/:id/pipeline`, `queryKeys.pipeline(ticketId)`
   factory added. SSE `state` events invalidate the query key.

3. **`frontend/src/hooks/useTicketSse.ts`** — `EventSource` wrapper on
   `/api/v1/me/tickets/:id/events`: handles `state` (invalidate pipeline
   query + board queries on DONE — column move) and `message` (Phase 2
   consumer; type the handler now). Auto-reconnect (EventSource native +
   server `retry:`). Open one per ticket-detail mount, close on unmount.

4. **`<PipelinePanel>`** — timeline rendering per `06` sketch: one row per
   `PipelineEvent`, ✓ completed / ↻ in-flight / ⋯ pending-vs-known states,
   duration from `detail.durationMs` when present, PR link when
   `prNumber`. Terminal-failure states: red badge + "Need human help"
   button (button action itself is SLYK-0400; render disabled with TODO or
   wire to a stub handler). Empty state (404 job): "This ticket isn't
   queued for agent work" + **Queue for agent** button → POST
   `/api/v1/me/tickets/:id/queue` (SLYK-0290).

5. **Pipeline tab** on the ticket detail modal (agent mode only): add tab
   alongside Comments using the existing tab mechanism in the ticket
   detail page.

6. **`<FailedPipelineBadge>`** — on kanban `TicketCard` + ticket detail
   header when job state is `FAILED_*` or `BLOCKED_HUMAN`, per `06`
   sketches (failure message + remaining-retries line; BLOCKED variant
   with "Needs human help"). Board query must expose pipeline state —
   extend the board payload or fetch a lightweight
   `needsPmAttention`/state summary per board load (pick the lighter:
   join job state into the existing board endpoint response in agent
   mode, additive field).

## Acceptance criteria

- [ ] Pipeline tab appears in agent mode, absent in plain mode (store
      mock test + plain bundle grep).
- [ ] Timeline renders events from the API; live state changes arrive via
      SSE without manual refresh.
- [ ] DONE via SSE: board ticket moves to Done column automatically.
- [ ] Empty state + Queue button: posting queues the ticket, panel flips
      to QUEUED.
- [ ] Failed badge on card + header for FAILED_*/BLOCKED_HUMAN; absent
      otherwise.
- [ ] Component tests: timeline render, empty state, badge gating, SSE
      invalidate (mock EventSource).

## References

- `docs/agentic-automation/06-frontend-ui.md` (PipelinePanel,
  FailedPipelineBadge, state map)
- `docs/agentic-automation/11-existing-patterns.md` (API client, queryKeys,
  SSE invalidate pattern)

## Dependencies

- SLYK-0270 (SSE endpoint)
- SLYK-0280 (pipeline GET)
- SLYK-0290 (queue button endpoint)
- SLYK-0160 (agentMode gating live)
