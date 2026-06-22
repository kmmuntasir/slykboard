# slykboard
An open-source, minimal Kanban board with built-in time tracking and reporting. Built for small teams. Lightweight alternative to enterprise task trackers with zero bloat.

## Development

### Prerequisites

- Node.js 24 (see `.nvmrc`)
- npm (ships with Node)
- Docker + Docker Compose (local Postgres — see `docker-compose.yml`)

### Getting Started

The fastest path from a fresh clone to a running app is the `Makefile`. It handles Node version checks, dependency install, env file creation, Postgres startup, and migrations in one step.

```bash
make bootstrap
```

What `make bootstrap` does:

1. Verifies Node 24+
2. Installs workspace dependencies (`npm install`)
3. Copies `.env.example` → `.env` for each package and generates a local `JWT_SECRET`
4. Starts the local Postgres container and waits until healthy
5. Applies Drizzle migrations

After bootstrap, fill in your Google OAuth credentials (see [Environment Setup](#environment-setup)) and start the app:

```bash
make dev
```

Run `make` (or `make help`) to list every available target.

### The Makefile

Common targets:

| Target | Description |
| --- | --- |
| `make bootstrap` | Fresh-clone setup: deps, env, DB, migrations |
| `make dev` | Run backend (:3000) + frontend (:5173) concurrently |
| `make up` / `make down` | Start / stop the Postgres container |
| `make db-psql` | Open a `psql` shell in the Postgres container |
| `make migrate` | Apply pending Drizzle migrations |
| `make studio` | Open Drizzle Studio (DB GUI) |
| `make test` | Run all tests (backend + frontend) |
| `make lint` / `make typecheck` | Lint / type-check the monorepo |
| `make health` | Probe the backend health endpoint |

> The `Makefile` wraps the underlying npm workspace scripts — each target maps to an `npm run -w <pkg>` command, so you can drop down to npm directly whenever you need more control.

### Running the App

```bash
# Boot backend (:3000) and frontend (:5173) concurrently with namespaced logs
npm run dev
```

### Per-Package Scripts

```bash
npm run dev -w frontend     # Vite dev server only
npm run dev -w backend      # API dev server only
npm run test                # Run tests in all workspaces
npm run lint                # Lint the whole monorepo
npm run typecheck           # Typecheck all workspaces
```

### Environment Setup

Copy the example env files and fill in real values. The real `.env` files are gitignored; `.env.example` files are tracked.

```bash
cp frontend/.env.example frontend/.env
cp backend/.env.example backend/.env
```
