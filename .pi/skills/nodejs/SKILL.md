---
name: nodejs
description: Backend coding conventions for the node-coder agent. The full reference — layered call rule, validation, data access, async, errors, auth, logging, testing, naming, and the avoid-list.
---

# Node.js / Express + PostgreSQL Conventions

Reference skill for the `node-coder` agent. The full backend coding standard. **The neighborhood wins over your defaults** — match what the codebase already does.

## Layered call rule — no skipping layers

`Route → Controller → Service → Data-access (repository/model)`.

- **Routes** wire HTTP to controllers — nothing else.
- **Controllers** do HTTP only: parse/validate input, call a service, shape the HTTP response. **Never import the data-access/DB layer directly into a route or controller.**
- **Services** own all business logic, transaction orchestration, and audit/activity logging.
- **Data-access** does persistence only. **Transactions live in the service layer.**

## Validation

Validate **every** incoming request at the edge with the project's validator (Zod/Joi) on `req.body`, `req.params`, `req.query`. Surface validation errors as `400` with a consistent error shape.

## Data access

- Parameterized queries / ORM query builder (Prisma / Drizzle / Knex / raw `pg`) — **never string-concatenate SQL**.
- Schema changes through the migration tool only — **never `CREATE TABLE` in app code**.
- Never hand-roll a different DB client; use what's there.

## Async

`async/await` — never raw promise chains, never ignored promises. Every async route handler/middleware is wrapped so rejected promises reach the error handler (async-handler wrapper, or `try/catch` + `next(err)`). Never swallow in an empty `catch {}` — log at warn/error with context, or rethrow.

## Errors

Throw or `next(err)` with typed/domain errors; centralized Express error middleware handles them. Never leak stack traces, SQL, internal paths, or secrets.

## Auth

Project mechanism (Google OAuth 2.0 / JWT / session). Protect routes via auth middleware. Enforce roles (Admin/Member) via a **permission middleware** — never inline role checks.

## Config

All secrets and URLs via environment variables. Fail fast on missing required env at boot.

## Logging

Project logger (pino/winston/morgan) — **never `console.log` in production paths**. Levels: error, warn, info, debug. **Never log secrets, JWTs, credentials, PII, or full request/response payloads. Mask identifiers.**

## Tests

- Service-logic unit tests with mocked data-access — **mock the collaborators/external clients, never the SUT.**
- One behavior per test; AAA layout (Arrange / Act / Assert).
- Deterministic data — no unseeded randomness.
- Co-locate `*.test.ts(x)` next to source.
- Backend stack: Vitest + supertest.

## Naming (defaults — overridden by the project)

`<domain>.routes.js` (or `routes/<domain>`), `<domain>.controller.js`, `<domain>.service.js`, `<domain>.repository.js` (or `models/<Domain>`), `<purpose>Dto` / `<purpose>Schema` (Zod), `<concern>.middleware.js`, `<concern>.config.js`. Match the project's ESM vs CJS and `.js` vs `.ts`.

## Avoid

`console.log` in production, string-concatenated SQL, unbounded N+1 queries, swallowed exceptions, magic numbers, scattered cross-cutting concerns.

## No stubs, no TODOs, no "fill this in later."

Be self-contained — if something is ambiguous, surface the conflict explicitly in your final report instead of guessing.
