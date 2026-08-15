# SLYK-0110 — `/api/v1` mount points + stub agent middleware

**Phase:** Pre-Phase-0 refactor
**Type:** Refactor
**Depends on:** —

## Description

Add the `/api/v1/*` mount scaffolding and the two agent middleware stubs so
Phase 0 only has to fill in bodies, not invent file locations. From
`00-refactor-plan.md` Tasks 3–4.

1. **Mount block in `backend/src/index.ts`** — before the error sink:

   ```ts
   if (process.env.SLYKBOARD_AGENT_MODE === 'true') {
     // Phase 0 replaces these comments with real route mounts:
     // const { internalRouter } = await import('./routes/internal.routes');
     // const { adminAgentRouter } = await import('./routes/admin-agent.routes');
     // app.use('/api/v1/internal', requireAgentMode, agentTokenAuth, internalRouter);
     // app.use('/api/v1/admin', requireAgentMode, authenticate, requirePlatformAdmin(), adminAgentRouter);
   }
   ```

   Repo is Node 24 + `"type": "module"` — top-level `await` inside the
   dynamic-import pattern is fine. Dynamic `import()` keeps agent modules out
   of the plain-mode bundle. Do NOT rename any existing `/api/*` route — new
   mount is additive.

2. **`backend/src/middleware/requireAgentMode.ts`** — rejects with
   `AppError(ErrorCode.NOT_IMPLEMENTED, 'Agent mode is not enabled on this
   server')` when `SLYKBOARD_AGENT_MODE !== 'true'`, else `next()`. Follow
   the exact code in `00-refactor-plan.md` Task 4.

3. **`backend/src/middleware/agentTokenAuth.ts`** — stub that always throws
   `AppError(ErrorCode.UNAUTHENTICATED, 'Agent token auth not implemented')`
   with a `TODO(Phase 0)` pointing at `03-security.md`. Real HMAC
   verification lands in SLYK-0150.

4. **Add `NOT_IMPLEMENTED` to the `ErrorCode` enum** in
   `backend/src/utils/envelope.ts` if absent (map to HTTP 501).

5. Unit tests for `requireAgentMode` behavior in both modes (env-driven).

## Acceptance criteria

- [ ] Plain mode boot: `/api/health` 200; any `/api/v1/internal/*` path →
      404 (nothing mounted).
- [ ] Agent mode boot: `/api/health` 200; `/api/v1/internal/*` → 404 still
      (mount block is comment-only until Phase 0) — the point of this ticket
      is the middleware files + enum + guarded mount block existing.
- [ ] `requireAgentMode` unit tests pass for both env values.
- [ ] `agentTokenAuth` stub throws the documented AppError.
- [ ] Existing routes untouched; full test suite green.

## References

- `docs/agentic-automation/00-refactor-plan.md` Tasks 3–4 (+ verification §3–4)
- `docs/agentic-automation/02-dual-mode.md` Layer 2
- `docs/agentic-automation/03-security.md` (auth direction diagrams)

## Dependencies

None.
