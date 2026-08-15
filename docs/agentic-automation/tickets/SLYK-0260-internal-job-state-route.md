# SLYK-0260 — `POST /api/v1/internal/jobs/:ticketId/state` + job repository

**Phase:** 1 — Pipeline State + SSE
**Type:** Feature (backend)
**Depends on:** SLYK-0150, SLYK-0250

## Description

Dispatcher state-write endpoint — the heart of the pipeline. Replaces the
stub in `internal.routes.ts`.

**Files:** `internal.routes.ts` + `internal.schema.ts`,
`backend/src/repositories/pipelineJobRepository.ts`,
`backend/src/services/pipelineJobService.ts`.

**Zod** (from `05-backend-routes.md`): `state` = the 15-value enum,
`detail?: record`, `traceId?: uuid`. Zod schema in `*.schema.ts` sibling.

**Behavior (transaction):**

1. Load `PipelineJobs` by ticketId → 404 envelope if absent.
2. Validate transition via SLYK-0250 (`assertLegalTransition`) — illegal →
   `400 INVALID_STATE_TRANSITION` + `details {from, to}` (new error code on
   the envelope enum; keep code SCREAMING_SNAKE per `05`).
   Retry-cap: FAILED_*→QUEUED over cap → also INVALID_STATE_TRANSITION (or
   explicit BLOCKED_HUMAN escalation error) per SLYK-0250 helper.
3. Insert `PipelineEvents` (fromState, toState, detail verbatim, traceId).
4. Update job: state, attempts (bump when entering FAILED_* → QUEUED retry
   path or per dispatcher hint in detail.attempt — simplest consistent
   rule: attempts++ whenever from is FAILED_* and to is QUEUED), updatedAt.
   Persist `githubPrNumber`/`githubPrSha` from detail when present.
5. `toState === 'DONE'` → also update core `Tickets.statusColumn = 'Done'`
   (kanban auto-move).
6. `toState === 'AGENT_WAITING'` → set `needsPmAttention = true`; any exit
   from AGENT_WAITING → clear it.
7. Emit SSE `state` event on the per-ticket emitter (emitter interface from
   SLYK-0270 — this ticket defines the service-level call site; if SLYK-
   0270 not yet merged, structure the emit behind a small `sseEmit()`
   seam and wire it in 0270).
8. Return 200 with updated job row envelope.

Idempotent inbound: same state written twice — second write is an illegal
transition (self-loop) → 400 per matrix. Dispatcher dedups upstream;
document this behavior in the route test.

## Acceptance criteria

- [ ] Legal transition: event row + job update + 200.
- [ ] `DONE` sets ticket column to Done.
- [ ] `AGENT_WAITING` sets needsPmAttention; leaving it clears.
- [ ] `DONE → MERGING` → 400 INVALID_STATE_TRANSITION with details.
- [ ] Unknown ticketId → 404; bad state string → 400; unsigned → 401;
      plain mode → 501.
- [ ] attempts bump on FAILED_*→QUEUED; over-cap → rejected/escalation.
- [ ] prNumber/sha persisted from detail when provided.
- [ ] Route tests co-located, table-driven over representative transitions
      (not all 225 — matrix lives in SLYK-0250 tests).

## References

- `docs/agentic-automation/05-backend-routes.md` § jobs/:ticketId/state
- `docs/agentic-automation/07-dispatcher-contract.md` § Retry semantics (idempotency)
- `docs/agentic-automation/11-existing-patterns.md` (route/service templates)

## Dependencies

- SLYK-0150 (internal router + HMAC)
- SLYK-0250 (transition validation core)
