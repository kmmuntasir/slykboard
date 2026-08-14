# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Slykboard — open-source minimal Kanban board with time tracking and reporting. PERN stack: React 19/Vite frontend, Express 5 backend, PostgreSQL + Drizzle ORM. npm-workspaces monorepo (`frontend/`, `backend/`). Node 24+.

Project instructions split across `.claude/rules/` (persona, git guidelines, style guide, dev/testing rules — loaded automatically) and `AGENTS.md` (same content for other agents). Do not duplicate them here.

## Commands

```bash
make bootstrap          # Fresh clone: node check, npm install, .env files, Postgres, migrations, seed admin
make dev                # Backend (:3000) + frontend (:5173) concurrently
make up / make down     # Start/stop local Postgres (docker compose, db: slykboard, user: slyk/slyk, port 5432)
make migrate            # Apply pending Drizzle migrations (journal-based, NOT push-based)
make migrate-generate   # Generate Drizzle migration from schema.ts changes
make test               # All tests (backend + frontend)
make test-api           # Backend tests only
make test-web           # Frontend tests only
make lint               # ESLint whole repo
make typecheck          # tsc --noEmit both workspaces
make gate               # Full F50 merge gate: typecheck + build + lint + prettier + test (PRs must pass green)
```

Single test file:

```bash
npm run test -w backend -- src/utils/jwt.test.ts
npm run test -w frontend -- src/components/TimerControls.test.tsx
```

Package manager: **npm only** — never `pnpm`, `yarn`, or `bun`. Root `package-lock.json` is the source of truth. `pnpm-lock.yaml`/`pnpm-workspace.yaml` are gitignored strays — never stage them.

## Backend Architecture (`backend/src/`)

Layers: `routes/ → middleware/ → services/ → db/`. The `controllers/` and `repositories/` directories exist but are **empty** — routes hold HTTP handlers (with co-located Zod schemas `*.schema.ts`), services own business logic and query Drizzle directly. Transactions live in services.

- **Entry** `index.ts`: middleware chain = helmet → cors (FRONTEND_URL only, credentials) → pino-http logger → express.json; then routers: `/api/auth`, `/api/projects`, `/api/tickets`, `/api/timer`, `/api/time`, `/api/users`, `/api/labels`, `/api/comments`. `/api/health` and `/api/health/ready` are the only non-enveloped responses.
- **Response envelope** (`utils/envelope.ts`): success `{ data: T }`, error `{ error: { code, message, details? } }`. Error codes: `VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_ERROR`. Central handling via `middleware/errorMiddleware.ts` + `utils/appError.ts` (throw `AppError`, never hand-write status codes in routes).
- **Auth**: Google OAuth auth-code flow (`services/googleOAuth.ts` exchanges code server-side) → JWT via `jose` (`utils/jwt.ts`), Bearer token, 8h TTL. JWT claims: `{ sub, email, pa (platform admin), ver (token version — bump to invalidate on logout) }`.
- **Authorization is two-tier**: platform admin (`users.isPlatformAdmin`) and project roles (`projectMembers.role`: `PROJECT_ADMIN | MEMBER`). Middleware: `authenticate` → `resolveProject` → `requireProjectMember` / `requireProjectAdmin` (`middleware/`).
- **DB**: Drizzle schema in `src/db/schema.ts` — 10 tables: users, projects, projectMembers, projectSequences, tickets, labels, ticketLabels, activityLogs, timeEntries, comments. Soft deletes on tickets; cascade on FKs; activityLogs is append-only audit trail. Pool singleton in `src/db/client.ts` (max 5).
- **HTML sanitization**: all rich-text input passes `utils/sanitizeHtml.ts` (isomorphic-dompurify); rejects `javascript:`/`data:` URIs.
- **Tests**: Vitest + supertest against the real Express app; `jose` and Google OAuth mocked; env injected by `backend/vitest.config.ts` (test DB `postgresql://test:test@localhost:5432/test`).

Drizzle-kit caveat: generated migrations for enum partial indexes emit unapplyable `$1` placeholders — reconcile to literal values (e.g. `'ADMIN'`) before applying.

## Frontend Architecture (`frontend/src/`)

- **Routing** (`routes/index.tsx`, React Router v7): `/login` public; `RequireAuth` guards app routes; `RequirePlatformAdmin` guards `/settings`. Board at `/projects/:slug`, ticket detail as modal overlay at `/projects/:slug/tickets/:displayId`, plus `/reports`, `/members`, `/settings` (project), `/account`.
- **State split**: React Query for all server state (30s staleTime; board polling per `VITE_POLL_INTERVAL_SECONDS`, default 30s — see `lib/queryClient.ts`); Zustand for client state — 3 stores: `useAuthStore` (user + JWT, localStorage-persisted), `useProjectStore` (last project), `useBoardUiStore` (filters/search/drag).
- **API layer**: `api/client.ts` `apiFetch<T>()` wraps fetch; Bearer token from `useAuthStore`; 401 triggers coalesced token refresh (`hooks/useAuthSync.ts`), 403 redirects to `/projects`. Domain modules in `api/*.ts`.
- **Auth flow**: `@react-oauth/google` auth-code on `LoginPage` → backend exchange → JWT in localStorage. `useAuthSync` decodes expiry with `jose`, auto-refreshes within 5min, syncs logout across tabs via storage events.
- **Board**: `pages/BoardPage.tsx` + `BoardColumn.tsx` + `UnsortedBucket.tsx`; drag-and-drop via `@hello-pangea/dnd`; reorder position math in `utils/boardReorder.ts`. Timer: `TimerControls.tsx` / `TimerHeroCard.tsx`, server-time-synced elapsed.
- **Rich text**: `components/RichTextEditor.tsx` — self-hosted CKEditor 5 (GPL build, no cloud license); image URLs restricted to http(s).
- **UI kit**: `components/ui/` — Radix primitives + Tailwind v4 (CSS-first config in `src/index.css`, OKLCH tokens, `.dark` class variant). Toasts via `sonner`.
- **Tests**: Vitest + jsdom + Testing Library (`src/test-setup.ts` stubs env vars and polyfills; `src/test/dndWrapper.tsx` wraps DnD components).

## Conventions

- Destructive or role-changing actions (delete, deactivate, promote/demote) require a confirmation modal before executing — both UI and flows.
- Ticket display IDs are per-project sequences (`projectSequences` table), not UUIDs.
