# F29 — Deployment & self-host packaging: Plan + Task Breakdown

> **Feature:** F29 — Deployment & self-host packaging (Phase 8 — Deployment)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F01–F28 (all DONE ✅) · **PRD ref:** §3 (Goal 2 — self-hostable, easy-to-deploy; Success Metric: "Successful deployment via Docker/Render"), §5 (Dockerized self-hosting — VPS/Render/Supabase for DB), REQ-1.1 (Google SSO), REQ-1.2 (`ALLOWED_DOMAIN` workspace restriction), REQ-1.3 (Admin/Member roles — `JWT_SECRET`); `.claude/rules/js-development-rules.md` (Deployment — Frontend/Backend)
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), project rules (`.claude/rules/`), dependency task doc: [F02](../F02-database-and-migrations/F02-database-and-migrations-tasks.md) (migration pipeline). Memory: `drizzle-partial-index-enum-dollar1` (validate the 0000–0012 migrate set applies cleanly — spot-check enum partial-index SQL). **NOTE:** memory `dev-db-push-based-no-migration-journal` does **NOT** apply to this repo — it describes the separate `slykboard-db` repo; this backend HAS a real migration journal (`drizzle.config.ts` + `0000–0012.sql` + `meta/_journal.json` v7 + programmatic `backend/src/db/migrate.ts`), so F29 wires drizzle `migrate()` — NOT push, NOT psql-pipe.

> **NOTE on `js-development-rules.md` Backend Deployment command:** the rules state start command `node src/index.js` (TypeScript source). This is stale/inaccurate for a compiled Docker image. F29 resolves to `node dist/index.js` (compiled output — see D5). Flagged in §9.

---

## 1. F29 Recap

**Goal:** Anyone can run Slykboard — `docker compose up` brings up a working stack, and the hosted paths (Render + Vercel + Supabase) are documented and reproducible.

**Ships:** Dockerized backend (multi-stage `node:24-bookworm-slim`, non-root, `tini`); Dockerized frontend (nginx multi-stage serving `dist/` with SPA fallback); `docker-compose.prod.yml` with Postgres 16 + backend + frontend (healthchecks, named volume, migrate-on-boot, one-command self-host); `render.yaml` (Render Docker web service blueprint) + `vercel.json` (Vite SPA rewrite); complete `.env.example` files (backend + frontend + root) and a step-by-step `docs/deployment.md` covering self-host compose, Render, Vercel, Supabase (pooler 6543 + direct 5432), secrets, migrations, manual rollback, OAuth/CORS/Google-Console setup; migrations wired to boot via a gated `migrate()` call before `app.listen`; a readiness probe (`/api/health/ready` with `SELECT 1`) alongside the existing liveness `/api/health`.

**Acceptance (definition of done):**
- `docker compose up` brings up a working stack.
- Production build of frontend served by backend or a static host with correct base path.
- All required env vars documented (`.env.example` complete + a deployment guide in `docs/`).
- Migrations run on startup or via a documented release step.

**Edge cases to resolve up front:**
- **Secret management: `JWT_SECRET`, OAuth creds, `DATABASE_URL` must never be defaulted in prod** → **Decision:** `backend/src/config/env.ts` already fail-fast throws on all 6 required vars (`FRONTEND_URL`, `DATABASE_URL`, `JWT_SECRET` ≥32 chars, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`) at module load — crash before `listen` if missing. F29 keeps this, completes `.env.example` with zero-value placeholders + required/optional comments, and documents that prod secrets live in Render env group / Vercel project env (encrypted), never in the image. No defaults for the 6 required vars in any prod path.
- **CORS + OAuth callback URL must match the deployed origin** → **Decision:** CORS stays locked to `env.frontendUrl` (single origin, `index.ts:27-36` — D9, no wildcard). Origin-coupling is `FRONTEND_URL` (CORS) + Google Console **Authorized JavaScript origins** only. `GOOGLE_CALLBACK_URL` stays the literal `'postmessage'` sentinel (`googleClient.ts:5-9`, GIS popup auth-code flow — NOT a real redirect route, origin-agnostic). Documented in `docs/deployment.md`. **Preview-URL limitation:** Vercel per-PR preview URLs can't all be registered in Google Console → use stable prod callback; OAuth on previews is documented as "disable or use prod origin".
- **Health check endpoint for Render / container orchestration** → **Decision:** keep `/api/health` (liveness-only, non-enveloped, `index.ts:44-51`) for Render `healthCheckPath` (Render ignores Docker `HEALTHCHECK`). ADD `/api/health/ready` (enveloped? No — non-enveloped to match `/api/health`) returning `{ status:'ok', db:'ok' }` after a `SELECT 1` probe — used by `docker-compose.prod.yml` `depends_on: condition: service_healthy` for backend readiness (D7).
- **DB migration strategy on version upgrades** → **Decision:** forward-only drizzle `migrate()` (programmatic, `drizzle-orm/node-postgres/migrator`) against the DIRECT url, baked into the image, gated by `RUN_MIGRATIONS_ON_START` (default true in prod image). NEVER `push` in prod (skips SQL, no audit). NO automatic rollback — document manual rollback (revert code + restore from DB backup) in `docs/deployment.md`. Validate the full 0000–0012 set applies cleanly on a fresh DB in T4/T9 (memory `drizzle-partial-index-enum-dollar1` — spot-check the enum partial-index SQL).

---

## 2. Codebase Analysis Summary

- **State:** F01–F28 all DONE ✅. Monorepo: npm workspaces (`frontend` + `backend`), ESM, Node ≥24 (`.nvmrc` 24, `.npmrc` engine-strict). Root `package.json` scripts: `dev` (concurrently), `build` (`npm run build -w backend && -w frontend`), `test`. **No root `start` script.** Existing deploy artifacts: `docker-compose.yml` (dev-only, single `postgres:16` service, pg_isready healthcheck), `backend/.env.example` (EXISTS), `frontend/.env.example` (EXISTS), `Makefile` (root — `bootstrap`/`up`/`migrate`/`env`/`health` targets). **GAPS:** no Dockerfile (BE or FE), no `.dockerignore`, no `render.yaml`, no `vercel.json`, no `nginx.conf`, no `docs/` dir (only `.docs/`), migrations not wired to startup, health liveness-only, no static serve, router/vite root-path only.
- **Existing structure this feature builds on:**
  - **Backend entry `backend/src/index.ts`:** builds Express app at module load; `start()` (`:71-105`) = `connectWithRetry(pool)` → `app.listen(env.port)`. SIGTERM/SIGINT graceful shutdown (10s hard deadline, `server.close` + `pool.end`). `isMain` guard (`:69`, `import.meta.url === pathToFileURL(process.argv[1]).href`) — `start()` only runs when executed directly. Exports `app` for tests. **F29 modifies `start()`:** insert `migrate()` call (gated) between `connectWithRetry` and `app.listen`.
  - **Config `backend/src/config/env.ts:16-53`:** `loadConfig()` fail-fast at module load (throws before `listen` if any required var missing). Required: `FRONTEND_URL`, `DATABASE_URL`, `JWT_SECRET` (≥32), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`. Optional: `PORT` (3000), `NODE_ENV` (development), `JWT_TTL` (8h), `ALLOWED_DOMAIN` (unset=allow-all). `env` is `Object.freeze`d. **F29 adds:** `runMigrationsOnStart` (bool, default from `NODE_ENV==='production'`) + `directDatabaseUrl` (optional, Supabase direct 5432 for migrate).
  - **Health `index.ts:44-51`:** `GET /api/health` non-enveloped → `{status:'ok', service, uptime, timestamp}` — LIVENESS ONLY (no DB probe). **F29 adds** `/api/health/ready` (SELECT 1).
  - **CORS `index.ts:27-36`:** `origin: env.frontendUrl` (single), `credentials:true`, fixed methods/headers, `maxAge:86400` — LOCKED to `FRONTEND_URL`. No wildcard. Helmet global.
  - **DB migrations:** `drizzle.config.ts` (schema `./src/db/schema.ts`, out `./src/db/migrations`, postgresql, reads `DATABASE_URL`). Migrations dir `backend/src/db/migrations/` — 13 migrations `0000`–`0012` (latest `0012_dark_peter_quill.sql` DROP INDEX), journal `meta/_journal.json` (13 entries, v7). **TWO migration paths, NEITHER wired to startup:** (1) `drizzle-kit migrate` CLI; (2) `backend/src/db/migrate.ts` standalone script (`:1-22` — own `Pool`, `migrate(db,{migrationsFolder})`, `pool.end`+exit; invoked via `make migrate` = `cd backend && npx tsx src/db/migrate.ts`). `index.ts` startup does NOT run migrations (only `connectWithRetry` SELECT 1).
  - **DB client `backend/src/db/client.ts`:** lazy singleton `Pool` `max:5`, `drizzle(pool,{schema})` — comment "single Render service, low concurrency".
  - **Build/start:** BE `build=tsc -p tsconfig.json` → `dist/`; `start=node dist/index.js` (ESM, compiled). FE `build=tsc -b && vite build` → `dist/`. `dist/` gitignored (`.gitignore:11`).
  - **Frontend `frontend/vite.config.ts`:** `plugins:[react(), tailwindcss()]`; **NO `base` option** (defaults `/`), NO `outDir` override (`dist/`), no server host/port. **Router `routes/index.tsx:36`:** `createBrowserRouter`, **NO `basename`** (assumes root `/`). → sub-path hosting would break router + vite base (D12: out of scope for MVP).
  - **Frontend env `frontend/src/config/env.ts`:** `VITE_API_BASE_URL` required, `VITE_GOOGLE_CLIENT_ID` required, `VITE_POLL_INTERVAL_SECONDS` optional default 30. VITE vars baked at BUILD time (per-env rebuild needed — documented).
  - **Google OAuth:** popup/GIS flow — frontend GIS popup → `POST /api/auth/google` (`auth.routes.ts:15`) → `exchangeCodeForUser(code)` → `googleClient.getToken` → verify id_token audience=`googleClientId`, `email_verified`. `googleClient.ts:5-9` `OAuth2Client(clientId, secret, GOOGLE_CALLBACK_URL)` — `GOOGLE_CALLBACK_URL` = literal `'postmessage'` (GIS popup auth-code flow) — NOT a real redirect URL. So `GOOGLE_CALLBACK_URL` is **origin-agnostic**; only `FRONTEND_URL` (CORS) + Google Console Authorized JavaScript origins are origin-coupled. Logout OAuth token revocation TODO at `auth.routes.ts:93` (deferred — see §9 D14).
- **Prior art / partial work:** `docker-compose.yml` (dev-only, F02/F10 — Postgres for local dev). `backend/.env.example` + `frontend/.env.example` (exist but may be incomplete — F29 completes them). `Makefile` (dev convenience). `backend/src/db/migrate.ts` (F02 — standalone migrate script, container-safe pattern to reuse). `connectWithRetry` (`backend/src/db/connect.ts`) — F29 calls `migrate()` AFTER this succeeds.
- **File paths the plan references that do NOT exist yet (will be created):** `Dockerfile` (root, BE context), `frontend/Dockerfile` (FE context), `frontend/nginx.conf`, `.dockerignore` (root), `docker-compose.prod.yml`, `render.yaml` (root), `vercel.json` (root), `docs/deployment.md`. (`.env.example` files exist — F29 completes/validates them.)
- **Files F29 modifies:** `backend/src/index.ts` (`migrate()` in `start()` before `listen` + new `/api/health/ready` SELECT 1 route), `backend/src/config/env.ts` (add `runMigrationsOnStart` + `directDatabaseUrl`), `backend/.env.example` + `frontend/.env.example` (complete with new vars + comments), possibly a root `.env.example` (self-host compose). **No FE source change** (FE is build-only — D12 sub-path out of scope).
- **Project rules this plan must satisfy:** `.claude/rules/git-guidelines.md` (SLYK-F29 prefix; `feature/SLYK-F29-deployment-self-host` branch; single-line commits; rebase-merge only; release branches `release/1.2.3` version-only), `.claude/rules/js-development-rules.md` (Deployment — Frontend: Vercel build `npm run build`, publish `dist`, env in dashboard; Backend: Render build `npm install`, start `node dist/index.js` [rules stale — D5 resolves], env table; Security: no secrets in code, CORS specific frontend URL only, parameterized queries, auth middleware), `.claude/rules/js-style-guide.md` (no `console.log` — use `logger`; no secrets in code), `.claude/rules/js-testing-rules.md` (verification via existing test suites — F29 adds no new tests but must not break them). `.gitignore` required entries (`node_modules/`, `.env`, `dist/`, `build/`, `*.log`, `.DS_Store`) → basis for `.dockerignore`.
- **Hidden coupling to plan for:**
  - `backend/src/index.ts` + `backend/src/config/env.ts` are BOTH touched by T4 → sequenced within T4 (single owner) to avoid conflict.
  - `migrate()` against Supabase transaction-mode pooler (6543) breaks prepared statements → app `Pool` needs `prepare:false` OR migrate against DIRECT 5432. F29 uses DIRECT url for migrate (D4/D8) — a NEW env var `DIRECT_DATABASE_URL`.
  - Drizzle `migrate()` resolves the migrations folder at runtime via `import.meta.url` → must be baked into the Docker image at a known path (`backend/src/db/migrations` stays in-tree; image copies it).
  - Memory `drizzle-partial-index-enum-dollar1`: drizzle-kit emitted unapplyable `$1` SQL for an enum partial index in a sibling repo. This repo's `0000`–`0012` set MUST be validated to apply cleanly via `migrate()` on a fresh DB before relying on it at deploy (T4 spot-check + T9 full fresh-DB apply).
  - Memory `dev-db-push-based-no-migration-journal`: does NOT apply (separate `slykboard-db` repo). This backend HAS a journal.
  - `isMain` guard in `index.ts:69`: `migrate()` in `start()` only runs when executed directly (not under `vitest`/supertest which import `app`). Good — tests won't trigger migrate.
  - FE VITE vars are build-time-baked → a Vercel deploy needs a per-env rebuild with the correct `VITE_API_BASE_URL` (no runtime injection).
  - Render ignores Docker `HEALTHCHECK` (uses its own HTTP probe) → `render.yaml` `healthCheckPath: /api/health` is what Render uses; Docker `HEALTHCHECK` is for compose/self-host.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Backend Docker base image | **`node:24-bookworm-slim` (multi-stage deps→build→runner, non-root `node` user, `tini` PID 1)** | Node 24 (`.nvmrc`); **bookworm-slim NOT alpine** — musl breaks native deps (e.g. `pg`/`better-sqlite3`-class builds); ~120MB. Multi-stage keeps final image lean. `tini` (`--init` or `ENTRYPOINT ["tini","--"]`) reaps zombies + forwards SIGTERM to the existing graceful-shutdown handler (`index.ts:88`). Non-root `USER node`. Research (Analysis D). |
| D2 | Frontend serving strategy | **nginx multi-stage for self-host (`node:24-slim` build → `nginx:alpine` serve `dist/`, SPA `try_files` fallback + gzip) + Vercel for hosted** | Decouples FE release cadence from BE; nginx ~25MB; `try_files $uri $uri/ /index.html;` prevents deep-link 404 on refresh (research). Rejects BE-served `express.static` (one container) — simpler but slower + couples releases (flagged §9). Vercel = hosted alt per PRD §5 + rules (Vite preset). |
| D3 | Production compose | **`docker-compose.prod.yml` (3 services: `postgres:16` pg_isready+named volume → `backend` depends_on service_healthy → `frontend` nginx), kept SEPARATE from dev `docker-compose.yml`** | One-command self-host (acceptance #1). 3 independently-scalable services, decoupled. Dev compose stays simple (Postgres-only). `depends_on: condition: service_healthy` gates backend on DB + gates frontend on backend. Research. |
| D4 | Migrations on startup | **Programmatic `migrate()` in `start()` AFTER `connectWithRetry` + BEFORE `app.listen`, gated by `RUN_MIGRATIONS_ON_START` (default true in prod image), against DIRECT url, `drizzle/` baked into image, NEVER `push`** | Single BE instance (no replica race) — `db/client.ts` comment confirms "single Render service". `migrate()` is idempotent (`__drizzle_migrations`); drizzle docs say NEVER `push` in prod (skips SQL, no audit/rollback). This repo HAS a journal (`drizzle.config.ts` + 0000–0012 + `migrate.ts`) — memory `dev-db-push-based-no-migration-journal` does NOT apply (separate repo). Bake migrations folder into image at known path. |
| D5 | Backend start command | **`node dist/index.js` (compiled) — NOT `node src/index.js`** | `backend/package.json` `start=node dist/index.js`, `build=tsc -p tsconfig.json` → `dist/`. `.claude/rules/js-development-rules.md` Deployment(Backend) says `node src/index.js` — STALE (TS source). F29 resolves to compiled `dist/`. Flagged §9. |
| D6 | Secrets handling | **`.env.example` complete (zero-value placeholders + required/optional comments) + fail-fast `env.ts` (already throws) + Render env group / Vercel project env (encrypted); NEVER default the 6 required vars in prod** | `env.ts:16-53` already throws on all 6 required vars at module load — crash before `listen`. `.gitignore` excludes `.env`. Docker `env_file` for self-host compose. Spec edge case #1. |
| D7 | Health probes | **`/api/health` (liveness, existing, non-enveloped) for Render `healthCheckPath` + NEW `/api/health/ready` (non-enveloped, `SELECT 1` probe) for compose `depends_on` readiness** | Render ignores Docker `HEALTHCHECK` (uses its own HTTP probe). Compose needs a DB-aware readiness gate so frontend starts only after backend can reach DB. Both non-enveloped to match existing `/api/health` (F03 D10 exception). Spec edge case #3. |
| D8 | Supabase connection modes | **`DATABASE_URL` = pooler 6543 transaction-mode (app `Pool`, `prepare:false`) + `DIRECT_DATABASE_URL` = direct 5432 (migrate)** | Drizzle + pgbouncer transaction-mode: prepared statements break → app `Pool` `prepare:false`. Migrations MUST run against DIRECT 5432 (pgbouncer can't run DDL reliably in transaction mode). Two env vars. Research (Analysis D #8). |
| D9 | CORS + OAuth origin coupling | **CORS stays `origin: env.frontendUrl` (single, no wildcard); `GOOGLE_CALLBACK_URL` stays `'postmessage'` (GIS popup); origin-coupling = `FRONTEND_URL` (CORS) + Google Console Authorized JavaScript origins** | `index.ts:27-36` already single-origin. `googleClient.ts:5-9` uses `'postmessage'` sentinel (popup auth-code flow — NOT a redirect route), so `GOOGLE_CALLBACK_URL` is origin-agnostic. Only `FRONTEND_URL` + Google Console JS origins are origin-coupled. Preview-URL limitation documented (§1, §8). Spec edge case #2. |
| D10 | Vercel frontend hosting | **Vite preset (auto) + `vercel.json` SPA rewrite `{"rewrites":[{"source":"/(.*)","destination":"/index.html"}]}` + `VITE_API_BASE_URL` → Render backend (baked at build)** | Vite preset auto-detected; `npm run build` → `dist`. SPA rewrite prevents deep-link 404 (research #7). VITE vars baked at build → per-env rebuild. |
| D11 | Render backend hosting | **Docker web service (one artifact for self-host + Render) + `render.yaml` blueprint + `healthCheckPath: /api/health` + stateless (no disk)** | One Dockerfile serves both self-host and Render (PRD §5: "Dockerized ... Render"). `render.yaml` = reproducible infra. Stateless (migrations on boot, no local disk). Research #6. |
| D12 | Sub-path hosting | **OUT OF SCOPE for MVP** | `vite.config.ts` has no `base` (defaults `/`); `routes/index.tsx:36` `createBrowserRouter` no `basename`. Sub-path hosting needs `base` + `basename` + asset-path changes — documented as future work in `docs/deployment.md`. MVP assumes root-path or a dedicated (sub)domain. |
| D13 | Schema / migration owned by F29 | **NONE** | F29 owns NO DB schema change; only wires migrate-on-boot. The 0000–0012 set is pre-existing (F02 et al.). F29 validates it applies cleanly but authors no new migration. |
| D14 | OAuth token revocation TODO (`auth.routes.ts:93`) | **DEFER (out of F29 scope)** | Pre-existing logout-revocation TODO. Not a deploy/packaging concern; deferred unless trivial. Flagged §9. |

> **Out of F29 scope (explicitly deferred):** sub-path hosting (D12 — needs vite `base` + router `basename`); OAuth token revocation on logout (D14 — `auth.routes.ts:93` TODO); runtime FE env injection (VITE vars stay build-time-baked — per-env rebuild); Sentry/error-tracking; automatic DB rollback (forward-only only — manual rollback documented); multi-region/HA (single instance per `db/client.ts` comment); CI/CD pipeline beyond `render.yaml`/Vercel auto-deploy; CDN for FE assets.

> **Owner sign-off needed:** (a) nginx-served FE vs BE-served FE (D2 — recommend nginx, decoupled); (b) `RUN_MIGRATIONS_ON_START` default true in prod image (D4); (c) NEW `DIRECT_DATABASE_URL` env var (D4/D8); (d) sub-path hosting out of scope (D12); (e) new `docker-compose.prod.yml` vs extending dev `docker-compose.yml` (D3 — recommend separate); (f) OAuth token revocation in F29 or defer (D14 — recommend defer). Full list in §9.

---

## 4. Architecture Overview (Target Tree)

```
/  (repo root)
├── Dockerfile                                   # NEW — backend multi-stage (node:24-bookworm-slim, non-root, tini, migrations baked in)
├── .dockerignore                                # NEW — mirrors .gitignore (node_modules/.env/dist/build/*.log/.DS_Store)
├── docker-compose.prod.yml                      # NEW — 3 services (postgres:16 → backend → frontend nginx), healthchecks, volume, env
├── render.yaml                                  # NEW — Render Docker web service blueprint, healthCheckPath /api/health, env keys
├── vercel.json                                  # NEW — Vite SPA rewrite
├── .env.example                                 # NEW (root) — self-host compose env (or document in docs/deployment.md)
├── docs/
│   └── deployment.md                            # NEW — self-host compose + Render + Vercel + Supabase + secrets + migrations + rollback + OAuth/CORS/Google-Console + preview caveat
├── docker-compose.yml                           # (existing dev-only — UNCHANGED)
├── Makefile                                     # (existing — optionally add prod targets; not required)
├── backend/
│   ├── .env.example                             # MODIFY — complete: add DIRECT_DATABASE_URL + RUN_MIGRATIONS_ON_START + required/optional comments
│   └── src/
│       ├── index.ts                             # MODIFY — migrate() in start() after connectWithRetry, gated; new /api/health/ready SELECT 1
│       ├── config/
│       │   └── env.ts                           # MODIFY — add runMigrationsOnStart (bool) + directDatabaseUrl (optional)
│       └── db/
│           └── migrations/                      # (existing 0000-0012 — baked into Docker image; validated applies cleanly)
└── frontend/
    ├── Dockerfile                               # NEW — nginx multi-stage (node:24-slim build → nginx:alpine serve dist/)
    ├── nginx.conf                               # NEW — SPA try_files fallback + gzip + (optional) /api proxy
    └── .env.example                             # MODIFY/validate — VITE_API_BASE_URL + VITE_GOOGLE_CLIENT_ID + VITE_POLL_INTERVAL_SECONDS documented
```

**Boot lifecycle (non-obvious flow):**
- Container starts → `tini` → `node dist/index.js` → module load runs `loadConfig()` (fail-fast — throws if any of 6 required vars missing → crash before `listen`) → `isMain` true → `start()` → `connectWithRetry(pool)` (SELECT 1, retries) → **if `runMigrationsOnStart`**: `migrate(db, { migrationsFolder })` against `directDatabaseUrl ?? databaseUrl` (idempotent via `__drizzle_migrations`; idempotent re-runs on restart) → `app.listen(env.port)` → `/api/health/ready` returns `{status:'ok', db:'ok'}` once listening → compose `depends_on: service_healthy` unblocks `frontend` nginx container.
- Compose: `postgres` (pg_isready healthy) → `backend` (depends_on postgres healthy; own `/api/health/ready` healthcheck) → `frontend` (depends_on backend healthy).
- Render: Docker web service boots same `node dist/index.js`; Render polls `healthCheckPath: /api/health` (liveness); migrate-on-boot runs (generous grace period — finishes before listen).
- Vercel: FE build-only (`vite build` → `dist`); `vercel.json` SPA rewrite; `VITE_API_BASE_URL` baked → Render backend URL.

---

## 5. Parallelization Strategy

Tasks are grouped into **5 batches** by dependency order. Within a batch, tasks touch **disjoint file sets** → zero merge conflicts → safe to run in parallel.

Two shared backend files (`index.ts`, `env.ts`) are BOTH owned by T4 — sequenced within T4 (single task) to avoid conflict. `docker-compose.prod.yml` (T3) references image names from T1/T2 and depends on T4's migrate-on-boot wiring.

### Batch dependency diagram

```
Batch 1 (disjoint new files — fully parallel)
  T1 BE Dockerfile + .dockerignore  ─┐
  T2 FE Dockerfile + nginx.conf       │  (all new disjoint files)
  T5 .env.example completion          │
  T6 render.yaml + vercel.json       ─┘

                        │  (Batch 1 merged — images buildable, env/templates exist)
                        ▼
Batch 2 (backend boot wiring — owns index.ts + env.ts)
  T4 migrate-on-boot + /api/health/ready + env.ts flags

                        │  (Batch 2 merged — backend boots with migrate + ready probe)
                        ▼
Batch 3 (compose — references T1/T2 images + T4 wiring)
  T3 docker-compose.prod.yml

                        │  (Batch 3 merged — full stack can come up)
                        ▼
Batch 4 (docs — depends on all prior)
  T8 docs/deployment.md

                        │
                        ▼
Batch 5 (terminal — verification)
  T9 docker build + compose up smoke + fresh-DB migrate + tsc/lint/build
```

- **Batch 1 → Batch 2** is a hard barrier: T4's Dockerfile (T1) bakes in migrations + T4 modifies the very `index.ts` the BE image runs — but T4's code change must land before the image is reproducible end-to-end. (T1 can be authored in parallel since it just references `dist/` + `migrations/`; the merge order is T1 then T4, but they touch disjoint files so no conflict.)
- **Batch 2 → Batch 3** is a hard barrier: T3 compose depends_on backend's `/api/health/ready` (T4) and references the image names from T1/T2.
- **Batch 3 → Batch 4** is a hard barrier: docs reference the final compose + Render + Vercel artifacts.
- **Batch 4 → Batch 5** is a hard barrier: verification runs against the fully merged feature.

### Merge order rules
1. **Batch 1 merges first.** T1, T2, T5, T6 are fully disjoint (new files) — merge in any order. What must be on main before Batch 2: `Dockerfile` (BE), `frontend/Dockerfile` + `nginx.conf`, `.dockerignore`, complete `.env.example`s, `render.yaml`, `vercel.json`.
2. **Batch 2 (T4) merges second.** T4 owns `backend/src/index.ts` + `backend/src/config/env.ts` (single owner — no conflict). Branches from Batch 1 merged state.
3. **Batch 3 (T3) merges third.** `docker-compose.prod.yml` references BE/FE images + backend ready probe.
4. **Batch 4 (T8) merges fourth.** `docs/deployment.md` documents the as-built stack.
5. **Batch 5 (T9) merges last.** Verification gate.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | 1 | `Dockerfile`, `.dockerignore` | — | T2, T5, T6 |
| **T2** | 1 | `frontend/Dockerfile`, `frontend/nginx.conf` | — | T1, T5, T6 |
| **T5** | 1 | `backend/.env.example`, `frontend/.env.example`, root `.env.example` | — | T1, T2, T6 |
| **T6** | 1 | `render.yaml`, `vercel.json` | — | T1, T2, T5 |
| **T4** | 2 | `backend/src/index.ts`, `backend/src/config/env.ts` | Batch 1 (T1 for image context) | — |
| **T3** | 3 | `docker-compose.prod.yml` | T1, T2, T4 | — |
| **T8** | 4 | `docs/deployment.md` | T1, T2, T3, T4, T5, T6 | — |
| **T9** | 5 | (verification — no file changes) | all prior | — |

### Developer assignment tracks
- **Solo:** (T1 ‖ T2 ‖ T5 ‖ T6) → T4 → T3 → T8 → T9.
- **2 devs:** Dev-A: T1 → T4 → T3 → T9. Dev-B: T2 → T5 → T6 → T8. (Converge on T9.)
- **3 devs:** Dev-A: T1 + T4; Dev-B: T2 + T3; Dev-C: T5 + T6 + T8 — then T9.

---

## 6. Tasks

### T1 — Backend Dockerfile + .dockerignore

**Batch:** 1 · **Depends on:** — · **Parallel with:** T2, T5, T6

**Description:** Dockerize the backend for both self-host (compose) and Render (Docker web service, D11). Multi-stage `node:24-bookworm-slim` (D1): `deps` (install production deps) → `build` (tsc → `dist/`) → `runner` (copy `dist/` + `node_modules` + `migrations/`, non-root, `tini`). Migrations folder baked in at known path for T4's `migrate()`.

Create:
- `Dockerfile` (root, build context = repo root for workspace install, OR `backend/` — recommend root context to honor npm workspaces; final stage copies `backend/dist` + `backend/node_modules` + `backend/src/db/migrations`):
  ```dockerfile
  # ---- deps ----
  FROM node:24-bookworm-slim AS deps
  WORKDIR /app
  COPY package.json package-lock.json* ./
  COPY backend/package.json ./backend/
  RUN npm ci --workspaces --include-workspace-root || npm install --workspaces
  # ---- build ----
  FROM deps AS build
  COPY backend/ ./backend/
  RUN npm run build -w backend
  # ---- runner ----
  FROM node:24-bookworm-slim AS runner
  ENV NODE_ENV=production
  RUN apt-get update && apt-get install -y --no-install-recommends tini wget \
      && rm -rf /var/lib/apt/lists/*
  WORKDIR /app
  COPY --from=deps /app/node_modules ./node_modules
  COPY --from=deps /app/backend/node_modules ./backend/node_modules
  COPY --from=build /app/backend/dist ./backend/dist
  COPY --from=build /app/backend/src/db/migrations ./backend/src/db/migrations
  COPY backend/package.json ./backend/
  USER node
  EXPOSE 3000
  HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
  ENTRYPOINT ["/usr/bin/tini", "--"]
  CMD ["node", "backend/dist/index.js"]
  ```
  (Adjust exact `node_modules` layout for npm workspaces — verify in T9 `docker build`.) `NODE_ENV=production` set. `RUN_MIGRATIONS_ON_START` defaults true in prod (T5 env.example documents; env.ts D4 logic derives from `NODE_ENV` if unset). `tini` PID 1 (D1).
- `.dockerignore` (root) — mirror `.gitignore`: `node_modules`, `**/node_modules`, `.env`, `.env.*`, `dist`, `**/dist`, `build`, `*.log`, `.DS_Store`, `.git`, `.gitignore`, `Dockerfile`, `*.md`, `.docs`, `docs`, `coverage`. Keeps build context lean; prevents secrets leaking into image layers.

**Acceptance Criteria:**
- [ ] `docker build -f Dockerfile -t slykboard-backend .` succeeds (T9 verifies).
- [ ] Final image runs as non-root `node` user; `tini` PID 1.
- [ ] `dist/` + `migrations/` baked into image at `backend/dist` + `backend/src/db/migrations`.
- [ ] `.dockerignore` excludes `node_modules`, `.env*`, `dist`, `.git`.
- [ ] `HEALTHCHECK` defined (Render ignores it; used by self-host/compose where not overridden).
- [ ] Image starts with `node backend/dist/index.js` (compiled — D5).

**Dependencies:** —

---

### T2 — Frontend Dockerfile + nginx.conf

**Batch:** 1 · **Depends on:** — · **Parallel with:** T1, T5, T6

**Description:** Dockerize the frontend for self-host (compose) — nginx multi-stage serving `dist/` (D2). `node:24-slim` builds (`tsc -b && vite build`) → `nginx:alpine` serves `dist/` with SPA fallback + gzip. `VITE_*` vars passed as build `ARG`s (baked at build per D10).

Create:
- `frontend/Dockerfile` (build context = `frontend/`):
  ```dockerfile
  # ---- build ----
  FROM node:24-slim AS build
  WORKDIR /app
  ARG VITE_API_BASE_URL
  ARG VITE_GOOGLE_CLIENT_ID
  ARG VITE_POLL_INTERVAL_SECONDS=30
  ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
  ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
  ENV VITE_POLL_INTERVAL_SECONDS=$VITE_POLL_INTERVAL_SECONDS
  COPY package.json package-lock.json* ./
  RUN npm ci
  COPY . .
  RUN npm run build
  # ---- runner ----
  FROM nginx:alpine AS runner
  COPY --from=build /app/dist /usr/share/nginx/html
  COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
  EXPOSE 80
  CMD ["nginx", "-g", "daemon off;"]
  ```
  (If context = `frontend/`, drop the `frontend/` prefix on the `nginx.conf` COPY.)
- `frontend/nginx.conf`:
  ```nginx
  server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    location / {
      try_files $uri $uri/ /index.html;   # SPA fallback (D2)
    }
    # Optional: proxy /api to backend (uncomment if same-origin desired)
    # location /api/ { proxy_pass http://backend:3000; }
  }
  ```
  `try_files` prevents deep-link 404 on refresh (research #2). gzip on. Optional `/api` proxy (commented — FE typically calls cross-origin Render/Vercel-configured URL; proxy only for single-origin self-host).

**Acceptance Criteria:**
- [ ] `docker build -f frontend/Dockerfile -t slykboard-frontend .` succeeds (T9).
- [ ] Final image = `nginx:alpine` serving `/usr/share/nginx/html`.
- [ ] `nginx.conf` has `try_files $uri $uri/ /index.html;` (deep-link refresh works).
- [ ] gzip enabled for css/js/json/svg.
- [ ] `VITE_*` build args accepted (baked at build).
- [ ] No `.env` copied into image (FE Dockerfile relies on build args, not env file).

**Dependencies:** —

---

### T3 — docker-compose.prod.yml (3-service self-host stack)

**Batch:** 3 · **Depends on:** T1, T2, T4 · **Parallel with:** —

**Description:** One-command self-host stack (acceptance #1, D3). Three services: `postgres:16` (pg_isready healthcheck + named volume) → `backend` (depends_on postgres service_healthy; own `/api/health/ready` healthcheck — T4) → `frontend` (nginx, depends_on backend service_healthy). Separate from dev `docker-compose.yml` (keeps dev simple). `env_file` for secrets (D6).

Create:
- `docker-compose.prod.yml`:
  ```yaml
  # Slykboard self-host production stack (F29). One-command: docker compose -f docker-compose.prod.yml up -d
  services:
    postgres:
      image: postgres:16
      environment:
        POSTGRES_USER: ${POSTGRES_USER}
        POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
        POSTGRES_DB: ${POSTGRES_DB}
      volumes:
        - pgdata:/var/lib/postgresql/data
      healthcheck:
        test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
        interval: 5s
        timeout: 3s
        retries: 10
        start_period: 10s
      restart: unless-stopped

    backend:
      build: { context: ., dockerfile: Dockerfile }
      env_file: .env
      environment:
        DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
        DIRECT_DATABASE_URL: postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
        RUN_MIGRATIONS_ON_START: "true"
      depends_on:
        postgres: { condition: service_healthy }
      healthcheck:
        test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:3000/api/health/ready || exit 1"]
        interval: 10s
        timeout: 5s
        retries: 10
        start_period: 30s
      restart: unless-stopped

    frontend:
      build:
        context: .
        dockerfile: frontend/Dockerfile
        args:
          VITE_API_BASE_URL: ${VITE_API_BASE_URL}
          VITE_GOOGLE_CLIENT_ID: ${VITE_GOOGLE_CLIENT_ID}
          VITE_POLL_INTERVAL_SECONDS: ${VITE_POLL_INTERVAL_SECONDS:-30}
      ports:
        - "80:80"
      depends_on:
        backend: { condition: service_healthy }
      restart: unless-stopped

  volumes:
    pgdata:
  ```
  `backend` exposes no host port by default (frontend proxies or FE calls cross-origin via `VITE_API_BASE_URL`); expose `3000:3000` on backend if direct API access desired (documented). `frontend` on `:80`. `RUN_MIGRATIONS_ON_START=true` for compose. Note: with compose, both `DATABASE_URL` and `DIRECT_DATABASE_URL` point at the same direct Postgres (no pooler) — fine; the DIRECT var matters for Supabase (T8 docs).

**Acceptance Criteria:**
- [ ] `docker compose -f docker-compose.prod.yml up -d` brings up postgres → backend → frontend in order (T9 verifies).
- [ ] `postgres` healthcheck = pg_isready; named volume `pgdata` persists data across restarts.
- [ ] `backend` `depends_on.postgres.condition: service_healthy`; own healthcheck hits `/api/health/ready` (T4).
- [ ] `frontend` `depends_on.backend.condition: service_healthy`.
- [ ] Secrets via `env_file: .env` (never baked into image).
- [ ] Dev `docker-compose.yml` UNCHANGED.

**Dependencies:** T1 (BE image), T2 (FE image), T4 (`/api/health/ready` + migrate-on-boot).

---

### T4 — Migrate-on-boot wiring + /api/health/ready + env.ts flags

**Batch:** 2 · **Depends on:** Batch 1 (T1 for image context) · **Parallel with:** —

**Description:** Wire migrations to startup (D4) and add a readiness probe (D7). Single owner of `backend/src/index.ts` + `backend/src/config/env.ts` (sequenced within this task — no conflict). `migrate()` runs AFTER `connectWithRetry` succeeds and BEFORE `app.listen`, gated by `runMigrationsOnStart` (default true when `NODE_ENV==='production'`), against `directDatabaseUrl ?? databaseUrl`. The `isMain` guard (`index.ts:69`) ensures migrate only runs when executed directly (not under vitest/supertest which import `app`). Spot-check the 0000–0012 set applies cleanly (memory `drizzle-partial-index-enum-dollar1`).

Create / Modify:
- `backend/src/config/env.ts` — add two fields to `Config` + `loadConfig`:
  ```ts
  export interface Config {
    // ...existing fields...
    runMigrationsOnStart: boolean;
    directDatabaseUrl?: string;   // optional — Supabase direct 5432 for migrate
  }
  // inside loadConfig, before return:
  const runMigrationsOnStart = envSource.RUN_MIGRATIONS_ON_START !== undefined
    ? envSource.RUN_MIGRATIONS_ON_START === 'true'
    : (envSource.NODE_ENV === 'production');   // default true in prod
  // add to returned object:
  //   runMigrationsOnStart,
  //   directDatabaseUrl: envSource.DIRECT_DATABASE_URL || undefined,
  ```
  Fail-fast behavior unchanged (still throws on the 6 required vars). New vars are optional.
- `backend/src/index.ts` — add a `runMigrations` helper + call it in `start()`; add `/api/health/ready` route:
  ```ts
  import { migrate } from 'drizzle-orm/node-postgres/migrator';
  import { drizzle } from 'drizzle-orm/node-postgres';
  import path from 'node:path';
  import { fileURLToPath } from 'node:url';
  import * as schema from './db/schema';

  async function runMigrations(migrationsUrl: string): Promise<void> {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const migPool = new Pool({ connectionString: migrationsUrl });
    const migDb = drizzle(migPool, { schema });
    try {
      await migrate(migDb, { migrationsFolder: path.join(here, 'db', 'migrations') });
      logger.info('[slykboard-backend] migrations applied');
    } finally {
      await migPool.end();
    }
  }
  // in start(), after connectWithRetry(pool) succeeds, before app.listen:
  if (env.runMigrationsOnStart) {
    try {
      await runMigrations(env.directDatabaseUrl ?? env.databaseUrl);
    } catch (err) {
      logger.error({ err }, '[slykboard-backend] migration failed on boot');
      process.exit(1);
    }
  }
  // new readiness route (alongside existing /api/health at :44):
  app.get('/api/health/ready', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() });
    } catch (err) {
      logger.error({ err }, '[slykboard-backend] readiness probe DB failed');
      res.status(503).json({ status: 'degraded', db: 'error' });
    }
  });
  ```
  Note: `migrate()` uses its OWN short-lived `Pool` (against the direct url) so the app's `prepare:false`/pooler pool isn't disturbed. Migrations folder resolved via `import.meta.url` — works in the baked-in Docker path (`backend/dist/db/migrations` relative to `dist/index.js` — VERIFY the relative path holds after `tsc` build; if `dist` flattens structure, adjust to `path.join(here, '..', 'src', 'db', 'migrations')` or copy migrations into `dist`). `Pool` import already in scope (`index.ts:7` area). **Run `npm run db:migrate` against a FRESH local DB** (or `make migrate` on a throwaway compose pg) to validate 0000–0012 applies cleanly — spot-check enum partial-index SQL (memory `drizzle-partial-index-enum-dollar1`).

**Acceptance Criteria:**
- [ ] `env.ts` exposes `runMigrationsOnStart` (defaults true in prod) + optional `directDatabaseUrl`; fail-fast unchanged.
- [ ] `start()` runs `migrate()` after `connectWithRetry`, before `listen`; exits 1 on migration failure.
- [ ] `migrate()` does NOT run under vitest/supertest (`isMain` guard holds).
- [ ] `GET /api/health/ready` returns `{status:'ok', db:'ok'}` when DB up; 503 when DB down.
- [ ] 0000–0012 applies cleanly on a fresh DB (record proof) — no `$1` enum-index error.
- [ ] `rtk tsc` (BE) passes; existing `rtk vitest run -w backend` green (migrate didn't fire in tests).
- [ ] Migrations folder path resolves correctly in compiled `dist/` (verify `node dist/index.js` finds it).

**Dependencies:** Batch 1 (T1 for the image that bakes migrations).

---

### T5 — Complete .env.example files (backend + frontend + root)

**Batch:** 1 · **Depends on:** — · **Parallel with:** T1, T2, T6

**Description:** Complete `.env.example` for all envs (D6, spec acceptance #3). Zero-value placeholders, required/optional comments, the NEW `DIRECT_DATABASE_URL` + `RUN_MIGRATIONS_ON_START` vars from T4.

Create / Modify:
- `backend/.env.example` — complete with all vars (match `env.ts` + T4 additions):
  ```env
  # === REQUIRED (app crashes at boot if missing) ===
  FRONTEND_URL=https://app.example.com        # CORS origin (D9) — your deployed frontend URL
  DATABASE_URL=postgresql://user:pass@host:5432/db   # App DB (Supabase: pooler 6543, prepare:false)
  DIRECT_DATABASE_URL=postgresql://user:pass@host:5432/db  # OPTIONAL — direct 5432 for migrations (Supabase); defaults to DATABASE_URL
  JWT_SECRET=                                  # >= 32 chars — generate: openssl rand -base64 48
  GOOGLE_CLIENT_ID=                            # Google OAuth client ID (Google Console)
  GOOGLE_CLIENT_SECRET=                        # Google OAuth client secret
  GOOGLE_CALLBACK_URL=postmessage              # GIS popup flow — leave 'postmessage' (D9)

  # === OPTIONAL ===
  PORT=3000
  NODE_ENV=production
  JWT_TTL=8h
  ALLOWED_DOMAIN=                              # unset = allow all domains; set to restrict (REQ-1.2)
  RUN_MIGRATIONS_ON_START=true                 # default true in prod (NODE_ENV=production); set false to skip
  ```
- `frontend/.env.example` — validate/complete:
  ```env
  VITE_API_BASE_URL=https://api.example.com    # backend URL (baked at BUILD time — per-env rebuild)
  VITE_GOOGLE_CLIENT_ID=                       # same as backend GOOGLE_CLIENT_ID
  VITE_POLL_INTERVAL_SECONDS=30                # board auto-poll interval
  ```
- Root `.env.example` (for self-host compose — `docker-compose.prod.yml` reads `.env`):
  ```env
  # Self-host compose vars (docker-compose.prod.yml)
  POSTGRES_USER=slyk
  POSTGRES_PASSWORD=                           # set a strong password
  POSTGRES_DB=slykboard
  # Plus all backend/*.env vars (FRONTEND_URL, JWT_SECRET, GOOGLE_*, etc.)
  # Plus frontend VITE_* vars (baked into frontend image at build)
  ```

**Acceptance Criteria:**
- [ ] All 6 required backend vars documented (zero-value, "REQUIRED" comment).
- [ ] `DIRECT_DATABASE_URL` + `RUN_MIGRATIONS_ON_START` documented (T4 additions).
- [ ] Frontend VITE vars documented (build-time note).
- [ ] Root `.env.example` covers compose vars (`POSTGRES_*` + backend + frontend).
- [ ] No real secrets in any `.env.example`.
- [ ] `.gitignore` still excludes `.env` (real) but tracks `.env.example`.

**Dependencies:** — (coordinate var names with T4).

---

### T6 — render.yaml (Backend blueprint) + vercel.json (Frontend SPA rewrite)

**Batch:** 1 · **Depends on:** — · **Parallel with:** T1, T2, T5

**Description:** Reproducible hosted infra (D11, D10). `render.yaml` = Render Docker web service using the BE Dockerfile (T1), `healthCheckPath: /api/health`, env keys. `vercel.json` = Vite SPA rewrite (prevents deep-link 404).

Create:
- `render.yaml` (root):
  ```yaml
  services:
    - type: web
      name: slykboard-backend
      runtime: docker
      dockerfilePath: ./Dockerfile
      plan: free   # or starter
      healthCheckPath: /api/health
      autoDeploy: true
      envVars:
        - key: NODE_ENV
          value: production
        - key: FRONTEND_URL
          sync: false        # set in dashboard (your Vercel frontend URL)
        - key: DATABASE_URL
          sync: false        # Supabase pooler 6543
        - key: DIRECT_DATABASE_URL
          sync: false        # Supabase direct 5432 (migrations)
        - key: JWT_SECRET
          sync: false        # generate: openssl rand -base64 48
        - key: GOOGLE_CLIENT_ID
          sync: false
        - key: GOOGLE_CLIENT_SECRET
          sync: false
        - key: GOOGLE_CALLBACK_URL
          value: postmessage
        - key: RUN_MIGRATIONS_ON_START
          value: "true"
  ```
  `sync:false` = set manually in Render dashboard (secret). Render uses `healthCheckPath` (ignores Docker HEALTHCHECK). Stateless (no disk). Migrate-on-boot runs on each deploy.
- `vercel.json` (root):
  ```json
  {
    "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
  }
  ```
  Vite preset auto-detected; build `npm run build -w frontend` (or configure `buildCommand`/`outputDirectory` if needed); output `frontend/dist`. SPA rewrite prevents deep-link 404 (research #7). `VITE_API_BASE_URL` set in Vercel project env → baked at build.

**Acceptance Criteria:**
- [ ] `render.yaml` valid; references `./Dockerfile`; `healthCheckPath: /api/health`.
- [ ] All required env keys listed (`sync:false` for secrets).
- [ ] `vercel.json` has the SPA rewrite.
- [ ] No secrets in either file.

**Dependencies:** — (coordinate env keys with T5).

---

### T8 — docs/deployment.md (comprehensive deploy guide)

**Batch:** 4 · **Depends on:** T1, T2, T3, T4, T5, T6 · **Parallel with:** —

**Description:** The deployment guide in `docs/` (spec acceptance #3 + edge cases). Step-by-step for self-host compose, Render (BE), Vercel (FE), Supabase (DB). Covers secrets, migrations (forward-only + manual rollback), OAuth/CORS/Google-Console setup, preview-URL caveat.

Create:
- `docs/deployment.md` — sections:
  1. **Self-host (Docker Compose):** clone → cp `.env.example` `.env` → fill secrets (`openssl rand -base64 48` for `JWT_SECRET`, `POSTGRES_PASSWORD`) → `docker compose -f docker-compose.prod.yml up -d` → verify `curl http://localhost/api/health/ready`. Note: frontend `VITE_*` are baked at BUILD time (rebuild image after changing).
  2. **Hosted — Render (backend):** New → Web Service → connect repo → `render.yaml` auto-detected (or manual Docker) → set env vars in dashboard (`sync:false` keys) → deploy → health check on `/api/health`. Migrations auto-run on boot.
  3. **Hosted — Vercel (frontend):** New Project → import repo → framework preset Vite → build `npm run build -w frontend` → output `frontend/dist` → set `VITE_API_BASE_URL` (Render URL) + `VITE_GOOGLE_CLIENT_ID` in project env → deploy. `vercel.json` SPA rewrite handles routing.
  4. **DB — Supabase:** create project → get pooler URL (port 6543, transaction mode) = `DATABASE_URL`; get direct URL (port 5432) = `DIRECT_DATABASE_URL`. **App `Pool` must use `prepare:false`** with pgbouncer (document the drizzle config or note that F29's migrate uses DIRECT url). Migrations run against `DIRECT_DATABASE_URL`.
  5. **Secrets:** never commit `.env`; `JWT_SECRET` ≥32 chars; OAuth creds from Google Console; fail-fast boot crashes if missing (no silent defaults).
  6. **Migrations:** forward-only drizzle `migrate()` on boot (gated `RUN_MIGRATIONS_ON_START`); idempotent (`__drizzle_migrations`); **no auto-rollback** — manual rollback = revert code + restore DB backup; document backup strategy (Supabase PITR / `pg_dump`).
  7. **OAuth + CORS + Google Console:** add deployed frontend origin to Google Console → Authorized JavaScript origins (GIS popup flow). `FRONTEND_URL` env = CORS origin (must match). `GOOGLE_CALLBACK_URL` stays `'postmessage'`. **Preview-URL caveat:** Vercel per-PR preview URLs can't all be registered → use stable prod URL or disable OAuth on previews.
  8. **Health probes:** `/api/health` (liveness, Render), `/api/health/ready` (readiness, compose).
  9. **Env var reference table** (consolidated from T5 — required vs optional, defaults).
  10. **Sub-path hosting note** (D12): out of scope; MVP assumes root-path or dedicated (sub)domain.

**Acceptance Criteria:**
- [ ] `docs/deployment.md` exists with all 10 sections.
- [ ] Self-host compose walkthrough reproducible end-to-end.
- [ ] Render + Vercel + Supabase steps concrete (click-paths / env keys).
- [ ] Manual rollback documented (no auto-rollback).
- [ ] OAuth/CORS/Google-Console setup + preview-URL caveat documented.
- [ ] Env var reference table complete (matches T5).

**Dependencies:** T1, T2, T3, T4, T5, T6 (documents the as-built artifacts).

---

### T9 — Integration verification & sign-off

**Batch:** 5 (terminal) · **Depends on:** all prior · **Parallel with:** —

**Description:** The final definition-of-done gate. Build both images, bring up the full stack, verify health + migrations, run all checks.

Steps:
1. `rtk tsc` (BE + FE) — zero errors.
2. `rtk vitest run -w backend` + `rtk vitest run -w frontend` — all green (migrate-on-boot didn't break tests; `isMain` guard holds).
3. `rtk lint` + `rtk prettier --check` — zero violations.
4. `npm run build -w backend && npm run build -w frontend` — both succeed.
5. **Fresh-DB migration apply:** spin up a throwaway compose Postgres → `cd backend && npx tsx src/db/migrate.ts` (or `make migrate` against it) → confirm 0000–0012 applies with NO `$1` enum-index error (memory `drizzle-partial-index-enum-dollar1`). Record proof.
6. `docker build -f Dockerfile -t slykboard-backend .` — succeeds.
7. `docker build -f frontend/Dockerfile -t slykboard-frontend .` — succeeds.
8. **Full stack smoke:** `docker compose -f docker-compose.prod.yml up -d` (with a filled `.env`) → wait for healthy → `curl http://localhost/api/health/ready` → `{status:'ok', db:'ok'}`; open `http://localhost` → FE loads (SPA); migrations ran (check backend logs "migrations applied").
9. **Deep-link refresh:** navigate `http://localhost/projects/some-slug` then hard-refresh → no 404 (nginx SPA fallback / vercel rewrite).
10. **Fail-fast check:** unset `JWT_SECRET` → `docker compose up backend` → crashes at boot (no listen) with clear error.
11. **Health probe:** stop Postgres → `/api/health/ready` returns 503; restart → recovers.

**Acceptance Criteria:**
- [ ] All four feature Acceptance bullets satisfied (record observable proof):
  - [ ] `docker compose up` brings up a working stack (step 8).
  - [ ] Production FE build served by nginx (self-host) with correct base path (root `/`) (step 8/9).
  - [ ] All env vars documented (`.env.example` complete + `docs/deployment.md`) (T5/T8).
  - [ ] Migrations run on startup (step 8 logs + step 5 fresh-DB apply).
- [ ] All 4 edge cases resolved (secrets fail-fast, CORS/OAuth origin-coupled, health probes, forward-only migrations + manual rollback doc).
- [ ] No schema delta authored by F29 (D13) — confirm no new migration file.
- [ ] `rtk tsc`/`vitest`/`lint`/`prettier`/`build` exit codes `0`.
- [ ] Fresh-DB migrate applies cleanly (no `$1` error).

**Dependencies:** T1–T8.

---

## 7. Final F29 Acceptance Checklist

- [ ] `docker compose up` (with `docker-compose.prod.yml`) brings up postgres → backend → frontend, healthy.
- [ ] Production build of frontend served by nginx (self-host) with SPA fallback (deep-link refresh works); Vercel alt documented + `vercel.json` rewrite.
- [ ] All required env vars documented: `.env.example` (backend + frontend + root) complete + `docs/deployment.md`.
- [ ] Migrations run on startup (`migrate()` in `start()`, gated `RUN_MIGRATIONS_ON_START`, against DIRECT url, baked into image); idempotent; fresh-DB apply validated.
- [ ] Secrets never defaulted in prod (fail-fast `env.ts` on 6 required vars; `.env.example` zero-values; Render/Vercel encrypted env).
- [ ] CORS locked to `FRONTEND_URL` (single origin); `GOOGLE_CALLBACK_URL='postmessage'`; Google Console JS origins documented; preview-URL caveat documented.
- [ ] `/api/health` (liveness, Render) + `/api/health/ready` (readiness, compose, SELECT 1).
- [ ] Forward-only migrations; manual rollback documented (no auto-rollback).
- [ ] Backend Docker image: `node:24-bookworm-slim`, multi-stage, non-root, `tini`, `node dist/index.js` (compiled, D5).
- [ ] Frontend Docker image: nginx multi-stage serving `dist/`, gzip, SPA fallback.
- [ ] `render.yaml` (Docker web service, `healthCheckPath: /api/health`) + `vercel.json` (SPA rewrite).
- [ ] `.dockerignore` mirrors `.gitignore` (node_modules/.env/dist/build/*.log/.DS_Store).
- [ ] No schema delta authored by F29 (D13).
- [ ] No secrets in code/images; no `console.log` (use `logger`).
- [ ] Single-line `SLYK-F29:` commits; branch `feature/SLYK-F29-deployment-self-host`; rebase-merge only.
- [ ] Lint + format + typecheck + tests pass on an empty change.

**Integration record (fill during the terminal task):**
- Feature commit SHA: `________`
- `docker compose up` health probe response: `________`
- Fresh-DB migrate apply proof (commit/log excerpt): `________`
- BE image size / FE image size: `________`
- Lint/format/typecheck/test/build exit codes: `0 / 0 / 0 / 0 / 0`

---

## 8. Schema deltas owned by this feature

**F29 owns NONE (D13).** F29 wires migrate-on-boot + packaging/docs only. The `0000`–`0012` migration set is pre-existing (authored by F02 and subsequent features). F29 VALIDATES that this set applies cleanly via `migrate()` on a fresh DB (T4 spot-check, T9 full apply) but authors no new migration. No DB schema change.

---

## 9. Cross-cutting decisions — CONFIRMED (owner-approved 2026-06-25)

1. **nginx-served FE vs BE-served FE** (D2) — ✅ **CONFIRMED: nginx** (multi-stage, ~25MB, SPA fallback). Decoupled, independently scalable, matches the 3-service compose model. BE-served (`express.static`) rejected — couples FE release cadence to BE + slower static serving.
2. **`RUN_MIGRATIONS_ON_START` default** (D4) — ✅ **CONFIRMED: default true in prod image** (derived from `NODE_ENV==='production'` if unset; explicitly `true` in compose/render.yaml; `false` for local dev where `make migrate` is manual). Migrate-on-boot IS the release step (single BE instance, no replica race per `db/client.ts`).
3. **NEW `DIRECT_DATABASE_URL` env var** (D4/D8) — ✅ **CONFIRMED: add it.** Supabase transaction-mode pooler (6543) can't reliably run DDL; migrations need direct 5432. Optional var; defaults to `DATABASE_URL` for self-host/compose (no pooler).
4. **Sub-path hosting scope** (D12) — ✅ **CONFIRMED: OUT OF SCOPE for MVP.** `vite.config.ts` (no `base`) + `routes/index.tsx` (no `basename`) assume root `/`. Documented as future work; MVP assumes root-path or dedicated (sub)domain.
5. **Extend dev `docker-compose.yml` vs new `docker-compose.prod.yml`** (D3) — ✅ **CONFIRMED: separate prod file.** Dev compose stays Postgres-only; prod is 3 services. Dev workflow untouched.
6. **OAuth token revocation TODO** (`auth.routes.ts:93`, D14) — ✅ **CONFIRMED: DEFER out of F29.** Security-feature concern, not deploy/packaging. F29 documents it as a known gap.
7. **Stale `js-development-rules.md` start command** (D5) — ✅ **CONFIRMED: use `node dist/index.js`** (compiled), not the rules' `node src/index.js`. Rules doc flagged stale for a future doc-update (not blocking F29).

**Sources:**
- `basic-PRD.md` §3 (Goal 2 self-hostable; Success Metric "Successful deployment via Docker/Render"), §5 (Dockerized — VPS/Render/Supabase), REQ-1.1 (Google SSO), REQ-1.2 (`ALLOWED_DOMAIN`), REQ-1.3 (roles/JWT).
- `.claude/rules/js-development-rules.md` — Deployment (Frontend: Vercel, `npm run build`, publish `dist`; Backend: Render, start command [stale — D5]; env table; Security: no secrets, CORS specific frontend URL).
- `.claude/rules/git-guidelines.md` — SLYK-F29 prefix; rebase-merge only; release branches `release/1.2.3`.
- Dependency task doc: [F02](../F02-database-and-migrations/F02-database-and-migrations-tasks.md) — migration pipeline (`drizzle.config.ts`, `migrate.ts`, journal).
- Grounding: `backend/src/index.ts:27-36,44-51,69-109`; `backend/src/config/env.ts:16-53`; `backend/src/db/migrate.ts:1-22`; `backend/src/db/client.ts` (single-instance comment); `backend/package.json:8-9` (`build`/`start`); `frontend/package.json:8-9`; `frontend/vite.config.ts:1-18` (no `base`); `frontend/src/config/env.ts` (VITE vars); `backend/src/services/googleClient.ts:5-9` (`'postmessage'`); `backend/src/routes/auth.routes.ts:93` (revocation TODO); `docker-compose.yml:1-25` (dev-only); root `package.json:13-22` (workspaces, build); `.gitignore:11` (`dist`).
- External research (2026): `node:24-bookworm-slim` (musl/alpine native-dep issues) + `tini` + non-root + multi-stage; nginx multi-stage SPA fallback (`try_files`) + gzip; compose `depends_on: service_healthy` + pg_isready + named volume; drizzle prod = `migrate()` NEVER `push` (idempotent `__drizzle_migrations`); Supabase pooler 6543 transaction-mode (`prepare:false`) vs direct 5432 (migrate); Render Docker web service `healthCheckPath` (ignores Docker HEALTHCHECK) + `render.yaml` + stateless; Vercel Vite preset + `vercel.json` SPA rewrite; `.env.example` + fail-fast; Docker `env_file` for self-host.
- Memory: `drizzle-partial-index-enum-dollar1` (validate 0000–0012 applies cleanly — spot-check enum partial-index SQL in T4/T9); **`dev-db-push-based-no-migration-journal` does NOT apply** (separate `slykboard-db` repo — this backend HAS a journal); `confirm-modals-for-destructive-actions` (no destructive deploy action in F29 — N/A but noted).
