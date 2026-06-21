# F02 — Database connection & migration pipeline: Plan + Task Breakdown

> **Feature:** F02 — Database connection & migration pipeline (Phase 0 — Foundation)
> **Slug:** `SLYK` · **Depends on:** F01 · **PRD ref:** §5, §8.1
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), [`features.md`](../../features.md) (F02 spec block), the project rules discovered for this repo (`.claude/rules/{js-style-guide,js-testing-rules,js-development-rules,git-guidelines,persona}.md`), plus dependency feature task doc: [F01](../F01-monorepo-scaffolding/F01-monorepo-scaffolding-tasks.md). Phase-2 evidence supplied verbatim by four parallel analysis agents (codebase state, F01 inherited contracts, PRD+rules extract, external research).

---

## 1. F02 Recap

**Goal:** A versioned PostgreSQL schema the app can evolve safely.

**Ships:** `db:push` / migrate command applies the `Users` table; backend can open and close a pooled connection.

**Acceptance (definition of done):**
- Postgres reachable locally (Docker compose).
- Migration tool wired (Drizzle ORM + `drizzle-kit` — pick documented).
- `Users` table matches PRD §8.1 and seeds cleanly.
- Connection pool configured with sensible defaults; app shuts down gracefully (no hanging sockets).

**Edge cases — resolved:**

- **Pick the client once — every later feature inherits it.** → **Decision (owner-confirmed): Drizzle ORM** with the `node-postgres` (`pg`) driver. Source-of-truth schema lives in committed TypeScript (`backend/src/db/schema.ts`). Cross-cutting decision #1 from `features.md` is **RESOLVED here.** Rationale in §3 (D1).
- **Connection retry/backoff on cold start** → **Decision:** App-layer exponential backoff + jitter (base 200ms, factor 2, jitter ±25%, max 5 attempts) gated by `await pool.query('SELECT 1')` before `app.listen()`.
- **TZ: store all timestamps as UTC (`timestamptz`)** → **Decision:** Every timestamp column uses Drizzle `timestamp({ withTimezone: true, mode: 'date' })`, defaulting to `now()`. Combined with `TZ=UTC` in `.env`. Critical for F20+ time tracking.
- **Connection pool config** → **Decision:** `pg.Pool`, `max: 5`, wrapped by `drizzle(pool)`. Supavisor **session-mode** pooled URL (port 5432) in hosted env; plain `postgres:16` container locally.
- **Graceful shutdown** → **Decision:** Extend the existing `shutdown()` seam (`backend/src/index.ts:32-38`) with `await pool.end()` before `process.exit(0)`, plus a 10s hard-deadline force-exit timer.
- **`DATABASE_URL` empty-default → required-throw** → **Decision:** Tighten `backend/src/config/env.ts:5,17` so an empty `DATABASE_URL` throws fail-fast like `FRONTEND_URL` already does (Evidence B). Update the table-driven case at `env.test.ts:29-34`.
- **dotenv vs Node 24 `--env-file`** → **Decision (owner-confirmed): `dotenv`.** Load via side-effect `import 'dotenv/config'` at the top of the config module, seed, and `drizzle.config.ts`. F01's `dev` script is left unchanged (`tsx watch src/index.ts`) — no `--env-file` added.
- **Users timestamps not in PRD §8.1** → **Decision:** Add `created_at`/`updated_at` anyway (`timestamp({ withTimezone: true })`, `defaultNow()` / `.$onUpdate(() => new Date())`). Convention; every later table has them and audit/time-tracking features (F18, F20+) need a consistent baseline.
- **Local Postgres** → **Decision (owner-confirmed): `docker-compose.yml`** at repo root, `postgres:16`, single container. Matches hosted engine; zero Supabase lock-in (Slykboard uses Google OAuth directly).

---

## 2. Codebase Analysis Summary

- **State:** **Greenfield for DB.** Zero DB code exists. No `schema.prisma`, no `drizzle.config`, no `*.sql`, no `docker-compose`, no Dockerfile. `pg`/`prisma`/`drizzle` absent from `package-lock`. No `dotenv` anywhere. Every file F02 references must be **created** except the F01 seams listed below.
- **Monorepo shape (confirmed in live code):** npm workspaces `["frontend","backend"]`; root `type:module`; root `engines.node:">=24.0.0"`; `.nvmrc`→24. Root dev deps: `concurrently@9`, `eslint@9`, `prettier@3`, `typescript@5.7`. Root scripts: `dev`,`dev:api`,`dev:web`,`build`,`typecheck`,`lint`,`format`,`format:check`,`test`. **No `db:*`/`migrate` script exists.**
- **TS config (`tsconfig.base.json`):** target ES2023, module ESNext, moduleResolution Bundler, strict, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`. **DB row access must handle `undefined`** on indexed lookups.
- **Backend `package.json`:** name `@slykboard/backend`, ESM, private. Deps installed: `express@^5.0.0`, `cors@^2.8.5` (Express 5 confirmed). Dev deps: `tsx@^4.19.0`, `vitest@^3.0.0`, `supertest@^7.0.0`, `@types/node@^22`, `@types/express@^5`, `@types/cors`, `@types/supertest`, `typescript@^5.6`. Scripts: `dev`(`tsx watch src/index.ts`),`build`(`tsc`),`start`(`node dist/index.js`),`typecheck`,`test`,`test:watch`. **No db scripts, no dotenv.**
- **Existing structure this feature builds on (F01 seams — all confirmed in live code):**
  - **[env typed loader]** `backend/src/config/env.ts:1-21` — follow the `loadConfig(envSource?)` factory + fail-fast-throw + frozen singleton pattern. `DATABASE_URL` already declared at `:5`, defaulted to `''` at `:17` — F02 tightens empty→throw. F02 prepends `import 'dotenv/config'` here.
  - **[config re-export]** `backend/src/config/index.ts:1-2` — re-exports `env` + `Config`; consumers import as `import { env } from '../config'` (pattern used in `index.ts:4`).
  - **[env test pattern]** `backend/src/config/env.test.ts:1-56` — table-driven `cases.forEach(...)` with `expectThrow?`/`field?`/`value?` shape. Has case "defaults DATABASE_URL to empty" at `:29-34` that F02 modifies.
  - **[workspace bridge]** root `package.json:15-16` — `-w backend` prefix for workspace installs.
  - **[db/ dir reserved]** `backend/src/db/.gitkeep` — empty, designated F02 home.
  - **[entry + shutdown seam]** `backend/src/index.ts:1-46` — Express + `GET /api/health` + `cors({origin:env.frontendUrl})` + `express.json()`. Graceful shutdown already at `index.ts:32-38`: SIGTERM/SIGINT → `shutdown()` → `server.close(()=>process.exit(0))`. F02 adds `await pool.end()` there. `app` exported; `start()` under `isMain` guard (`index.ts:20,41-43`).
  - **[vitest config]** `backend/vitest.config.ts:1-10` — injects test env `FRONTEND_URL`,`NODE_ENV=test`. F02 adds `DATABASE_URL`.
  - **[supertest present]** `backend/package.json:23` — `^7` available for HTTP-level integration tests.
  - **[table-driven test shape]** `backend/src/health.test.ts:6-17`, `env.test.ts:14-55` — `cases.forEach(...)` mandatory per `js-testing-rules.md`.
- **Prior art / partial work:** None. F02 is the first DB-touching feature.
- **File paths the plan references that do NOT exist yet (will be created):**
  - `docker-compose.yml` (repo root)
  - `backend/src/db/schema.ts` (Drizzle schema — source of truth)
  - `backend/src/db/client.ts` (Pool + drizzle instance, lazy singleton)
  - `backend/src/db/connect.ts` (retry/backoff helper)
  - `backend/src/db/migrate.ts` (migration runner for prod/programmatic use)
  - `backend/src/db/seed.ts` (Users seed)
  - `backend/drizzle.config.ts` (drizzle-kit config)
  - `backend/src/db/migrations/` (generated SQL by `drizzle-kit generate`)
  - `backend/src/db/db.test.ts` (integration test)
- **Files F02 MODIFIES:** `backend/src/config/env.ts`, `backend/src/config/env.test.ts`, `backend/vitest.config.ts`, `backend/src/index.ts`, `backend/.env.example`, `backend/package.json`, root `.gitignore` (verify entries).
- **Project rules this plan must satisfy:**
  - `.claude/rules/js-style-guide.md` — 2-space JS indent, 100-char lines, trailing commas, camelCase vars, SCREAMING_SNAKE_CASE constants, no `any`, import order (external → internal → types → relative).
  - `.claude/rules/js-testing-rules.md` — Vitest, co-located `*.test.ts`, table-driven `cases.forEach`, Testing-Library priority (`getByRole` etc.), coverage targets (>80% business logic).
  - `.claude/rules/js-development-rules.md` — dir structure (`backend/src/db/`, `repositories/`, `config/`); parameterized/ORM queries NEVER string-concat SQL; env table incl. `DATABASE_URL` required; Render deploy with `node src/index.js`.
  - `.claude/rules/git-guidelines.md` — **NEVER run git without explicit approval**; rebase-and-merge ONLY (no merge commits, no squash); branch `type/SLYK-<n>-<desc>` (omit ticket if unknown); single-line commit `SLYK-<n>: msg`; `.gitignore` must include `node_modules/`,`.env`,`dist/`,`build/`,`*.log`,`.DS_Store`.
  - `.claude/rules/persona.md` — PERN stack; Supabase usable as Postgres host; Render for backend.
- **Hidden coupling to plan for:**
  - The ORM choice (D1) is cross-cutting decision #1 and locks the data-access idiom for every later feature. Wrong pick = expensive retrofit.
  - `noUncheckedIndexedAccess` affects how Drizzle row types are consumed — nullable columns already typed `T | null`, but array indexing returns `T | undefined`.
  - Drizzle schema is **committed TypeScript** (not generated), so imports resolve from source — no `generate` step needed to type-check (unlike Prisma). `db:generate` (drizzle-kit) only emits SQL migration files.
  - Drizzle has no built-in `@updatedAt` equivalent at the SQL layer; use the `.$onUpdate(() => new Date())` column hook (drizzle-orm 0.31+) so updates bump `updated_at` automatically — document it so F05+ repos rely on it.
  - `verbatimModuleSyntax` requires `import type` for type-only imports — `import type { Pool } from 'pg'` where only the type is used.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | **ORM / DB client** (cross-cutting #1 — RESOLVED, owner-confirmed) | **Drizzle ORM** (`drizzle-orm` + `drizzle-kit`) with `node-postgres` (`pg`) | SQL-like, lightweight, zero codegen-at-runtime; committed TS schema (`schema.ts`) is source of truth → type-safe with the repo's strict TS posture; first-class JSONB (`jsonb().$type<T>()`) + `text[]` for the JSONB/array-heavy schema (Projects.columns, Tickets.checklist, Tickets.labels); BYO `pg.Pool` = explicit pool control + graceful `pool.end()`. `js-development-rules.md:118-160` permits Prisma/Drizzle/raw `pg`. PRD §5 mandates PostgreSQL, not the client. |
| D2 | **Client version line** | **Drizzle ORM latest stable 0.x** (`drizzle-orm`, `drizzle-kit`); **avoid the 1.0.0 beta** until stable | Stable 0.x is battle-tested (0.34–0.45 in production per research). Pin whatever `npm i drizzle-orm drizzle-kit` resolves to. Evidence D. |
| D3 | **Driver + pooling** | `pg.Pool` `max: 5`, wrapped by `drizzle(pool, { schema })` via `drizzle-orm/node-postgres` | Explicit `pg.Pool` control for graceful `pool.end()`; Supabase PgBouncer deprecated → Supavisor, session-mode (port 5432) pooled URL recommended for single-service low-concurrency Render deploy; transaction-mode (6543) reserved for many-instance scaling. Evidence D. |
| D4 | **Migration pipeline** | `drizzle-kit generate` (emit SQL from `schema.ts`) → `drizzle-kit migrate` (apply); `drizzle-kit push` for quick dev sync | SQL migrations are committed under `backend/src/db/migrations/`; `generate` is the source-of-truth → SQL step; `migrate` applies pending files. Evidence D. |
| D5 | **Prod migration command** | `npx drizzle-kit migrate` (or `npm run db:migrate`) in Render **Pre-Deploy Command** | Runs before `node src/index.js` each release; reads `DATABASE_URL` (loaded via dotenv in `drizzle.config.ts`); non-interactive. Evidence D. **Confirm deployment path with owner.** |
| D6 | **Timestamp strategy (UTC `timestamptz`)** | Every timestamp column: `timestamp({ withTimezone: true, mode: 'date' }).defaultNow()`; `TZ=UTC` in dev env | Forces true `timestamptz` (stored UTC). Critical for F20+ time tracking. F02 spec edge case. |
| D7 | **Cold-start retry/backoff** | App-layer exponential backoff + jitter: base 200ms, factor 2, jitter ±25%, max 5 attempts; validate via `await pool.query('SELECT 1')`; runs before `app.listen()` | No built-in boot retry in `pg`/Drizzle. F02 spec edge case. Evidence D. |
| D8 | **Env-loading strategy (owner-confirmed)** | **`dotenv`** — `import 'dotenv/config'` side-effect at top of `env.ts`, `seed.ts`, and `drizzle.config.ts` | Owner-selected over Node 24 `--env-file`. Keeps F01's `dev` script untouched (`tsx watch src/index.ts`). `dotenv` default `override:false` lets Vitest-injected `test.env` win in tests. |
| D9 | **Local Postgres (owner-confirmed)** | `docker-compose.yml` at repo root, `postgres:16`, single container | Matches hosted engine version; zero lock-in (Slykboard uses Google OAuth directly); one container, healthcheck, named volume. Evidence D. |
| D10 | **Schema location** | Committed TS: `backend/src/db/schema.ts` (source of truth) | Drizzle schema IS source — no generated client to gitignore, no `generate` step for type-checking. `db:generate` only emits migration SQL. |
| D11 | **`Users` timestamps (not in PRD §8.1)** | Add `created_at`/`updated_at` (`timestamp({ withTimezone: true })`, `defaultNow()` / `.$onUpdate(() => new Date())`) | Convention; F18 audit + F20+ time tracking need a consistent baseline. PRD §8.1 omits them but Tickets/ActivityLogs have them. |
| D12 | **`DATABASE_URL` validation** | Fail-fast throw on empty (matches existing `FRONTEND_URL` pattern at `env.ts:9-11`) | Env table marks `DATABASE_URL` required (`js-development-rules.md:137`). Consistent with F01's fail-fast idiom (Evidence B). |
| D13 | **Graceful shutdown** | Extend `shutdown()` seam (`index.ts:32-38`): `await pool.end()` + 10s hard-deadline force-exit timer | Closes the `pg.Pool`; prevents hanging sockets on Render (grace ~30s). F02 spec acceptance bullet. Evidence D. |

> **Out of F02 scope (explicitly deferred):**
> - **F03** owns the response envelope, global error middleware, Zod validation, request logging. F02 surfaces DB errors minimally via the connect helper and does NOT pre-build the F03 envelope.
> - **F05** owns the `Users` upsert on Google login — F02 only creates the table + seeds dev rows.
> - **Logger:** F01 uses raw `console.log/error`. F02 reuses `console.*` for the connect helper; a proper logger is a later enhancement.
> - All non-`Users` schema (Projects, Tickets, TimeEntries, ActivityLogs) is deferred to F08/F12/F18/F20 respectively. F02's `schema.ts` contains **only** the `users` table + `role` enum.
> - PRD §9 deferred items (webhooks, GitHub/GitLab, workflow automation, CSV/PDF export) — not built.

> **Owner sign-off status:**
> - ✅ **(b) Prisma vs Drizzle vs raw `pg`** → **Drizzle** (D1).
> - ✅ **(d) dotenv vs Node-24 `--env-file`** → **dotenv** (D8).
> - ✅ **(f) Local Postgres** → **docker-compose** (D9).
> - ➖ **(c) Generated-client output path** → **moot** — Drizzle has no generated client; schema is committed TS (D10).
> - ⚠️ Still open: **(g) Render Pre-Deploy = `drizzle-kit migrate`** — confirm deployment path (D5). **(e) Users timestamps not in PRD §8.1** — plan adds them; flag if owner disagrees (D11).

---

## 4. Architecture Overview (Target Tree)

```
slykboard/                                    # repo root
├── docker-compose.yml                        # NEW (D9) — postgres:16, healthcheck, volume
├── .gitignore                                # MODIFY — verify node_modules/,.env,dist/,build/,*.log,.DS_Store
│
└── backend/
    ├── .env.example                          # MODIFY — fill DATABASE_URL sample value + TZ=UTC
    ├── package.json                          # MODIFY — add drizzle/pg/dotenv deps + db:* scripts
    ├── vitest.config.ts                      # MODIFY — add DATABASE_URL to test env
    ├── drizzle.config.ts                     # NEW (D4) — drizzle-kit config; dotenv-loaded DATABASE_URL
    └── src/
        ├── config/
        │   ├── env.ts                        # MODIFY — prepend `import 'dotenv/config'`; DATABASE_URL empty → fail-fast throw (D8,D12)
        │   └── env.test.ts                   # MODIFY — update "defaults to empty" case → throw case
        ├── db/                               # was: .gitkeep (empty)
        │   ├── schema.ts                     # NEW (D1,D6,D11) — users table + role enum, timestamptz
        │   ├── client.ts                     # NEW (D1,D3) — pg.Pool + drizzle() lazy singleton
        │   ├── connect.ts                    # NEW (D7) — retry/backoff helper, validates via pool.query
        │   ├── migrate.ts                    # NEW (D4) — programmatic migrate runner (drizzle-orm migrator)
        │   ├── seed.ts                       # NEW — dev Users seed (ADMIN + MEMBER rows)
        │   ├── migrations/                   # NEW (generated by `drizzle-kit generate`)
        │   │   └── 0000_init_users.sql
        │   └── db.test.ts                    # NEW — table-driven integration test (pool open/close, seed)
        └── index.ts                          # MODIFY — boot: await connectWithRetry(); shutdown: await pool.end() (D13)
```

**Boot lifecycle (non-obvious flow):**

1. Process starts (`tsx watch src/index.ts` — env loaded by `dotenv/config` inside `env.ts`).
2. `start()` under `isMain` guard calls `await connectWithRetry(pool)` — exponential backoff + jitter, max 5 attempts, validates via `pool.query('SELECT 1')`. Throws if all attempts fail → process exits non-zero (Render restarts).
3. `app.listen(env.port)`.
4. SIGTERM/SIGINT received → `shutdown()`: `server.close()` → 10s hard-deadline timer → `await pool.end()` → `process.exit(0)`.

The `pg.Pool` is a **lazy singleton on `globalThis`** (import-safe — constructing `Pool` does NOT connect; the pool connects on first query. Boot-time connectivity is validated by `connect.ts`).

---

## 5. Parallelization Strategy

Tasks are grouped into **4 batches** by dependency order. Within a batch, tasks touch **disjoint file sets** → zero merge conflicts → safe to run in parallel and merge independently.

### Batch dependency diagram

```
                    ┌──────────────────────────────────────┐
   Batch A          │ T1  docker-compose + .env + env.ts   │
   (foundation)     │     + vitest.config + .gitignore     │
                    └────────────────┬─────────────────────┘
                                     │ (DATABASE_URL contract locked)
                                     ▼
                    ┌──────────────────────────────────────┐
   Batch B          │ T2  drizzle/pg/dotenv install +      │
   (schema + config)│     schema.ts + drizzle.config +     │
                    │     db scripts + generate migration  │
                    └────────────────┬─────────────────────┘
                                     │ (drizzle() + migration SQL exist)
                                     ▼
                    ┌──────────────────────────────────────┐
   Batch C          │ T3  client.ts + connect.ts retry/    │
   (runtime wiring) │     backoff + index.ts hooks         │
                    └────────────────┬─────────────────────┘
                                     │ (app boots + connects + shuts down)
                                     ▼
                    ┌──────────────────────────────────────┐
   Batch D          │ T4  seed.ts + db.test.ts             │
   (verification)   │     integration verification + signoff│
                    └──────────────────────────────────────┘
```

- **Batch A → Batch B** is a hard barrier: T2 needs the locked `DATABASE_URL` contract (fail-fast + sample value + dotenv loading) and a running local Postgres to apply the migration.
- **Batch B → Batch C** is a hard barrier: T3 imports from `schema.ts` and `drizzle-orm/node-postgres`, both of which only exist after T2.
- **Batch C → Batch D** is a hard barrier: T4 exercises the full boot→connect→shutdown lifecycle and the seeded `Users` table end-to-end.

F02 is small enough that **no two tasks share a batch** (no parallel pair). Each batch is a single task. This is the safest layout given the strict file-disjointness requirement.

### Merge order rules

1. **Batch A (T1) merges first.** Must be on `main` before T2 branches — T2 needs the `DATABASE_URL` contract and local Postgres.
2. **Batch B (T2) merges second.** Brings `schema.ts`, `drizzle.config.ts`, deps, `db:*` scripts, and the generated migration SQL.
3. **Batch C (T3) merges third.** Wires the pool + drizzle instance into the app boot/shutdown lifecycle.
4. **Batch D (T4) merges last.** Terminal verification + sign-off record.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | A | `docker-compose.yml`, `backend/.env.example`, `backend/src/config/env.ts`, `backend/src/config/env.test.ts`, `backend/vitest.config.ts`, `.gitignore` | — | — |
| **T2** | B | `backend/package.json`, `backend/src/db/schema.ts`, `backend/drizzle.config.ts`, `backend/src/db/migrations/` (generated) | T1 | — |
| **T3** | C | `backend/src/db/client.ts`, `backend/src/db/connect.ts`, `backend/src/db/migrate.ts`, `backend/src/index.ts`, `backend/src/db/.gitkeep` (delete) | T2 | — |
| **T4** | D | `backend/src/db/seed.ts`, `backend/src/db/db.test.ts` | T3 | — |

### Developer assignment tracks

- **Solo (recommended):** T1 → T2 → T3 → T4. Linear; ~1 day total.
- **2 devs:** Not beneficial — F02's tasks are strictly sequential (each gates the next). One dev drives, the other reviews PRs.
- **3+ devs:** Same — serialize. Reserve extra devs for F03/F04 which are independent of F02's tree and can branch off F01 in parallel.

---

## 6. Tasks

### T1 — Local Postgres + `DATABASE_URL` contract

**Batch:** A · **Depends on:** None · **Parallel with:** —

**Description:** Stand up a local PostgreSQL 16 container and lock the `DATABASE_URL` contract (fail-fast + sample value + dotenv loading). This is the foundation every later task assumes. No Drizzle yet.

Create / Modify:

- **`docker-compose.yml`** (repo root — NEW). Single `postgres:16` service matching the hosted engine; named volume; healthcheck; `restart: unless-stopped`. Copy-pasteable:

  ```yaml
  # Slykboard local dev database (F02). Matches hosted Postgres 16 engine.
  # Usage: docker compose up -d   (from repo root)
  services:
    postgres:
      image: postgres:16
      container_name: slykboard-db
      environment:
        POSTGRES_USER: slyk
        POSTGRES_PASSWORD: slyk
        POSTGRES_DB: slykboard
        POSTGRES_INITDB_ARGS: "--data-checksums"
      ports:
        - "5432:5432"
      volumes:
        - pgdata:/var/lib/postgresql/data
      healthcheck:
        test: ["CMD-SHELL", "pg_isready -U slyk -d slykboard"]
        interval: 5s
        timeout: 3s
        retries: 10
      restart: unless-stopped

  volumes:
    pgdata:
  ```

- **`backend/.env.example`** (MODIFY). Replace the `DATABASE_URL=` placeholder line (currently with `# F02 fills these in:` comment per Evidence A) with the working local value. Final contents:

  ```
  PORT=3000
  FRONTEND_URL=http://localhost:5173
  # Local docker-compose Postgres (F02). Production uses the hosted pooled URL.
  DATABASE_URL=postgresql://slyk:slyk@localhost:5432/slykboard
  TZ=UTC
  ```

- **`backend/src/config/env.ts`** (MODIFY). Two changes:
  1. Prepend the dotenv side-effect import as the **first line** (D8):
     ```typescript
     import 'dotenv/config'
     ```
  2. Tighten `DATABASE_URL` from empty-default to fail-fast, matching the existing `FRONTEND_URL` pattern at `:9-11`. The loader body becomes:

     ```typescript
     if (!envSource.FRONTEND_URL) {
         throw new Error('FRONTEND_URL is required')
     }
     if (!envSource.DATABASE_URL) {
         throw new Error('DATABASE_URL is required')
     }
     // ... rest unchanged
     return {
         port: Number(envSource.PORT) || 3000,
         frontendUrl: envSource.FRONTEND_URL,
         databaseUrl: envSource.DATABASE_URL, // was: envSource.DATABASE_URL || ''
         // ...
     }
     ```

- **`backend/src/config/env.test.ts`** (MODIFY). The case at `:29-34` ("defaults DATABASE_URL to empty") must flip to assert a throw. Keep the table-driven `cases.forEach` shape. Replace it with:

  ```typescript
  {
      name: 'throws when DATABASE_URL missing',
      env: { FRONTEND_URL: 'http://localhost:5173' }, // no DATABASE_URL
      expectThrow: 'DATABASE_URL is required',
  },
  {
      name: 'accepts DATABASE_URL',
      env: { FRONTEND_URL: 'http://localhost:5173', DATABASE_URL: 'postgresql://x:x@localhost:5432/x' },
      field: 'databaseUrl',
      value: 'postgresql://x:x@localhost:5432/x',
  },
  ```

- **`backend/vitest.config.ts`** (MODIFY). Add `DATABASE_URL` to the test env injection so unit tests don't throw on import. After edit:

  ```typescript
  /// <reference types="vitest" />
  import { defineConfig } from 'vitest/config'

  export default defineConfig({
      test: {
          environment: 'node',
          env: {
              FRONTEND_URL: 'http://localhost:5173',
              NODE_ENV: 'test',
              DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
          },
      },
  })
  ```

  Note: Vitest sets `process.env` from `test.env` before importing test files; `dotenv/config` (default `override:false`) will not clobber those values.

- **`.gitignore`** (VERIFY at repo root). Confirm the entries required by `git-guidelines.md` exist: `node_modules/`, `.env`, `dist/`, `build/`, `*.log`, `.DS_Store`. Add any missing. Do NOT gitignore `.env.example` (it must ship).

**Acceptance Criteria:**
- [ ] `docker compose up -d` starts a healthy `slykboard-db` container; `docker compose exec postgres pg_isready -U slyk -d slykboard` returns "accepting connections".
- [ ] `backend/.env.example` contains a working `DATABASE_URL` sample and `TZ=UTC`.
- [ ] Importing `env` with no `DATABASE_URL` in the environment throws `DATABASE_URL is required`.
- [ ] `npm test -w backend` passes; the env test table includes the throw case and the accept case.
- [ ] `backend/vitest.config.ts` injects `DATABASE_URL` so unit tests import `env` without throwing.
- [ ] `.gitignore` has all six required entries.
- [ ] `npm run lint`, `npm run format:check`, `npm run typecheck` all pass.

**Dependencies:** None (F01 is already merged on `main`).

---

### T2 — Drizzle + pg + dotenv install, schema, migration, db scripts

**Batch:** B · **Depends on:** T1 · **Parallel with:** —

**Description:** Install Drizzle ORM + drizzle-kit + pg + dotenv, author the `users` table + `role` enum per PRD §8.1 verbatim plus the timestamp convention (D11), wire `drizzle.config.ts`, generate the first migration SQL, and add `db:*` scripts.

Create / Modify:

- **`backend/package.json`** (MODIFY). Add deps and scripts. Install commands:

  ```bash
  npm install drizzle-orm pg dotenv -w backend
  npm install -D drizzle-kit @types/pg -w backend
  ```

  Pin `drizzle-orm`/`drizzle-kit` to the stable 0.x version `npm i` resolves (avoid the 1.0.0 beta — D2).

  Add to `scripts`:

  ```json
  "db:generate": "drizzle-kit generate",
  "db:push": "drizzle-kit push",
  "db:migrate": "drizzle-kit migrate",
  "db:studio": "drizzle-kit studio",
  "db:seed": "tsx src/db/seed.ts"
  ```

  (`dev` stays `tsx watch src/index.ts` — dotenv loads inside `env.ts`. No `--env-file`.)

- **`backend/src/db/schema.ts`** (NEW). Source of truth. `users` table per PRD §8.1 (`basic-PRD.md:136-145`) + timestamps (D11), using Drizzle `pg-core`:

  ```typescript
  import { pgTable, uuid, text, timestamp, pgEnum } from 'drizzle-orm/pg-core'

  // PRD §8.1 — role enum. Admin manages settings; Member is default.
  export const roleEnum = pgEnum('Role', ['ADMIN', 'MEMBER'])

  // PRD §8.1 — Users table, verbatim columns + standard UTC timestamps.
  // snake_case column names via the 2nd arg; camelCase access keys via the 1st arg.
  export const users = pgTable(
      'Users',
      {
          id: uuid('id').primaryKey().defaultRandom(),
          googleId: text('google_id').notNull().unique(),
          email: text('email').notNull().unique(),
          fullName: text('full_name').notNull(),
          avatarUrl: text('avatar_url'),
          role: roleEnum('role').default('MEMBER').notNull(),
          // Convention: every table carries UTC timestamptz (F18 audit + F20+ baseline).
          createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
              .defaultNow()
              .notNull(),
          // Drizzle has no SQL-layer @updatedAt; bump on every update via this hook.
          updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
              .defaultNow()
              .$onUpdate(() => new Date())
              .notNull(),
      },
  )
  ```

  Notes: `withTimezone: true` forces `timestamptz` (D6); `mode: 'date'` returns JS `Date`; `.$onUpdate` (drizzle-orm 0.31+) auto-bumps `updated_at` on update — repos in F05+ rely on it (no manual set needed); `avatarUrl` nullable per PRD (account with no avatar → F05 fallback).

- **`backend/drizzle.config.ts`** (NEW). drizzle-kit config; loads `DATABASE_URL` via dotenv so CLI commands work without `--env-file`:

  ```typescript
  import 'dotenv/config'
  import { defineConfig } from 'drizzle-kit'

  export default defineConfig({
      schema: './src/db/schema.ts',
      out: './src/db/migrations',
      dialect: 'postgresql',
      dbCredentials: {
          url: process.env.DATABASE_URL!,
      },
      verbose: true,
      strict: true,
  })
  ```

- **`backend/src/db/migrations/`** (GENERATED). Run from `backend/`:

  ```bash
  npm run db:generate
  ```

  This emits `backend/src/db/migrations/0000_<name>.sql` (+ journal) containing `CREATE TABLE "Users"`, `CREATE TYPE "Role"`, and indexes. Commit the migrations directory.

**Acceptance Criteria:**
- [ ] `npm install` succeeds; `drizzle-orm`, `pg`, `dotenv` in `backend/package.json` deps; `drizzle-kit`, `@types/pg` in devDeps.
- [ ] `npm run db:push -w backend` applies `schema.ts` to the T1 docker-compose DB without error (creates `Users` + `Role` enum).
- [ ] `npm run db:generate -w backend` emits a committed `.sql` migration file containing `CREATE TABLE "Users"`.
- [ ] `docker compose exec postgres psql -U slyk -d slykboard -c '\d "Users"'` shows columns `id` (uuid, PK), `google_id` (unique), `email` (unique), `full_name`, `avatar_url` (nullable), `role` (Role enum, default MEMBER), `created_at` (timestamptz), `updated_at` (timestamptz).
- [ ] `psql ... -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Users' AND column_name IN ('created_at','updated_at')"` reports `timestamp with time zone` (proves `withTimezone: true` worked — D6).
- [ ] `backend/package.json` has scripts `db:generate`, `db:push`, `db:migrate`, `db:studio`, `db:seed`.
- [ ] `npm run lint`, `npm run format:check`, `npm run typecheck` all pass.

**Dependencies:** T1 (DATABASE_URL contract + running local Postgres).

---

### T3 — Drizzle client + pool + retry/backoff + boot/shutdown wiring

**Batch:** C · **Depends on:** T2 · **Parallel with:** —

**Description:** Create the import-safe `pg.Pool` + drizzle instance (lazy, on `globalThis`), the cold-start retry/backoff helper, a programmatic migrate runner, and wire both into the app boot (before `app.listen`) and graceful shutdown (extend the existing `shutdown()` seam).

Create / Modify:

- **`backend/src/db/client.ts`** (NEW). Lazy singleton. Import-safe — no connection at import time (D1, D3):

  ```typescript
  import { drizzle } from 'drizzle-orm/node-postgres'
  import { Pool } from 'pg'
  import { env } from '../config'
  import * as schema from './schema'

  // Lazy singleton on globalThis — survives tsx watch HMR / hot restarts.
  // Import-safe: constructing Pool does NOT connect; it connects on first query.
  // Boot-time connectivity is validated by connect.ts.
  const globalForDb = globalThis as unknown as {
      __slykPool?: Pool
  }

  const pool: Pool =
      globalForDb.__slykPool ??
      new Pool({
          connectionString: env.databaseUrl,
          max: 5, // D3 — single Render service, low concurrency
      })

  if (!globalForDb.__slykPool) {
      globalForDb.__slykPool = pool
  }

  export const db = drizzle(pool, { schema })
  export { pool }
  ```

- **`backend/src/db/connect.ts`** (NEW). Retry/backoff helper (D7). Exponential backoff + jitter, max 5 attempts, validates via `pool.query('SELECT 1')`:

  ```typescript
  import type { Pool } from 'pg'

  const MAX_ATTEMPTS = 5
  const BASE_DELAY_MS = 200
  const FACTOR = 2
  const JITTER = 0.25 // ±25%

  const sleep = (ms: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms))

  /**
   * Validates DB connectivity at boot. pg/Drizzle have no built-in boot retry —
   * this wraps pool.query('SELECT 1') in exponential backoff + jitter so the
   * app doesn't crash if the DB is briefly unreachable on cold start (F02 edge
   * case). Throws if all attempts fail; caller should let the process exit non-zero.
   */
  export async function connectWithRetry(
      pool: Pool,
      attempts = MAX_ATTEMPTS,
  ): Promise<void> {
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
          try {
              await pool.query('SELECT 1')
              return
          } catch (err) {
              if (attempt === attempts) {
                  throw err
              }
              const delay = BASE_DELAY_MS * FACTOR ** (attempt - 1)
              const jitter = delay * JITTER * (Math.random() * 2 - 1)
              await sleep(Math.round(delay + jitter))
          }
      }
  }
  ```

- **`backend/src/db/migrate.ts`** (NEW). Programmatic migrate runner using the `drizzle-orm/node-postgres/migrator`. Alternative to `drizzle-kit migrate` for release scripts / startup (D4, D5):

  ```typescript
  import 'dotenv/config'
  import { drizzle } from 'drizzle-orm/node-postgres'
  import { migrate } from 'drizzle-orm/node-postgres/migrator'
  import { Pool } from 'pg'
  import path from 'node:path'
  import { fileURLToPath } from 'node:url'

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const db = drizzle(pool)

  const here = path.dirname(fileURLToPath(import.meta.url))

  migrate(db, { migrationsFolder: path.join(here, 'migrations') })
      .then(async () => {
          console.info('Migrations applied')
          await pool.end()
      })
      .catch(async (err) => {
          console.error('Migration failed:', err)
          await pool.end()
          process.exit(1)
      })
  ```

- **`backend/src/db/.gitkeep`** (DELETE). Directory now has real files.

- **`backend/src/index.ts`** (MODIFY). Hook the pool + connect helper into boot and the existing shutdown seam at `:32-38`. Changes:
  - Import `pool` from `'./db/client'` and `connectWithRetry` from `'./db/connect'`.
  - In `start()` (under `isMain` guard at `:41-43`), before `app.listen`, call `await connectWithRetry(pool)`. If it throws, log and `process.exit(1)`.
  - In `shutdown()`, add a 10s hard-deadline timer and `await pool.end()` before `process.exit(0)`.

  Target `index.ts` tail (sketch — preserve existing exports `app`, `start`, `shutdown`):

  ```typescript
  import { pool } from './db/client'
  import { connectWithRetry } from './db/connect'

  // ... existing app + health route ...

  async function shutdown(): Promise<void> {
      console.info('Shutting down...')
      // Hard deadline: if server.close or pool.end stall, force-exit.
      const forceExit = setTimeout(() => {
          console.error('Shutdown timed out, forcing exit')
          process.exit(1)
      }, 10_000)
      forceExit.unref()

      await new Promise<void>((resolve) => server.close(() => resolve()))
      await pool.end() // closes the pg.Pool — no hanging sockets
      clearTimeout(forceExit)
      process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  async function start(): Promise<void> {
      try {
          await connectWithRetry(pool)
      } catch (err) {
          console.error('Database connection failed on boot:', err)
          process.exit(1)
      }
      server.listen(env.port, () => {
          console.info(`Backend listening on :${env.port}`)
      })
  }

  if (import.meta.url === `file://${process.argv[1]}`) {
      start()
  }
  ```

  Preserve the existing `app` export and the `GET /api/health` route exactly (F03 owns the envelope — do not touch response shapes).

**Acceptance Criteria:**
- [ ] Importing `backend/src/db/client.ts` does NOT open a DB connection (no network activity at import).
- [ ] With the DB up, `npm run dev -w backend` boots, logs `Backend listening on :3000`, and `GET /api/health` returns 200.
- [ ] With the DB stopped (`docker compose stop`), boot retries 5 times (visible in logs) then exits non-zero within ~5s (200+400+800+1600 ≈ 3s base + jitter).
- [ ] Sending SIGTERM/SIGINT to a running backend logs `Shutting down...`, closes the server, calls `pool.end()`, and the process exits within 10s with no hanging sockets (`lsof -i :5432` shows the backend's connections gone).
- [ ] If `server.close` stalls, the 10s hard-deadline timer fires `process.exit(1)`.
- [ ] `npm run lint`, `npm run format:check`, `npm run typecheck` all pass.

**Dependencies:** T2 (`schema.ts` + deps must exist).

---

### T4 — Users seed + integration verification & sign-off

**Batch:** D · **Depends on:** T3 · **Parallel with:** —

**Description:** Author the dev `Users` seed and the table-driven integration test that proves the full lifecycle (boot → connect → migrate applied → seed clean → pool open/close → graceful shutdown). This is the terminal definition-of-done gate.

Create / Modify:

- **`backend/src/db/seed.ts`** (NEW). Seeds two dev rows — one ADMIN, one MEMBER — so F05/F06 login flows have known fixtures. Idempotent via `onConflictDoNothing` on `email`:

  ```typescript
  import 'dotenv/config'
  import { drizzle } from 'drizzle-orm/node-postgres'
  import { Pool } from 'pg'
  import { users } from './schema'

  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  const db = drizzle(pool)

  async function main(): Promise<void> {
      await db
          .insert(users)
          .values([
              {
                  googleId: 'admin-dev-fixture',
                  email: 'admin@slykboard.local',
                  fullName: 'Dev Admin',
                  role: 'ADMIN',
              },
              {
                  googleId: 'member-dev-fixture',
                  email: 'member@slykboard.local',
                  fullName: 'Dev Member',
                  role: 'MEMBER',
              },
          ])
          .onConflictDoNothing({ target: users.email })

      console.info('Seeded 2 users')
  }

  main()
      .then(async () => {
          await pool.end()
      })
      .catch(async (err) => {
          console.error(err)
          await pool.end()
          process.exit(1)
      })
  ```

  (Seed runs via `npm run db:seed -w backend`; it constructs its own throwaway `Pool` so it's independent of the app's singleton.)

- **`backend/src/db/db.test.ts`** (NEW). Table-driven Vitest integration test per `js-testing-rules.md`. Uses a fresh per-test `Pool` + drizzle against the dev DB (DB must be running — integration test). Verifies: connection works, the `Users` table exists with the §8.1 columns, insert/read/delete round-trips, and `pool.end()` closes the pool. Follow the `cases.forEach` pattern:

  ```typescript
  import { describe, it, expect } from 'vitest'
  import { drizzle } from 'drizzle-orm/node-postgres'
  import { sql } from 'drizzle-orm'
  import { Pool } from 'pg'
  import { users } from './schema'

  function makeClient(): { db: ReturnType<typeof drizzle>; pool: Pool } {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL })
      const db = drizzle(pool)
      return { db, pool }
  }

  describe('F02 database integration', () => {
      it('connects and SELECTs 1', async () => {
          const { db, pool } = makeClient()
          const rows = await db.execute(sql`SELECT 1 AS one`)
          expect((rows.rows as Array<{ one: number }>)[0]?.one).toBe(1)
          await pool.end()
          expect(pool.ended).toBe(true)
      })

      const columnCases = [
          { name: 'id', type: 'uuid' },
          { name: 'google_id', type: 'text' },
          { name: 'email', type: 'text' },
          { name: 'full_name', type: 'text' },
          { name: 'avatar_url', type: 'text' },
          { name: 'role', type: 'USER-DEFINED' }, // Role enum
          { name: 'created_at', type: 'timestamp with time zone' },
          { name: 'updated_at', type: 'timestamp with time zone' },
      ]

      columnCases.forEach(({ name, type }) => {
          it(`Users column ${name} is ${type}`, async () => {
              const { db, pool } = makeClient()
              const res = await db.execute(sql`
                  SELECT column_name, data_type
                  FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = ${'Users'}
                    AND column_name = ${name}
              `)
              expect(
                  (res.rows as Array<{ data_type: string }>)[0]?.data_type,
              ).toBe(type)
              await pool.end()
          })
      })

      it('round-trips a User row with UTC timestamps', async () => {
          const { db, pool } = makeClient()
          const [created] = await db
              .insert(users)
              .values({
                  googleId: `test-${Date.now()}`,
                  email: `test-${Date.now()}@slykboard.local`,
                  fullName: 'Test User',
                  role: 'MEMBER',
              })
              .returning()

          expect(created).toBeDefined()
          expect(created?.createdAt).toBeInstanceOf(Date)
          expect(created?.updatedAt).toBeInstanceOf(Date)
          expect(created?.role).toBe('MEMBER')

          await db.delete(users).where(sql`id = ${created!.id}`)
          await pool.end()
      })
  })
  ```

  Note: `noUncheckedIndexedAccess` makes `rows[0]` / `[created]` `T | undefined` — the `?.` / `toBeDefined()` guards handle it.

**Steps (terminal verification):**
1. `docker compose up -d` from repo root; wait for healthy.
2. `npm run db:migrate -w backend` — applies pending migrations idempotently.
3. `npm run db:seed -w backend` — logs `Seeded 2 users`.
4. `docker compose exec postgres psql -U slyk -d slykboard -c 'SELECT email, role FROM "Users";'` — confirms the two seed rows.
5. `npm run dev -w backend` — boots, connects (retry helper passes first try), logs listening on :3000.
6. `curl http://localhost:3000/api/health` — 200 `{status,service,uptime,timestamp}`.
7. `kill -TERM <pid>` — process exits within 10s, no hanging sockets.
8. `npm test -w backend` — all unit + integration tests green.
9. `npm run lint && npm run format:check && npm run typecheck` — all pass.

**Acceptance Criteria:**
- [ ] `npm run db:seed -w backend` seeds 2 users (ADMIN + MEMBER); re-running is idempotent (`onConflictDoNothing`).
- [ ] `psql` confirms both seed rows present with correct roles.
- [ ] `npm test -w backend` passes, including all `db.test.ts` cases (connection, every §8.1 column type, UTC timestamp round-trip, pool close).
- [ ] Full boot→connect→shutdown lifecycle demonstrated; `curl /api/health` returns 200; SIGTERM exits cleanly within 10s.
- [ ] `created_at`/`updated_at` round-trip as `Date` instances and are stored as `timestamp with time zone` (D6 proven).
- [ ] `npm run lint`, `npm run format:check`, `npm run typecheck` all pass on the as-merged feature.
- [ ] Integration record filled in §7.

**Dependencies:** T3 (full boot/shutdown lifecycle must be wired).

---

## 7. Final F02 Acceptance Checklist

- [ ] **Postgres reachable locally** — `docker compose up -d` brings up a healthy `postgres:16` container; `pg_isready` returns accepting. (D9)
- [ ] **Migration tool wired** — `db:generate`, `db:push`, `db:migrate`, `db:studio`, `db:seed` scripts in `backend/package.json`; Drizzle ORM documented as the chosen client (cross-cutting decision #1 RESOLVED). (D1, D2, D4)
- [ ] **`Users` table matches PRD §8.1 and seeds cleanly** — columns `id` (uuid PK), `google_id` (unique), `email` (unique), `full_name`, `avatar_url` (nullable), `role` (Role enum ADMIN/MEMBER); `db:seed` plants ADMIN + MEMBER rows idempotently. (D11 for the extra timestamps)
- [ ] **Connection pool configured** — `pg.Pool` `max: 5` wrapped by `drizzle(pool)`; Supavisor session-mode URL ready for hosted deploy. (D3)
- [ ] **App shuts down gracefully (no hanging sockets)** — `shutdown()` calls `server.close()` → 10s hard-deadline timer → `pool.end()` → `process.exit(0)`; `lsof` confirms no leaked connections. (D13)
- [ ] **UTC `timestamptz`** — every timestamp column uses `timestamp({ withTimezone: true })`; `TZ=UTC` in `.env.example`; integration test asserts `timestamp with time zone` column type. (D6)
- [ ] **Retry/backoff on cold start** — `connectWithRetry` runs before `app.listen`, 5 attempts exponential + jitter, validates via `pool.query('SELECT 1')`; boot fails fast + non-zero if DB unreachable. (D7)
- [ ] **`DATABASE_URL` fail-fast** — empty/missing `DATABASE_URL` throws at config load, matching the `FRONTEND_URL` idiom. (D12)
- [ ] **dotenv env loading** — `import 'dotenv/config'` in `env.ts`, `seed.ts`, `drizzle.config.ts`; F01 `dev` script untouched. (D8)
- [ ] Lint + format checks pass on an empty change.
- [ ] Typecheck + tests pass (`npm run typecheck && npm test`).
- [ ] `.gitignore` has `node_modules/`, `.env`, `dist/`, `build/`, `*.log`, `.DS_Store`.
- [ ] Branch named `feature/SLYK-<n>-db-connection-migration-pipeline` (or omit ticket if unknown); commits single-line `SLYK-<n>: msg`; rebase-and-merge only.

**Integration record (fill during T4):**
- Feature commit SHA: `________`
- `docker compose up -d` healthcheck: `________` (timestamp)
- `db:migrate` applied migration file: `backend/src/db/migrations/0000_<name>.sql`
- `db:seed` output: `Seeded 2 users`
- `GET /api/health` response: `________`
- `psql \d "Users"` columns confirmed: `________`
- SIGTERM exit time: `________`s (must be ≤ 10s)
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0`

---

## 8. Schema deltas owned by this feature

F02 owns **no row** in the `features.md` schema-deltas table — that table tracks deltas *vs.* the PRD §8 draft (Tickets.position, Labels table, etc.). F02 instead ships the **baseline** schema (the `users` table) that the PRD §8.1 already specifies.

However, F02 **RESOLVES cross-cutting decision #1** from `features.md` ("ORM/client: Prisma vs. Drizzle vs. raw `pg` — decide in F02, never again"):

| Cross-cutting decision | Resolution | Owner sign-off |
| --- | --- | --- |
| **#1 ORM/client** | **Drizzle ORM** (`drizzle-orm` + `drizzle-kit`) with `node-postgres` (`pg`). Committed TS schema at `backend/src/db/schema.ts`; `pg.Pool` wrapped by `drizzle(pool)`. Every later feature (F05 user upsert, F08 Projects, F12 Tickets, F18 ActivityLogs, F20 TimeEntries) inherits this client, the `schema.ts` → `db:generate` → `db:migrate` pipeline, and the `.$onUpdate` `updated_at` convention. | ✅ Owner-confirmed. |

One additive schema choice F02 makes (not a delta vs. PRD, but a convention set here that all later tables inherit):

| Addition | Detail | Migration |
| --- | --- | --- |
| `Users.created_at` / `Users.updated_at` | `timestamptz`, `DEFAULT now()` / bumped via Drizzle `.$onUpdate`. PRD §8.1 omits them; F02 adds per convention (D11). | Inside `0000_<name>.sql`: `created_at timestamptz DEFAULT now() NOT NULL`, `updated_at timestamptz DEFAULT now() NOT NULL`. |
| **Timestamp convention (`timestamp({ withTimezone: true })`)** | Every timestamp column in every future model MUST use `withTimezone: true`. F02 sets the precedent; PRD §8.3/§8.4/§8.5 tables with timestamps inherit it. | N/A (convention, enforced at PR review). |
| **`updated_at` auto-bump convention (`.$onUpdate`)** | Every table with an `updated_at` column wires `.$onUpdate(() => new Date())` so repos never set it manually. F02 sets the precedent. | N/A (convention, enforced at PR review). |
