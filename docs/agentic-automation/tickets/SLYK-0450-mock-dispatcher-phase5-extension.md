# SLYK-0450 — Mock dispatcher: latency profiles + failure injection polish

**Phase:** 5 — Polish + Admin Tools
**Type:** Tooling
**Depends on:** SLYK-0360, SLYK-0410

## Description

Phase 5 slice of the mock per `10-mock-dispatcher.md` Implementation
order: rate-limit simulation, 500 injection, latency profiles.

1. **Failure injection** — complete the SLYK-0220 stub:
   `/admin/next-status?path=<path>&status=<code>` marks the next call to
   that path to return the injected status (500 default). Drive smoke:
   onboard with injected 500 → slykboard retries 3× → meta FAILED +
   admin sees error.
2. **Latency profiles** — `--latency=<profile>` flag: `fast` (0ms),
   `slow` (2s/call), `flaky` (30% 500s). Used to exercise SSE
   reconnect + delivered:false UI states.
3. **Rate-limit simulation** — mock can also return 429 on demand
   (`/admin/next-status?...&status=429`) so slykboard's own limiter +
   retry interplay is observable end-to-end.
4. **README** — final usage matrix: scenario × phase smoke test mapping
   (which scenario proves which Phase 0.5/1/2/5 acceptance item).
5. **E2E guards** — Vitest: injected 500 on `/onboard` → retries counted
   exactly 3 → FAILED state asserted; flaky profile replay against
   ticket_created → eventual DONE or BLOCKED consistent with retry cap.

## Acceptance criteria

- [ ] `next-status` injection works per-path; one-shot (next call only).
- [ ] Onboard 500-injection smoke: 3 retries then FAILED, per
      `10-mock-dispatcher.md` failure-injection example.
- [ ] Latency profiles loadable; flaky run converges legally.
- [ ] README matrix covers every phase's smoke items.
- [ ] No regressions in scenarios happy-path/agent-waiting/failed-ci-
      retry/blocked-human/decommission.

## References

- `docs/agentic-automation/10-mock-dispatcher.md` § Failure injection +
  Implementation order (Phase 5)
- `docs/agentic-automation/09-implementation-phases.md` Phase 5 smoke tests

## Dependencies

- SLYK-0360 (full scenario engine)
- SLYK-0410 (rate limiting exists to interplay with)
