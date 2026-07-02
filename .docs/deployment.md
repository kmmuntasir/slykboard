# Slykboard — Deployment Guide

SLYK-F29. Comprehensive guide for shipping Slykboard to production.

Covers three paths: **self-hosted Docker Compose** (one command — backend + frontend + Postgres), and the **hosted split** (Render backend + Vercel frontend + Supabase database).

---

## 1. Overview

Slykboard is a two-service app:

- **Backend** — Node.js 24 + Express 5, PostgreSQL (drizzle ORM). Serves `/api`.
- **Frontend** — React 19 + Vite static bundle served by nginx (Docker) or Vercel.

What ships:

| Path | Backend | Frontend | Database |
|---|---|---|---|
| **Docker Compose (self-host)** | `Dockerfile` → `:3000` | `frontend/Dockerfile` (nginx) → `:8080` | `postgres:16` container (`db` service) |
| **Hosted split** | Render (`render.yaml`, Docker runtime) | Vercel (`vercel.json`, Vite preset) | Supabase Postgres |

Committed deploy artifacts:

- `Dockerfile` — backend image (`node:24-bookworm-slim`, non-root `node` user, `tini` PID 1, runs `npx tsx backend/src/index.ts` — the backend uses extensionless ESM imports that native `node` rejects, so the runtime is **tsx** (not compiled `node dist/`); exposes `:3000`, ships migrations at `backend/src/db/migrations`, migrate-on-boot gated by `RUN_MIGRATIONS_ON_START`).
- `frontend/Dockerfile` — frontend image (`node:24` build → `nginx:alpine` serve, exposes `:80`, `VITE_*` build args).
- `frontend/nginx.conf` — SPA fallback (`try_files … /index.html`), static-asset caching, security headers. No `/api` proxy by default.
- `.dockerignore` — excludes `node_modules`, `.env.*` (keeps `.env.example`), build output, docs.
- `docker-compose.prod.yml` — 3-service stack (`db`, `backend`, `frontend`) + `pgdata` volume. One-command up.
- `render.yaml` — Render Blueprint (Docker web service, `healthCheckPath: /api/health`).
- `vercel.json` — Vite framework, `dist` output, SPA rewrite.
- `.env.example` (root, combined) + `backend/.env.example` + `frontend/.env.example`.

> **Scope assumption:** the MVP assumes a **root path / dedicated domain** (e.g. `https://slykboard.example.com`). Sub-path hosting (e.g. `/slykboard/`) is **out of scope** for F29 — see [§12](#12-known-gaps--out-of-scope).

---

## 2. Prerequisites

- **Docker + Docker Compose** (v2+) for the self-host path.
- A **Google OAuth client** — create one in Google Cloud Console (see [§8](#8-google-oauth--cors-setup)). You need the **Client ID** + **Client Secret**.
- A generated **`JWT_SECRET`** — random string, **>= 32 characters**. Backend hard-rejects shorter values on boot.

Generate a secret locally:

```bash
openssl rand -base64 48   # or: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

- (Hosted split only) accounts on **Render**, **Vercel**, and **Supabase**.

---

## 3. Self-host via Docker Compose (one command)

The fastest path — bring up backend + frontend + Postgres together.

### 3.1 Clone + configure

```bash
git clone <repo-url> slykboard
cd slykboard

cp .env.example .env
```

Edit `.env`. Fill the required backend vars:

```dotenv
# Backend (required)
FRONTEND_URL=http://localhost:8080          # the origin the browser hits (nginx)
DATABASE_URL=postgresql://slyk:slyk@db:5432/slyk   # NOTE: host = "db" (the compose service)
DIRECT_DATABASE_URL=postgresql://slyk:slyk@db:5432/slyk   # same — no pooler in compose
JWT_SECRET=<your-32-plus-char-secret>
GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<your-client-secret>
GOOGLE_CALLBACK_URL=postmessage             # literal sentinel for the GIS popup flow — NOT a URL

# Backend (deployment flags)
NODE_ENV=production
RUN_MIGRATIONS_ON_START=true

# Frontend (VITE_* — build-time, baked into the bundle)
VITE_API_BASE_URL=http://localhost:3000/api
VITE_GOOGLE_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
VITE_POLL_INTERVAL_SECONDS=30
```

Notes:

- **`DATABASE_URL` host is `db`**, not `localhost` — the backend container reaches Postgres over the compose network. The compose file already sets this default; only override `POSTGRES_USER/PASSWORD/DB` if you customise them.
- **`FRONTEND_URL` must equal the browser-facing origin** (`http://localhost:8080` here) — it drives CORS.
- **`VITE_*` are build-time** — changing them requires a rebuild (`--build`).

You may also override the compose-level DB credentials via env (defaults shown):

```dotenv
POSTGRES_USER=slyk
POSTGRES_PASSWORD=slyk
POSTGRES_DB=slyk
```

### 3.2 Bring it up

```bash
docker compose -f docker-compose.prod.yml up --build
```

Builds all three images and starts them. Dependency order is enforced: `backend` waits for `db` healthy, `frontend` waits for `backend` healthy.

### 3.3 Verify

```bash
# Liveness (no DB check)
curl http://localhost:3000/api/health
# → {"status":"ok","service":"slykboard-backend",...}

# Readiness (DB SELECT 1)
curl http://localhost:3000/api/health/ready
# → {"status":"ready","db":"ok",...}

# Frontend
open http://localhost:8080
```

**Migrations run automatically on boot** (gated by `RUN_MIGRATIONS_ON_START=true`). The 13 forward-only drizzle migrations (`0000`–`0012`) apply before the server starts listening. No manual migrate step needed.

### Ports

| Service | Container | Host |
|---|---|---|
| frontend (nginx) | `:80` | `:8080` |
| backend | `:3000` | `:3000` |
| db | `:5432` | (not published by default) |

---

## 4. Hosted — Render (backend)

Deploy the API as a Docker web service via the Render Blueprint.

### 4.1 Apply the Blueprint

1. Push the repo to GitHub.
2. In Render dashboard → **New** → **Blueprint** → connect the repo.
3. Render reads `render.yaml` and provisions the `slykboard-api` web service (`runtime: docker`, `dockerfilePath: ./Dockerfile`, `plan: starter`).

> **Do NOT set `dockerContext: backend`.** The build context must be the repo root — npm workspaces share one root `package-lock.json`, so there is no per-package lockfile. `render.yaml` intentionally omits `dockerContext` so it defaults to root.

> **Render runs its own HTTP health probe against `healthCheckPath: /api/health`** and ignores the Docker `HEALTHCHECK`. The service is the `/api/health` liveness route (returns 200 `status: ok`, no DB call).

### 4.2 Set environment variables

In the Render dashboard, fill every var marked `sync: false` in `render.yaml`:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` (inlined in `render.yaml`) |
| `RUN_MIGRATIONS_ON_START` | `true` (inlined in `render.yaml`) |
| `FRONTEND_URL` | your deployed frontend origin (e.g. `https://app.example.com`) |
| `DATABASE_URL` | Supabase **pooler** connection string (`:6543`) — see [§6](#6-hosted--supabase-database) |
| `DIRECT_DATABASE_URL` | Supabase **direct** connection string (`:5432`) — used for migrations |
| `JWT_SECRET` | >= 32 chars |
| `GOOGLE_CLIENT_ID` | your OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | your OAuth client secret |
| `GOOGLE_CALLBACK_URL` | `postmessage` |

Notes:

- **Stateless, no disk.** The backend holds no local state — Render can scale/restart freely. Sessions are JWT-based; the DB holds the `tokenVersion` used for hard-invalidation.
- **Migrations run on boot** using `DIRECT_DATABASE_URL` (a dedicated short-lived pool, separate from the app pool), before the server listens.

---

## 5. Hosted — Vercel (frontend)

Deploy the Vite static bundle.

1. In Vercel → **Add New Project** → import the repo.
2. **Root Directory:** if your repo root *is* the frontend, leave default. If frontend lives in `frontend/`, set the root directory to `frontend/`.
3. **Framework Preset:** Vite (auto-detected). `vercel.json` already pins `buildCommand: "npm run build"`, `outputDirectory: "dist"`, and the SPA rewrite.
4. **Set build env vars** (build-time — a rebuild is required to change these):
   - `VITE_API_BASE_URL` → your **Render backend URL**, e.g. `https://slykboard-api.onrender.com/api`.
   - `VITE_GOOGLE_CLIENT_ID` → your OAuth client ID.
   - `VITE_POLL_INTERVAL_SECONDS` → `30` (optional).

> **SPA rewrite:** `vercel.json` has `rewrites: [{ "source": "/(.*)", "destination": "/index.html" }]`. This serves `index.html` for any client route, so deep links / refreshes don't 404. Missing this = blank page on refresh of a client route.

---

## 6. Hosted — Supabase (database)

Provision Postgres on Supabase and point the app at it.

1. Create a Supabase project.
2. From **Project Settings → Database → Connection string**, take **both** connection strings:
   - **Transaction pooler** (port `6543`) → set as `DATABASE_URL` (app runtime traffic, transaction mode).
   - **Direct connection** (port `5432`) → set as `DIRECT_DATABASE_URL` (migrations / DDL).

### Why two URLs

The Supabase **pooler** (PgBouncer, transaction mode, `:6543`) cannot run DDL / migrations reliably — it multiplexes connections. Migrations therefore use `DIRECT_DATABASE_URL` (the direct `:5432` connection), via a dedicated short-lived pool in `index.ts`. `DIRECT_DATABASE_URL` defaults to `DATABASE_URL` when unset, so for Supabase you **must** set it explicitly to the direct string.

### ⚠️ PgBouncer + drizzle caveat (`prepare: false`)

PgBouncer in **transaction mode does not support prepared statements**. drizzle/`pg` issue them by default. If you point `DATABASE_URL` at the pooler, the **app pool** (`backend/src/db/client.ts`) must run with `prepare: false`:

```ts
// backend/src/db/client.ts — required when DATABASE_URL targets a transaction-mode pooler
new Pool({ connectionString: env.databaseUrl, max: 5, prepare: false });
```

The current pool does **not** set `prepare: false` (it targets a direct/non-pooled Postgres). Two safe options:

- **(Recommended)** Point `DATABASE_URL` at the Supabase **session-mode** pooler (or the direct connection) so prepared statements work unchanged — keep the direct `:5432` string on both `DATABASE_URL` and `DIRECT_DATABASE_URL` for low-traffic deployments.
- Point `DATABASE_URL` at the transaction pooler (`:6543`) **and** set `prepare: false` in the app pool.

The migration pool is already isolated and uses the direct URL, so it is unaffected.

---

## 7. Environment variables reference

### Backend (`backend/src/config/env.ts`)

`loadConfig()` validates on boot; missing required vars or a short `JWT_SECRET` crash-fails before serving.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `FRONTEND_URL` | ✅ | — | Browser-facing frontend origin. Drives CORS. |
| `DATABASE_URL` | ✅ | — | App DB connection string (pooler for Supabase). |
| `JWT_SECRET` | ✅ | — | **Must be >= 32 chars** or boot fails. |
| `GOOGLE_CLIENT_ID` | ✅ | — | OAuth client ID. |
| `GOOGLE_CLIENT_SECRET` | ✅ | — | OAuth client secret. |
| `GOOGLE_CALLBACK_URL` | ✅ | — | Set to `postmessage` (GIS popup sentinel, not a URL). |
| `NODE_ENV` | ⬜ | `development` | Set `production` in prod. Also gates the migration default. |
| `PORT` | ⬜ | `3000` | Listen port. |
| `JWT_TTL` | ⬜ | `8h` | jose duration string (`8h`, `15m`, `1d`). |
| `ALLOWED_DOMAIN` | ⬜ | _(unset)_ | Restrict to a G-Suite domain. Empty/`''` = all Google accounts. |
| `DIRECT_DATABASE_URL` | ⬜ | falls back to `DATABASE_URL` | DDL/migration connection (Supabase direct `:5432`). |
| `RUN_MIGRATIONS_ON_START` | ⬜ | `true` when `NODE_ENV=production`, else `false` | `true`/`1`/`yes` → on; `false`/`0`/`no` → off; unset → production-default. |

> `TZ` appears in `.env.example` (defaults `UTC`) but is a runtime/Postgres convention — not read by `env.ts`.

### Frontend (Vite — build-time, baked into bundle)

| Variable | Required | Default | Notes |
|---|---|---|---|
| `VITE_API_BASE_URL` | ✅ | — | Backend `/api` base. Changing it = rebuild. |
| `VITE_GOOGLE_CLIENT_ID` | ✅ | — | OAuth client ID (public). |
| `VITE_POLL_INTERVAL_SECONDS` | ⬜ | `30` | Board auto-poll interval. |

---

## 8. Google OAuth + CORS setup

Slykboard uses the **Google Identity Services (GIS) popup auth-code flow**. There is **no redirect URL to register** — instead:

1. **Google Cloud Console → APIs & Services → Credentials** → your OAuth 2.0 Client ID.
2. **Authorized JavaScript origins** — add every deployed **frontend origin**:
   - Self-host: `http://localhost:8080` (and your prod domain).
   - Vercel: `https://<your-app>.vercel.app` (prod).
3. **`GOOGLE_CALLBACK_URL=postmessage`** — Google's literal sentinel for the popup flow. **Not a URL.** Same value in every environment.
4. **`FRONTEND_URL` env** — must equal the **same frontend origin**; it drives backend CORS. A mismatch between the deployed origin, the Google Console entry, and `FRONTEND_URL` breaks the flow.

The flow is **origin-coupled**, not URL-coupled: correctness depends on (a) Google Console **Authorized JavaScript origins** + (b) backend `FRONTEND_URL` (CORS) agreeing on the origin.

> **Vercel preview URLs caveat:** each PR/deploy preview gets a unique `*.vercel.app` subdomain. You **cannot pre-register them all** in the Google Console. Options:
> - Use a **stable production origin** for OAuth-gated flows (previews show the login button but Google rejects the origin), or
> - **Disable OAuth-dependent features on preview deployments.**

---

## 9. Secret management

- The **6 required backend vars must be set in prod** (`FRONTEND_URL`, `DATABASE_URL`, `JWT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`). The backend **fail-fast** crashes on boot if any are missing or if `JWT_SECRET` < 32 chars.
- **Never bake secrets into images.** `.dockerignore` excludes `.env.*` (only `.env.example` ships). Secrets are injected at runtime:
  - **Render:** dashboard env vars / an env group. (`render.yaml` marks secrets `sync: false`.)
  - **Vercel:** project env vars (mark `VITE_*` appropriately — `VITE_GOOGLE_CLIENT_ID` is public by design).
  - **Docker Compose:** the `backend` service loads an `env_file: .env` (`.env` is gitignored). Keep `.env` off the host's public surface.
- **`JWT_SECRET` >= 32 chars.** Rotate by changing the value and restarting; all outstanding JWTs invalidate (ver mismatch / tokenVersion bump).

---

## 10. Migrations + rollback

- **Forward-only.** drizzle's migrator runs the 13 migrations (`0000`–`0012`) sequentially via the migration journal (`meta/_journal.json`). **No down/rollback migrations exist** — the project has none and drizzle generates none.
- **On boot, gated by `RUN_MIGRATIONS_ON_START`** (defaults on in production). Uses a dedicated short-lived pool against `DIRECT_DATABASE_URL`, **before** the server listens. A migration failure calls `process.exit(1)` — the service never serves bad schema.
- **Manual runner:** `backend/src/db/migrate.ts` runs `migrate` against `DATABASE_URL` standalone (useful outside the boot path).

### Rollback strategy (no auto-rollback)

Because migrations are forward-only, recovering from a bad migration is:

1. **Revert the code** to the pre-bad-migration commit (so the offending migration is not re-run), and
2. Either:
   - **Author a new forward migration** that corrects the schema, or
   - **Restore the database** from a pre-deploy backup/snapshot.

> **Take a DB backup / snapshot before every deploy.** This is the primary safety net given there is no automated rollback.

For Supabase, use the project's automated backups / PITR. For self-host Compose, back up the `pgdata` volume (or `pg_dump` against the `db` service) before `docker compose up --build`.

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| **CORS error** in browser | `FRONTEND_URL` env ≠ deployed frontend origin | Set `FRONTEND_URL` to the exact browser origin (scheme + host + port). |
| **OAuth popup fails / `redirect_uri_mismatch` or origin blocked** | Deployed origin not in Google Console **Authorized JavaScript origins** | Add the exact origin in Google Cloud Console → Credentials. |
| **Frontend blank on refresh** of a client route | SPA rewrite missing | Confirm `vercel.json` `rewrites` (Vercel) or nginx `try_files … /index.html` (Docker) is present — both are committed. |
| **Migration fails with `$1` enum-index SQL** | Known **drizzle-kit** caveat: it emits unapplyable `$1` placeholders for enum partial indexes during reconcile | This is a generation-time issue, not a deploy issue. The committed migration SQL is already reconciled to literal values (e.g. `'ADMIN'`). If regenerating migrations, reconcile enum partial-index SQL to literals before committing. |
| **Healthcheck failing / service never goes healthy** | Migrate-on-boot hasn't finished before the readiness probe; or `DIRECT_DATABASE_URL` can't reach the DB | The compose `backend` healthcheck has `start_period: 40s` to cover boot migrations — increase it if migrations are slow. Ensure `DIRECT_DATABASE_URL` (Supabase `:5432`) is reachable. Render probes `/api/health` (liveness, no DB) — for that path, a failing deploy usually means missing required env var (boot crash). |
| **Boot crash on startup** | Missing required env var or `JWT_SECRET` < 32 chars | Set all 6 required vars + a >= 32-char `JWT_SECRET`. |
| **Supabase: `prepared statement ... does not exist`** | Transaction-mode pooler (`:6543`) + drizzle default prepared statements | See [§6](#6-hosted--supabase-database): set `prepare: false` in the app pool, or point `DATABASE_URL` at session-mode / direct. |

---

## 12. Known gaps / out of scope

- **Sub-path hosting** (`/slykboard/` under a shared domain) — not supported in F29. MVP assumes a root path / dedicated domain. Future work.
- **OAuth token revocation on logout** — the `POST /api/auth/logout` handler (`backend/src/routes/auth.routes.ts`) currently only bumps the user's `tokenVersion` (hard-expires outstanding JWTs). Google-side OAuth token revocation is **deferred** (TODO at `auth.routes.ts:89-93`). Client-side token clear remains authoritative for UX.
- **No backend-served frontend in the hosted split.** The Docker `frontend` image runs its own `nginx:alpine` (decoupled from the backend). On Render + Vercel, nginx is not involved — Vercel serves the static bundle. There is no single-origin "backend serves FE" mode.
