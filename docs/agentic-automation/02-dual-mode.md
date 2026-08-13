# 02 — Dual-Mode Architecture (Plain vs Agent)

## Master switch

```bash
# .env
SLYKBOARD_AGENT_MODE=false              # default; plain kanban
SLYKBOARD_AGENT_MODE=true               # unlocks agentic features
```

Boolean env var, read at boot. All agentic code paths check this
before executing. Plain mode = zero agent code in hot path.

## Three layers that respect the flag

### Layer 1 — Schema (conditional migrations)

Drizzle migration runner (`backend/src/db/migrate.ts`) is updated to
run two schema sets:

```ts
// backend/src/db/migrate.ts (paraphrased)
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import { client } from './client';

const db = drizzle(client);

export async function migrate() {
  // Always run core schema (users, projects, tickets, comments, etc.)
  await drizzleMigrate(db, { migrationsFolder: './src/db/migrations/core' });

  if (process.env.SLYKBOARD_AGENT_MODE === 'true') {
    await drizzleMigrate(db, { migrationsFolder: './src/db/migrations/agent' });
  }
}
```

Migration folders split:

```
backend/src/db/migrations/
  core/                          # always runs (existing + future plain kanban migrations)
  agent/                         # only runs when SLYKBOARD_AGENT_MODE=true
```

Plain-mode installs end up with a clean kanban schema dump. Agent-mode
installs get the full schema (core + agent).

### Layer 2 — Routes (middleware short-circuit)

Every agentic route mounts under `/api/v1/internal/*` (dispatcher
callbacks) or `/api/v1/admin/*` (admin UI actions like onboarding).
Both mount points sit behind middleware:

```ts
// backend/src/middleware/agentMode.ts
import type { RequestHandler } from 'express';

export const requireAgentMode: RequestHandler = (req, res, next) => {
  if (process.env.SLYKBOARD_AGENT_MODE !== 'true') {
    return res.status(501).json({ error: 'Agent mode disabled' });
  }
  next();
};

// backend/src/index.ts (route mounting)
app.use('/api/v1/internal', requireAgentMode, agentTokenAuth, internalRoutes);
app.use('/api/v1/admin', requireAgentMode, requirePlatformAdmin, adminRoutes);
```

`agentTokenAuth` verifies the HMAC token from dispatcher (see
`07-dispatcher-contract.md`). `requirePlatformAdmin` checks
`users.is_platform_admin = true` on the authenticated session.

Plain mode: any HTTP verb to `/api/v1/internal/*` or `/api/v1/admin/*`
returns `501 Disabled` before reaching route handlers. Tree-shaking +
the env check guarantee no agent code paths execute.

### Layer 3 — Frontend (config-gated components)

Backend emits a runtime config the frontend reads on boot:

```ts
// backend/src/config/runtime.ts
export const runtimeConfig = {
  agentMode: process.env.SLYKBOARD_AGENT_MODE === 'true',
  dispatcherUrl: process.env.SLYKBOARD_DISPATCHER_URL ?? null,
};
```

```ts
// backend/src/routes/auth.ts (existing route, add to /me response)
router.get('/me', authenticate, (req, res) => {
  res.json({
    user: req.user,
    config: runtimeConfig,   // ← frontend reads window state from this
  });
});
```

Frontend stores it in a Zustand store:

```ts
// frontend/src/stores/runtimeConfig.ts
interface RuntimeConfig { agentMode: boolean; dispatcherUrl: string | null }
export const useRuntimeConfig = create<RuntimeConfig>(() => ({
  agentMode: false,
  dispatcherUrl: null,
}));
// AuthProvider calls /me, populates this store from response.config.
```

Components + routes feature-gate on `useRuntimeConfig(s => s.agentMode)`:

```tsx
// frontend/src/components/Navbar.tsx (paraphrased)
const agentMode = useRuntimeConfig(s => s.agentMode);
return (
  <nav>
    <NavLink to="/boards">Boards</NavLink>
    {agentMode && <NavLink to="/admin/onboarding">Add Project</NavLink>}
  </nav>
);
```

Plain mode: zero agentic components imported, zero agentic routes in
the router. Bundle stays smaller. No greyed-out UI — features are
**absent**, not disabled.

## Plain-mode contract

A plain-mode install must:

1. Boot successfully with only core env vars (no `SLYKBOARD_DISPATCHER_URL`,
   no `SLYKBOARD_DISPATCHER_TOKEN`).
2. Have a DB with only core tables (verify with `\dt` in psql).
3. Show zero agentic UI — no Pipeline tab on tickets, no Add Project
   button, no chat panel.
4. Reject every `/api/v1/internal/*` + `/api/v1/admin/*` call with `501`.

OSS self-host community clones the repo and runs `docker compose up`
without setting `SLYKBOARD_AGENT_MODE`. Everything just works as a
Jira-like kanban.

## Agent-mode contract

An agent-mode install must:

1. Set `SLYKBOARD_AGENT_MODE=true`.
2. Set `SLYKBOARD_DISPATCHER_URL` (e.g. `https://dispatcher.kmlab.dev`).
3. Set `SLYKBOARD_DISPATCHER_TOKEN` (HMAC shared secret — copy from
   dispatcher env at install time).
4. Run both core + agent migrations automatically on boot.
5. Expose all internal + admin endpoints (still behind HMAC + admin
   auth).

## Switching modes after install

| Direction | Required steps |
|---|---|
| Plain → Agent | Set env vars, restart container. **Agent migrations run automatically** on next boot. Existing core data untouched. |
| Agent → Plain | Set `SLYKBOARD_AGENT_MODE=false`, restart. Agent tables remain in DB (orphaned but harmless). To remove: drop the agent schema manually. **No automatic teardown** — preserves audit data if you flip back. |

## What about feature flags within agent mode?

Phase 6+ may add per-project flags (e.g. disable chat for one project,
disable auto-merge for another). Not in v1. v1 is binary: agent mode
on or off, applied to all projects uniformly.

Per-project overrides like `projects.agent_backend` (which agent
handles the project — see `04-schema.md`) are independent of mode.
Even in agent mode, a project's `agent_backend` may be null (use
global default) or a specific backend name.

## Anti-patterns to avoid

- **Don't** check `SLYKBOARD_AGENT_MODE` inside component render bodies
  scattered across the codebase. Centralize in `useRuntimeConfig`.
- **Don't** import agent code (services, types, components) from plain-
  mode entry points. Use dynamic imports if absolutely necessary; the
  build should not pull agent code into the plain bundle.
- **Don't** add agent columns to plain tables (e.g. don't add
  `pipeline_state` to the existing `Tickets` table). Use a separate
  `PipelineJobs` table that joins on `ticket_id`. This keeps plain
  tables clean and the agent migration self-contained.
- **Don't** run agent migrations unconditionally to "keep things
  simple". The conditional runner is load-bearing for the OSS
  contract.
