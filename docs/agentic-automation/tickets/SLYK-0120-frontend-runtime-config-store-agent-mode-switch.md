# SLYK-0120 — Frontend runtime config store + `__AGENT_MODE__` build switch

**Phase:** Pre-Phase-0 refactor
**Type:** Refactor
**Depends on:** —

## Description

Frontend bundle-isolation groundwork so later phases can feature-gate every
agent component from one place. From `00-refactor-plan.md` Task 5.

1. **`frontend/src/stores/useRuntimeConfigStore.ts`** — Zustand store:

   ```ts
   interface RuntimeConfigState {
     agentMode: boolean;
     dispatcherUrl: string | null;
     set: (cfg: { agentMode: boolean; dispatcherUrl: string | null }) => void;
   }
   ```

   Defaults `{ agentMode: false, dispatcherUrl: null }`. Follows existing
   store conventions (`useAuthStore`, `useProjectStore`, `useBoardUiStore`).

2. **Build-time switch** — add to `frontend/vite.config.ts`:

   ```ts
   define: {
     __AGENT_MODE__: JSON.stringify(process.env.SLYKBOARD_AGENT_MODE === 'true'),
   }
   ```

   Declare `declare const __AGENT_MODE__: boolean;` in
   `frontend/src/vite-env.d.ts`. This lets `if (__AGENT_MODE__)` statically
   prune agent branches at build time.

3. **Route-array pattern** — restructure `frontend/src/routes/index.tsx` so
   agent routes (added in later phases) can be spread into the routes array
   conditionally on `__AGENT_MODE__` with `React.lazy(() => import(...))`
   chunks. No agent routes exist yet — this ticket only establishes the
   pattern + helper (e.g. an `agentRoutes` array that is currently empty and
   a spread site, so later tickets append to one file region).

4. Unit tests for the store (default state, `set`).

## Acceptance criteria

- [ ] `make typecheck` + `make lint` green; frontend tests green.
- [ ] `SLYKBOARD_AGENT_MODE=false npm run build` succeeds; no agent strings
      in `dist/` (trivially true today — pattern proven by an empty
      agent-routes array).
- [ ] `SLYKBOARD_AGENT_MODE=true npm run build` succeeds (no route changes
      yet — build must not break in either mode).
- [ ] Store unit tests pass.
- [ ] No existing route/behavior changed.

## References

- `docs/agentic-automation/00-refactor-plan.md` Task 5 (+ verification §7)
- `docs/agentic-automation/02-dual-mode.md` Layer 3
- `docs/agentic-automation/06-frontend-ui.md` Routing

## Dependencies

None.
