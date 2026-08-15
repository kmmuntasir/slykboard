# SLYK-0150 — Real HMAC `agentTokenAuth`, raw-body capture, stub routers

**Phase:** 0 — Foundations
**Type:** Feature (backend)
**Depends on:** SLYK-0110, SLYK-0130

## Description

Replace the `agentTokenAuth` stub with real HMAC verification, wire raw-body
capture, and mount the internal + admin routers as stubs.

1. **`agentTokenAuth` middleware** (`backend/src/middleware/agentTokenAuth.ts`)
   — verify `X-Dispatcher-Signature` header: hex HMAC-SHA256 of the request's
   raw bytes, key `SLYKBOARD_DISPATCHER_TOKEN`, constant-time compare
   (`timingSafeEqual` with length check). Missing/invalid →
   `AppError(UNAUTHENTICATED)` per the code in `03-security.md`. Throw
   `500 INTERNAL_ERROR` (not 401) if agent mode is on but the token env is
   somehow unset — config validation should have caught it.

2. **Raw-body capture** — mount `express.json({ verify: (req, _res, buf) =>
   { req.rawBody = buf; }, type: 'application/json' })` on the
   `/api/v1/internal` path in `index.ts` BEFORE `agentTokenAuth`, per
   `07-dispatcher-contract.md`. The global `express.json()` must not double-
   parse — scope the verify-configured parser to the internal path.

3. **Stub routers**:
   - `backend/src/routes/internal.routes.ts` — mounts the four internal
     paths (jobs/:ticketId/state, jobs/:ticketId/messages,
     projects/:slug/deploy-target, projects/:slug/onboarding/events) as
     handlers returning `501 NOT_IMPLEMENTED` "not implemented until Phase
     X". Real logic in SLYK-0200/0260/0320.
   - `backend/src/routes/admin-agent.routes.ts` — mounts admin paths
     (projects, projects/:slug/decommission, agent-tokens) as the same kind
     of stubs.
   - Sibling `*.schema.ts` files can be created empty now or with the
     route-shape placeholders; convention established.

4. **Mount in `index.ts`** — uncomment/replace the SLYK-0110 comment block:

   ```ts
   if (process.env.SLYKBOARD_AGENT_MODE === 'true') {
     const { internalRouter } = await import('./routes/internal.routes');
     const { adminAgentRouter } = await import('./routes/admin-agent.routes');
     app.use('/api/v1/internal', requireAgentMode, agentTokenAuth, internalRouter);
     app.use('/api/v1/admin', requireAgentMode, authenticate, requirePlatformAdmin(), adminAgentRouter);
   }
   ```

   Note `requirePlatformAdmin()` invoked as factory.

5. **Test helper** `backend/src/test/hmac.ts` — `signPayload()` +
   `dispatcherHeaders()` per `11-existing-patterns.md`.

6. **Tests** — supertest against the app:
   - unsigned request to `/api/v1/internal/*` in agent mode → 401;
   - wrong-signature → 401;
   - valid signature → passes auth, hits the stub → 501;
   - plain mode → 501 from `requireAgentMode`;
   - tampered body after signing → 401 (proves raw-body capture works).

## Acceptance criteria

- [ ] All supertest cases above pass.
- [ ] Agent mode: `/api/v1/internal/jobs/x/state` with valid HMAC → 501
      stub body; without signature → 401 envelope.
- [ ] Plain mode: same path → 501 "Agent mode is not enabled".
- [ ] Admin path requires authenticate + platform admin (401 unauth'd, 403
      non-admin, stub 501 for admin).
- [ ] Signature verification is over raw bytes — test with non-ASCII body.

## References

- `docs/agentic-automation/03-security.md` (agentTokenAuth + raw body)
- `docs/agentic-automation/07-dispatcher-contract.md` Auth §
- `docs/agentic-automation/11-existing-patterns.md` (middleware table, hmac test helper)

## Dependencies

- SLYK-0110 (mount block, stub files, NOT_IMPLEMENTED enum)
- SLYK-0130 (env validation guarantees token present in agent mode)
