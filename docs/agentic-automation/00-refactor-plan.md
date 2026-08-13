# 00 — Refactor Plan (Pre-Phase 0)

> **Read this before any work in `01`–`09`.** The agentic-automation
> docs were written against an *idealized* slykboard layout. The actual
> repo does not match it in several structural ways. This doc reconciles
> the gap by **refactoring the repo to match the docs**, not the other
> way around (path B from the audit — better long-term, bounded one-time
> cost).
>
> **Status: must be completed end-to-end before Phase 0 starts.**
> Estimated effort: ~1 day of focused work.

## Why refactor, not paper over

The docs describe a hard architectural boundary between **plain mode**
(OSS kanban, no agent code) and **agent mode** (opt-in agentic layer).
Three structural features enforce that boundary:

1. **Schema split** — core tables vs agent tables in separate files with
   separate migration folders.
2. **Conditional migrations** — core always runs; agent only when
   `SLYKBOARD_AGENT_MODE=true`.
3. **Bundle isolation** — plain-mode ships zero agent code in the
   frontend bundle.

Each feature relies on a structural property of the repo that the
current layout doesn't have. Patching the docs to match reality would
mean abandoning all three guarantees; patching the repo to match the
docs preserves them.

## Current state (verified 2026-08-13)

| Aspect | Current | Target (post-refactor) |
|---|---|---|
| Schema file | `backend/src/db/schema.ts` (single, 330 lines) | `backend/src/db/schema/core.ts` + `backend/src/db/schema/agent.ts` + `backend/src/db/schema/index.ts` |
| Migrations dir | `backend/src/db/migrations/` (single) | `backend/src/db/migrations/core/` + `backend/src/db/migrations/agent/` |
| Drizzle config | `backend/drizzle.config.ts` (single schema path) | `backend/drizzle.config.ts` (parametrized via env) or split into two configs |
| Migration runner | `drizzle-kit migrate` via npm script; also `runMigrations()` in `index.ts` calls `drizzle-orm/node-postgres/migrator` with one folder | Custom runner that applies core always + agent conditionally |
| Controllers dir | Empty `backend/src/controllers/.gitkeep` (unused — repo is routes-as-controllers) | Same (no change — README + `05` need to acknowledge this) |
| Frontend store prefix | `use*Store` (`useAuthStore`, `useBoardUiStore`, `useProjectStore`) | `use*Store` (docs say `runtimeConfig.ts` — rename to `useRuntimeConfigStore.ts`) |
| API base path | `/api/*` (no `/v1`) | Add `/api/v1/*` for new routes; keep existing `/api/*` mounting untouched (avoid breaking existing clients) |

## Tasks

### Task 1 — Split schema file

Move the contents of `backend/src/db/schema.ts` into three files.

**New file: `backend/src/db/schema/core.ts`**

Move ALL existing table/enum/interface definitions verbatim:
- `START_TICKET_NUMBER` constant
- `users` table
- `Column`, `ChecklistItem` interfaces
- `projects` table
- `projectMemberRoleEnum`
- `projectMembers` table
- `projectSequences` table
- `priorityEnum`
- `tickets` table
- `labels` table
- `ticketLabels` table
- `activityActionEnum`
- `activityLogs` table
- `timeEntries` table
- `comments` table
- `CommentRow` type

Imports stay the same (all from `drizzle-orm` + `drizzle-orm/pg-core`). No code changes within these definitions — pure move.

**New file: `backend/src/db/schema/agent.ts`**

Created empty for now (Phase 0 fills it from `04-schema.md`). Just a
placeholder header comment:

```ts
// Agent-mode schema. Exported only when SLYKBOARD_AGENT_MODE=true
// (see schema/index.ts). Populated in Phase 0 per
// docs/agentic-automation/04-schema.md.
export {};
```

**New file: `backend/src/db/schema/index.ts`**

```ts
// Always re-export core.
export * from './core';

// Re-export agent schema unconditionally. Type definitions and Drizzle
// table objects are inert (no side effects at import). Migration
// gating (02-dual-mode.md Layer 1) + route gating (Layer 2) + frontend
// gating (Layer 3) keep plain mode clean. Bundle analysis verifies.
export * from './agent';
```

The Drizzle table objects are *declarations* — importing them does not
create the tables. Tables only exist after their migration runs. So
re-exporting agent schema in plain mode is harmless at runtime; the
tables simply don't exist in the DB.

**Update `backend/drizzle.config.ts`:**

Two configs (drizzle-kit doesn't accept multiple schemas in one config):

- `backend/drizzle.config.ts` — keeps the existing config for backward
  compatibility (defaults to core). Set `schema: './src/db/schema/core.ts'`
  + `out: './src/db/migrations/core'`.
- `backend/drizzle.config.agent.ts` — new file:
  `schema: './src/db/schema/agent.ts'` + `out: './src/db/migrations/agent'`.

**Update `backend/package.json` scripts:**

```json
{
  "db:generate:core": "drizzle-kit generate --config=drizzle.config.ts",
  "db:generate:agent": "drizzle-kit generate --config=drizzle.config.agent.ts",
  "db:generate": "npm run db:generate:core && npm run db:generate:agent",
  "db:migrate": "tsx src/db/migrate.ts",
  "db:push:core": "drizzle-kit push --config=drizzle.config.ts",
  "db:push:agent": "drizzle-kit push --config=drizzle.config.agent.ts",
  "db:studio:core": "drizzle-kit studio --config=drizzle.config.ts",
  "db:studio:agent": "drizzle-kit studio --config=drizzle.config.agent.ts",
  "db:seed": "tsx src/db/seed.ts"
}
```

`db:migrate` is now a custom runner (Task 2), not `drizzle-kit migrate`.

### Task 2 — Move existing migrations + write custom runner

**Step 1: Move existing migration files**

```bash
cd backend/src/db
mkdir -p migrations/core migrations/agent
git mv migrations/0000_dear_mattie_franklin.sql migrations/core/
git mv migrations/0001_nebulous_invaders.sql migrations/core/
git mv migrations/0002_windy_thunderbolts.sql migrations/core/
git mv migrations/meta migrations/core/meta
touch migrations/agent/.gitkeep
```

The `_journal.json` inside `meta/` tracks applied migrations. Moving
the whole `meta/` dir preserves the journal. New core migrations
generated by `db:generate:core` will append to this journal.

For agent migrations, drizzle-kit generates a fresh journal inside
`migrations/agent/meta/` on first `db:generate:agent` run. Phase 0
does that.

**Step 2: Custom migration runner**

Replace `backend/src/db/migrate.ts`:

```ts
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT_MODE = process.env.SLYKBOARD_AGENT_MODE === 'true';
const here = path.dirname(fileURLToPath(import.meta.url));

async function run(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL required');

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  try {
    // Core always runs.
    await migrate(db, {
      migrationsFolder: path.join(here, 'migrations', 'core'),
    });
    console.info('[migrate] core migrations applied');

    // Agent only in agent mode.
    if (AGENT_MODE) {
      await migrate(db, {
        migrationsFolder: path.join(here, 'migrations', 'agent'),
      });
      console.info('[migrate] agent migrations applied');
    } else {
      console.info('[migrate] agent mode off — skipping agent migrations');
    }
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
```

**Step 3: Update `runMigrations()` in `backend/src/index.ts`**

The boot-time migration runner in `index.ts` (lines 95-110) also needs
the conditional. Replace the `runMigrations` function with:

```ts
async function runMigrations(): Promise<void> {
  const coreFolder =
    process.env.CORE_MIGRATIONS_FOLDER?.trim() ||
    fileURLToPath(new URL('./db/migrations/core', import.meta.url));

  const migrationPool = new Pool({ connectionString: env.directDatabaseUrl });
  const migrationDb = drizzle(migrationPool);

  logger.info({ coreFolder }, '[slykboard-backend] running core migrations');
  try {
    await migrate(migrationDb, { migrationsFolder: coreFolder });

    if (process.env.SLYKBOARD_AGENT_MODE === 'true') {
      const agentFolder =
        process.env.AGENT_MIGRATIONS_FOLDER?.trim() ||
        fileURLToPath(new URL('./db/migrations/agent', import.meta.url));
      logger.info({ agentFolder }, '[slykboard-backend] running agent migrations');
      await migrate(migrationDb, { migrationsFolder: agentFolder });
    }

    logger.info('[slykboard-backend] migrations applied');
  } finally {
    await migrationPool.end();
  }
}
```

The `MIGRATIONS_FOLDER` env var (line 96-98 of current `index.ts`) is
now `CORE_MIGRATIONS_FOLDER` + `AGENT_MIGRATIONS_FOLDER`. Preserve old
var name as a deprecated alias if any operator relies on it; otherwise
just rename.

**Step 4: Update `backend/src/db/migrate.ts` references**

Anything that imported `migrate.ts` for the runner — none found in
audit, but verify with `grep -R 'db/migrate' backend/src`. The
boot-time path in `index.ts` (above) handles it.

### Task 3 — Add API v1 mount point

Docs use `/api/v1/*` for new agent routes. Current codebase uses
`/api/*` without version. **Do NOT rename existing routes** — that
breaks the frontend. Add new mount point alongside.

**Edit `backend/src/index.ts`** (insert before error sink):

```ts
// --- Agent-mode routes (mounted only when SLYKBOARD_AGENT_MODE=true) ---
// See docs/agentic-automation/02-dual-mode.md Layer 2.
if (process.env.SLYKBOARD_AGENT_MODE === 'true') {
  // Dynamic import keeps these modules out of the plain-mode bundle.
  // Phase 0 fills in internalRouter / adminRouter / agentChatRouter.
  // For now, they don't exist — this block stays commented until Phase 0.
  //
  // const { internalRouter } = await import('./routes/internal.routes');
  // const { adminAgentRouter } = await import('./routes/admin-agent.routes');
  // app.use('/api/v1/internal', requireAgentMode, agentTokenAuth, internalRouter);
  // app.use('/api/v1/admin', requireAgentMode, requirePlatformAdmin(), adminAgentRouter);
}
```

Wait — top-level `await` in an Express handler file requires ESM + Node 18+.
Repo is on Node 24 + type: module. OK.

But top-level `if` + dynamic `import()` inside an `if` is fine. Just
guard every route mount with the env check. Phase 0 will replace the
comment block with real route mounts.

### Task 4 — Create stub middleware files

Two new middleware files Phase 0 will fill. Create them empty now so
Phase 0 doesn't have to invent file locations.

**`backend/src/middleware/requireAgentMode.ts`:**

```ts
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// Agent-mode gate. Mount as the first middleware on any /api/v1/*
// agent route. Rejects with 501 when SLYKBOARD_AGENT_MODE != 'true'.
export function requireAgentMode(_req: Request, _res: Response, next: NextFunction): void {
  if (process.env.SLYKBOARD_AGENT_MODE !== 'true') {
    throw new AppError(ErrorCode.NOT_IMPLEMENTED, 'Agent mode is not enabled on this server');
  }
  next();
}
```

Add `NOT_IMPLEMENTED` to `ErrorCode` enum in `backend/src/utils/envelope.ts`
if it doesn't exist.

**`backend/src/middleware/agentTokenAuth.ts`:**

Phase 0 fills the HMAC verification. For refactor phase, leave a stub:

```ts
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// HMAC signature verification for dispatcher→slykboard requests.
// Phase 0 fills in real verification per docs/agentic-automation/03-security.md.
export function agentTokenAuth(_req: Request, _res: Response, next: NextFunction): void {
  // TODO(Phase 0): real HMAC verification.
  throw new AppError(ErrorCode.UNAUTHENTICATED, 'Agent token auth not implemented');
}
```

### Task 5 — Frontend bundle isolation

The docs claim Vite tree-shakes agent components in plain mode. That's
wrong if `App.tsx` statically imports them. Fix: dynamic `import()`
gated on `useRuntimeConfigStore`.

**New file: `frontend/src/stores/useRuntimeConfigStore.ts`:**

```ts
import { create } from 'zustand';

interface RuntimeConfigState {
  agentMode: boolean;
  dispatcherUrl: string | null;
  set: (cfg: { agentMode: boolean; dispatcherUrl: string | null }) => void;
}

export const useRuntimeConfigStore = create<RuntimeConfigState>((set) => ({
  agentMode: false,
  dispatcherUrl: null,
  set: (cfg) => set(cfg),
}));
```

Populated from `/api/health` or a new `/api/v1/me` field — exact
source decided in Phase 0. Default false + null.

**New file: `frontend/src/types/runtime-config.d.ts`:**

Vite injects runtime config at build time. Add to `vite.config.ts`:

```ts
// In defineConfig:
define: {
  __AGENT_MODE__: JSON.stringify(process.env.SLYKBOARD_AGENT_MODE === 'true'),
}
```

Then in `frontend/src/vite-env.d.ts`:

```ts
declare const __AGENT_MODE__: boolean;
```

This lets the build-time check (`if (__AGENT_MODE__)`) statically prune
agent branches.

**Routing pattern (applied in Phase 0, documented here for reference):**

```tsx
// frontend/src/App.tsx
// Agent routes use React.lazy + dynamic import(). Vite splits each into
// its own chunk. In plain mode (build with SLYKBOARD_AGENT_MODE=false),
// the import never resolves — agent chunks are uploaded as part of the
// dist/ tree but never loaded by the browser. To actually exclude them
// from the bundle entirely, use the conditional export pattern:
//
// if (__AGENT_MODE__) {
//   const OnboardingPage = React.lazy(() => import('./pages/OnboardingPage'));
// }
//
// Or simpler: a build-time switch in vite.config.ts that excludes
// agent pages from the routes array entirely.

const agentMode = __AGENT_MODE__;
const routes = [
  // ...core routes always
  ...(agentMode
    ? [
        { path: '/admin/onboarding', element: React.lazy(() => import('./pages/OnboardingPage')) },
        // ...etc
      ]
    : []),
];
```

**Bundle verification (acceptance criterion):**

```bash
# Build plain mode
SLYKBOARD_AGENT_MODE=false npm run build
ls frontend/dist/assets/
# Verify: no chunk file contains 'PipelinePanel', 'AgentChatPanel', etc.
grep -l 'PipelinePanel' frontend/dist/assets/*.js
# Expected: no matches

# Build agent mode
SLYKBOARD_AGENT_MODE=true npm run build
grep -l 'PipelinePanel' frontend/dist/assets/*.js
# Expected: one or more matches
```

### Task 6 — Doc consistency fixes (ALREADY APPLIED)

The following doc fixes were applied during the doc-edit pass that
landed alongside this refactor plan. **No action needed by the agent
executing the refactor** — listed here for traceability:

- `README.md` "Conventions reminder": corrected to "Route handler →
  Service → Repository (no controllers dir)".
- `02-dual-mode.md` middleware example: `requirePlatformAdmin` →
  `requirePlatformAdmin()` (factory invocation); `authenticate`
  mounted before it; ordering note `requireAgentMode → agentTokenAuth
  → handler` added.
- `02-dual-mode.md` tree-shaking section: replaced with the
  `__AGENT_MODE__` build-time switch + `React.lazy` pattern (Task 5).
- `02-dual-mode.md` middleware filename: `agentMode.ts` →
  `requireAgentMode.ts`.
- `03-security.md` middleware references: invocation style corrected;
  filename `agentToken.ts` → `agentTokenAuth.ts`.
- `05-backend-routes.md` `/api/v1/admin/*` description: invocation
  style corrected; `authenticate` ordering noted.
- `06-frontend-ui.md` store references: `useRuntimeConfig` →
  `useRuntimeConfigStore`.
- `09-implementation-phases.md` middleware filenames + store name +
  Phase 0 task list updated to match.

If a future doc edit reverts any of these, this Task 6 list is the
canonical reference to restore.

### Task 7 — Env var validation

Existing `backend/src/config/env.ts` (Zod-based) needs new env vars
added with conditional rules.

**Add to `backend/src/config/env.ts` schema:**

```ts
SLYKBOARD_AGENT_MODE: z.enum(['true', 'false']).default('false'),
SLYKBOARD_DISPATCHER_URL: z.string().url().optional(),
SLYKBOARD_DISPATCHER_TOKEN: z.string().min(64).optional(),
SLYKBOARD_SLACK_ESCALATION_WEBHOOK: z.string().url().optional(),
```

**Add cross-field validation:**

```ts
// After parse — agent mode requires dispatcher URL + token.
if (parsed.SLYKBOARD_AGENT_MODE === 'true') {
  if (!parsed.SLYKBOARD_DISPATCHER_URL) {
    throw new Error('SLYKBOARD_DISPATCHER_URL required when SLYKBOARD_AGENT_MODE=true');
  }
  if (!parsed.SLYKBOARD_DISPATCHER_TOKEN) {
    throw new Error('SLYKBOARD_DISPATCHER_TOKEN required when SLYKBOARD_AGENT_MODE=true');
  }
}
```

Update `backend/src/config/env.test.ts` with cases for both modes.

## Verification (acceptance criteria)

Run these checks after all tasks complete, before starting Phase 0:

### 1. Plain mode migration

```bash
cd backend
unset SLYKBOARD_AGENT_MODE
npm run db:migrate
# Expected: "core migrations applied" + "agent mode off — skipping agent migrations"
psql $DATABASE_URL -c '\dt'
# Expected: existing tables only (Users, Projects, Tickets, etc.).
# NO new tables. NO errors.
```

### 2. Agent mode migration (still pre-Phase-0, so no agent migrations yet)

```bash
cd backend
SLYKBOARD_AGENT_MODE=true SLYKBOARD_DISPATCHER_URL=http://localhost:4001 \
  SLYKBOARD_DISPATCHER_TOKEN=$(openssl rand -hex 32) \
  npm run db:migrate
# Expected: "core migrations applied" + "agent migrations applied" (but
# agent dir is empty, so this is a no-op).
psql $DATABASE_URL -c '\dt'
# Expected: same table list as plain mode (no agent tables yet).
```

### 3. Server boots in plain mode

```bash
npm run dev
# Hit /api/health — should return 200.
# Hit /api/v1/internal/anything — should 404 (route doesn't exist).
```

### 4. Server boots in agent mode

```bash
SLYKBOARD_AGENT_MODE=true SLYKBOARD_DISPATCHER_URL=http://localhost:4001 \
  SLYKBOARD_DISPATCHER_TOKEN=$(openssl rand -hex 32) \
  npm run dev
# Hit /api/health — should return 200.
# Hit /api/v1/internal/anything — should 401 (route exists, auth stub fails).
# Server logs should show "agent mode" somewhere.
```

### 5. Existing tests pass

```bash
cd backend && npm test
cd ../frontend && npm test
# Expected: zero regressions vs pre-refactor baseline.
```

### 6. Existing kanban flows still work

Manual smoke:
- Login via Google OAuth.
- View a board.
- Create a ticket.
- Move ticket across columns.
- Add a comment.
- All should work identically to pre-refactor.

### 7. Bundle isolation proof

```bash
cd frontend
SLYKBOARD_AGENT_MODE=false npm run build
grep -r 'PipelinePanel\|AgentChatPanel\|OnboardingPage' dist/
# Expected: no matches.

SLYKBOARD_AGENT_MODE=true npm run build
grep -r 'PipelinePanel\|AgentChatPanel\|OnboardingPage' dist/
# Expected: matches present (in their own chunks).
```

## Rollback plan

If refactor breaks something not caught by smoke tests:

```bash
# Restore single schema.ts
git revert <refactor-commit-sha>
# Restore drizzle.config.ts to single-schema form
# Restore migrations/ as flat dir
# Restore package.json scripts
```

Refactor should land as ONE commit (large but atomic). Easy to revert.

## What this refactor does NOT do

- **Does not create any agent tables.** Phase 0 generates the first
  agent migration via `npm run db:generate:agent`.
- **Does not implement any agent route.** Phase 0 fills the stub
  middleware + route handlers.
- **Does not change any existing route path.** `/api/auth`,
  `/api/projects`, etc. keep working unchanged.
- **Does not touch Cyrus.** Out of scope — Cyrus lives in a separate
  repo and is touched only by the dispatcher.
- **Does not add any production env vars beyond the three agent
  switches.** Operator .env file gets three new lines (all optional
  unless agent mode is on).

## Cross-references

- `02-dual-mode.md` — explains the three-layer gating model this
  refactor implements.
- `04-schema.md` — Phase 0 fills `schema/agent.ts` from this doc.
- `05-backend-routes.md` — Phase 0 fills `routes/internal.routes.ts`,
  `routes/admin-agent.routes.ts`, `routes/agent-chat.routes.ts` from
  this doc.
- `09-implementation-phases.md` Phase 0 — assumes refactor is done.

## Commit strategy

Single commit, clear message:

```
Refactor: split schema + migrations for agent-mode prep

Pre-Phase-0 refactor per docs/agentic-automation/00-refactor-plan.md.
- schema.ts → schema/{core,agent,index}.ts
- migrations/ → migrations/{core,agent}/
- drizzle.config.ts → split into core + agent configs
- migrate.ts → custom runner with conditional agent migrations
- Add requireAgentMode + agentTokenAuth stub middleware
- Add useRuntimeConfigStore (Zustand) on frontend
- vite.config.ts: __AGENT_MODE__ build-time switch
- config/env.ts: SLYKBOARD_AGENT_MODE + dispatcher URL/token validation
- README conventions: drop controllers layer from layered rule

No behavior change in plain mode. Agent mode unreachable until Phase 0
fills in schema/routes/middleware bodies.
```

Run the verification checklist above before pushing. If any check
fails, fix in the same commit (still pre-merge).
