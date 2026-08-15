# SLYK-0160 — Health/`me` runtime config + `SCHEMA_VERSION` + store population

**Phase:** 0 — Foundations
**Type:** Feature (backend + frontend)
**Depends on:** SLYK-0110, SLYK-0120

## Description

Surface agent-mode runtime config to the frontend and version the dispatcher
contract.

1. **`backend/src/config/version.ts`** — `export const SCHEMA_VERSION = 1;`

2. **`/api/health`** — extend the existing response with
   `{ agentMode: <bool>, schemaVersion: SCHEMA_VERSION }` per
   `07-dispatcher-contract.md` § Versioning. Keep every existing field.

3. **`backend/src/config/runtime.ts`** — `runtimeConfig = { agentMode,
   dispatcherUrl }` derived from env (see `02-dual-mode.md` Layer 3).

4. **Runtime config delivery** — add `config: runtimeConfig` to the existing
   authenticated user-info endpoint response (`/api/.../me` — locate the
   actual existing route; `02-dual-mode.md` shows the pattern of adding
   `config` to the `/me` response). Frontend decides agent mode from this at
   runtime; `__AGENT_MODE__` (SLYK-0120) is the build-time counterpart.

5. **Frontend population** — in the auth bootstrap path
   (`useAuthSync`/`AuthProvider` area), call the endpoint and
   `useRuntimeConfigStore.getState().set(config)` on login/refresh. Store
   defaults keep plain mode safe when never populated.

6. **Tests** — health returns both new fields in both modes; `/me` includes
   config only when authenticated; store `set` integration (mock the API
   response, assert store state).

## Acceptance criteria

- [ ] `/api/health` in plain mode: `agentMode: false, schemaVersion: 1`.
- [ ] `/api/health` in agent mode: `agentMode: true, schemaVersion: 1`.
- [ ] Authenticated `/me`-equivalent response carries `config.agentMode ===
      true` in agent mode.
- [ ] Frontend: after login in agent mode, `useRuntimeConfigStore` reports
      `agentMode === true` (component or hook test).
- [ ] Frontend plain mode: store stays `{false, null}`.
- [ ] No regression in existing auth tests.

## References

- `docs/agentic-automation/09-implementation-phases.md` Phase 0 tasks
- `docs/agentic-automation/02-dual-mode.md` Layer 3
- `docs/agentic-automation/07-dispatcher-contract.md` § Versioning
- `docs/agentic-automation/11-existing-patterns.md` § `/api/health` schemaVersion

## Dependencies

- SLYK-0110 (mount scaffolding; NOT_IMPLEMENTED available)
- SLYK-0120 (`useRuntimeConfigStore` exists)
