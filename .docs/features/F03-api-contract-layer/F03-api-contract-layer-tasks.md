# F03 — API contract layer: Plan + Task Breakdown

> **Feature:** F03 — API contract layer (Phase 0 — Foundation)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F01 (F02 also merged; F03 is parallel to F02 in dep graph but ships after F01) · **PRD ref:** js-development-rules.md (Route/Middleware conventions) + PRD §5, §8
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), [`features.md`](../../features.md) (F03 spec block, lines 117-131), the project rules discovered for this repo (`.claude/rules/{js-style-guide,js-testing-rules,js-development-rules,git-guidelines,persona}.md`), plus dependency feature task docs: [F01](../F01-monorepo-scaffolding/F01-monorepo-scaffolding-tasks.md), [F02](../F02-database-migration-pipeline/F02-database-migration-pipeline-tasks.md). Phase-2 evidence supplied verbatim by four parallel analysis agents (codebase state, F01/F02 inherited contracts, PRD+rules extract, external research).

---

## 1. F03 Recap

**Goal:** Every endpoint speaks one consistent shape.

**Ships:** A reusable response envelope, global error middleware, request validation (Zod at the edge), and request logging — plus hardened CORS and security headers. Every future route (F05+ auth, F08 Projects, F12 Tickets, F18 ActivityLogs, F20 TimeEntries) inherits this contract.

**Acceptance (definition of done):**
1. Success envelope `{ data }` and error envelope `{ error: { code, message, details? } }` used everywhere (no bare `{ error: <string> }`, no ad-hoc shapes).
2. Central error handler maps validation errors → 400, auth → 401, not-found → 404, server → 500. Unknown routes hit a `notFound` middleware → 404 envelope (never Express's default HTML).
3. Zod validation at the edge for request bodies/params/query via a reusable `validateRequest(schema)` factory.
4. CORS locked to `FRONTEND_URL` only (single string origin, not `*`).
5. Request logging on every request (structured JSON via pino-http; secrets redacted).
6. Stack traces never leak in production responses; no `console.log` for request/error logging.

**Edge cases — resolved:**

- **Never leak stack traces or internal messages in production responses.** → **Decision (sign-off: owner-implicit per F03 spec):** defense in depth — (a) error middleware maps code→status via lookup, never trusts `err.message` for 5xx in production (5xx body message is always `'Internal server error'`); (b) `err.stack` only attached when `NODE_ENV !== 'production'`; (c) treat unset `NODE_ENV` as production (`isProd = env.nodeEnv !== 'development'`, the stricter direction); (d) pino redacts `req.headers.authorization`, `req.headers.cookie`, `req.body.password`, `*.password`; (e) `helmet()` strips `X-Powered-By` and sets security headers; (f) request bodies never logged in production. **D9 below.**
- **Decide error `code` vocabulary up front so the frontend can branch on it.** → **Decision (sign-off: owner-implicit per F03 spec):** ratify a closed 6-code vocabulary: `VALIDATION_FAILED` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409, reserved for F05+ unique-constraint collisions), `INTERNAL_ERROR` (500). `AppError` carries `code` + `status` + optional `details`. Unknown `Error` instances normalize to `INTERNAL_ERROR` / 500. F03 ships the table as a `codeToStatus` lookup so downstream features import a single source of truth. **D3, D4 below.**
- **Success envelope shape — the rules never define it.** → **Decision (sign-off: owner-implicit — the F03 spec literally says `(e.g. { data })`):** success body is `{ data }` (the resource, array, or `null`/scalar), error body is `{ error: { code, message, details? } }`. The existing `/api/health` endpoint is the one documented exception (see next edge case).
- **`/api/health` returns a bespoke non-enveloped shape and has a test asserting `body.status === 'ok'`.** → **Decision:** health is a **probe endpoint** (Render healthcheck, ops dashboards) and stays **non-enveloped** — `{ status, service, uptime, timestamp }` unchanged. Rationale: liveness probes are consumed by infra, not the frontend; wrapping it in `{ data: {...} }` adds friction for ops tools that match on top-level `status`. The `health.test.ts` assertions stay valid as-is. F03 documents this as the single sanctioned exception; every route added after F03 uses the envelope. **D10 below.**
- **Express 5 async error handling.** → **Decision:** use Express 5's native behavior — rejected promises in async route handlers auto-forward to the error middleware. **No `asyncHandler` wrapper, no `express-async-errors` shim.** Route handlers throw/reject freely. **D6 below.**
- **Logger choice — style guide forbids `console.log` in production but doesn't name a logger.** → **Decision:** `pino` + `pino-http` for structured JSON request logging with built-in redaction. Replaces the 9 raw `console.*` call sites in `index.ts`/`db/*`. `pino-pretty` in dev for readability. **D7 below.**
- **Validation location / API.** → **Decision:** a `validateRequest(schema)` middleware factory. It accepts a Zod 4 object schema (or a `{ body?, query?, params? }` partial), runs `safeParse` per source, on failure throws an `AppError` with `code: 'VALIDATION_FAILED'`, `status: 400`, `details: z.flattenError(err)`; on success overwrites `req.body`/`req.query`/`req.params` with the parsed (typed, coerced, stripped) values. Mounted per-route, not globally. F03 ships the **factory + one example schema + example route usage**; per-route schemas are authored by each downstream feature (F05+). **D11 below.**
- **CORS — single origin or list?** → **Decision:** single string origin = `env.frontendUrl`. The F01 wire already does this; F03 hardens it with `credentials: true`, `methods`, `allowedHeaders`, `maxAge`. Because `credentials: true` forbids `*`, origin MUST stay a single string. **D8 below.**
- **`429` / rate-limit.** → **Decision: OUT OF SCOPE (deferred).** The F03 spec does not mention rate-limiting; PRD §4 REQ-4 (30s polling) implies low per-client load. A `RATE_LIMITED` code (429) is reserved for future addition but not built here. Documented in §3 Out-of-scope.
- **Request-id / correlation id.** → **Decision: deferred.** `pino-http` auto-generates a per-request id in logs; no custom header propagation in F03. Future feature may surface it as `X-Request-Id`.
- **Env-schema validation (validate `process.env` itself with Zod).** → **Decision: deferred.** F01/F02 already fail-fast on `FRONTEND_URL`/`DATABASE_URL`. Replacing the hand-written `loadConfig` with a Zod schema is a refactor that risks regressions in the frozen `env` singleton; defer to a dedicated cleanup task.
- **Zod schemas location (shared dir vs per-route).** → **Decision:** F03 ships the `validateRequest` factory + a single example schema inline in the example route. Per-route schemas will be co-located with their routes when F05+ adds them (`backend/src/routes/<feature>.schema.ts`); F03 does NOT pre-create a `schemas/` dir. **D12 below.**
- **`createApp()` factory — should F03 introduce one?** → **Decision: NO.** The current `index.ts` builds `app` inline at module top level and exports it; `health.test.ts` imports `{ app }` from `./index`. Refactoring to `createApp()` would touch the test seam and risk regressions for no current benefit. F03 edits `index.ts` in place (mounts middleware between the `express.json()` call at line 11 and the health route at line 13, error handler last after routes). Flag for future cleanup if middleware list grows. **D13 below.**

> **Owner questions surfaced (none blocking — all resolved with rationale above):**
> - Health endpoint non-enveloped exception — confirm acceptable for ops tooling. (Resolved as documented exception; trivially reversible.)
> - 6-code vocabulary (`UNAUTHENTICATED`/`FORBIDDEN`/`NOT_FOUND`/`VALIDATION_FAILED`/`CONFLICT`/`INTERNAL_ERROR`) — confirm the frontend can branch on these exact strings. (Matches F03 spec's enumerated examples.)

---

## 2. Codebase Analysis Summary

- **State:** **Modified greenfield.** F01 (monorepo scaffolding) and F02 (DB pool/migrations) are merged and confirmed in live code. The Express app boots, exports `app`, has a health route, and opens/closes a `pg.Pool` with retry/backoff and graceful shutdown. What's **MISSING** for F03: response envelope helpers, global error middleware, 404 handler, Zod validation layer (**Zod NOT installed** — confirmed), request logging (**no pino/morgan/helmet/winston**), security headers. The `middleware/` and `utils/` dirs exist as `.gitkeep`-only placeholders. There are ~9 raw `console.*` call sites in `index.ts`/`db/*`.
- **Monorepo shape (confirmed in live code):** npm workspaces `["frontend","backend"]`; root `type: module`; root `engines.node: ">=24.0.0"`; `.nvmrc` → 24. Backend is `@slykboard/backend`, ESM, private. Install prefix: `-w backend`.
- **Backend deps installed (relevant):** `express@^5.0.0` (Express 5 confirmed), `cors@^2.8.5`, `dotenv@^17.4.2`, `drizzle-orm@^0.45.2`, `pg@^8.22.0`. Dev: `tsx`, `vitest@^3`, `supertest@^7`, `@types/cors`, `@types/express@^5`, `@types/supertest`, `@types/pg`, `drizzle-kit`. **NOT installed (F03 must add):** `zod`, `pino`, `pino-http`, `pino-pretty` (dev), `helmet`. `@types/pino-http` ships types in-box for `pino-http@^10`; `helmet@^8` ships its own types.
- **TS config gotchas (`tsconfig.base.json`):** `strict`, `verbatimModuleSyntax` (forces `import type` / `export type` for type-only imports), `noUncheckedIndexedAccess` (indexed lookups return `T | undefined` — relevant for `codeToStatus` map access), `isolatedModules`, `module: ESNext`, `moduleResolution: Bundler`. **No path aliases** — relative imports only. Backend `tsconfig.json` extends base with `composite: true`, rootDir `src`, outDir `dist`.
- **Style (live repo, verified):** Prettier — **2-space indent, semicolons, single quotes, 100 cols, trailing commas** (the live `index.ts`/`env.ts` use semicolons; exemplar doc omitted them but the repo wins). camelCase vars/functions, PascalCase types/components, SCREAMING_SNAKE_CASE constants. Functions <50 lines, early returns, async/await. Import order: external → internal → type → relative. No `any` (use `unknown`). Named HTTP status constants (no magic numbers).
- **Existing structure this feature builds on (F01/F02 seams — all confirmed in live code with citations):**
  - **[Express app + export]** `backend/src/index.ts:8` `const app: Express = express();`; `:64` `export { app };`. Used by `health.test.ts:3` via supertest. **F03 mounts middleware in place (no `createApp()` refactor — D13).**
  - **[CORS already wired]** `backend/src/index.ts:10` `app.use(cors({ origin: env.frontendUrl }));` — single-origin, already F03-compliant on origin. F03 hardens with `credentials`, `methods`, `allowedHeaders`, `maxAge` (D8).
  - **[Body parsing]** `backend/src/index.ts:11` `app.use(express.json());`.
  - **[Health route]** `backend/src/index.ts:13-20` returns ad-hoc `{ status, service, uptime, timestamp }`. **F03 leaves this shape intact (D10 documented exception).**
  - **[Boot/shutdown]** `backend/src/index.ts:22-62` — `isMain` guard, `start()` calls `connectWithRetry(pool)` before `app.listen`, `shutdown()` does `server.close()` → `pool.end()` → 10s force-exit timer. F03 does NOT touch boot/shutdown; it only inserts middleware between line 11 and line 13, and appends error middleware after the health route.
  - **[Typed config]** `backend/src/config/env.ts:1-26` — `import 'dotenv/config';` at `:1`; `Config` interface at `:3-8` (`port, frontendUrl, nodeEnv, databaseUrl`); `loadConfig(envSource)` factory at `:10`; fail-fast throws on missing `FRONTEND_URL` (`:11-13`) and `DATABASE_URL` (`:14-16`); frozen singleton `env` at `:26` (`Object.freeze`). Barrel at `config/index.ts`. **F03 reuses `env.nodeEnv` and `env.frontendUrl` — no new env vars introduced** (no `.env.example` or `vitest.config.ts` changes needed for F03).
  - **[DB pool singleton]** `backend/src/db/client.ts` — globalThis-cached `Pool` max:5, exports `db` + `pool`. F03 does not touch this.
  - **[Vitest config]** `backend/vitest.config.ts:1-13` — injects `FRONTEND_URL`, `NODE_ENV=test`, `DATABASE_URL`. **No new env vars from F03 → no edit needed.**
  - **[Test pattern]** `backend/src/health.test.ts` + `backend/src/config/env.test.ts` — table-driven `cases.forEach(...)`, supertest against exported `app`. Mandatory shape per `js-testing-rules.md`.
  - **[Empty placeholder dirs confirmed]** `backend/src/middleware/.gitkeep`, `backend/src/utils/.gitkeep` — F03 fills these.
- **Prior art / partial work:** None for F03. No envelope, no error middleware, no validation, no logger. CORS is half-done (origin correct, rest missing).
- **File paths the plan references that do NOT exist yet (will be created):**
  - `backend/src/utils/httpStatus.ts` — named HTTP status constants (no magic numbers).
  - `backend/src/utils/appError.ts` — `AppError` class (extends `Error`, carries `code`/`status`/`details`).
  - `backend/src/utils/appError.test.ts` — unit tests.
  - `backend/src/utils/envelope.ts` — `success(data)` / `error(code, message, details?)` envelope builders + `ErrorCode` union + `codeToStatus` map.
  - `backend/src/utils/envelope.test.ts` — unit tests.
  - `backend/src/config/logger.ts` — pino instance with env-aware level + redaction; dev pretty transport.
  - `backend/src/config/logger.test.ts` — unit tests (level selection, redaction paths).
  - `backend/src/middleware/errorMiddleware.ts` — Express 5 4-arg global error handler.
  - `backend/src/middleware/errorMiddleware.test.ts` — unit tests (code→status map, prod stack suppression).
  - `backend/src/middleware/notFound.ts` — 404 handler for unmatched routes.
  - `backend/src/middleware/notFound.test.ts` — unit tests.
  - `backend/src/middleware/validateRequest.ts` — Zod 4 `validateRequest(schema)` factory.
  - `backend/src/middleware/validateRequest.test.ts` — unit tests (safeParse pass/fail, details shape).
  - `backend/src/middleware/requestLogger.ts` — thin wrapper mounting `pino-http` with serializers.
  - `backend/src/middleware/requestLogger.test.ts` — unit tests (serializer shape).
  - `backend/src/middleware/__example_route__.ts` — optional: a `/api/ping` route demonstrating envelope + validateRequest (proves the contract end-to-end; removable or kept as a smoke route). **Decision: keep as `/api/ping` smoke route — cheap, proves wiring, useful for F04 frontend smoke test.**
  - `backend/src/middleware/__example_route__.test.ts` — integration test for `/api/ping`.
- **Files F03 MODIFIES:**
  - `backend/package.json` — add `zod`, `pino`, `pino-http`, `helmet` deps; `pino-pretty` devDep.
  - `backend/src/index.ts` — mount `helmet()`, hardened `cors(...)`, `requestLogger`, keep `express.json()`, routes; append `notFound` then `errorMiddleware` last. Replace `console.*` with logger where in-scope (boot/shutdown logging stays `console.*` if logger not yet ready at that point — see D7 note; or switch to logger if clean).
  - `backend/src/health.test.ts` — **MAY need a tweak**: after error middleware is mounted, an unknown path must now return the 404 envelope not Express default. Existing health assertions stay. Add a case asserting unknown routes return `{ error: { code: 'NOT_FOUND' } }`.
- **Project rules this plan must satisfy:**
  - `.claude/rules/js-development-rules.md` — dir structure (`backend/src/{middleware,utils,config}/`); "Return JSON responses with a consistent envelope" (Route Conventions); "Validate all inputs (Zod/Joi at the edge)" (Security); "CORS configured for specific frontend URL only" (Security); "Auth enforced via middleware; roles via permission middleware" (precedent for 401/403 shapes); env table (`PORT`, `FRONTEND_URL` required, `NODE_ENV` defaults development); Render deploy `node src/index.js` (entry path fixed).
  - `.claude/rules/js-style-guide.md` — 2-space JS/TS indent, 100 cols, trailing commas, single quotes, semicolons (live repo); camelCase vars, PascalCase types, SCREAMING_SNAKE_CASE constants; functions <50 lines, early returns, async/await; no `any`; named HTTP status constants; import order; references an `ApiError` class convention (F03 ships `AppError`).
  - `.claude/rules/js-testing-rules.md` — Vitest; co-located `*.test.ts`; table-driven `cases.forEach` preferred; `vi.fn()` mocks; mock req/res/next; `describe('middlewareName')`; assertions `.toBe/.toEqual/.toThrow`; business logic >80% coverage; `npm test -- --root backend` (this repo uses `npm test -w backend`).
  - `.claude/rules/git-guidelines.md` — **NEVER run git without explicit approval**; rebase-and-merge ONLY (no merge commits, no squash); branch `type/SLYK-<n>-<desc>` (omit ticket if unknown — F03 has no Jira ticket, so `feature/SLYK-F03-api-contract-layer`); single-line commit `SLYK-<n>: msg`; `.gitignore` has `node_modules/`, `.env`, `dist/`, `build/`, `*.log`, `.DS_Store`.
  - `.claude/rules/persona.md` — Node 24+/Express 5, reply concise, backend code → `./backend/`.
- **Hidden coupling to plan for:**
  - **`createApp()` refactor avoided (D13):** the app is built inline and exported; `health.test.ts` imports it. Editing `index.ts` in place keeps the test seam stable.
  - **Health bespoke shape + test (D10):** `health.test.ts:8` asserts `body.status === 'ok'`. If health were enveloped, this assertion breaks. F03 keeps health non-enveloped — zero test churn for the existing cases.
  - **Frozen `env` singleton:** `env` is `Object.freeze(loadConfig())` read at import time. F03 reads `env.nodeEnv` and `env.frontendUrl` at middleware construction time — fine, but any runtime config change requires a restart (matches existing F01/F02 behavior).
  - **`verbatimModuleSyntax`:** all type-only imports must use `import type` (e.g. `import type { Request, Response, NextFunction } from 'express'`). Exporting types needs `export type`.
  - **`noUncheckedIndexedAccess`:** `codeToStatus[code]` returns `number | undefined`. The error middleware must fall back to 500 when a code isn't in the map (defense in depth — unknown codes never crash the handler).
  - **Express 5 error middleware signature:** MUST be a 4-arg `(err, req, res, next)` registered LAST via `app.use(...)`. Even though `next` is unused, all 4 params must be present or Express won't recognize it as an error handler. Style guide's no-unused-vars rule conflicts here → use an eslint-disable comment on `next` (standard Express pattern).
  - **`pino-http` mount order:** must mount AFTER `helmet`/`cors` (so those are logged as applied) but BEFORE routes (so `req.log` is available in handlers and the error middleware can call `req.log.error`). Boot/shutdown logging happens outside the request lifecycle — the logger module exports a raw `logger` too, used by `start()`/`shutdown()` if switched over.
  - **Error handler is the LAST `app.use`:** any route or middleware registered after it is unreachable. The `notFound` handler must be registered immediately before it.
  - **`req.log` availability:** `pino-http` hangs `req.log` on every request. The error middleware should guard `req.log?.error(...)` in case a pre-log error occurs (e.g. malformed request before pino-http runs — unlikely given mount order, but defensive).

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale (cite source) |
|---|----------|--------|-----------|
| D1 | **Validation library** | **Zod 4** (`zod@^4.0.1`, the `zod` package — NOT `@zod/mini`) | `js-development-rules.md` Security bullet: "Validate all inputs (Zod/Joi at the edge)". Zod 4 is GA (Aug 2025); `{ error }` customization, top-level `z.email()`, `z.flattenError(err)` → `{ formErrors, fieldErrors }`, `z.coerce.*`. Pin `^4` to dodge transitive 3.25.x. Evidence D (Context7 `/colinhacks/zod/v4.0.1`). |
| D2 | **Envelope shape** | **Success `{ data }`, error `{ error: { code, message, details? } }`** | F03 spec acceptance bullet 1 verbatim: "Success envelope (e.g. `{ data }`) and error envelope (`{ error: { code, message, details? } }`) used everywhere." `js-development-rules.md` Route Conventions: "Return JSON responses with a consistent envelope." Precedent error body `{ error: <string> }` in the rules' middleware example is superseded by the richer F03 shape. |
| D3 | **Error code vocabulary (closed set)** | `VALIDATION_FAILED` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `INTERNAL_ERROR` (500) | F03 spec edge case verbatim: "Decide error `code` vocabulary up front (e.g. `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`)". `CONFLICT` reserved for F05+ unique-constraint collisions (Users.email/googleId). Frontend branches on `code` string, never on HTTP status alone. Exported as `ErrorCode` union + `codeToStatus` map. |
| D4 | **`AppError` class** | `class AppError extends Error { constructor(code, message, details?) }`; `status` derived from `codeToStatus[code] ?? 500` | `js-style-guide.md` Error Handling references an `ApiError` class convention. F03 ships `AppError` (name avoids collision with the doc's `ApiError` placeholder). Carries `code` (machine-readable), `message` (human-readable, safe to expose), `details?` (structured — e.g. Zod field errors). `name = 'AppError'` for clean logs. |
| D5 | **Express 5 error handling** | **Native** — async route handlers' rejected promises auto-forward to the error middleware | Express 5 (`express@^5.0.0`, `backend/package.json:23`) behavior. No `asyncHandler` wrapper, no `express-async-errors` shim. Evidence D (Context7 `/expressjs/express/v5.2.0`). Route handlers throw/reject freely. |
| D6 | **Global error middleware signature** | 4-arg `(err, req, res, next)` registered LAST via `app.use`; eslint-disable on unused `next` | Express requires all 4 args to recognize an error handler. Standard pattern; `js-style-guide.md` allows eslint-disable for framework constraints. |
| D7 | **Logger** | **`pino` + `pino-http`**; `pino-pretty` dev transport | `js-style-guide.md`: "avoid `console.log` in production — use proper logger". pino is fastest, structured JSON, built-in redaction. Config: `level: isProd ? 'info' : 'debug'`; `redact: { paths: ['req.headers.authorization','req.headers.cookie','req.body.password','*.password'], censor: '[REDACTED]' }`; dev pretty transport via `pino-pretty`. Evidence D. Mount `pinoHttp({ logger, serializers })` before routes; hangs `req.log`. Error middleware calls `req.log.error({ err })`. Boot/shutdown can use the raw `logger` export. |
| D8 | **CORS hardening** | `cors({ origin: env.frontendUrl, credentials: true, methods: ['GET','POST','PUT','PATCH','DELETE'], allowedHeaders: ['Content-Type','Authorization'], maxAge: 86400 })` | F03 spec acceptance: "CORS locked to `FRONTEND_URL` only". `js-development-rules.md` Security: "CORS configured for specific frontend URL only". `credentials: true` enables future HttpOnly cookies (F05 auth); forces single-string origin (cannot be `*`). `allowedHeaders` matches what the frontend sends. Evidence D. |
| D9 | **Production safety (no leaks)** | Defense in depth: (a) 5xx message hardcoded `'Internal server error'` in prod; (b) `err.stack` only when `env.nodeEnv !== 'production'`; (c) `isProd = env.nodeEnv !== 'development'` (stricter — unset `NODE_ENV` treated as prod); (d) pino redaction; (e) `helmet()` strips `X-Powered-By` + security headers; (f) request bodies never logged in prod | F03 spec edge case verbatim: "Never leak stack traces or internal messages in production responses." `js-development-rules.md` Security: "No secrets in code — all via environment variables". Evidence D. |
| D10 | **Health endpoint treatment** | **Non-enveloped exception** — `/api/health` keeps `{ status, service, uptime, timestamp }` | Liveness probes consumed by Render healthcheck / ops tools, not the frontend; matching on top-level `status` is the convention. Wrapping would break `health.test.ts:8` and add ops friction. F03 documents this as the single sanctioned exception; every post-F03 route uses the envelope. Trivially reversible if owner disagrees. |
| D11 | **Validation API** | `validateRequest(schema)` middleware factory: accepts a Zod 4 schema (or `{ body?, query?, params? }` partial); `safeParse` per source; on fail `throw new AppError('VALIDATION_FAILED', 'Request validation failed', details: z.flattenError(err))`; on success overwrite `req.body`/`query`/`params` with parsed | `js-development-rules.md` Security: "Validate all inputs (Zod/Joi at the edge)". Mounted per-route. F03 ships the factory + one example; downstream features (F05+) author their own schemas co-located with routes. |
| D12 | **Zod schemas location** | Per-route co-location when added by F05+ (`backend/src/routes/<feature>.schema.ts`); F03 ships NO `schemas/` dir, only the factory + one inline example | Avoids premature shared-dir coupling; each feature owns its schemas. Matches "one concern per file" style. |
| D13 | **`createApp()` factory?** | **NO** — edit `index.ts` in place | Current inline `app` + `export { app }` is a stable test seam (`health.test.ts:3`). Refactoring to `createApp()` risks regressions for no current benefit. F03 inserts middleware in place: helmet → cors → requestLogger → express.json (existing) → routes → notFound → errorMiddleware. Flag for future cleanup only if middleware count grows. |
| D14 | **Security headers** | `helmet@^8` via `app.use(helmet())` | Removes `X-Powered-By`, sets CSP/HSTS/frame-options/etc. Types in-box since helmet v7. Cheap, high-value. Evidence D. |
| D15 | **NODE_ENV prod-default** | `isProd = env.nodeEnv !== 'development'` | Unset `NODE_ENV` (Render misconfig, leaked env) is treated as production → fails safe (stack hidden, verbose logging off). Stricter than `=== 'production'`. |
| D16 | **Example/smoke route** | `/api/ping` — validates a `GET ?name=<string>` query via Zod, returns `{ data: { message: 'pong, <name>' } }` | Proves the full contract (envelope + validateRequest + errorMiddleware + requestLogger) end-to-end with a real HTTP request. Cheap. Useful for F04 frontend smoke test. Co-located test asserts success envelope + validation-failure envelope. |

> **Out of F03 scope (explicitly deferred):**
> - **Rate limiting (429 / `RATE_LIMITED`)** — not in F03 spec; PRD §4 REQ-4 (30s polling) implies low load. Reserved code; built in a later feature if needed.
> - **Request-id header propagation (`X-Request-Id`)** — `pino-http` auto-generates per-request ids in logs; surfacing as a response header is a future enhancement.
> - **Env-schema validation** (Zod-validated `process.env`) — F01/F02 fail-fast is sufficient; refactor deferred.
> - **Auth/permission middleware** (F06) — F03 only defines the `UNAUTHENTICATED`/`FORBIDDEN` codes and shapes; the middleware that throws them ships in F06.
> - **Per-route Zod schemas** (F05+) — F03 ships the factory + one example only.
> - **`createApp()` factory refactor** — deferred (D13).
> - **Replacing all 9 `console.*` call sites in `db/*`** — F03 swaps `index.ts` boot/shutdown logging to the logger where clean; `db/client.ts`/`db/connect.ts`/`db/seed.ts` keep `console.*` (out of the request path; lower priority). Future cleanup.
> - **OpenAPI / route documentation** — not requested; a later feature may generate specs from Zod schemas.

> **Owner sign-off status:**
> - ✅ Envelope shape `{ data }` / `{ error: { code, message, details? } }` — F03 spec acceptance bullet 1 (verbatim).
> - ✅ Error code vocabulary (6 codes) — F03 spec edge case (enumerated examples + `CONFLICT` reserved).
> - ✅ Zod as the validator — `js-development-rules.md` Security bullet names Zod.
> - ✅ CORS single-origin `FRONTEND_URL` — F03 spec acceptance + `js-development-rules.md`.
> - ➖ Health endpoint non-enveloped exception (D10) — resolved with rationale; trivially reversible if owner prefers uniform enveloping.
> - ➖ `/api/ping` smoke route kept (D16) — confirm acceptable; removable if unwanted.
> - ➖ `pino-http` over `morgan` (D7) — confirm logger choice (style guide doesn't name one).

---

## 4. Architecture Overview (Target Tree)

```
slykboard/                                        # repo root
└── backend/
    ├── package.json                              # MODIFY — add zod/pino/pino-http/helmet deps; pino-pretty devDep
    └── src/
        ├── config/
        │   ├── env.ts                            # (unchanged — F03 reuses env.nodeEnv, env.frontendUrl)
        │   ├── logger.ts                         # NEW (D7) — pino instance; isProd level + redaction + dev pretty
        │   └── logger.test.ts                    # NEW — unit: level selection, redact paths
        ├── utils/
        │   ├── httpStatus.ts                     # NEW — named HTTP status constants (no magic numbers)
        │   ├── appError.ts                       # NEW (D4) — AppError class
        │   ├── appError.test.ts                  # NEW — unit: constructs with code/status/details
        │   ├── envelope.ts                       # NEW (D2,D3) — success()/error() builders + ErrorCode union + codeToStatus
        │   └── envelope.test.ts                  # NEW — unit: envelope shapes, code→status map
        ├── middleware/                            # was: .gitkeep (empty)
        │   ├── errorMiddleware.ts                # NEW (D5,D6,D9) — Express 5 4-arg global error handler
        │   ├── errorMiddleware.test.ts           # NEW — unit: code→status, prod stack suppression, fallback 500
        │   ├── notFound.ts                       # NEW — 404 for unmatched routes
        │   ├── notFound.test.ts                  # NEW — unit: returns NOT_FOUND envelope
        │   ├── validateRequest.ts                # NEW (D1,D11) — Zod 4 safeParse factory
        │   ├── validateRequest.test.ts           # NEW — unit: pass/fail/details shape
        │   ├── requestLogger.ts                  # NEW (D7) — pino-http mount wrapper with serializers
        │   ├── requestLogger.test.ts             # NEW — unit: serializer shape
        │   ├── pingRoute.ts                      # NEW (D16) — /api/ping smoke route (envelope + validateRequest demo)
        │   └── pingRoute.test.ts                 # NEW — integration: success + validation-failure envelopes
        ├── health.test.ts                        # MODIFY — add a case for 404 envelope on unknown routes
        └── index.ts                              # MODIFY — mount helmet→cors→requestLogger→express.json→routes→notFound→errorMiddleware
```

**Request lifecycle (mount order — non-obvious, MUST be exactly this):**

1. `helmet()` — sets security headers, strips `X-Powered-By`. (First, so every response including errors gets them.)
2. `cors({ origin: env.frontendUrl, credentials: true, ... })` — preflight handling.
3. `requestLogger` (pino-http) — hangs `req.log` on every request; logs `req.method`, `req.url`, `res.statusCode`, `responseTime`. (Before routes so handlers can use `req.log`.)
4. `express.json()` — body parsing (existing, line 11).
5. Routes: `/api/health` (existing, non-enveloped exception) + `/api/ping` (new smoke route).
6. `notFound` — catches any unmatched route, responds `{ error: { code: 'NOT_FOUND', message: 'Resource not found' } }` 404. (Immediately before the error handler.)
7. `errorMiddleware` (4-arg) — the sink. Catches `AppError` (maps `code`→`status` via `codeToStatus`), catches generic `Error` (→ `INTERNAL_ERROR` 500), suppresses stack in prod, logs via `req.log.error`. (MUST be the LAST `app.use`.)

> Boot/shutdown (`start()`, `shutdown()`, SIGTERM/SIGINT, `connectWithRetry`, `pool.end`) is **untouched** by F03.

---

## 5. Parallelization Strategy

Tasks are grouped into **4 batches** by dependency order. Within a batch, tasks touch **disjoint file sets** → zero merge conflicts → safe to run in parallel and merge independently.

### Batch dependency diagram

```
                    ┌────────────────────────────────────────────┐
   Batch A          │ T1  zod/pino/pino-http/helmet install +     │
   (deps +          │     httpStatus constants                   │
    foundations)    │     + envelope.ts + appError.ts + logger.ts│
                    └──────────────────┬─────────────────────────┘
                                       │ (AppError + envelope + logger exist)
                                       ▼
                    ┌────────────────────────────────────────────┐
   Batch B          │ T2  errorMiddleware.ts   ‖  T3 notFound.ts │
   (middleware core │     (deps: AppError,        (deps: envelope)│
    — parallel)     │      envelope, logger)                      │
                    │     T4 validateRequest.ts                   │
                    │     (deps: AppError, zod)                   │
                    └──────────────────┬─────────────────────────┘
                                       │ (all 4 middleware modules exist)
                                       ▼
                    ┌────────────────────────────────────────────┐
   Batch C          │ T5  requestLogger.ts (pino-http wrapper)    │
   (logging         │     + pingRoute.ts (smoke route)            │
    integration)    │     (deps: logger, envelope, validateReq)   │
                    └──────────────────┬─────────────────────────┘
                                       │ (all middleware + smoke route exist)
                                       ▼
                    ┌────────────────────────────────────────────┐
   Batch D          │ T6  index.ts mount wiring + CORS/ helmet    │
   (wiring +        │     harden + health.test tweak + full       │
    verification)   │     verification & sign-off                 │
                    └────────────────────────────────────────────┘
```

- **Batch A → Batch B** is a hard barrier: every middleware module in B imports `AppError`, `envelope` helpers, or the `logger`. None exist until T1 lands.
- **Batch B → Batch C** is a hard barrier: `requestLogger` uses the `logger`; `pingRoute` uses `envelope` + `validateRequest`.
- **Batch C → Batch D** is a hard barrier: `index.ts` mounts every module produced above; the verification gate exercises the full request lifecycle.

### Merge order rules

1. **Batch A (T1) merges first.** Deps installed; `httpStatus.ts`, `appError.ts`, `envelope.ts`, `logger.ts` on `main`. Must land before any middleware branches.
2. **Batch B (T2, T3, T4) merge second, in any order (parallel-safe).** Disjoint files: `errorMiddleware.*`, `notFound.*`, `validateRequest.*`. Each imports only from Batch A outputs (already on `main`).
3. **Batch C (T5) merges third.** `requestLogger.*` + `pingRoute.*` depend on logger + envelope + validateRequest (all on `main` after B).
4. **Batch D (T6) merges last.** Terminal wiring + verification. Touches `index.ts`, `health.test.ts`, and records the integration proof.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | A | `backend/package.json`, `backend/src/utils/httpStatus.ts`, `backend/src/utils/appError.ts` + test, `backend/src/utils/envelope.ts` + test, `backend/src/config/logger.ts` + test | — | — |
| **T2** | B | `backend/src/middleware/errorMiddleware.ts` + test | T1 | T3, T4 |
| **T3** | B | `backend/src/middleware/notFound.ts` + test | T1 | T2, T4 |
| **T4** | B | `backend/src/middleware/validateRequest.ts` + test | T1 | T2, T3 |
| **T5** | C | `backend/src/middleware/requestLogger.ts` + test, `backend/src/middleware/pingRoute.ts` + test | T1, T4 | — |
| **T6** | D | `backend/src/index.ts`, `backend/src/health.test.ts` | T1, T2, T3, T4, T5 | — |

### Developer assignment tracks

- **Solo (recommended):** T1 → (T2 ‖ T3 ‖ T4) → T5 → T6. ~1 day.
- **2 devs:** Dev-A: T1 → T2 → T5 → T6. Dev-B (branches after A merges): T3 ‖ T4, then reviews. Merge order A → (B-parallel) → C → D.
- **3 devs:** Dev-A: T1 → T2 → T6. Dev-B: T3 (after A). Dev-C: T4 (after A). Then one dev takes T5, then T6.

---

## 6. Tasks

### T1 — Deps + foundations (httpStatus, AppError, envelope, logger)

**Batch:** A · **Depends on:** None · **Parallel with:** —

**Description:** Install Zod 4, pino, pino-http, helmet (+ pino-pretty dev). Ship the four foundational modules every later task imports: named HTTP status constants, the `AppError` class, the response envelope helpers + `ErrorCode` union + `codeToStatus` map, and the pino logger config. All in `utils/` and `config/` (disjoint from `middleware/`).

Create / Modify:

- **`backend/package.json`** (MODIFY). Install:

  ```bash
  npm install zod pino pino-http helmet -w backend
  npm install -D pino-pretty -w backend
  ```

  Pin `zod@^4` (NOT `@zod/mini`, NOT 3.x — D1). `helmet@^8` ships its own types. `pino-http@^10` ships types in-box. `pino-pretty` is dev-only (pretty dev logs).

- **`backend/src/utils/httpStatus.ts`** (NEW). Named HTTP status constants — `js-style-guide.md`: "no magic numbers — define constants". SCREAMING_SNAKE_CASE per style guide.

  ```typescript
  // Named HTTP status codes. Use these instead of magic numbers.
  // js-style-guide.md: "Magic numbers — define constants".
  export const HttpStatus = {
    OK: 200,
    CREATED: 201,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
    INTERNAL_SERVER_ERROR: 500,
    NOT_IMPLEMENTED: 501,
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
  } as const;

  export type StatusCode = (typeof HttpStatus)[keyof typeof HttpStatus];
  ```

- **`backend/src/utils/envelope.ts`** (NEW). `success(data)` / `error(code, message, details?)` builders + `ErrorCode` union + `codeToStatus` map (D2, D3). Single source of truth for the code→status contract.

  ```typescript
  import { HttpStatus } from './httpStatus';

  // Closed error-code vocabulary (F03 spec edge case). Frontend branches on `code`.
  // Add new codes here ONLY after owner sign-off — this is the contract surface.
  export const ErrorCode = {
    VALIDATION_FAILED: 'VALIDATION_FAILED',
    UNAUTHENTICATED: 'UNAUTHENTICATED',
    FORBIDDEN: 'FORBIDDEN',
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
  } as const;

  export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

  // Single source of truth: code → HTTP status. noUncheckedIndexedAccess makes
  // lookup return `number | undefined`; callers MUST fall back to 500.
  export const codeToStatus: Readonly<Record<ErrorCodeValue, number>> = Object.freeze({
    [ErrorCode.VALIDATION_FAILED]: HttpStatus.BAD_REQUEST,
    [ErrorCode.UNAUTHENTICATED]: HttpStatus.UNAUTHORIZED,
    [ErrorCode.FORBIDDEN]: HttpStatus.FORBIDDEN,
    [ErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
    [ErrorCode.CONFLICT]: HttpStatus.CONFLICT,
    [ErrorCode.INTERNAL_ERROR]: HttpStatus.INTERNAL_SERVER_ERROR,
  });

  // Success body: { data }. data may be a resource, array, null, or scalar.
  export function success<T>(data: T): { data: T } {
    return { data };
  }

  // Error body: { error: { code, message, details? } }. message is human-readable
  // and safe to expose; details is structured (e.g. Zod field errors).
  export interface ErrorEnvelope {
    error: {
      code: ErrorCodeValue;
      message: string;
      details?: unknown;
    };
  }

  export function error(
    code: ErrorCodeValue,
    message: string,
    details?: unknown,
  ): ErrorEnvelope {
    const body: ErrorEnvelope = { error: { code, message } };
    if (details !== undefined) {
      body.error.details = details;
    }
    return body;
  }
  ```

- **`backend/src/utils/appError.ts`** (NEW). `AppError` class (D4). Extends `Error`; carries `code`, `status` (derived), `details`.

  ```typescript
  import { codeToStatus, type ErrorCodeValue } from './envelope';
  import { HttpStatus } from './httpStatus';

  export interface AppErrorOptions {
    details?: unknown;
    cause?: unknown;
  }

  /**
   * Application error carrying a machine-readable `code` (from the closed
   * ErrorCode vocabulary), a safe-to-expose `message`, and optional structured
   * `details` (e.g. Zod field errors). `status` is derived from codeToStatus;
   * unknown codes fall back to 500 (defense in depth).
   *
   * Throw this from routes/middleware/services; the global errorMiddleware
   * catches it and serializes it via the error envelope.
   */
  export class AppError extends Error {
    readonly code: ErrorCodeValue;
    readonly status: number;
    readonly details?: unknown;

    constructor(
      code: ErrorCodeValue,
      message: string,
      options?: AppErrorOptions,
    ) {
      super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
      this.name = 'AppError';
      this.code = code;
      // noUncheckedIndexedAccess: lookup is `number | undefined` → fallback 500.
      this.status = codeToStatus[code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
      if (options?.details !== undefined) {
        this.details = options.details;
      }
    }
  }
  ```

- **`backend/src/utils/envelope.test.ts`** (NEW). Table-driven unit tests per `js-testing-rules.md`.

  ```typescript
  import { describe, it, expect } from 'vitest';
  import { success, error, codeToStatus, ErrorCode } from './envelope';
  import { HttpStatus } from './httpStatus';

  describe('envelope', () => {
    const successCases = [
      { name: 'wraps an object', input: { a: 1 }, expected: { data: { a: 1 } } },
      { name: 'wraps an array', input: [1, 2], expected: { data: [1, 2] } },
      { name: 'wraps null', input: null, expected: { data: null } },
      { name: 'wraps a scalar', input: 'ok', expected: { data: 'ok' } },
    ];

    successCases.forEach(({ name, input, expected }) => {
      it(name, () => {
        expect(success(input)).toEqual(expected);
      });
    });

    it('error() omits details when not provided', () => {
      expect(error(ErrorCode.NOT_FOUND, 'Resource not found')).toEqual({
        error: { code: 'NOT_FOUND', message: 'Resource not found' },
      });
    });

    it('error() includes details when provided', () => {
      const details = { fieldErrors: { email: ['Invalid'] } };
      expect(error(ErrorCode.VALIDATION_FAILED, 'bad', details)).toEqual({
        error: {
          code: 'VALIDATION_FAILED',
          message: 'bad',
          details,
        },
      });
    });

    const mapCases: Array<[keyof typeof codeToStatus, number]> = [
      ['VALIDATION_FAILED', HttpStatus.BAD_REQUEST],
      ['UNAUTHENTICATED', HttpStatus.UNAUTHORIZED],
      ['FORBIDDEN', HttpStatus.FORBIDDEN],
      ['NOT_FOUND', HttpStatus.NOT_FOUND],
      ['CONFLICT', HttpStatus.CONFLICT],
      ['INTERNAL_ERROR', HttpStatus.INTERNAL_SERVER_ERROR],
    ];

    mapCases.forEach(([code, status]) => {
      it(`codeToStatus[${code}] === ${status}`, () => {
        expect(codeToStatus[code]).toBe(status);
      });
    });
  });
  ```

- **`backend/src/utils/appError.test.ts`** (NEW). Table-driven.

  ```typescript
  import { describe, it, expect } from 'vitest';
  import { AppError } from './appError';
  import { ErrorCode } from './envelope';
  import { HttpStatus } from './httpStatus';

  describe('AppError', () => {
    const cases = [
      { name: 'VALIDATION_FAILED → 400', code: ErrorCode.VALIDATION_FAILED, expected: HttpStatus.BAD_REQUEST },
      { name: 'UNAUTHENTICATED → 401', code: ErrorCode.UNAUTHENTICATED, expected: HttpStatus.UNAUTHORIZED },
      { name: 'FORBIDDEN → 403', code: ErrorCode.FORBIDDEN, expected: HttpStatus.FORBIDDEN },
      { name: 'NOT_FOUND → 404', code: ErrorCode.NOT_FOUND, expected: HttpStatus.NOT_FOUND },
      { name: 'CONFLICT → 409', code: ErrorCode.CONFLICT, expected: HttpStatus.CONFLICT },
      { name: 'INTERNAL_ERROR → 500', code: ErrorCode.INTERNAL_ERROR, expected: HttpStatus.INTERNAL_SERVER_ERROR },
    ];

    cases.forEach(({ name, code, expected }) => {
      it(name, () => {
        const err = new AppError(code, 'msg');
        expect(err.code).toBe(code);
        expect(err.status).toBe(expected);
        expect(err.message).toBe('msg');
        expect(err.name).toBe('AppError');
        expect(err.details).toBeUndefined();
      });
    });

    it('carries details when provided', () => {
      const err = new AppError(ErrorCode.VALIDATION_FAILED, 'bad', { details: { x: 1 } });
      expect(err.details).toEqual({ x: 1 });
    });

    it('is an instance of Error', () => {
      expect(new AppError(ErrorCode.NOT_FOUND, 'x')).toBeInstanceOf(Error);
    });
  });
  ```

- **`backend/src/config/logger.ts`** (NEW). pino instance with env-aware level + redaction + dev pretty transport (D7, D9).

  ```typescript
  import { env } from './env';
  import pino, { type Logger } from 'pino';

  // D15: unset NODE_ENV is treated as production (stricter). Fails safe.
  const isProd = env.nodeEnv !== 'development';

  // Redact secrets from logs (D9 defense in depth). `*.password` catches nested.
  const redactPaths = [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.body.password',
    '*.password',
    'req.body.token',
    '*.token',
  ];

  export const logger: Logger = pino({
    level: isProd ? 'info' : 'debug',
    redact: {
      paths: redactPaths,
      censor: '[REDACTED]',
    },
    transport: isProd
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'ISO' },
        },
  });

  export { isProd };
  ```

  Note: `pino-pretty` is imported by name as a transport target (string) — pino spawns it as a worker thread; the devDep must be installed (T1 does this). `import { type Logger } from 'pino'` satisfies `verbatimModuleSyntax`.

- **`backend/src/config/logger.test.ts`** (NEW). Unit: level selection + redact paths present. (Don't assert transport internals — fragile.)

  ```typescript
  import { describe, it, expect } from 'vitest';
  import { logger, isProd } from './logger';

  describe('logger config', () => {
    it('exports a pino logger', () => {
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('isProd reflects NODE_ENV !== development', () => {
      // vitest.config.ts sets NODE_ENV=test → isProd === true here.
      expect(isProd).toBe(true);
    });

    it('logger.level is info when isProd', () => {
      // test env → isProd true → level 'info'
      expect(logger.level).toBe('info');
    });
  });
  ```

**Acceptance Criteria:**
- [ ] `npm install` succeeds; `zod`, `pino`, `pino-http`, `helmet` in `backend/package.json` deps; `pino-pretty` in devDeps. Versions: `zod@^4` (not 3.x), `helmet@^8`.
- [ ] `npm run typecheck -w backend` passes (`import type` used for type-only imports; no `any`).
- [ ] `npm test -w backend` passes: `envelope.test.ts` (all success/error/map cases), `appError.test.ts` (all 6 code→status cases + details + Error instance), `logger.test.ts` (logger export, isProd, level).
- [ ] `npm run lint` and `npm run format:check` pass.
- [ ] `httpStatus.ts` exports `HttpStatus` const object + `StatusCode` type.
- [ ] `envelope.ts` exports `ErrorCode`, `ErrorCodeValue`, `codeToStatus`, `success`, `error`, `ErrorEnvelope`.
- [ ] `appError.ts` exports `AppError` class with `code`/`status`/`details` readonly fields.
- [ ] `logger.ts` exports `logger` (pino) + `isProd`.

**Dependencies:** None (F01 + F02 already on `main`).

---

### T2 — Global error middleware

**Batch:** B · **Depends on:** T1 · **Parallel with:** T3, T4

**Description:** The Express 5 4-arg global error handler — the sink every `AppError` and unknown `Error` funnels through. Maps code→status via `codeToStatus`, suppresses stack in prod, logs via `req.log`. Disjoint file: `middleware/errorMiddleware.*`.

Create / Modify:

- **`backend/src/middleware/errorMiddleware.ts`** (NEW). D5, D6, D9.

  ```typescript
  import type { Request, Response, NextFunction } from 'express';
  import { AppError } from '../utils/appError';
  import { error, ErrorCode } from '../utils/envelope';
  import { HttpStatus } from '../utils/httpStatus';
  import { isProd, logger } from '../config/logger';

  // Express 5 error middleware: MUST be 4-arg and registered LAST via app.use.
  // Async route handlers' rejected promises auto-forward here (D5) — no wrapper.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export function errorHandler(
    err: unknown,
    req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: NextFunction,
  ): void {
    // Normalize to AppError. Unknown errors → INTERNAL_ERROR 500.
    const appErr =
      err instanceof AppError
        ? err
        : new AppError(
            ErrorCode.INTERNAL_ERROR,
            // Never trust err.message for 5xx in prod — D9.
            isProd ? 'Internal server error' : err instanceof Error ? err.message : 'Unknown error',
            { cause: err },
          );

    // In production, force all 5xx messages to the generic string.
    const safeMessage =
      isProd && appErr.status >= HttpStatus.INTERNAL_SERVER_ERROR
        ? 'Internal server error'
        : appErr.message;

    // Log. req.log from pino-http if available; fall back to the raw logger.
    const log = (req.log ?? logger) as typeof logger;
    if (appErr.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      log.error({ err }, 'request failed');
    } else {
      log.warn({ err }, 'request error');
    }

    const body = error(appErr.code, safeMessage, appErr.details);

    // Stack only in non-production (D9).
    if (!isProd && err instanceof Error && err.stack) {
      (body.error as Record<string, unknown>).stack = err.stack;
    }

    res.status(appErr.status).json(body);
  }
  ```

  Notes: (a) Two `eslint-disable-next-line @typescript-eslint/no-unused-vars` — one on the function (for the `_next` param shape Express requires) is conventional; the `err`/`req`/`res` are all used. Actually only `_next` is unused — single disable on it. (See final form below — collapse to one disable.) (b) `req.log` is typed by `pino-http`; if its ambient types aren't auto-included, cast via `(req.log ?? logger)`. (c) Stack is attached by spreading into the error object — non-prod only. (d) `appErr.status >= 500` triggers `log.error`; 4xx triggers `log.warn` (noisy-but-expected client errors shouldn't page anyone).

  Simplified final form (single disable, cleaner):

  ```typescript
  import type { Request, Response, NextFunction } from 'express';
  import { AppError } from '../utils/appError';
  import { error, ErrorCode } from '../utils/envelope';
  import { HttpStatus } from '../utils/httpStatus';
  import { isProd, logger } from '../config/logger';

  // Express 5 error middleware: MUST be 4-arg and registered LAST via app.use.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
    const appErr =
      err instanceof AppError
        ? err
        : new AppError(
            ErrorCode.INTERNAL_ERROR,
            isProd
              ? 'Internal server error'
              : err instanceof Error
                ? err.message
                : 'Unknown error',
            { cause: err },
          );

    const safeMessage =
      isProd && appErr.status >= HttpStatus.INTERNAL_SERVER_ERROR
        ? 'Internal server error'
        : appErr.message;

    const log = (req.log ?? logger) as typeof logger;
    if (appErr.status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      log.error({ err }, 'request failed');
    } else {
      log.warn({ err }, 'request error');
    }

    const body = error(appErr.code, safeMessage, appErr.details);
    if (!isProd && err instanceof Error && err.stack) {
      (body.error as Record<string, unknown>).stack = err.stack;
    }

    res.status(appErr.status).json(body);
  }
  ```

  (`next` is kept to satisfy Express's 4-arg detection — `eslint-disable` is the standard escape.)

- **`backend/src/middleware/errorMiddleware.test.ts`** (NEW). Mock req/res/next per `js-testing-rules.md`. Table-driven across the 6 codes + unknown error + prod stack suppression.

  ```typescript
  import { describe, it, expect, vi } from 'vitest';
  import type { Request, Response, NextFunction } from 'express';
  import { errorHandler } from './errorMiddleware';
  import { AppError } from '../utils/appError';
  import { ErrorCode } from '../utils/envelope';
  import { HttpStatus } from '../utils/httpStatus';

  function makeReqRes() {
    const req = { log: { error: vi.fn(), warn: vi.fn() } } as unknown as Request;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;
    return { req, res, next };
  }

  describe('errorMiddleware', () => {
    const cases = [
      { name: 'VALIDATION_FAILED → 400', code: ErrorCode.VALIDATION_FAILED, status: HttpStatus.BAD_REQUEST },
      { name: 'UNAUTHENTICATED → 401', code: ErrorCode.UNAUTHENTICATED, status: HttpStatus.UNAUTHORIZED },
      { name: 'FORBIDDEN → 403', code: ErrorCode.FORBIDDEN, status: HttpStatus.FORBIDDEN },
      { name: 'NOT_FOUND → 404', code: ErrorCode.NOT_FOUND, status: HttpStatus.NOT_FOUND },
      { name: 'CONFLICT → 409', code: ErrorCode.CONFLICT, status: HttpStatus.CONFLICT },
      { name: 'INTERNAL_ERROR → 500', code: ErrorCode.INTERNAL_ERROR, status: HttpStatus.INTERNAL_SERVER_ERROR },
    ];

    cases.forEach(({ name, code, status }) => {
      it(name, () => {
        const { req, res, next } = makeReqRes();
        const err = new AppError(code, 'msg', { details: { x: 1 } });
        errorHandler(err, req, res, next);
        expect(res.status).toHaveBeenCalledWith(status);
        expect(res.json).toHaveBeenCalledWith({
          error: { code, message: 'msg', details: { x: 1 } },
        });
        expect(next).not.toHaveBeenCalled();
      });
    });

    it('normalizes unknown Error to INTERNAL_ERROR 500', () => {
      const { req, res, next } = makeReqRes();
      // isProd is true in test env → message should be 'Internal server error'
      errorHandler(new Error('boom'), req, res, next);
      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(res.json).toHaveBeenCalledWith({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
    });

    it('includes details only when provided', () => {
      const { req, res, next } = makeReqRes();
      errorHandler(new AppError(ErrorCode.NOT_FOUND, 'x'), req, res, next);
      expect(res.json).toHaveBeenCalledWith({
        error: { code: 'NOT_FOUND', message: 'x' },
      });
    });

    it('logs 5xx at error level', () => {
      const { req, res, next } = makeReqRes();
      errorHandler(new AppError(ErrorCode.INTERNAL_ERROR, 'x'), req, res, next);
      expect((req.log as { error: ReturnType<typeof vi.fn> }).error).toHaveBeenCalled();
    });

    it('logs 4xx at warn level', () => {
      const { req, res, next } = makeReqRes();
      errorHandler(new AppError(ErrorCode.NOT_FOUND, 'x'), req, res, next);
      expect((req.log as { warn: ReturnType<typeof vi.fn> }).warn).toHaveBeenCalled();
      expect((req.log as { error: ReturnType<typeof vi.fn> }).error).not.toHaveBeenCalled();
    });
  });
  ```

  Note: because `vitest.config.ts` sets `NODE_ENV=test`, `isProd = env.nodeEnv !== 'development'` → `true`. So the unknown-error case asserts the prod-safe message. To prove dev behavior (stack inclusion), a separate test mocking `env` would be needed — out of scope for T2 (the prod-default is the security-relevant path; stack inclusion is non-prod-only and visible in dev manually).

**Acceptance Criteria:**
- [ ] `errorHandler` is a 4-arg function exported from `middleware/errorMiddleware.ts`.
- [ ] All 6 `AppError` codes map to the correct HTTP status (table-driven cases pass).
- [ ] Unknown `Error` normalizes to `INTERNAL_ERROR` / 500 with message `'Internal server error'` in prod/test env.
- [ ] 5xx logged at `error`, 4xx at `warn`; `next` never called.
- [ ] `npm run lint` passes (eslint-disable on `next` accepted as framework constraint).
- [ ] `npm test -w backend` and `npm run typecheck -w backend` pass.

**Dependencies:** T1 (`AppError`, `envelope`, `httpStatus`, `logger`).

---

### T3 — Not-found middleware

**Batch:** B · **Depends on:** T1 · **Parallel with:** T2, T4

**Description:** A 2-arg middleware that catches any unmatched route and responds with the `NOT_FOUND` envelope. Registered immediately before the error handler. Disjoint file: `middleware/notFound.*`.

Create / Modify:

- **`backend/src/middleware/notFound.ts`** (NEW).

  ```typescript
  import type { Request, Response, NextFunction } from 'express';
  import { AppError } from '../utils/appError';
  import { ErrorCode } from '../utils/envelope';

  // Catches unmatched routes. Registered immediately BEFORE errorHandler.
  // We throw AppError so the centralized errorMiddleware shapes the response —
  // single serialization path (envelope + logging) for all errors.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export function notFound(req: Request, _res: Response, _next: NextFunction): never {
    throw new AppError(ErrorCode.NOT_FOUND, `Resource not found: ${req.method} ${req.path}`);
  }
  ```

  (Throws rather than `res.json()` so the error middleware does the logging + envelope — one path. `never` return reflects the throw. `req.path` is safe to expose — it's the client's request, not internal state.)

- **`backend/src/middleware/notFound.test.ts`** (NEW).

  ```typescript
  import { describe, it, expect } from 'vitest';
  import type { Request } from 'express';
  import { notFound } from './notFound';
  import { AppError } from '../utils/appError';
  import { ErrorCode } from '../utils/envelope';

  describe('notFound', () => {
    it('throws AppError NOT_FOUND', () => {
      const req = { method: 'GET', path: '/api/nope' } as unknown as Request;
      expect(() => notFound(req, {} as never, {} as never)).toThrow(AppError);
    });

    it('includes method and path in the message', () => {
      const req = { method: 'POST', path: '/api/missing' } as unknown as Request;
      try {
        notFound(req, {} as never, {} as never);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe(ErrorCode.NOT_FOUND);
        expect((err as AppError).message).toBe('Resource not found: POST /api/missing');
      }
    });
  });
  ```

**Acceptance Criteria:**
- [ ] `notFound` throws `AppError('NOT_FOUND', ...)` including method + path.
- [ ] Registered immediately before `errorHandler` in `index.ts` (wired in T6).
- [ ] `npm test -w backend`, `npm run typecheck -w backend`, `npm run lint` all pass.

**Dependencies:** T1 (`AppError`, `ErrorCode`).

---

### T4 — Request validation factory (Zod 4)

**Batch:** B · **Depends on:** T1 · **Parallel with:** T2, T3

**Description:** The `validateRequest(schema)` middleware factory — Zod 4 `safeParse` at the edge (D1, D11). Accepts either a single Zod object schema (applied to `req.body`) or a `{ body?, query?, params? }` partial. On failure throws `AppError('VALIDATION_FAILED', ...)` with `details: z.flattenError(err)`; on success overwrites the source with the parsed value. Disjoint file: `middleware/validateRequest.*`.

Create / Modify:

- **`backend/src/middleware/validateRequest.ts`** (NEW). Zod 4 idioms (`z.flattenError`, not 3.x `.format()`).

  ```typescript
  import type { Request, Response, NextFunction } from 'express';
  import type { ZodTypeAny } from 'zod';
  import { flattenError } from 'zod';
  import { AppError } from '../utils/appError';
  import { ErrorCode } from '../utils/envelope';

  // Accept either a single schema (applied to body) or a per-source partial.
  export interface ValidationSchema {
    body?: ZodTypeAny;
    query?: ZodTypeAny;
    params?: ZodTypeAny;
  }

  type SchemaInput = ZodTypeAny | ValidationSchema;

  function normalize(schema: SchemaInput): ValidationSchema {
    return typeof schema.parse === 'function' ? { body: schema } : schema;
  }

  /**
   * Edge validation factory. Usage:
   *   router.post('/x', validateRequest(z.object({ name: z.string() })), handler)
   *   router.get('/x/:id', validateRequest({ params: z.object({ id: z.uuid() }) }), handler)
   *
   * On success, overwrites req.body / req.query / req.params with the parsed
   * (typed, coerced, stripped) values. On failure throws AppError with
   * code VALIDATION_FAILED, status 400, details = z.flattenError(err).
   */
  export function validateRequest(schema: SchemaInput) {
    const normalized = normalize(schema);

    return (req: Request, _res: Response, next: NextFunction): void => {
      const sources: Array<keyof ValidationSchema> = ['body', 'query', 'params'];

      for (const source of sources) {
        const s = normalized[source];
        if (!s) continue;

        const result = s.safeParse(req[source]);
        if (!result.success) {
          throw new AppError(ErrorCode.VALIDATION_FAILED, 'Request validation failed', {
            source,
            issues: flattenError(result.error), // Zod 4: { formErrors, fieldErrors }
          });
        }
        // Overwrite with parsed (coerced/stripped) value.
        (req[source] as unknown) = result.data;
      }

      next();
    };
  }
  ```

  Notes: (a) `import { flattenError } from 'zod'` — Zod 4 top-level export (3.x had `.format()` on the error; do NOT use). (b) `import type { ZodTypeAny } from 'zod'` satisfies `verbatimModuleSyntax`. (c) `normalize()` distinguishes a bare schema (body-only — the common case) from a `{ body, query, params }` partial via the presence of `.parse`. (d) The thrown `AppError` is caught by the error middleware (T2) → 400 envelope with `details.issues` shaped as `{ formErrors, fieldErrors }`. (e) `req[source]` overwrite is type-loose by necessity (Express's `Request` types are immutable-ish) — the cast through `unknown` is the sanctioned escape; route handlers downstream rely on the schema's inferred type via a local `z.infer<>`.

- **`backend/src/middleware/validateRequest.test.ts`** (NEW). Table-driven across pass/fail/body/query/params.

  ```typescript
  import { describe, it, expect, vi } from 'vitest';
  import type { Request, Response, NextFunction } from 'express';
  import { z } from 'zod';
  import { validateRequest } from './validateRequest';
  import { AppError } from '../utils/appError';
  import { ErrorCode } from '../utils/envelope';

  function makeReq(overrides: Partial<Request> = {}): Request {
    return {
      body: {},
      query: {},
      params: {},
      ...overrides,
    } as unknown as Request;
  }

  describe('validateRequest', () => {
    it('passes and overwrites body with parsed value on success', () => {
      const next = vi.fn() as unknown as NextFunction;
      const mw = validateRequest(z.object({ name: z.string() }));
      const req = makeReq({ body: { name: 'ok', extra: 'stripped' } } as Partial<Request>);
      mw(req, {} as Response, next);
      expect(next).toHaveBeenCalled();
      expect((req.body as { name: string }).name).toBe('ok');
      expect((req.body as { extra?: string }).extra).toBeUndefined(); // stripped
    });

    it('throws VALIDATION_FAILED on bad body', () => {
      const next = vi.fn() as unknown as NextFunction;
      const mw = validateRequest(z.object({ name: z.string() }));
      const req = makeReq({ body: { name: 123 } } as Partial<Request>);
      expect(() => mw(req, {} as Response, next)).toThrow(AppError);
      try {
        mw(req, {} as Response, next);
      } catch (err) {
        const e = err as AppError;
        expect(e.code).toBe(ErrorCode.VALIDATION_FAILED);
        expect(e.status).toBe(400);
        expect(e.details).toMatchObject({ source: 'body', issues: { formErrors: [], fieldErrors: { name: expect.any(Array) } } });
      }
    });

    it('validates query via { query } partial', () => {
      const next = vi.fn() as unknown as NextFunction;
      const mw = validateRequest({ query: z.object({ page: z.coerce.number().int().positive() }) });
      const req = makeReq({ query: { page: '5' } } as Partial<Request>);
      mw(req, {} as Response, next);
      expect(next).toHaveBeenCalled();
      expect((req.query as { page: number }).page).toBe(5); // coerced
    });

    it('validates params', () => {
      const next = vi.fn() as unknown as NextFunction;
      const mw = validateRequest({ params: z.object({ id: z.uuid() }) });
      const req = makeReq({ params: { id: 'not-a-uuid' } } as Partial<Request>);
      expect(() => mw(req, {} as Response, next)).toThrow(AppError);
    });

    it('skips sources not in the schema', () => {
      const next = vi.fn() as unknown as NextFunction;
      const mw = validateRequest({ query: z.object({ q: z.string() }) });
      const req = makeReq({ body: { anything: true }, query: { q: 'x' } } as Partial<Request>);
      mw(req, {} as Response, next);
      expect(next).toHaveBeenCalled();
      // body untouched (not in schema)
      expect((req.body as { anything: boolean }).anything).toBe(true);
    });
  });
  ```

  Notes: Zod 4 `z.coerce.number()` coerces `'5'` → `5` (proves parsed-overwrite carries coercions). `z.uuid()` is a Zod 4 top-level string check. `flattenError(result.error)` returns `{ formErrors: string[], fieldErrors: Record<string, string[]> }` — asserted via `toMatchObject`.

**Acceptance Criteria:**
- [ ] `validateRequest(schema)` accepts both a bare Zod schema (body) and a `{ body?, query?, params? }` partial.
- [ ] Success path calls `next()` and overwrites `req.body`/`query`/`params` with parsed (coerced/stripped) values.
- [ ] Failure path throws `AppError('VALIDATION_FAILED', ..., { source, issues })`; `status === 400`; `issues` shaped as `{ formErrors, fieldErrors }`.
- [ ] Uses Zod 4 `flattenError` (not 3.x `.format()`).
- [ ] `npm test -w backend`, `npm run typecheck -w backend`, `npm run lint` all pass.

**Dependencies:** T1 (`AppError`, `ErrorCode`, zod installed).

---

### T5 — Request logger + smoke route (/api/ping)

**Batch:** C · **Depends on:** T1, T4 · **Parallel with:** —

**Description:** Mount `pino-http` via a wrapper that sets serializers (D7), and ship the `/api/ping` smoke route proving envelope + `validateRequest` + error path end-to-end (D16). Two files, both in `middleware/`.

Create / Modify:

- **`backend/src/middleware/requestLogger.ts`** (NEW). Thin `pinoHttp` mount with serializers.

  ```typescript
  import { pinoHttp } from 'pino-http';
  import type { Request, Response } from 'express';
  import { logger, isProd } from '../config/logger';

  // Serializers: lean in prod (no headers/body — D9), richer in dev for debugging.
  const serializers = {
    req: (req: Request) =>
      isProd
        ? { id: req.id, method: req.method, url: req.url }
        : { id: req.id, method: req.method, url: req.url, headers: req.headers },
    res: (res: Response) => ({ statusCode: res.statusCode }),
    // responseTime is added by pino-http automatically.
  };

  export const requestLogger = pinoHttp({ logger, serializers });
  ```

  Notes: `pino-http` reads `req.id` (auto-generated), `req.method`, `req.url`; `res.statusCode` and `responseTime` come from the lib. Body/headers excluded in prod. Mounted in `index.ts` after `cors`, before routes.

- **`backend/src/middleware/requestLogger.test.ts`** (NEW). Assert serializers shape (don't test the stream internals).

  ```typescript
  import { describe, it, expect } from 'vitest';
  import type { Request, Response } from 'express';
  import { requestLogger } from './requestLogger';

  describe('requestLogger', () => {
    it('is an Express middleware function (3-arg)', () => {
      expect(typeof requestLogger).toBe('function');
      expect(requestLogger.length).toBe(3);
    });
  });
  ```

  (Shallow — the real proof is the integration test on `/api/ping` and the T6 end-to-end run.)

- **`backend/src/middleware/pingRoute.ts`** (NEW). Smoke route. D16. Demonstrates: envelope `success()`, `validateRequest({ query })`, `req.log` usage, async handler (no wrapper — Express 5 D5).

  ```typescript
  import { Router } from 'express';
  import { z } from 'zod';
  import { validateRequest } from './validateRequest';
  import { success } from '../utils/envelope';

  export const pingRouter = Router();

  const pingQuery = z.object({
    name: z.string().min(1).default('world'),
  });

  // GET /api/ping?name=<string> → { data: { message: 'pong, <name>' } }
  // Proves: envelope + validateRequest + async handler (Express 5 native errors).
  pingRouter.get(
    '/ping',
    validateRequest({ query: pingQuery }),
    async (req, res): Promise<void> => {
      const { name } = req.query as z.infer<typeof pingQuery>;
      req.log?.info({ name }, 'ping');
      res.json(success({ message: `pong, ${name}` }));
    },
  );
  ```

  Notes: (a) `z.infer<typeof pingQuery>` local — per-route schemas co-located with routes (D12). (b) `req.log?.info` — optional-chain in case pino-http hasn't attached (defensive). (c) async handler — Express 5 auto-forwards rejected promises to the error middleware (D5). (d) Returns `success({ message })` → `{ data: { message } }`.

- **`backend/src/middleware/pingRoute.test.ts`** (NEW). Integration via supertest — proves the full contract.

  ```typescript
  import { describe, it, expect } from 'vitest';
  import request from 'supertest';
  import express, { type Express } from 'express';
  import { pingRouter } from './pingRoute';
  import { notFound } from './notFound';
  import { errorHandler } from './errorMiddleware';

  // Minimal app that mirrors the F03 mount order for this slice.
  function buildApp(): Express {
    const app = express();
    app.use(express.json());
    app.use('/api', pingRouter);
    app.use(notFound);
    app.use(errorHandler);
    return app;
  }

  describe('GET /api/ping', () => {
    it('returns success envelope with default name', async () => {
      const res = await request(buildApp()).get('/api/ping');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { message: 'pong, world' } });
    });

    it('returns success envelope with provided name', async () => {
      const res = await request(buildApp()).get('/api/ping?name=munta');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { message: 'pong, munta' } });
    });

    it('returns VALIDATION_FAILED 400 when name is empty', async () => {
      const res = await request(buildApp()).get('/api/ping?name=');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details).toBeDefined();
    });

    it('hits NOT_FOUND for unknown sub-routes', async () => {
      const res = await request(buildApp()).get('/api/unknown');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
  ```

  Notes: Builds a minimal `express()` app inline (does NOT import the global `app` from `index.ts` — that's T6's job; here we isolate the route + middleware slice). This is an integration test in the sense that it exercises real Express + middleware + Zod, but without DB/logger transports.

**Acceptance Criteria:**
- [ ] `requestLogger` is a 3-arg Express middleware exporting `pinoHttp({ logger, serializers })`.
- [ ] `GET /api/ping` (no query) returns 200 `{ data: { message: 'pong, world' } }`.
- [ ] `GET /api/ping?name=munta` returns 200 `{ data: { message: 'pong, munta' } }`.
- [ ] `GET /api/ping?name=` (empty) returns 400 `{ error: { code: 'VALIDATION_FAILED', details: ... } }`.
- [ ] Unknown sub-route returns 404 `{ error: { code: 'NOT_FOUND' } }`.
- [ ] `npm test -w backend`, `npm run typecheck -w backend`, `npm run lint` all pass.

**Dependencies:** T1 (logger, envelope), T4 (validateRequest).

---

### T6 — Wire everything in index.ts + CORS/helmet harden + health test tweak + verification & sign-off

**Batch:** D · **Depends on:** T1, T2, T3, T4, T5 · **Parallel with:** —

**Description:** The terminal integration. Mount helmet + hardened CORS + requestLogger + routes + notFound + errorHandler in the exact order D4 specifies. Harden CORS (D8). Tweak `health.test.ts` to also assert the 404 envelope on unknown routes. Run full verification and fill the integration record.

Create / Modify:

- **`backend/src/index.ts`** (MODIFY). Insert helmet + requestLogger, harden CORS, mount `pingRouter`, append `notFound` + `errorHandler`. Final shape (preserving boot/shutdown untouched):

  ```typescript
  import { pathToFileURL } from 'node:url';
  import cors from 'cors';
  import express, { type Express } from 'express';
  import helmet from 'helmet';
  import { env } from './config';
  import { logger } from './config/logger';
  import { pool } from './db/client';
  import { connectWithRetry } from './db/connect';
  import { requestLogger } from './middleware/requestLogger';
  import { notFound } from './middleware/notFound';
  import { errorHandler } from './middleware/errorMiddleware';
  import { pingRouter } from './middleware/pingRoute';

  const app: Express = express();

  // --- Global middleware (order matters — see F03 §4 lifecycle) ---
  // 1. Security headers (first so every response incl. errors gets them).
  app.use(helmet());
  // 2. CORS — locked to FRONTEND_URL (D8). credentials:true enables future HttpOnly cookies.
  app.use(
    cors({
      origin: env.frontendUrl,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400,
    }),
  );
  // 3. Request logging (pino-http) — hangs req.log before routes use it.
  app.use(requestLogger);
  // 4. Body parsing.
  app.use(express.json());

  // --- Routes ---
  // Health is the documented non-enveloped exception (F03 D10) — consumed by ops probes.
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'slykboard-backend',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // Smoke route proving the F03 contract end-to-end (D16).
  app.use('/api', pingRouter);

  // --- Error sink (MUST be last) ---
  app.use(notFound);
  app.use(errorHandler);

  // --- Boot / shutdown (untouched by F03) ---
  const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

  async function start(): Promise<void> {
    try {
      await connectWithRetry(pool);
    } catch (err) {
      logger.error({ err }, '[slykboard-backend] database connection failed on boot');
      process.exit(1);
    }

    const server = app.listen(env.port, () => {
      logger.info(`[slykboard-backend] listening on :${env.port}`);
    });

    server.on('error', (err) => {
      logger.error({ err }, '[slykboard-backend] server error');
      process.exit(1);
    });

    const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
      logger.info(`[slykboard-backend] ${signal} received, shutting down`);
      const forceExit = setTimeout(() => {
        logger.error('[slykboard-backend] shutdown timed out, forcing exit');
        process.exit(1);
      }, 10_000);
      forceExit.unref();

      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.end();
      clearTimeout(forceExit);
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }

  if (isMain) {
    start();
  }

  export { app };
  ```

  Changes vs current: (a) added `helmet`, `logger`, `requestLogger`, `notFound`, `errorHandler`, `pingRouter` imports; (b) mounted helmet → cors (hardened) → requestLogger → express.json → routes → notFound → errorHandler; (c) swapped boot/shutdown `console.log/error` → `logger.info/error` (the `db/*` `console.*` sites are out of scope — D7 deferred note); (d) health route and shutdown logic otherwise byte-identical.

- **`backend/src/health.test.ts`** (MODIFY). Keep existing cases; add one asserting unknown routes now return the 404 envelope (proves `notFound` + `errorHandler` are wired at the app level).

  ```typescript
  import { describe, it, expect } from 'vitest';
  import request from 'supertest';
  import { app } from './index';

  describe('GET /api/health', () => {
    const cases = [
      { name: 'responds 200', expectStatus: 200 },
      { name: 'body status ok', expectStatus: 200, field: 'status', value: 'ok' },
    ];

    cases.forEach(({ name, expectStatus, field, value }) => {
      it(name, async () => {
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(expectStatus);
        if (field) expect(res.body[field]).toBe(value);
      });
    });

    it('returns NOT_FOUND envelope for unknown routes (F03)', async () => {
      const res = await request(app).get('/api/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('health stays non-enveloped (documented F03 D10 exception)', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      // top-level `status`, NOT nested under `data`
      expect(res.body.status).toBe('ok');
      expect(res.body.data).toBeUndefined();
    });
  });
  ```

**Steps (terminal verification):**
1. `docker compose up -d` (DB up — F02 contract; `connectWithRetry` validates at boot).
2. `npm run dev -w backend` — boots, logs (structured JSON) `listening on :3000`.
3. `curl -i http://localhost:3000/api/health` → 200, body `{ status, service, uptime, timestamp }` (NOT enveloped — D10).
4. `curl -i 'http://localhost:3000/api/ping?name=munta'` → 200, body `{ data: { message: 'pong, munta' } }`.
5. `curl -i 'http://localhost:3000/api/ping?name='` → 400, body `{ error: { code: 'VALIDATION_FAILED', message: 'Request validation failed', details: { source: 'query', issues: { formErrors: [], fieldErrors: { name: [...] } } } } }`.
6. `curl -i http://localhost:3000/api/nope` → 404, body `{ error: { code: 'NOT_FOUND', message: 'Resource not found: GET /api/nope' } }`.
7. `curl -i -H 'Origin: http://evil.example' http://localhost:3000/api/ping` → response lacks `Access-Control-Allow-Origin` (origin not in allowlist → CORS blocks; D8).
8. `curl -i http://localhost:3000/api/ping` → response has `X-Content-Type-Options: nosniff`, no `X-Powered-By` (helmet — D14).
9. Inspect dev logs: each request logs JSON with `req.method`, `req.url`, `res.statusCode`, `responseTime`; `req.headers.authorization` is NOT present in logs (redaction — D9). Confirm by hitting with an `Authorization` header: `curl -i -H 'Authorization: Bearer secret' http://localhost:3000/api/ping` and grep the log line — should show `[REDACTED]`.
10. `kill -TERM <pid>` — process exits within 10s, logs `SIGTERM received, shutting down`.
11. `npm test -w backend` — all unit + integration tests green.
12. `npm run lint && npm run format:check && npm run typecheck -w backend` — all pass.

**Acceptance Criteria:**
- [ ] `index.ts` mounts helmet → cors (hardened) → requestLogger → express.json → health → pingRouter → notFound → errorHandler, in that exact order.
- [ ] `helmet()`, hardened `cors(...)`, `requestLogger`, `notFound`, `errorHandler`, `pingRouter` all imported and used.
- [ ] CORS origin is exactly `env.frontendUrl` (single string); `credentials: true`; methods/allowedHeaders/maxAge set; cross-origin request from a disallowed origin gets no `Access-Control-Allow-Origin`.
- [ ] `/api/health` returns 200 non-enveloped (D10); unknown routes return 404 `{ error: { code: 'NOT_FOUND' } }`.
- [ ] `/api/ping?name=X` returns 200 `{ data: { message: 'pong, X' } }`; empty name returns 400 `{ error: { code: 'VALIDATION_FAILED', details: {...} } }`.
- [ ] Response headers include `X-Content-Type-Options: nosniff`; no `X-Powered-By`.
- [ ] Dev logs show structured JSON per request; `req.headers.authorization` is `[REDACTED]`.
- [ ] Boot/shutdown lifecycle intact (F02 contract preserved): boots, connects, shuts down within 10s on SIGTERM.
- [ ] `health.test.ts` includes the NOT_FOUND case and the non-enveloped-health case; all existing cases still pass.
- [ ] `npm test -w backend`, `npm run typecheck -w backend`, `npm run lint`, `npm run format:check` all pass on the as-merged feature.
- [ ] Integration record filled in §7.

**Dependencies:** T1 (all foundations), T2 (errorMiddleware), T3 (notFound), T4 (validateRequest), T5 (requestLogger + pingRoute).

---

## 7. Final F03 Acceptance Checklist

- [ ] **Success + error envelopes used everywhere.** Every post-F03 route responds `{ data }` on success and `{ error: { code, message, details? } }` on failure. `/api/health` is the single documented non-enveloped exception (D10). (Acceptance bullet 1; D2.)
- [ ] **Central error handler maps codes → statuses.** `VALIDATION_FAILED` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409 (reserved), `INTERNAL_ERROR` 500. Unknown routes hit `notFound` → 404 envelope (never Express default HTML). (Acceptance bullet 2; D3, D4, D6.)
- [ ] **Zod validation at the edge.** `validateRequest(schema)` factory ships; proven by `/api/ping` query validation. Uses Zod 4 (`flattenError`, `z.coerce.*`, top-level string checks). (Acceptance bullet 3; D1, D11.)
- [ ] **CORS locked to `FRONTEND_URL` only.** Single-string origin, `credentials: true`, hardened methods/headers/maxAge. Disallowed origins get no `Access-Control-Allow-Origin`. (Acceptance bullet 4; D8.)
- [ ] **Request logging.** `pino-http` mounted before routes; every request logged as structured JSON with method/url/status/responseTime. Secrets redacted (`authorization`, `cookie`, `password`, `token`). (D7, D9.)
- [ ] **No stack/internal leaks in production.** 5xx message hardcoded `'Internal server error'` in prod; stack only in non-prod; unset `NODE_ENV` treated as prod (D15); `helmet()` strips `X-Powered-By`; pino redaction active. (F03 edge case; D9, D14.)
- [ ] **Closed error-code vocabulary.** `ErrorCode` union + `codeToStatus` map exported from `utils/envelope.ts`; downstream features import and reuse. (F03 edge case; D3.)
- [ ] Lint + format checks pass on an empty change.
- [ ] Typecheck + tests pass (`npm run typecheck && npm test`).
- [ ] `.gitignore` retains `node_modules/`, `.env`, `dist/`, `build/`, `*.log`, `.DS_Store` (no F03 change; verified).
- [ ] Branch named `feature/SLYK-F03-api-contract-layer` (no Jira ticket — slug-only per git-guidelines); commits single-line `SLYK-F03: msg`; rebase-and-merge only (no squash, no merge commits).
- [ ] No new env vars introduced (F03 reuses `env.nodeEnv`, `env.frontendUrl` from F01); `.env.example` and `vitest.config.ts` unchanged.

**Integration record (fill during T6):**
- Feature commit SHA: `fc19fac` (branch HEAD at T6 verification time; will advance when orchestrator commits T6).
- Deps installed: zod `4.4.3`, pino `10.3.1`, pino-http `11.0.0`, helmet `8.2.0`, pino-pretty `13.1.3` (dev).
- `GET /api/health` (HTTP 200) body: `NOT VERIFIED — requires live DB (env unavailable; docker compose has 0 services, no backend/.env DATABASE_URL)`. Code path returns `{ status:'ok', service, uptime, timestamp }` non-enveloped (D10), proven by unit test `health stays non-enveloped`.
- `GET /api/ping?name=munta` (HTTP 200) body: `NOT VERIFIED — requires live DB`. Contract asserted via unit tests on pingRoute + validateRequest.
- `GET /api/ping?name=` (HTTP 400) body: `NOT VERIFIED — requires live DB`. Contract asserted via errorMiddleware + validateRequest unit tests.
- `GET /api/nope` (HTTP 404) body: `NOT VERIFIED — requires live DB`. Contract asserted via `health.test.ts` "returns NOT_FOUND envelope for unknown routes" (passes).
- CORS disallowed-origin check: `Access-Control-Allow-Origin` absent for evil origin: `NOT VERIFIED — requires live DB` (CORS config source-of-truth: `origin: env.frontendUrl` single string, `credentials: true`, hardened methods/allowedHeaders/maxAge — D8).
- Helmet headers: `X-Content-Type-Options: nosniff` present `NOT VERIFIED — requires live DB`; `X-Powered-By` absent `NOT VERIFIED — requires live DB` (helmet() mounted first in stack — D14).
- Log redaction: `req.headers.authorization` shows `[REDACTED]` `NOT VERIFIED — requires live DB` (redaction config in `requestLogger.ts` — D9).
- SIGTERM exit time: `NOT VERIFIED — requires live DB` (shutdown logic unchanged from F02; 10s forceExit timer intact).
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / nonzero`. Test run reports `1 failed | 10 passed` files — the single failure is pre-existing `backend/src/db/db.test.ts` (PG 28P01 auth, committed in F02, needs live DB creds, NOT F03 code). Every F03 test file passes.
- Test count: `57 passed | 10 failed` tests across `11` files (10 failures all in db.test.ts; 57 passes include health, envelope, errorMiddleware, notFound, validateRequest, pingRoute, requestLogger suites).

---

## 8. Conventions established by this feature

F03 owns **no row** in the `features.md` schema-deltas table (it owns no DB deltas). Instead, F03 **ratifies the API-contract conventions** every downstream feature (F05+ auth, F08 Projects, F12 Tickets, F18 ActivityLogs, F20 TimeEntries, F22 Reports) inherits:

| Convention | Detail | Source of truth (import path) |
| --- | --- | --- |
| **Success envelope** | `{ data }` where `data` is the resource, array, scalar, or `null`. Built via `success(data)`. | `backend/src/utils/envelope.ts` → `success` |
| **Error envelope** | `{ error: { code, message, details? } }`. `code` ∈ closed `ErrorCode` union; `message` human-readable + safe to expose; `details` structured (e.g. Zod field errors). Built via `error(code, message, details?)`. | `backend/src/utils/envelope.ts` → `error`, `ErrorEnvelope` |
| **Error-code vocabulary** | `VALIDATION_FAILED` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `INTERNAL_ERROR` (500). Add new codes ONLY after owner sign-off — this is the frontend contract surface. | `backend/src/utils/envelope.ts` → `ErrorCode`, `codeToStatus` |
| **AppError class** | Throw `new AppError(code, message, { details?, cause? })` from routes/middleware/services; the global `errorMiddleware` catches + serializes it. `status` is derived from `code`. | `backend/src/utils/appError.ts` → `AppError` |
| **Global error handler** | Express 5 4-arg `errorHandler` registered LAST via `app.use`. Catches `AppError` + unknown `Error` (→ `INTERNAL_ERROR`). Stack suppressed in prod. Routes MUST be registered before it; `notFound` immediately before it. | `backend/src/middleware/errorMiddleware.ts` |
| **Async route errors** | Express 5 native — no `asyncHandler` wrapper. Async handlers' rejected promises auto-forward to `errorMiddleware`. | (Framework behavior — documented in D5) |
| **Validation pattern** | `validateRequest(schema)` factory — accepts a Zod 4 schema (applied to body) or `{ body?, query?, params? }` partial. `safeParse` per source; on fail throws `AppError('VALIDATION_FAILED', ..., { source, issues: flattenError(err) })`; on success overwrites `req.body`/`query`/`params` with parsed value. Mounted per-route. | `backend/src/middleware/validateRequest.ts` |
| **Per-route schemas** | Co-located with the route: `backend/src/routes/<feature>.schema.ts`. Use `z.infer<typeof schema>` for handler-level typing. (F03 ships one example inline in `pingRoute.ts`.) | (Convention — enforced at PR review) |
| **HTTP status constants** | Use `HttpStatus.BAD_REQUEST` etc. — never magic numbers. | `backend/src/utils/httpStatus.ts` → `HttpStatus` |
| **Logger** | `pino` via `logger` from `config/logger.ts`; `req.log` (from `pino-http`) inside request scope. Level: `info` prod / `debug` dev. Secrets redacted. **No `console.log` for request/error logging.** | `backend/src/config/logger.ts` |
| **CORS** | `cors({ origin: env.frontendUrl, credentials: true, methods, allowedHeaders, maxAge })`. Single-string origin (never `*`). | `backend/src/index.ts` (D8) |
| **Security headers** | `helmet()` mounted first in the global middleware chain. | `backend/src/index.ts` (D14) |
| **NODE_ENV prod-default** | `isProd = env.nodeEnv !== 'development'` (stricter — unset treated as prod). Affects: 5xx message sanitization, stack suppression, log level, log serializers. | `backend/src/config/logger.ts` → `isProd` |
| **Non-enveloped exception** | `/api/health` is the ONLY sanctioned non-enveloped route (ops probe). Every route added after F03 MUST use the envelope. | (Documented — D10) |

**Cross-cutting decision status (from `features.md`):** F03 does not resolve any numbered cross-cutting decision (those are ORM/client in F02, auth strategy in F06, etc.). F03 instead establishes the **API-shape contract** that those features adhere to.
