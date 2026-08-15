# SLYK-0250 — Pipeline state machine + transition matrix

**Phase:** 1 — Pipeline State + SSE
**Type:** Feature (backend)
**Depends on:** SLYK-0140

## Description

Encode the legal-transition matrix from `05-backend-routes.md` as a pure,
unit-testable module — the validation core every state write goes through.

**Files:** `backend/src/services/pipelineStateService.ts` +
`pipelineStateService.test.ts`.

1. **`LEGAL_TRANSITIONS: Set<string>`** of `"${from}->${to}"` — encode the
   full matrix from `05-backend-routes.md` exactly:

   - BACKLOG → QUEUED
   - QUEUED → AGENT_RUNNING, FAILED_AGENT
   - AGENT_RUNNING → AGENT_WAITING, PR_OPEN, FAILED_AGENT
   - AGENT_WAITING → AGENT_RUNNING, FAILED_AGENT
   - PR_OPEN → CI_RUNNING
   - CI_RUNNING → MERGING, FAILED_CI
   - MERGING → CONFLICT_RETRY, DONE
   - CONFLICT_RETRY → MERGING, FAILED_CONFLICT
   - DEPLOYING → DONE, FAILED_DEPLOY
   - FAILED_AGENT / FAILED_CI / FAILED_CONFLICT / FAILED_DEPLOY → QUEUED,
     BLOCKED_HUMAN
   - BLOCKED_HUMAN → QUEUED
   - DONE → (nothing — terminal)
   - Everything else illegal.

2. **`isLegalTransition(from, to): boolean`** +
   **`assertLegalTransition(from, to)`** throwing
   `AppError(VALIDATION_FAILED)`-style error the route layer maps to `400
   INVALID_STATE_TRANSITION` with `details: {from, to}`.

3. **Retry-cap helper** — `exceedsRetryCap(attempts, cap = 3)`: FAILED_* →
   QUEUED allowed only while attempts < cap; at/over cap the only legal exit
   is BLOCKED_HUMAN. Enforced in the transition helper so SLYK-0260's route
   gets it for free.

4. **Tests — every cell of the 15×15 matrix** (225 asserts via table or
   loop): legal cells pass, illegal cells throw with correct details. Plus
   retry-cap boundaries (attempts 2/3/4 × transitions to QUEUED vs
   BLOCKED_HUMAN).

## Acceptance criteria

- [ ] 100% matrix coverage test passes (assert count = 225 or equivalent
      exhaustive loop).
- [ ] Terminal DONE rejects everything.
- [ ] Retry-cap logic tested at boundaries.
- [ ] Pure module — no DB, no HTTP; importable by route + service layers.

## References

- `docs/agentic-automation/05-backend-routes.md` § Pipeline state
  transitions (authoritative matrix + invariants)
- `docs/agentic-automation/09-implementation-phases.md` Phase 1 (DONE→
  MERGING must 400)

## Dependencies

- SLYK-0140 (pipelineStateEnum exists to type against)
