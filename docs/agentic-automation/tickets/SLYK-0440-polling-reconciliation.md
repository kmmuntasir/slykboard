# SLYK-0440 — 60s polling reconciliation fallback

**Phase:** 5 — Polish + Admin Tools
**Type:** Feature (backend)
**Depends on:** SLYK-0290, SLYK-0180

## Description

Missed-webhook safety net from `07-dispatcher-contract.md` failure table:
"Slykboard polling fallback — every 60s, query dispatcher
`GET /jobs/:ticketId/state` for any ticket in a non-terminal state,
reconcile."

1. **`dispatcherClient` extension** — `getFromDispatcher(path)` GET with
   the same auth approach (sign empty-string body or use a token header —
   check the dispatcher contract; `07` defines only POST shapes, so
   define: GET carries `X-Slykboard-Signature: HMAC(token, "")` +
   document the deviation for the dispatcher repo).
2. **Reconciler** — `backend/src/services/pipelineReconciler.ts`:
   `setInterval` (60s, env-tunable) selecting `PipelineJobs` rows in
   non-terminal states (`DONE`, `FAILED_*`, `BLOCKED_HUMAN` excluded —
   they're terminal per matrix; reconcile BACKLOG→DEPLOYING range),
   fetching dispatcher truth, applying drifted state via the SLYK-0260
   transition service (illegal-transition errors logged + skipped —
   dispatcher is source of truth but matrix still applies).
   Started only in agent mode (`index.ts` boot, after migrations);
   unref'd interval; graceful shutdown clear.
3. **Conflict rule** — if dispatcher state == local: no-op. If dispatcher
   ahead: apply. If dispatcher behind (stale): trust local, log.
4. **Tests** — fake timers: interval fires; drift applied via service;
   terminal rows skipped; HTTP failure doesn't kill the loop.

## Acceptance criteria

- [ ] Reconciler runs every 60s in agent mode, not at all in plain mode.
- [ ] Drifted state converges to dispatcher truth through the legal-
      transition path.
- [ ] Terminal-state tickets excluded from polling.
- [ ] Dispatcher error → logged, loop continues.
- [ ] No duplicate PipelineEvents when states already agree.

## References

- `docs/agentic-automation/07-dispatcher-contract.md` § Failure scenarios
  (polling fallback)
- `docs/agentic-automation/09-implementation-phases.md` Phase 5 (front/
  backend polling reconciliation task)

## Dependencies

- SLYK-0290 (job lifecycle exists)
- SLYK-0180 (dispatcherClient to extend)
