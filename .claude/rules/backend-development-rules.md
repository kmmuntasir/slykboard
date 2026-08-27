# Backend Development Rules

## General

Node.js 24+ + Express.js 5 + TypeScript (ESM). PostgreSQL 16 via `pg` Pool + **Drizzle ORM**. npm-workspaces monorepo (`backend/`), npm only. Layered: route → middleware → services → db. Auth via Google OAuth auth-code exchange (`google-auth-library`) + app JWT (`jose`). Structured JSON logging via pino + pino-http.

## Project Structure

```
backend/src/
    index.ts            # entry: helmet -> cors -> requestLogger(pino-http) -> express.json; routers; notFound -> errorHandler last
    config/             # env.ts (loadConfig, frozen env object), logger.ts, googleClient.ts, index.ts
    db/
        schema.ts       # Drizzle pgTable definitions, 10 tables
        client.ts       # pg Pool singleton (max 5)
        connect.ts, migrate.ts, seed.ts, bootstrap-admin.ts
        migrations/     # generated SQL + meta/_journal.json (journal-based)
    middleware/         # authenticate, requestLogger, validateRequest, resolveProject,
                        # requireProjectMember, requireProjectAdmin, requirePlatformAdmin,
                        # errorMiddleware(errorHandler), notFound, pingRoute
    routes/             # auth, comments, labels, projectMembers, projects, report, tickets,
                        # time, timer, users — handlers + co-located Zod schemas (*.schema.ts)
                        # + co-located tests (*.routes.test.ts)
    services/           # business logic; owns transactions; queries Drizzle directly.
                        # accessControl, activityLogService, activityService, boardService,
                        # bootstrapService, commentService, googleOAuth, labelService,
                        # membershipService, projectService, reportService, ticketService,
                        # timerService, tokenVersion, userService
    utils/              # appError, envelope, httpStatus, jwt, parseTicketDisplayId, sanitizeHtml, slug
    types/express.d.ts
```

`controllers/` and `repositories/` directories exist but are **empty** — reserved. Do not put logic there today.

## Layering — route → middleware → services → db

Never skip layers.

- **Routes** (`routes/*.ts`): HTTP only. Parse and validate input with co-located Zod schemas applied via `validateRequest`, call a service, shape the response through the envelope. No business logic in routes.
- **Middleware** (`middleware/*.ts`): cross-cutting concerns — `authenticate` (Bearer JWT verify), project resolution/membership gates (`resolveProject`, `requireProjectMember`, `requireProjectAdmin`, `requirePlatformAdmin`), error handling (`errorMiddleware`). Attaches user identity to the request.
- **Services** (`services/*.ts`): business logic. Query Drizzle directly and own `db.transaction()` blocks.
- **DB** (`db/`): Drizzle schema, Pool singleton, migrations, seeds. No ad-hoc pg clients anywhere else.

## Database (PostgreSQL 16 + Drizzle ORM)

- Drizzle query builder or parameterized `sql` only. NEVER string-concatenate user input into SQL.
- Schema changes: edit `src/db/schema.ts` → `make migrate-generate` → inspect generated SQL → `make migrate`. Journal-based flow; do NOT use push-based sync for repo schema changes.
- Known drizzle-kit quirk: generated migrations for enum partial indexes emit unapplyable `$1` placeholders — reconcile to literal values (e.g. `'ADMIN'`) before applying.
- Timestamps UTC (`TZ=UTC` recommended).
- Soft deletes on tickets; cascade FKs; `activityLogs` is an append-only audit trail.
- Pool singleton lives in `db/client.ts` (max 5).

## API Client / Contract

- All `/api/*` endpoints (except auth) require `Bearer <JWT>` in the Authorization header.
- Routers: `/api/auth`, `/api/projects`, `/api/tickets`, `/api/timer`, `/api/time`, `/api/users`, `/api/labels`, `/api/comments`.
- `/api/health` and `/api/health/ready` are the only non-enveloped responses.

## Validation

- Validate input at the route edge with Zod schemas in co-located `*.schema.ts`, applied via the `validateRequest` middleware.
- Reject malformed input with `400` `VALIDATION_FAILED` envelope.
- Never echo raw input back in a way that enables XSS/reflected injection.

## Sanitization

- All rich-text input (ticket descriptions, comments) passes `utils/sanitizeHtml.ts` (isomorphic-dompurify).
- Rejects `javascript:` / `data:` URIs; preserves the sanitized subset.

## Transactions

- Multi-statement mutations are wrapped in `db.transaction()` inside the service layer.
- Never hold a transaction open across an external HTTP call.
- Always roll back on error.

## Error Handling

- Consistent JSON envelope (`utils/envelope.ts`): success `{ data: T }`, error `{ error: { code, message, details? } }`.
- Codes: `VALIDATION_FAILED` | `UNAUTHENTICATED` | `FORBIDDEN` | `NOT_FOUND` | `CONFLICT` | `INTERNAL_ERROR`.
- Routes throw `AppError` (`utils/appError.ts`) or let Zod errors propagate — never hand-write `res.status(...)` codes. Central handling in `middleware/errorMiddleware.ts`.
- Status mapping: `400` validation, `401` auth, `403` forbidden, `404` not found, `409` conflict, `500` server error.
- Never leak stack traces, SQL, or secrets.
- Never swallow in empty `catch {}` — log via `logger.warn`/`logger.error` with context, or rethrow.

## Logging

- pino + pino-http (`config/logger.ts`, `middleware/requestLogger.ts`) — structured JSON.
- Never `console.log` in production paths.
- **Never** log secrets, JWTs, credentials, PII, or full request/response payloads. Mask identifiers.

## Auth

- Google OAuth **auth-code** flow: frontend obtains the code via `@react-oauth/google`; backend `services/googleOAuth.ts` exchanges it server-side using `config/googleClient.ts` (`google-auth-library`) and validates audience = `GOOGLE_CLIENT_ID`.
- Optional `ALLOWED_DOMAIN` email-domain restriction.
- App JWT signed with `jose` (`utils/jwt.ts`), Bearer scheme. Claims: `{ sub, email, pa (platform admin boolean), ver (token version) }`. TTL from `JWT_TTL`, default `'8h'`.
- Token version bump invalidates outstanding tokens (`tokenVersion` service).
- Platform Admin is bootstrapped once via `src/db/bootstrap-admin.ts` (`BOOTSTRAP_ADMIN_*` env).
- **Two-tier authorization**: platform admin (`users.isPlatformAdmin`, gated by `requirePlatformAdmin`) AND per-project roles (`projectMembers.role`: `PROJECT_ADMIN | MEMBER`; chain `authenticate` → `resolveProject` → `requireProjectMember` / `requireProjectAdmin`).

## Domain Rules (constraints)

1. **Ticket display IDs are per-project sequences** (`projectSequences` table), not UUIDs. Parse via `utils/parseTicketDisplayId.ts`.
2. **Tickets soft-delete** — never hard-delete rows; filtered reads must exclude deleted tickets.
3. **activityLogs is append-only** — audit entries are written by services (`activityLogService`), never updated or removed.
4. **Board ordering** — position/reorder math is validated server-side; client-sent positions are never trusted blindly.
5. **Time tracking** — durations persist from the server clock (`timeEntries`); client-reported elapsed values are advisory/display only.
6. **Authorization is enforced twice** — route-level gating AND a permission re-check in the service layer (`accessControl`). Route gating alone is not sufficient.

## Build and Run

```bash
cd backend
npm run dev          # tsx watch with hot reload (port 3000)
npm run build        # tsc compile
npm start            # Production: node dist/index.js
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm test             # vitest
npm run test:watch   # vitest watch mode

npm run db:generate  # drizzle-kit generate
npm run db:migrate   # apply pending migrations (journal-based)
npm run db:studio    # drizzle studio
npm run db:seed      # idempotent seed
```

Root Makefile equivalents: `make dev`, `make test-api`, `make lint`, `make typecheck`, `make gate`, `make migrate`, `make migrate-generate`, `make up`/`make down` (docker compose Postgres), `make bootstrap`.

## Tests

- Vitest + supertest against the REAL exported Express app with a REAL Postgres test DB.
- `backend/vitest.config.ts` injects env inline: `NODE_ENV=test`, `DATABASE_URL=postgresql://test:test@localhost:5432/test`, `FRONTEND_URL=http://localhost:5173`, `JWT_SECRET` (>=32 chars), `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL=postmessage`.
- `jose` and `google-auth-library` are mocked; tests co-located as `*.test.ts`.
- Cover happy paths + error paths (`400/401/403/404/409`) + authorization-matrix edge cases (platform admin vs project admin vs member vs non-member, cross-project access).

## Environment Variables (`backend/.env`, mirrors `.env.example`)

| Variable | Required | Notes |
|----------|----------|-------|
| `FRONTEND_URL` | Yes | Comma-separated allowed origins (CORS) |
| `DATABASE_URL` | Yes | Postgres connection string |
| `JWT_SECRET` | Yes | App JWT signing, >=32 chars |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth |
| `GOOGLE_CLIENT_SECRET` | Yes | Server-side code exchange |
| `GOOGLE_CALLBACK_URL` | Yes | `postmessage` in tests/dev |
| `PORT` | No | Default 3000 |
| `NODE_ENV` | No | |
| `JWT_TTL` | No | Default `8h` |
| `ALLOWED_DOMAIN` | No | Email-domain restriction |
| `BOOTSTRAP_ADMIN_EMAIL` / `_FULL_NAME` / `_DISPLAY_NAME` | Bootstrap | Creates the platform admin once |
| `DIRECT_DATABASE_URL` | No | Fallback to `DATABASE_URL`; used for prod-start migrations |
| `RUN_MIGRATIONS_ON_START` | No | Default true when `NODE_ENV=production` |

Loaded by `src/config/env.ts` (`loadConfig`, frozen env object). Fail fast on missing required vars.

## Avoid

- Ad-hoc `pg` clients outside `db/client.ts`.
- String-concatenated SQL — Drizzle query builder / parameterized statements only.
- Hand-written `res.status(...)` in routes bypassing `AppError` + the envelope.
- Business logic in routes or in the empty `controllers/`/`repositories/` directories.
- Push-based schema sync — journal-based migrations only.
- Skipping `sanitizeHtml` on any rich-text input.
- `console.log` / `console.error` in production (use the pino logger).
- Logging tokens, secrets, or DB contents.
- Hardcoded URLs, hosts, ports, credentials.
- Exposing internal stack traces via API responses.
