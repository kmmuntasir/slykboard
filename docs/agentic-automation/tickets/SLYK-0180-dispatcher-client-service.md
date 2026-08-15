# SLYK-0180 — `dispatcherClient` service: HMAC signing, retry, logging

**Phase:** 0.5 — Onboarding MVP
**Type:** Feature (backend)
**Depends on:** SLYK-0130, SLYK-0170

## Description

`backend/src/services/dispatcherClient.ts` — slykboard's only outbound path
to the dispatcher, per `07-dispatcher-contract.md`.

1. **`postToDispatcher<T>(path, body)`** — serialize body once to the exact
   raw bytes, sign `createHmac('sha256', SLYKBOARD_DISPATCHER_TOKEN)
   .update(raw).digest('hex')`, POST with `Content-Type: application/json`
   + `X-Slykboard-Signature`. Sign the exact raw bytes — never re-serialize
   (key-order differences break signatures). `204` → undefined; else parse
   JSON. Non-2xx → throw `DispatcherError(path, status, detail)`.

2. **`DispatcherError`** class as specified.

3. **Retry semantics** — on 5xx/network error retry 3× with exponential
   backoff 1s/5s/30s; on 4xx never retry; every outbound payload includes
   `idempotencyKey` (uuid v4) so retries are safe on the dispatcher side.

4. **Observability** — pino log per call: direction, path, method, status,
   durationMs, ticketId/traceId when known. Never log the token or full
   bodies (truncate PM text >200 chars per `03-security.md` Logging).

5. **Tests** (`backend/src/services/dispatcherClient.test.ts`) using
   supertest-style local server or the mock skeleton on a random port:
   - signs correctly (mock verifies + 202);
   - retries on 500 then succeeds (count attempts);
   - gives up after 3 retries, throws DispatcherError;
   - does NOT retry on 400;
   - `204` handling;
   - idempotencyKey present in payload.

## Acceptance criteria

- [ ] All test cases above pass against a real HTTP listener.
- [ ] Backoff timings configurable via constants (test mode can shrink
      them — no real 30s waits in CI; inject or env-scale).
- [ ] Logs include the documented fields, exclude secrets.
- [ ] Used-by-later-tickets export surface stable: `postToDispatcher`,
      `DispatcherError`.

## References

- `docs/agentic-automation/07-dispatcher-contract.md` (full contract, retry §, observability §)
- `docs/agentic-automation/03-security.md` (outbound signing, logging rules)
- `docs/agentic-automation/11-existing-patterns.md` (service template)

## Dependencies

- SLYK-0130 (env vars validated)
- SLYK-0170 (mock skeleton to test against)
