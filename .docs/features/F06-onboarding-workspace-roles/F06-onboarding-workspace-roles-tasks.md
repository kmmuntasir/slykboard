# F06 — Onboarding, workspace restriction & roles: Plan + Task Breakdown

> **Feature:** F06 — Onboarding, workspace restriction & roles (Phase 1 — Identity & Access)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F05 (partial — T1-T12 merged + unit-tested; T13 live Google smoke + T14 terminal verification pending owner) · **PRD ref:** REQ-1.2, REQ-1.3
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), `.claude/rules/{js-development-rules,js-style-guide,js-testing-rules,git-guidelines,persona}.md`, plus dependency task doc: [F05](../F05-google-sso-login-jwt-issuance/F05-google-sso-login-jwt-issuance-tasks.md)

---

## 1. F06 Recap

**Goal:** Control who may enter the workspace and what role they get.

**Ships:** If `ALLOWED_DOMAIN` is set, only accounts whose Google-verified email belongs to that G-Suite workspace can log in; the first-ever user to sign in is atomically promoted to `ADMIN`; all subsequent signups join as `MEMBER`. Role is persisted on the `Users` row and carried in the issued JWT. A user whose domain later becomes disallowed is grandfathered (recommended default — sign-off pending).

**Acceptance (definition of done):**

1. Email domain checked against `ALLOWED_DOMAIN` when set; mismatch → `403 FORBIDDEN` with a clear message.
2. Empty `Users` table → first signup becomes `ADMIN` atomically (race-safe).
3. Subsequent signups → `MEMBER`.
4. Role persisted on the `Users` row and carried in the JWT.

(All four bullets copied verbatim from `features.md`; tightened with the observable wiring each implies: verified-email gate, partial unique index, `/me` role propagation, frontend FORBIDDEN UX.)

**Edge cases — resolved up front:**

- **Race: two simultaneous first-signups could both grab admin** → **Decision: race-safe two-layer guard.** (a) DB arbiter = partial unique index `users_one_admin ON users(role) WHERE role='ADMIN'` so the database itself refuses a second ADMIN row. (b) Application path = transactional counted-query inside `upsertByGoogleId` — `db.transaction(async (tx) => { const count = await tx.$countQuery...; role = count === 0 ? 'ADMIN' : 'MEMBER'; insert... })`; on `unique-violation` (23505) caught at app layer, retry once as `MEMBER`. The index is the hard guarantee; the count minimizes contention. Cite research D-1 (PG partial-index arbiter; ON CONFLICT vs partial index requires `WHERE role='ADMIN'` predicate; SO 46727740; Hasura #3666). **Carried as schema delta** (§8) + Drizzle migration `0001_*.sql`.
- **Domain check must run on the verified Google email** → **Decision: F06 asserts `payload.email_verified === true` in `exchangeCodeForUser` BEFORE the domain check runs.** Currently `payload.email_verified` is read nowhere (`googleOAuth.ts:23-26` ignores it). F06 adds the assertion: if absent or `!== true`, throw `AppError(UNAUTHENTICATED, 'Email not verified by Google')`. The domain check then runs on `GoogleUserInfo.email` which is sourced from the verified payload. Cite D-2 (Google GSI verify ID token; google-auth-library v10 — `email_verified` is the authoritative signal; never trust `payload.email` for domain restriction without it).
- **Existing user whose domain later becomes disallowed — grandfather or block** → **Owner sign-off needed.** Recommended default = **grandfather**: domain check runs only at signup time (insert path); conflict path (existing `googleId`) skips the domain gate so tightening `ALLOWED_DOMAIN` does not lock out current members. Rationale: PRD §REQ-1.2 talks about "belong to the permitted workspace" at onboarding; retroactive eviction is a destructive action better owned by an admin via F25 whitelist/blocklist. Alternative (block on next login) is reversible by reverting the env var but breaks currently-logged-in users mid-session. Surfaced in §3 + §9 — do NOT silently pick.
- **First-admin promotion timing** → **Decision: at insert time, inside the upsert transaction.** Not a separate endpoint, not a flag in the JWT, not a cron. The signup `POST /api/auth/google` call is the only trigger. If `ALLOWED_DOMAIN` is set, the first admin MUST come from the allowed domain (the domain check runs before upsert, so a disallowed-domain signup never gets to the first-admin logic).

**Scope boundary (explicit deferrals):**

- **Manual email whitelist / blocklist** → **F25** (Whitelist management — `features.md` F25 owns "allow/block specific emails regardless of domain"). F06 ships ONLY `ALLOWED_DOMAIN` enforcement. No `whitelisted` column, no `AllowedEmails` table, no whitelist endpoints. Cite research C (PRD gives NO schema/endpoint/rule for whitelist; F25 deps F06 only). Documented as Option A (minimal).
- **`requireRole('ADMIN')` middleware + role-gated UI** → **F07 / F17 / F25.** F06 ships the role on the JWT + on `req.user`; downstream consumers gate on it. F06 does NOT add a single `requireRole` call.
- **Token invalidation when role changes mid-session (`token_version` / `ver` claim)** → **F07** (Session lifecycle). F06's single-admin model means the only role transition is the first-user promotion (MEMBER → ADMIN at insert — no live token exists yet, so no invalidation needed). Multi-admin demotion (introduced by F25) needs `token_version`; F06 flags this for F07. Cite D-4 (SO 21978658; Curity JWT best practices).

---

## 2. Codebase Analysis Summary

- **State:** **Partial — F05 plumbing complete, F06 enforcement absent.** F05 T1-T12 merged and unit-tested on `main` (branch `feature/SLYK-F05-google-sso-jwt-issuance`); T13 (live Google smoke) + T14 (terminal verification) pending owner per F05 §7. **F06 can proceed on the merged T1-T12 surface** — it does not depend on the live smoke (the seam is the code, not the manual verification). All files F06 touches confirmed to exist on `main`.
- **Existing structure F06 builds on (with path citations):**
  - **Auth route entrypoint:** `backend/src/routes/auth.routes.ts:13-34` — `POST /api/auth/google` does `exchangeCodeForUser(code) → upsertByGoogleId(info) → signJwt({sub,email,role})`. **Domain-check hook lives between `:18` (exchange) and `:19` (upsert)** — F06 inserts `assertEmailVerified(info)` + `assertDomainAllowed(info.email)` there. `role: user.role` already wired into JWT claim (`:20`) + response body (`:29`).
  - **Google OAuth service:** `backend/src/services/googleOAuth.ts:13-37` — `exchangeCodeForUser(code)` returns `GoogleUserInfo{googleId,email,fullName,avatarUrl}` from `verifyIdToken` w/ audience check (`:19-22`). **`payload.email_verified` is NOT asserted today** (`:23-26` reads `payload` but never checks `email_verified`) — F06 adds the assertion here.
  - **User upsert:** `backend/src/services/userService.ts:11-31` — `upsertByGoogleId(input)`. Insert omits `role` → DB default `'MEMBER'` applies (`schema.ts:14`). Conflict update preserves `role` + `id` (deliberately excluded from `set`, tested at `userService.test.ts:76-78`). **SEAM F06 ASSUMES — NOT IMPLEMENTED:** empty-table→ADMIN logic. Current upsert cannot express "first only". F06 adds transactional count-then-insert w/ conditional role.
  - **JWT signer:** `backend/src/utils/jwt.ts:11-26` — `signJwt` + `JwtUserClaims`. `role` already first-class claim (`role: 'ADMIN' | 'MEMBER'`, `:14`). **NO F06 CHANGE needed** — just ensure `user.role` is correct before sign.
  - **`authenticate` middleware:** `backend/src/middleware/auth.ts:8-31`. Sets `req.user={id,email,role}` from JWT (`:26`). `AuthenticatedUser` type at `backend/src/types/express.d.ts:1-5`. `requireRole('ADMIN')` does NOT exist (deferred to F07/F17/F25 — F06 adds nothing here).
  - **Router mount:** `backend/src/index.ts:48` — `app.use('/api/auth', authRouter)` already between `:46` (ping) and `:49` (notFound). **No F06 change to mount.**
  - **Drizzle schema:** `backend/src/db/schema.ts:1-22`. Columns: `id` (uuid PK), `googleId` (text NOT NULL UNIQUE, snake `google_id`), `email` (text NOT NULL UNIQUE), `fullName` (text NOT NULL, snake `full_name`), `avatarUrl` (text nullable, snake `avatar_url`), `role` (`roleEnum` default 'MEMBER' notNull), `createdAt`/`updatedAt` (timestamptz notNull). `roleEnum` at `:4`: `pgEnum('Role', ['ADMIN', 'MEMBER'])` — **already exists, F06 keeps it** (D5 sunk-cost decision).
  - **Migration:** `backend/src/db/migrations/0000_calm_the_renegades.sql:1-13` ships `CREATE TYPE "Role" AS ENUM('ADMIN','MEMBER')` + role column. **F06 adds `0001_*.sql`** for the partial unique index (§8).
  - **Migration runner:** `backend/src/db/migrate.ts:13` uses `drizzle-orm/node-postgres/migrator.migrate`, `migrationsFolder: './src/db/migrations'`. Drizzle-kit config `backend/drizzle.config.ts` (`schema: './src/db/schema.ts'`, `out: './src/db/migrations'`, `dialect: 'postgresql'`, `strict: true`). **Workflow:** edit `schema.ts` → `drizzle-kit generate` → commit SQL → `tsx src/db/migrate.ts`.
  - **Seed:** `backend/src/db/seed.ts:11-26` seeds ADMIN + MEMBER fixtures (`googleId: 'admin-dev-fixture'`, `'member-dev-fixture'`) idempotent on `email`. **CRITICAL INTERACTION:** after seed runs, `users` table is non-empty → F06's first-admin logic (count === 0) correctly yields `MEMBER` for new dev signups. **Document dev-mode caveat:** in a seeded dev DB, no new signup will ever be promoted to ADMIN (intended). To test first-admin promotion, run against an unseeded DB (drop + recreate or `TRUNCATE users`).
  - **Config:** `backend/src/config/env.ts:3-51` — typed `Config` interface; `allowedDomain?: string` declared (`:12`), read `envSource.ALLOWED_DOMAIN || undefined` (`:47`). `env` frozen object exported via `backend/src/config/index.ts`. **ALLOWED_DOMAIN already wired — F06 just consumes `env.allowedDomain`.** `JWT_SECRET` validated required + min 32 chars (`:22-27`). Tests `backend/src/config/env.test.ts` (table-driven, `validBase` fixture).
  - **`.env.example`:15-16** documents `ALLOWED_DOMAIN` (`# F06: leave empty to allow all Google accounts; set to your G-Suite domain to restrict.`). F06 may tighten the doc comment but the key itself is shipped.
  - **Error vocab:** `backend/src/utils/envelope.ts:5-12` — closed `ErrorCode`: `VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, INTERNAL_ERROR`. `codeToStatus` (`:18-25`): `FORBIDDEN → 403` (`:21`). `AppError` at `backend/src/utils/appError.ts:18-33` — throw `new AppError(ErrorCode.FORBIDDEN, '<msg>')`. **FORBIDDEN already in vocab + tested but NEVER thrown by app code today — F06 is the first user.** Reuse, do NOT add codes (closed vocab, owner sign-off required for additions per F03 D-pattern).
  - **Frontend auth store:** `frontend/src/stores/useAuthStore.ts` — Zustand + persist (`name: 'slyk-auth'`, partialize keeps `user` only). `AuthUser.role: 'ADMIN' | 'MEMBER'` already on shape (`:9`). **No F06 change.**
  - **Frontend LoginPage:** `frontend/src/pages/LoginPage.tsx:17-36` — `useGoogleLogin({flow: 'auth-code'})`, maps response → `AuthUser` incl `role: user.role`, error handling `:31-33` surfaces `ApiClientError.message` in `role="alert"` `text-red-600`. **FORBIDDEN message surfaces here automatically** — but F06 specializes the UX: `if (err.code === 'FORBIDDEN')` → distinct "workspace not allowed" message. Cite C (LoginPage can branch on `err.code`).
  - **Frontend TopNav:** `frontend/src/components/TopNav.tsx` — avatar/initials + Sign out; `NAV_LINKS` unconditional. **ADMIN-only UI gating hook deferred to F07/F17/F25 per scope.**
  - **Frontend api client:** `frontend/src/api/client.ts:26-76` — `apiFetch` on `!response.ok` parses `ApiErrorBody`, throws `ApiClientError(message, status, code, details)`; `code` carries `FORBIDDEN` through → frontend can branch `err.code === 'FORBIDDEN'`. `frontend/src/types/api.ts:6-15` mirrors `ErrorCode`. **No F06 change to client.**
  - **Tests:** Vitest. Backend `auth.routes.test.ts` integration via supertest vs real app; mocks `googleOAuth`, `userService`, `signJwt`; keeps real `verifyJwt`. `userService.test.ts` mocks db w/ fluent chain stub (`:22-40`). `googleOAuth.test.ts` uses `vi.hoisted` + mocks `googleClient`. `auth.test.ts` (middleware) real `signJwt` + `jose.SignJWT` for expired. **Pattern:** module-level `vi.mock('../module', () => ({...}))`, `vi.mocked(fn)`, `mockResolvedValueOnce`, `beforeEach(() => vi.clearAllMocks())`. Frontend auth tests: `useAuthStore.test.ts`, `LoginPage.test.tsx` (`:101` asserts role MEMBER), `TopNav.test.tsx` (`:25` uses role ADMIN fixture), `RequireAuth.test.tsx`, `api/auth.test.ts`.
- **Net-new logic F06 creates (no files yet):**
  - `backend/src/services/accessControl.ts` — domain check (`assertDomainAllowed(email)`) + email normalization helper (`normalizeEmailDomain(email)`). Co-locating these here keeps `userService.ts` focused on persistence and `googleOAuth.ts` focused on Google — single-responsibility per `js-style-guide.md`.
  - `backend/src/db/migrations/0001_<auto-name>.sql` — partial unique index.
- **Prior art / partial work:** None for F06 enforcement. F05 shipped the entire plumbing layer (env key, role column, role in JWT, role in store) but zero policy. F06 is the policy layer.
- **File paths the plan references that do NOT exist yet (will be created):**
  - `backend/src/services/accessControl.ts`, `backend/src/services/accessControl.test.ts`.
- **File paths the plan MODIFIES (exist on `main`):**
  - `backend/src/db/schema.ts` (add partial unique index declaration).
  - `backend/src/services/userService.ts` (transactional first-admin upsert).
  - `backend/src/services/googleOAuth.ts` (assert `payload.email_verified`).
  - `backend/src/routes/auth.routes.ts` (wire `assertDomainAllowed` + `/me` re-fetch).
  - `backend/.env.example` (tighten doc comment; add grandfather note).
  - `frontend/src/pages/LoginPage.tsx` (FORBIDDEN UX branch).
  - Co-located test files (`*.test.ts(x)`) for each modified source.
- **Project rules this plan must satisfy:** `js-development-rules.md` (RESTful routes, env table, Zod validation at edge, closed `ErrorCode`, layering routes→services→repositories, server-side checks, security: no secrets in code, parameterized queries), `js-style-guide.md` (PascalCase components, camelCase hooks, SCREAMING_SNAKE_CASE constants, 4-space JSX / 2-space TS, `import type`, `any` banned, no inline styles, no magic numbers, import order external→internal→type→relative), `js-testing-rules.md` (Vitest, co-located `*.test.ts(x)`, table-driven preferred, `vi.fn`/`vi.mock`, Testing Library priority `getByRole > getByLabelText > getByText > getByTestId`, coverage >80% business / >70% components), `git-guidelines.md` (branch `feature/SLYK-F06-onboarding-workspace-roles`, single-line commits `SLYK-F06: <msg>`, rebase-and-merge only, no squash, `.gitignore` intact), `persona.md` (React 19 + Express 5 + Postgres + Google OAuth 2.0 + Vercel + Render).
- **Hidden coupling to plan for:**
  - **`GET /api/auth/me` re-fetch gap.** Today `auth.routes.ts:37-41` sources `user` from `req.user` (JWT claims) — NOT a fresh DB read. If F06 promotes a user to ADMIN at signup, the JWT already carries ADMIN (good). But if a future feature changes role mid-session, `/me` won't reflect it until re-login. F06's `/me` change re-fetches the DB row so role is always current. Downstream concern (token invalidation) flagged for F07.
  - **Drizzle `$count` / count-in-transaction.** Drizzle's `db.$count(users)` is a convenience but does NOT accept a transaction object. Inside `db.transaction(async (tx) => {...})`, use `tx.select({count: count()}).from(users)` to count within the txn's snapshot. Cite drizzle-orm docs.
  - **ON CONFLICT vs partial index arbiter.** PostgreSQL's `INSERT ... ON CONFLICT DO UPDATE` only matches an arbiter index if the `conflict_target` + `WHERE` predicate match the index definition exactly. F06's partial index is `WHERE role='ADMIN'` — using `ON CONFLICT (role) WHERE role='ADMIN'` as the upsert arbiter is fragile (the column being inserted is the one constrained). Cleaner: plain `INSERT ... RETURNING`, catch `pg` error code `23505` (unique_violation) at the app layer, retry once as MEMBER. Cite D-1 (SO 46727740; Hasura #3666).
  - **`env.allowedDomain` normalization.** Env vars are raw strings — leading/trailing whitespace, mixed case. F06's `normalizeEmailDomain` lowercases the domain + trims. `env.allowedDomain` must be normalized ONCE at config-load time OR at every check. Decision: normalize at check time (single `normalizeEmailDomain` fn reused for both incoming email + configured domain) — keeps config loader dumb, normalizer authoritative.
  - **`verbatimModuleSyntax`** — all type-only imports must use `import type`. Applies to `GoogleUserInfo`, `UserRow`, `ErrorCodeValue` re-exports.
  - **Express 5 async route handlers** catch rejected promises automatically — `throw new AppError(...)` inside an `async` handler is forwarded to `errorHandler`. No `try/catch` wrapper needed for control-flow throws (only for the pg `23505` retry, which is a `try/catch` around `await db.transaction(...)`).
  - **Seed-vs-first-admin interaction** (documented above) — the first-admin logic is count-based, so any pre-existing row (including seed fixtures) suppresses promotion. Dev caveat must be in T6 docs.
  - **Google `hd` (hosted domain) claim** — additional signal for G-Suite accounts but NOT authoritative on its own (users can omit it; personal Google accounts lack it). F06 uses `email` domain (from verified payload) as the gate; `hd` is ignored. Cite D-2/D-3.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale (cite source) |
|---|----------|--------|-----------|
| D1 | **Race-safe first-admin** | **Two-layer guard: (a) partial unique index `users_one_admin ON users(role) WHERE role='ADMIN'` + (b) transactional count-then-insert in `upsertByGoogleId`, catch `23505` → retry as MEMBER** | DB-level guarantee is the only way to truly prevent double-admin under concurrency (plain COUNT+branch is the documented anti-pattern). Partial-index arbiter is cleanest declarative form. Cite D-1 (PG partial-indexes 11.8; SO 46727740; Hasura #3666; DbVisualizer upsert guide). |
| D2 | **Verified-email gate** | **Assert `payload.email_verified === true` in `exchangeCodeForUser` before returning `GoogleUserInfo`.** Throw `AppError(UNAUTHENTICATED, 'Email not verified by Google')` on absent/false | `email_verified` is the authoritative signal that Google has validated the email; domain restriction on an unverified email is a trivial bypass (attacker controls the claim). Cite D-2 (Google GSI verify ID token; google-auth-library v10; googleapis.dev TokenInfo.email_verified). |
| D3 | **Domain-check service location** | **New `backend/src/services/accessControl.ts`** exporting `assertDomainAllowed(email)` + `normalizeEmailDomain(email)` | Single-responsibility: `userService.ts` = persistence, `googleOAuth.ts` = Google I/O, `accessControl.ts` = policy. Matches `js-development-rules.md` layering guidance. Easier to unit-test in isolation (mock `env.allowedDomain`). |
| D4 | **`/me` role propagation** | **`GET /api/auth/me` re-fetches the user DB row (by `req.user.id`) instead of re-signing from JWT-sourced `req.user`** | F06's signup path already signs ADMIN into the JWT at first login (no propagation issue there), but the `/me` endpoint's contract is "current user state" — sourcing from the DB makes it the source of truth and future-proofs against role changes (F25 demotion). Cheap UX win; no token-version machinery needed yet. Cite D-4 (Curity claims best practices; role as cache not source-of-truth). |
| D5 | **Keep `pgEnum('Role')`** | **Do not migrate to `TEXT + CHECK`.** Add partial unique index separately | 2025-2026 consensus leans `TEXT + CHECK` for evolvable schemas (F25 may add a third role), BUT F05 already shipped `pgEnum` in migration `0000` — churning now breaks F05 + adds migration risk for zero F06 benefit. Document `TEXT + CHECK` as future-hardening but defer. Cite D-5 (Close Engineering / Crunchy Data / Cybertec consensus). |
| D6 | **Email normalization** | **`normalizeEmailDomain(email)`: trim, `lastIndexOf('@')+1`, lowercase domain. Compare normalized email domain to normalized `env.allowedDomain`** | RFC 5321 domain is case-insensitive; Gmail treats local-part CI but domain-after-@ is what we gate on. `lastIndexOf` (not `indexOf`) defends against malformed multi-@. Cite D-3 (SO 10858813; Salesforce restrict domains; authentik whitelist policy). |
| D7 | **Error code reuse** | **Reuse `FORBIDDEN` (403) for domain mismatch + verified-email failure (verified-email uses `UNAUTHENTICATED` 401 — see D2). No new error codes** | Closed vocab per F03 D-pattern; adding codes requires owner sign-off. `FORBIDDEN` already maps to 403 (`envelope.ts:21`). Cite `js-development-rules.md` security section + F05 D7. |
| D8 | **Frontend FORBIDDEN UX** | **`LoginPage` branches on `err.code === 'FORBIDDEN'` → distinct "Your Google account is not in the allowed workspace" message; other errors fall through to generic `err.message`** | Generic 403 surfacing as `err.message` works but is user-hostile (raw message). Specialized message matches `features.md` "clear message" acceptance. Branching on `err.code` is the documented frontend pattern (`frontend/src/types/api.ts:6-15` mirrors `ErrorCode`). Cite C (LoginPage can branch). |
| D9 | **Domain-change-over-time** | **RECOMMENDED default = grandfather existing users** (domain check runs only on insert path; conflict path skips). **Owner sign-off pending** | Retroactive eviction is destructive; PRD §REQ-1.2 reads as onboarding-time. Whitelist/blocklist (F25) is the right tool for retroactive access changes. Alternative (block on next login) is reversible but disrupts live sessions. Surfaced in §9. |
| D10 | **Whitelist scope** | **Option A — F06 ships domain check + first-admin ONLY. Whitelist deferred to F25** | F25 owns "Whitelist management" (`features.md`); F25 deps F06 only. Adding `whitelisted` column or `AllowedEmails` table now creates schema churn F25 may redesign. Minimal risk, matches F25 scope. Cite C (PRD gives NO whitelist schema/endpoint/rule). |
| D11 | **`role: 'ADMIN'` arbiter via partial index — Drizzle declaration** | **`uniqueIndex('users_one_admin').on(table.role).where(eq(table.role, 'ADMIN'))`** in `schema.ts`, generated via `drizzle-kit generate`** | Drizzle partial-index syntax (`drizzle-orm/pg-core` `uniqueIndex().on().where()`). Generated SQL must match PG arbiter rules for `ON CONFLICT` (F06 uses app-layer retry instead — see Hidden coupling). |
| D12 | **First-admin count in transaction** | **`db.transaction(async (tx) => { const [{count}] = await tx.select({count: count()}).from(users); const role = Number(count) === 0 ? 'ADMIN' : 'MEMBER'; ... insert with role ... })`** | `db.$count(users)` is a non-transactional convenience — inside a txn, use `tx.select({count: count()}).from(users)`. The txn isolates the count from concurrent inserts (PG default READ COMMITTED is sufficient with the unique-index backstop; SERIALIZABLE not needed because the index is the hard guarantee). |
| D13 | **`ALLOWED_DOMAIN` empty = allow all** | **`if (env.allowedDomain) { assertDomainAllowed(info.email) }` — empty/undefined skips the check entirely** | Matches `features.md` ("If `ALLOWED_DOMAIN` is set, only that G-Suite workspace can log in") + `.env.example:15-16` comment + `js-development-rules.md` env table (`ALLOWED_DOMAIN` optional, default —). |

> **Out of F06 scope (explicitly deferred):**
> - **Manual email whitelist / blocklist** → **F25** (Whitelist management). F06 ships ONLY `ALLOWED_DOMAIN` enforcement.
> - **`requireRole('ADMIN')` middleware + role-gated UI** → **F07 / F17 / F25.** F06 puts role on JWT + `req.user`; consumers gate downstream.
> - **Token invalidation (`token_version` / `ver` claim + middleware compare)** → **F07.** F06's single-admin model has no live-token role transition (first-user promotion happens at insert, before any token exists). Multi-admin demotion (F25) needs `token_version`.
> - **Retroactive domain eviction** → pending owner sign-off (D9). F06 recommends grandfather; if owner picks block-on-next-login, add domain check to conflict path too.
> - **Third role (e.g. `VIEWER`)** → F25 may introduce; F06 keeps the 2-value `pgEnum` (D5).

> **Owner sign-off needed:** D9 (grandfather vs block-on-next-login). All other decisions are binding per the evidence above. See §9 for the full sign-off list.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/                                              # repo root
├── backend/
│   ├── .env.example                                    # MODIFY — tighten ALLOWED_DOMAIN doc + grandfather note
│   └── src/
│       ├── db/
│       │   ├── schema.ts                               # MODIFY (T2) — add uniqueIndex('users_one_admin').on(role).where(eq(role,'ADMIN'))
│       │   └── migrations/
│       │       └── 0001_<auto>.sql                     # NEW (T2) — CREATE UNIQUE INDEX ... WHERE role='ADMIN'
│       ├── services/
│       │   ├── accessControl.ts                        # NEW (T1) — normalizeEmailDomain + assertDomainAllowed
│       │   ├── accessControl.test.ts                   # NEW (T1)
│       │   ├── googleOAuth.ts                          # MODIFY (T1) — assert payload.email_verified === true
│       │   ├── googleOAuth.test.ts                     # MODIFY (T1) — new email_verified scenarios
│       │   ├── userService.ts                          # MODIFY (T2) — transactional first-admin upsert + 23505 retry
│       │   └── userService.test.ts                     # MODIFY (T2) — first-admin + retry scenarios
│       └── routes/
│           ├── auth.routes.ts                          # MODIFY (T3) — wire assertDomainAllowed; /me re-fetch from DB
│           └── auth.routes.test.ts                     # MODIFY (T3) — FORBIDDEN + /me re-fetch scenarios
└── frontend/
    └── src/
        └── pages/
            ├── LoginPage.tsx                           # MODIFY (T5) — FORBIDDEN branch with distinct message
            └── LoginPage.test.tsx                      # MODIFY (T5) — FORBIDDEN scenario
```

**Request lifecycle (login with domain restriction — non-obvious):**

1. User clicks "Sign in with Google" in `LoginPage`. GIS popup → consent → `code` POSTed to `/api/auth/google`.
2. `auth.routes.ts:18` calls `exchangeCodeForUser(code)` → `googleOAuth.ts` asserts `payload.email_verified === true` (D2) → returns `GoogleUserInfo` (verified email).
3. `auth.routes.ts` (F06 insert) calls `assertDomainAllowed(info.email)` from `accessControl.ts` (D3, D6). If `env.allowedDomain` is set + domain mismatches → throws `AppError(FORBIDDEN, 'Your Google account is not in the allowed workspace')` → `errorHandler` returns `403 {error:{code:'FORBIDDEN', message:'...'}}`. Frontend `LoginPage` branches on `err.code === 'FORBIDDEN'` (D8) → distinct message.
4. If allowed (or `env.allowedDomain` empty per D13), `upsertByGoogleId(info)` runs the transactional first-admin logic (D1, D12): count users in txn → role = `count === 0 ? 'ADMIN' : 'MEMBER'` → insert w/ role. On `23505` unique_violation → retry once as MEMBER.
5. `signJwt({sub: user.id, email, role})` (role already on claim, F05) → `200 {data: {token, user: {..., role}}}`.
6. Frontend `setUser(...)` → `navigate(from)`.

**Subsequent login (conflict path — grandfather per D9):**

1-2. Same as above (verified email + domain check).
3. `upsertByGoogleId` insert hits `googleId` unique conflict → conflict-update path refreshes `email/fullName/avatarUrl/updatedAt` (F05 D9), preserves `role` + `id`. **Domain check ran on the verified email before upsert, but for an existing user this is the signup-time check — once a user exists, they are grandfathered (D9 recommended default).** If owner picks block-on-next-login, add the domain check to the conflict path too.

**`/me` re-fetch (D4):**

1. `GET /api/auth/me` → `authenticate` → `req.user = {id, email, role}` (from JWT).
2. F06 change: `const user = await findUserById(req.user.id)` (fresh DB read). If user no longer exists → `UNAUTHENTICATED` (account deleted). Else re-sign fresh 8h JWT with `user.role` (DB-authoritative) → `200 {data: {token, user: {id, email, role}}}` (note: `/me` returns the slim `{id, email, role}` shape — NOT `fullName`/`avatarUrl` which the frontend already has in store; this preserves F05's `/me` contract).

---

## 5. Parallelization Strategy

Tasks are grouped into **4 batches** by dependency order. Within a batch, tasks touch **disjoint file sets** → zero merge conflicts → safe to run in parallel and merge independently.

### Batch dependency diagram

```
                  ┌──────────────────────────────────────────────────────┐
   Batch A        │ T1  accessControl service + email_verified gate        │
   (backend core: │     [services/accessControl.ts (NEW) + test,           │
    parallel)     │      services/googleOAuth.ts (MODIFY email_verified)]  │
                  │ T2  first-admin logic + migration + schema index       │
                  │     [db/schema.ts (MODIFY), db/migrations/0001 (NEW),  │
                  │      services/userService.ts (MODIFY) + test]          │
                  │     (T1 & T2 disjoint: accessControl+googleOAuth vs    │
                  │      db+userService — zero file overlap)               │
                  └──────────────┬───────────────────────────────────────┘
                                 │ (services + index exist)
                                 ▼
                  ┌──────────────────────────────────────────────────────┐
   Batch B        │ T3  wire accessControl into auth.routes + /me re-fetch │
   (backend       │     [routes/auth.routes.ts (MODIFY) + test]           │
    wiring)       │     (consumes T1's assertDomainAllowed + T2's          │
                  │      findUserById; terminal backend)                   │
                  └──────────────┬───────────────────────────────────────┘
                                 │ (backend complete; /api/auth/* live)
                                 ▼
                  ┌──────────────────────────────────────────────────────┐
   Batch C        │ T4  docs (decisions, env doc, seed/dev caveat)         │
   (docs + UX:    │     [.env.example, .docs/features/F06.../decisions.md]│
    parallel)     │ T5  frontend LoginPage FORBIDDEN UX branch             │
                  │     [frontend/src/pages/LoginPage.tsx + test]          │
                  │     (T4 & T5 disjoint: docs+env vs frontend)           │
                  └──────────────┬───────────────────────────────────────┘
                                 │ (frontend + docs complete)
                                 ▼
                  ┌──────────────────────────────────────────────────────┐
   Batch D        │ T6  Integration verification & sign-off (terminal)     │
   (terminal)     │     (no files; runs lint/typecheck/test/build +        │
                  │      manual curl smoke)                                │
                  └──────────────────────────────────────────────────────┘
```

- **Batch A → Batch B** is a hard barrier: T3 imports `assertDomainAllowed` (T1) + calls `findUserById` on the updated `userService` (T2). Both must be on `main` before T3 branches.
- **Batch B → Batch C** is NOT a hard barrier for T5 — the frontend FORBIDDEN branch can be developed against a stubbed `ApiClientError` without the backend live. T4 (docs) can also proceed independently. **However, T6 (smoke) needs the backend live.** T5's tests mock the API client, so they pass without a backend.
- **Batch C → Batch D** is a hard barrier: T6 exercises the full stack.

**Within Batch A, T1 / T2 touch disjoint files** (confirmed by file-set inspection):

- **T1** owns: `backend/src/services/accessControl.ts` (NEW), `backend/src/services/accessControl.test.ts` (NEW), `backend/src/services/googleOAuth.ts` (MODIFY — email_verified assertion), `backend/src/services/googleOAuth.test.ts` (MODIFY).
- **T2** owns: `backend/src/db/schema.ts` (MODIFY — partial unique index), `backend/src/db/migrations/0001_*.sql` (NEW), `backend/src/services/userService.ts` (MODIFY — txn first-admin + retry), `backend/src/services/userService.test.ts` (MODIFY).

No overlaps. Both can branch off `main` (post-F05 T1-T12), implement, and merge in any order.

**Within Batch C, T4 / T5 touch disjoint files:**

- **T4** owns: `backend/.env.example` (MODIFY — doc tightening), `.docs/features/F06-onboarding-workspace-roles/decisions.md` (NEW — optional record of D1-D13 + sign-off items).
- **T5** owns: `frontend/src/pages/LoginPage.tsx` (MODIFY), `frontend/src/pages/LoginPage.test.tsx` (MODIFY).

### Merge order rules

1. **Batch A (T1, T2) merges first, in any order (parallel-safe).** Disjoint file sets. Both must be on `main` before Batch B branches.
2. **Batch B (T3) merges second.** Consumes T1's `assertDomainAllowed` + T2's transactional upsert / `findUserById`. Terminal backend task.
3. **Batch C (T4, T5) merges third, in any order (parallel-safe).** Disjoint file sets (docs+env vs frontend). T5's tests mock the API client — pass without T3 live, but T3 should be on `main` before T5's manual smoke (T6).
4. **Batch D (T6) merges last.** Terminal verification gate; owns no files.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | A | `backend/src/services/accessControl.ts` (NEW), `backend/src/services/accessControl.test.ts` (NEW), `backend/src/services/googleOAuth.ts` (MODIFY), `backend/src/services/googleOAuth.test.ts` (MODIFY) | F05 T1-T12 | T2 |
| **T2** | A | `backend/src/db/schema.ts` (MODIFY), `backend/src/db/migrations/0001_*.sql` (NEW), `backend/src/services/userService.ts` (MODIFY), `backend/src/services/userService.test.ts` (MODIFY) | F05 T1-T12 | T1 |
| **T3** | B | `backend/src/routes/auth.routes.ts` (MODIFY), `backend/src/routes/auth.routes.test.ts` (MODIFY) | T1, T2 | — |
| **T4** | C | `backend/.env.example` (MODIFY), `.docs/features/F06-onboarding-workspace-roles/decisions.md` (NEW) | — | T5 |
| **T5** | C | `frontend/src/pages/LoginPage.tsx` (MODIFY), `frontend/src/pages/LoginPage.test.tsx` (MODIFY) | F05 T10 | T4 |
| **T6** | D | (no files — terminal verification) | T3, T5 | — |

### Developer assignment tracks

- **Solo (recommended):** (T1 ‖ T2) → T3 → (T4 ‖ T5) → T6. ~1.5 days.
- **2 devs:**
  - **Dev-A (backend):** (T1 ‖ T2) → T3 → T6.
  - **Dev-B (docs + frontend):** T4 (start immediately) ‖ T5 (after F05 T10 confirmed merged) → help T6.
  - Merge order: Batch A (T1/T2 parallel) → Batch B (T3) ‖ Batch C (T4/T5) → Batch D (T6).
- **3 devs:**
  - **Dev-A (backend policy):** T1 → help T3.
  - **Dev-B (backend data):** T2 → help T3.
  - **Dev-C (frontend + docs):** T4 → T5 → T6.
  - Merge coordination: Dev-A owns `accessControl.ts` commit; Dev-B owns `schema.ts`/migration commit; T3 merges after both.

---

## 6. Tasks

### T1 — Backend accessControl service + email_verified gate

**Batch:** A · **Depends on:** F05 T1-T12 (merged) · **Parallel with:** T2

**Description:** Ship the policy layer (D2, D3, D6). Two coupled changes in disjoint concerns: (a) NEW `backend/src/services/accessControl.ts` exporting `normalizeEmailDomain(email)` + `assertDomainAllowed(email)`; (b) MODIFY `backend/src/services/googleOAuth.ts` to assert `payload.email_verified === true` before returning `GoogleUserInfo`. The verified-email gate belongs in `googleOAuth.ts` (it is a property of the Google payload, not a workspace policy) — `accessControl.ts` then trusts `GoogleUserInfo.email` unconditionally for the domain check.

Create / Modify:

- **`backend/src/services/accessControl.ts`** (NEW). Domain check + normalizer.

  ```typescript
  import { env } from '../config';
  import { AppError } from '../utils/appError';
  import { ErrorCode } from '../utils/envelope';

  // D6: extract domain from email, lowercase per RFC 5321 (domain is case-insensitive).
  // lastIndexOf defends against malformed multi-@ (indexOf would mis-split).
  // Returns '' for malformed input (no @) — caller compares against normalized allowedDomain.
  export function normalizeEmailDomain(email: string): string {
    const atIndex = email.trim().lastIndexOf('@');
    if (atIndex === -1 || atIndex === email.trim().length - 1) return '';
    return email.trim().slice(atIndex + 1).toLowerCase();
  }

  // D3 + D13: if env.allowedDomain is unset/empty, allow all (F06 "if configured" semantics).
  // Otherwise the email's domain must match the normalized allowedDomain.
  // Throws AppError(FORBIDDEN) on mismatch — first user of FORBIDDEN in the app.
  export function assertDomainAllowed(email: string): void {
    if (!env.allowedDomain) return; // D13 — empty = allow all
    const userDomain = normalizeEmailDomain(email);
    const allowedDomain = normalizeEmailDomain(`x@${env.allowedDomain}`);
    if (!userDomain || userDomain !== allowedDomain) {
      throw new AppError(
        ErrorCode.FORBIDDEN,
        'Your Google account is not in the allowed workspace',
      );
    }
  }
  ```

  Notes: (a) `normalizeEmailDomain` is reused for BOTH the incoming email and `env.allowedDomain` (single normalizer = consistent comparison). (b) `env.allowedDomain` may be a bare domain (`example.com`) — wrapping as `x@${env.allowedDomain}` lets the same normalizer extract it. (c) `trim()` before `lastIndexOf` defends against leading/trailing whitespace. (d) `toLowerCase()` per RFC 5321. (e) Empty userDomain (malformed email, no @) → FORBIDDEN — never allow a malformed email to bypass the gate. (f) `AppError(FORBIDDEN, ...)` is the FIRST use of FORBIDDEN in app code — `envelope.ts:21` already maps it to 403, tested at F03.

- **`backend/src/services/accessControl.test.ts`** (NEW). Table-driven. Scenario names:

  - **normalizeEmailDomain: lowercases domain** — `normalizeEmailDomain('Alice@Example.COM')` → `'example.com'`.
  - **normalizeEmailDomain: trims whitespace** — `normalizeEmailDomain('  alice@example.com  ')` → `'example.com'`.
  - **normalizeEmailDomain: uses lastIndexOf for malformed multi-@** — `normalizeEmailDomain('a@b@example.com')` → `'example.com'` (not `'b@example.com'`).
  - **normalizeEmailDomain: returns '' for missing @** — `normalizeEmailDomain('not-an-email')` → `''`.
  - **normalizeEmailDomain: returns '' for trailing @** — `normalizeEmailDomain('alice@')` → `''`.
  - **assertDomainAllowed: allows all when env.allowedDomain unset** — stub `env.allowedDomain = undefined`; call `assertDomainAllowed('anyone@anywhere.com')`; no throw.
  - **assertDomainAllowed: allows matching domain (case-insensitive)** — stub `env.allowedDomain = 'Example.com'`; call `assertDomainAllowed('alice@example.com')`; no throw.
  - **assertDomainAllowed: throws FORBIDDEN on mismatch** — stub `env.allowedDomain = 'allowed.com'`; call `assertDomainAllowed('alice@blocked.com')`; assert `AppError` w/ `code: 'FORBIDDEN'`, `message: 'Your Google account is not in the allowed workspace'`.
  - **assertDomainAllowed: throws FORBIDDEN on malformed email** — stub `env.allowedDomain = 'allowed.com'`; call `assertDomainAllowed('no-at-sign')`; assert FORBIDDEN.
  - **assertDomainAllowed: throws FORBIDDEN on bare-domain env mismatch** — stub `env.allowedDomain = 'allowed.com'`; call `assertDomainAllowed('alice@sub.allowed.com')`; assert FORBIDDEN (subdomains NOT auto-allowed — exact match only, document this).

  Notes: Mocking `env` requires `vi.mock('../config', () => ({env: {allowedDomain: '...'}}))` per-test OR a `beforeEach` that swaps the stub. Prefer the latter for table-driven tests. Pattern matches `googleOAuth.test.ts`'s `vi.hoisted` usage.

- **`backend/src/services/googleOAuth.ts`** (MODIFY). Add `email_verified` assertion.

  Current `:23-26`:
  ```typescript
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload?.email) {
    throw new Error('Google payload missing sub or email');
  }
  ```

  F06 change — assert `email_verified`:
  ```typescript
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload?.email) {
    throw new Error('Google payload missing sub or email');
  }
  // D2: Google must have verified the email. Without this, the domain gate is bypassable
  // (attacker controls the email claim). Cite google-auth-library v10 TokenInfo.email_verified.
  if (payload.email_verified !== true) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'Email not verified by Google');
  }
  ```

  Notes: (a) The assertion is OUTSIDE the existing `try/catch` (which wraps everything → `INTERNAL_ERROR`). F06's verified-email failure should surface as `UNAUTHENTICATED` (401 — the user's identity is not trustworthy), NOT `INTERNAL_ERROR` (500 — server fault). The cleanest way: throw `AppError(UNAUTHENTICATED, ...)` INSIDE the try block; the existing `catch (cause)` re-wraps it as `INTERNAL_ERROR`. **Therefore restructure the catch to re-throw `AppError` as-is** (check `if (cause instanceof AppError) throw cause` before the generic wrap). Updated catch:

  ```typescript
  } catch (cause) {
    // AppError (e.g. UNAUTHENTICATED for unverified email) propagates as-is.
    if (cause instanceof AppError) throw cause;
    // D7: never leak Google's error to the client — generic message.
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'Authentication failed', { cause });
  }
  ```

  (b) `payload.email_verified` from `google-auth-library` v10 is `boolean | undefined` — `!== true` covers both `false` and `undefined`. (c) Import `AppError` + `ErrorCode` (already imported at `:3-4`).

- **`backend/src/services/googleOAuth.test.ts`** (MODIFY — add email_verified scenarios). Scenario names:

  - **throws UNAUTHENTICATED when email_verified is false** — mock `verifyIdToken` → `{getPayload: () => ({sub: 'g1', email: 'a@b.com', email_verified: false})}`; assert `AppError` w/ `code: 'UNAUTHENTICATED'`, `message: 'Email not verified by Google'`.
  - **throws UNAUTHENTICATED when email_verified is undefined** — payload w/o `email_verified`; assert same.
  - **returns user info when email_verified is true** — payload `{sub, email, email_verified: true, name, picture}`; assert normal return (regression check on existing happy path).
  - **existing INTERNAL_ERROR scenarios still pass** (regression) — getToken rejection, verifyIdToken rejection, missing id_token, missing sub/email — all still surface as `INTERNAL_ERROR` w/ `'Authentication failed'`.

  Notes: The `email_verified: true` case is added to the existing happy-path mock; the `false`/`undefined` cases are new. Confirm the `instanceof AppError` re-throw doesn't break the `INTERNAL_ERROR` regression suite (it shouldn't — those paths throw raw `Error`, not `AppError`).

**Acceptance Criteria:**
- [ ] `accessControl.ts` exports `normalizeEmailDomain(email: string): string` + `assertDomainAllowed(email: string): void`.
- [ ] `normalizeEmailDomain` lowercases, trims, uses `lastIndexOf`, returns `''` on malformed input.
- [ ] `assertDomainAllowed` no-ops when `env.allowedDomain` is unset; throws `AppError(FORBIDDEN, 'Your Google account is not in the allowed workspace')` on mismatch (case-insensitive, exact match — no subdomain wildcard).
- [ ] `googleOAuth.ts` asserts `payload.email_verified === true`; failure → `AppError(UNAUTHENTICATED, 'Email not verified by Google')`; `AppError` propagates through the catch (not re-wrapped as `INTERNAL_ERROR`).
- [ ] All 10 accessControl + 4 googleOAuth scenarios above pass.
- [ ] `npm run typecheck -w backend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** F05 T1-T12 (env.allowedDomain, ErrorCode.FORBIDDEN, AppError all shipped). No dependency on T2.

---

### T2 — Backend first-admin logic + partial unique index migration

**Batch:** A · **Depends on:** F05 T1-T12 (merged) · **Parallel with:** T1

**Description:** Ship the race-safe first-admin promotion (D1, D11, D12). Three coupled changes: (a) add the partial unique index declaration to `schema.ts`; (b) generate the migration SQL via `drizzle-kit generate`; (c) rewrite `upsertByGoogleId` to run a transactional count-then-insert w/ conditional role + app-layer `23505` retry as MEMBER.

Create / Modify:

- **`backend/src/db/schema.ts`** (MODIFY). Add partial unique index.

  Append after the `users` table definition (`:22`):

  ```typescript
  import { uniqueIndex, eq } from 'drizzle-orm/pg-core';

  // F06 D1: race-safe first-admin guard. At most ONE row may have role='ADMIN'.
  // The DB enforces this regardless of concurrent inserts; the application also
  // uses a transactional count to minimize contention, but this index is the
  // hard guarantee. Cite PG partial-indexes 11.8; SO 46727740; Hasura #3666.
  export const usersOneAdminIndex = uniqueIndex('users_one_admin').on(users.role).where(eq(users.role, 'ADMIN'));
  ```

  Then attach the index to the table definition. Drizzle's `pgTable` second arg is the indexes config — modify `:8`:

  ```typescript
  export const users = pgTable(
    'Users',
    {
      // ...existing columns...
    },
    (table) => ({
      usersOneAdminIdx: uniqueIndex('users_one_admin').on(table.role).where(eq(table.role, 'ADMIN')),
    }),
  );
  ```

  Notes: (a) The `eq` import comes from `drizzle-orm` (not `drizzle-orm/pg-core`) — fix the import line above. (b) Drizzle's table-config callback form `(table) => ({...})` is the canonical way to declare indexes. (c) The generated SQL (next step) will be `CREATE UNIQUE INDEX "users_one_admin" ON "Users" USING btree ("role") WHERE "role" = 'ADMIN'`. (d) `uniqueIndex` (not `index`) — the UNIQUE constraint is the arbiter.

- **Generate the migration** via `drizzle-kit generate` from `backend/`:

  ```bash
  npm run db:generate -w backend
  ```

  This produces `backend/src/db/migrations/0001_<auto-name>.sql` (drizzle-kit picks a name like `users_one_admin.sql` or a random one). Verify the generated SQL contains:

  ```sql
  CREATE UNIQUE INDEX IF NOT EXISTS "users_one_admin"
    ON "Users" USING btree ("role")
    WHERE "role" = 'ADMIN';
  ```

  Apply locally to verify:
  ```bash
  npm run db:migrate -w backend
  ```

  Confirm `users_one_admin` exists via `\di users_one_admin` in psql. Notes: (a) `IF NOT EXISTS` is drizzle-kit's default for idempotency. (b) The partial predicate `WHERE "role" = 'ADMIN'` MUST match the `eq(users.role, 'ADMIN')` declaration exactly or `ON CONFLICT` arbiter matching breaks (F06 doesn't use ON CONFLICT here, but future features might). (c) Commit the generated SQL — `drizzle-kit generate` is a one-time authoring step; migrations are checked in.

- **`backend/src/services/userService.ts`** (MODIFY). Transactional first-admin upsert + retry.

  Full rewrite of `upsertByGoogleId`:

  ```typescript
  import { count, eq } from 'drizzle-orm';
  import { db } from '../db/client';
  import { users } from '../db/schema';
  import type { GoogleUserInfo } from './googleOAuth';

  export type UpsertUserInput = GoogleUserInfo;
  export type UserRow = typeof users.$inferSelect;

  const ADMIN_ROLE = 'ADMIN' as const;
  const MEMBER_ROLE = 'MEMBER' as const;
  const PG_UNIQUE_VIOLATION = '23505';

  // D1 + D12: race-safe upsert. Conflict path preserves role + id (F05 D9).
  // Insert path: count users in txn — 0 → ADMIN, else MEMBER.
  // The users_one_admin partial unique index is the hard guarantee against
  // double-admin under concurrency; the 23505 retry is the app-layer backstop.
  export async function upsertByGoogleId(input: UpsertUserInput): Promise<UserRow> {
    return db.transaction(async (tx) => {
      // Conflict on googleId → refresh profile (F05 D9), preserve role + id.
      const [existing] = await tx
        .select()
        .from(users)
        .where(eq(users.googleId, input.googleId))
        .limit(1);
      if (existing) {
        const [updated] = await tx
          .update(users)
          .set({
            email: input.email,
            fullName: input.fullName,
            avatarUrl: input.avatarUrl,
            updatedAt: new Date(),
          })
          .where(eq(users.id, existing.id))
          .returning();
        return updated!;
      }

      // Insert path: first-user → ADMIN, else MEMBER.
      const [{ rowCount }] = await tx.select({ rowCount: count() }).from(users);
      const isFirstUser = Number(rowCount) === 0;
      const role = isFirstUser ? ADMIN_ROLE : MEMBER_ROLE;

      try {
        const [row] = await tx
          .insert(users)
          .values({
            googleId: input.googleId,
            email: input.email,
            fullName: input.fullName,
            avatarUrl: input.avatarUrl,
            role,
          })
          .returning();
        return row!;
      } catch (cause) {
        // 23505 = unique_violation. Two races possible:
        //  (a) googleId conflict (another request inserted same googleId first)
        //      → re-read + refresh, return that row.
        //  (b) users_one_admin conflict (count said 0 but another ADMIN insert landed)
        //      → retry as MEMBER.
        const code = (cause as { code?: string })?.code;
        if (code !== PG_UNIQUE_VIOLATION) throw cause;
        return retryAsMemberOrRefresh(tx, input);
      }
    });
  }

  async function retryAsMemberOrRefresh(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    input: UpsertUserInput,
  ): Promise<UserRow> {
    // Try MEMBER insert (covers users_one_admin race).
    try {
      const [row] = await tx
        .insert(users)
        .values({
          googleId: input.googleId,
          email: input.email,
          fullName: input.fullName,
          avatarUrl: input.avatarUrl,
          role: MEMBER_ROLE,
        })
        .returning();
      return row!;
    } catch (cause) {
      const code = (cause as { code?: string })?.code;
      if (code !== PG_UNIQUE_VIOLATION) throw cause;
      // googleId conflict (another request won the insert race) → refresh.
      const [existing] = await tx
        .select()
        .from(users)
        .where(eq(users.googleId, input.googleId))
        .limit(1);
      if (!existing) throw cause; // shouldn't happen — defensive
      const [updated] = await tx
        .update(users)
        .set({
          email: input.email,
          fullName: input.fullName,
          avatarUrl: input.avatarUrl,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning();
      return updated!;
    }
  }

  // D4: /me re-fetch helper. Returns the DB-authoritative row for JWT re-signing.
  export async function findUserById(id: string): Promise<UserRow | undefined> {
    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return row;
  }
  ```

  Notes: (a) The explicit select-then-update (vs F05's single `onConflictDoUpdate`) preserves F05 D9 semantics (refresh email/name/avatar, preserve role + id) while enabling the conditional-role insert. (b) `db.transaction(async (tx) => {...})` — Drizzle's `tx` is a transaction-scoped query builder. (c) `tx.select({rowCount: count()}).from(users)` — `count()` from `drizzle-orm` (NOT `db.$count` which is non-transactional). (d) The 23505 retry is a single attempt — nested retries risk infinite loops; the partial unique index guarantees termination. (e) `retryAsMemberOrRefresh` is a module-private helper (not exported). (f) `findUserById` is NEW — consumed by T3's `/me` re-fetch (D4). (g) The `tx` type alias `Parameters<Parameters<typeof db.transaction>[0]>[0]` is ugly but correct; alternatively define `type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]` at module scope. (h) `ADMIN_ROLE`/`MEMBER_ROLE` constants (SCREAMING_SNAKE_CASE per style guide) — avoid magic strings.

- **`backend/src/services/userService.test.ts`** (MODIFY — new scenarios for first-admin + retry). Scenario names:

  - **inserts ADMIN when table is empty (first user)** — mock `db.transaction` to invoke the callback with a mock `tx`; mock `tx.select().from().where().limit()` → `[]` (no existing); mock `tx.select({rowCount: count()}).from()` → `[{rowCount: 0}]`; mock `tx.insert().values().returning()` → `[{id, role: 'ADMIN', ...}]`; assert result.role === 'ADMIN'.
  - **inserts MEMBER when table is non-empty (subsequent user)** — same as above but `rowCount: 1`; assert result.role === 'MEMBER'.
  - **updates profile on conflict (existing googleId)** — mock select → `[existing]`; mock update → `[updated]`; assert `update` called with `{email, fullName, avatarUrl, updatedAt}` (NO `role`, NO `id` in set).
  - **preserves role on conflict (existing ADMIN stays ADMIN)** — existing has role 'ADMIN'; assert the update path does NOT include role in set.
  - **retries as MEMBER on 23505 from users_one_admin** — mock insert to throw `{code: '23505'}` first time, then succeed on retry; assert the retry insert uses `role: 'MEMBER'`.
  - **retries as refresh on 23505 from googleId conflict** — mock insert to throw `{code: '23505'}`, retry insert also throws `{code: '23505'}`, then select returns existing; assert update called + existing returned.
  - **re-throws non-23505 errors** — mock insert to throw `{code: '23503'}` (foreign key violation); assert the error propagates (NOT swallowed).
  - **findUserById returns the row when found** — mock select → `[row]`; assert result === row.
  - **findUserById returns undefined when not found** — mock select → `[]`; assert result === undefined.

  Notes: Mocking the Drizzle transaction + chained query builder is intricate. Pattern from F05 `userService.test.ts:22-40` (fluent chain stub) extends to `tx`: build a mock `tx` object where each method (`select`, `insert`, `update`, `delete`) returns a chain that resolves at `.returning()` / `.limit()` / terminal. Use `vi.fn()` per method, `mockResolvedValueOnce` for sequence-sensitive calls. The `db.transaction` mock: `vi.mock('../db/client', () => ({db: {transaction: vi.fn(async (cb) => cb(mockTx))}}))`.

**Acceptance Criteria:**
- [ ] `schema.ts` declares `usersOneAdminIndex` (`uniqueIndex('users_one_admin').on(table.role).where(eq(table.role, 'ADMIN'))`) attached to `users`.
- [ ] `0001_*.sql` generated via `drizzle-kit generate`; contains `CREATE UNIQUE INDEX IF NOT EXISTS "users_one_admin" ON "Users" USING btree ("role") WHERE "role" = 'ADMIN'`; applied locally (verified via `\di`).
- [ ] `upsertByGoogleId` runs inside `db.transaction`; first-user → 'ADMIN'; subsequent → 'MEMBER'; conflict path refreshes profile preserving role + id.
- [ ] 23505 unique-violation caught + retried (as MEMBER, or as refresh on googleId conflict); non-23505 re-thrown.
- [ ] `findUserById(id)` exported; returns `UserRow | undefined`.
- [ ] All 9 userService scenarios above pass.
- [ ] `npm run typecheck -w backend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** F05 T1-T12 (schema, db client, userService skeleton). No dependency on T1.

---

### T3 — Backend route wiring (domain check + /me re-fetch)

**Batch:** B (terminal backend) · **Depends on:** T1, T2 · **Parallel with:** —

**Description:** Wire F06 policy into the auth routes (D4). Two changes: (a) `POST /api/auth/google` calls `assertDomainAllowed(info.email)` between `exchangeCodeForUser` and `upsertByGoogleId`; (b) `GET /api/auth/me` re-fetches the user DB row via `findUserById` instead of re-signing from `req.user` (JWT-sourced). Both changes are minimal — the route file is the integration point.

Create / Modify:

- **`backend/src/routes/auth.routes.ts`** (MODIFY). Wire domain check + /me re-fetch.

  Current `:13-34` (`POST /google`):
  ```typescript
  authRouter.post(
    '/google',
    validateRequest({ body: authCodeSchema }),
    async (req, res): Promise<void> => {
      const { code } = req.body as { code: string };
      const info = await exchangeCodeForUser(code);
      const user = await upsertByGoogleId(info);
      const token = await signJwt({ sub: user.id, email: user.email, role: user.role });
      res.json(success({ token, user: { id, email, fullName, avatarUrl, role } }));
    },
  );
  ```

  F06 change — insert domain check between `:18` and `:19`:
  ```typescript
  authRouter.post(
    '/google',
    validateRequest({ body: authCodeSchema }),
    async (req, res): Promise<void> => {
      const { code } = req.body as { code: string };
      const info = await exchangeCodeForUser(code);
      // F06 D3 + D13: enforce ALLOWED_DOMAIN on the Google-verified email.
      // Empty env.allowedDomain = allow all (assertDomainAllowed no-ops).
      assertDomainAllowed(info.email);
      const user = await upsertByGoogleId(info);
      const token = await signJwt({ sub: user.id, email: user.email, role: user.role });
      res.json(
        success({
          token,
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            avatarUrl: user.avatarUrl,
            role: user.role,
          },
        }),
      );
    },
  );
  ```

  Current `:37-41` (`GET /me`):
  ```typescript
  authRouter.get('/me', authenticate, async (req, res): Promise<void> => {
    const user = req.user!;
    const token = await signJwt({ sub: user.id, email: user.email, role: user.role });
    res.json(success({ token, user }));
  });
  ```

  F06 change — re-fetch from DB (D4):
  ```typescript
  authRouter.get('/me', authenticate, async (req, res): Promise<void> => {
    // F06 D4: source user from DB (not JWT) so role changes reflect immediately.
    const user = await findUserById(req.user!.id);
    if (!user) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'User no longer exists');
    }
    const token = await signJwt({ sub: user.id, email: user.email, role: user.role });
    res.json(
      success({
        token,
        user: { id: user.id, email: user.email, role: user.role },
      }),
    );
  });
  ```

  Updated imports at top of file:
  ```typescript
  import { Router } from 'express';
  import { success } from '../utils/envelope';
  import { validateRequest } from '../middleware/validateRequest';
  import { authenticate } from '../middleware/auth';
  import { signJwt } from '../utils/jwt';
  import { AppError } from '../utils/appError';
  import { ErrorCode } from '../utils/envelope';
  import { exchangeCodeForUser } from '../services/googleOAuth';
  import { upsertByGoogleId, findUserById } from '../services/userService';
  import { assertDomainAllowed } from '../services/accessControl';
  import { authCodeSchema } from './auth.schema';
  ```

  Notes: (a) `assertDomainAllowed` throws `AppError(FORBIDDEN)` on mismatch — Express 5's `errorHandler` catches it and returns `403 {error: {code: 'FORBIDDEN', message: '...'}}`. No try/catch needed in the route (D7 — closed vocab reused). (b) The `/me` shape returns `{id, email, role}` only — NOT `fullName`/`avatarUrl` (the frontend already has those in `useAuthStore`; `/me` is a session liveness + role check, not a profile refresh). This is a CONTRACT CHANGE from F05's `/me` (which returned `req.user` = `{id, email, role}` — same shape actually, since `AuthenticatedUser` only has those 3 fields). **Verify frontend `fetchMe` consumer** — `frontend/src/api/auth.ts` types `AuthResponseUser` as `{id, email, fullName, avatarUrl, role}` (all required). **T5 must reconcile:** either (i) `/me` returns the full row (include `fullName`/`avatarUrl`), or (ii) `fetchMe` type narrows. Decision: **(i) — `/me` returns the full row** to preserve F05's `AuthResponseUser` contract. Updated `/me`:
  ```typescript
  res.json(
    success({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        role: user.role,
      },
    }),
  );
  ```
  (c) `AppError(UNAUTHENTICATED, 'User no longer exists')` — defensive; if the user was deleted (F25 blocklist future), their JWT is still valid (stateless) until expiry; `/me` refuses. (d) Import order per `js-style-guide.md`: external (express) → internal (utils, middleware, services, routes) → relative (none here). `import type` not needed (all value imports). (e) The `AppError` + `ErrorCode` imports are NEW to this file — currently `auth.routes.ts` doesn't throw AppError directly (services do). F06's `/me` adds the first route-level throw.

- **`backend/src/routes/auth.routes.test.ts`** (MODIFY — add F06 scenarios). Scenario names:

  - **POST /google returns 200 ADMIN for first user when domain allowed** — mock `exchangeCodeForUser` → `{googleId, email: 'a@allowed.com', ...}`; mock `upsertByGoogleId` → `{id, role: 'ADMIN', ...}`; stub `env.allowedDomain = 'allowed.com'`; POST `{code}`; assert `200`, `body.data.user.role === 'ADMIN'`.
  - **POST /google returns 403 FORBIDDEN on domain mismatch** — stub `env.allowedDomain = 'allowed.com'`; mock `exchangeCodeForUser` → `{email: 'a@blocked.com', ...}`; POST `{code}`; assert `403`, `body.error.code === 'FORBIDDEN'`, `body.error.message === 'Your Google account is not in the allowed workspace'`. Assert `upsertByGoogleId` NOT called (domain check short-circuits).
  - **POST /google returns 200 when env.allowedDomain unset (allow all)** — stub `env.allowedDomain = undefined`; mock `exchangeCodeForUser` → `{email: 'a@anywhere.com', ...}`; POST `{code}`; assert `200`, `upsertByGoogleId` called.
  - **POST /google returns 401 UNAUTHENTICATED on unverified email** — mock `exchangeCodeForUser` to throw `AppError(UNAUTHENTICATED, 'Email not verified by Google')`; POST `{code}`; assert `401`, `body.error.code === 'UNAUTHENTICATED'`. Assert `assertDomainAllowed` + `upsertByGoogleId` NOT called.
  - **GET /me returns 200 with DB-fresh role** — sign a real JWT w/ role 'MEMBER' in the claim; mock `findUserById` → `{id, email, role: 'ADMIN', fullName, avatarUrl}` (DB now says ADMIN); GET `/me` w/ Bearer; assert `200`, `body.data.user.role === 'ADMIN'` (DB-authoritative, not JWT).
  - **GET /me returns 401 UNAUTHENTICATED when user not found in DB** — sign a real JWT; mock `findUserById` → `undefined`; GET `/me`; assert `401`, `body.error.code === 'UNAUTHENTICATED'`, `body.error.message === 'User no longer exists'`.
  - **Existing POST /google scenarios still pass** (regression) — 400 VALIDATION_FAILED on missing/empty code; 500 INTERNAL_ERROR on exchangeCodeForUser throwing non-AppError.
  - **Existing GET /me + POST /logout scenarios still pass** (regression).

  Notes: Mocking `env` for the domain-check scenarios requires `vi.mock('../config', () => ({env: {...fullConfig, allowedDomain: 'allowed.com'}}))`. The mock must include ALL `env` fields (the route also reads `env.googleClientId` indirectly via `exchangeCodeForUser`). Use a `beforeEach` to reset + per-test `vi.mocked(env).allowedDomain = '...'` OR re-mock per test. Pattern from `googleOAuth.test.ts` (vi.hoisted). The `/me` DB-fresh test uses a real signed JWT (import `signJwt` directly, don't mock it for that test) so `authenticate`'s `verifyJwt` passes.

**Acceptance Criteria:**
- [ ] `POST /api/auth/google` calls `assertDomainAllowed(info.email)` between exchange and upsert; 403 FORBIDDEN on mismatch; allows all when `env.allowedDomain` unset.
- [ ] `GET /api/auth/me` calls `findUserById(req.user.id)`; returns DB-fresh user; 401 UNAUTHENTICATED when user not found.
- [ ] `/me` response shape unchanged from F05 (`{token, user: {id, email, fullName, avatarUrl, role}}`).
- [ ] All 6 new + existing regression scenarios above pass.
- [ ] `npm run typecheck -w backend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T1 (`assertDomainAllowed`), T2 (`findUserById`, transactional upsert).

---

### T4 — Docs (decisions record, env doc, seed/dev caveat)

**Batch:** C · **Depends on:** None · **Parallel with:** T5

**Description:** Capture F06's irreversible decisions + the dev-mode caveat in discoverable places. Three artifacts: (a) tighten `.env.example` doc for `ALLOWED_DOMAIN`; (b) NEW `decisions.md` in the F06 feature dir recording D1-D13 + sign-off items (this is the human-readable companion to this tasks doc); (c) document the seed/first-admin dev caveat where developers will see it.

Create / Modify:

- **`backend/.env.example`** (MODIFY). Tighten `ALLOWED_DOMAIN` doc.

  Current (`:15-16`):
  ```
  # F06: leave empty to allow all Google accounts; set to your G-Suite domain to restrict.
  ALLOWED_DOMAIN=
  ```

  F06 change — expand the comment with grandfather semantics + normalization:
  ```
  # F06: leave empty to allow all Google accounts; set to your G-Suite domain to restrict.
  # Enforcement runs on the Google-verified email at signup. Case-insensitive domain match
  # (RFC 5321). Existing users are grandfathered — tightening this does NOT lock out current
  # members (recommended default; owner sign-off pending). Subdomain match is EXACT
  # ('example.com' does NOT match 'sub.example.com'). Manual email whitelist is F25.
  ALLOWED_DOMAIN=
  ```

- **`.docs/features/F06-onboarding-workspace-roles/decisions.md`** (NEW). Decisions record.

  Contents (mirror §3 of this doc in human-readable form, one section per decision D1-D13, plus the §9 sign-off list). This file is the single-source-of-truth for "why did F06 pick X" — future developers (F07/F25 owners) read this before changing F06 behavior. Include:

  - D1 race-safe first-admin (partial index + txn + 23505 retry)
  - D2 verified-email gate
  - D3 accessControl.ts location
  - D4 /me re-fetch
  - D5 keep pgEnum (defer TEXT+CHECK)
  - D6 email normalization
  - D7 FORBIDDEN reuse
  - D8 frontend FORBIDDEN UX
  - D9 grandfather (sign-off pending)
  - D10 whitelist → F25
  - D11 Drizzle partial index declaration
  - D12 count-in-transaction
  - D13 empty ALLOWED_DOMAIN = allow all

  Plus the three sign-off items from §9.

- **Dev-mode caveat** (document in `decisions.md` + optionally a comment in `backend/src/db/seed.ts`). The caveat:

  > **Dev caveat (F06 first-admin logic):** `backend/src/db/seed.ts` inserts ADMIN + MEMBER fixtures → the `users` table is non-empty after seeding. F06's first-admin promotion (count === 0) therefore yields `MEMBER` for all new dev signups (intended — the seed admin is the dev admin). To test first-admin promotion end-to-end, run against an unseeded database: `TRUNCATE "Users" RESTART IDENTITY CASCADE;` (or drop + recreate the DB), then sign in with a fresh Google account. The partial unique index `users_one_admin` will be respected — only the seed's `admin-dev-fixture` row holds ADMIN; any attempt to insert a second ADMIN (via direct SQL, not the app) will fail with 23505.

**Acceptance Criteria:**
- [ ] `backend/.env.example` comment for `ALLOWED_DOMAIN` documents grandfather semantics, case-insensitivity, exact subdomain match, F25 deferral.
- [ ] `.docs/features/F06-onboarding-workspace-roles/decisions.md` exists; documents D1-D13 + sign-off items.
- [ ] Dev-mode seed caveat documented in `decisions.md` (and optionally `seed.ts` comment).
- [ ] No code changes (docs-only task).

**Dependencies:** None (can proceed immediately).

---

### T5 — Frontend LoginPage FORBIDDEN UX branch

**Batch:** C · **Depends on:** F05 T10 (LoginPage exists) · **Parallel with:** T4

**Description:** Specialize the frontend error display for the FORBIDDEN case (D8). Today `LoginPage.tsx:31-33` surfaces `err.message` generically. F06 adds a branch: if `err instanceof ApiClientError && err.code === 'FORBIDDEN'`, show a distinct "workspace not allowed" message (longer, actionable — "contact your workspace admin"); other errors fall through to the existing `err.message` display.

Create / Modify:

- **`frontend/src/pages/LoginPage.tsx`** (MODIFY). Add FORBIDDEN branch.

  Current `:31-33`:
  ```tsx
  } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Login failed');
  }
  ```

  F06 change — branch on `err.code`:
  ```tsx
  } catch (err) {
      if (err instanceof ApiClientError) {
          if (err.code === 'FORBIDDEN') {
              // F06 D8: domain restriction. Specialized message — actionable for the user.
              setError(
                  'Your Google account is not in the allowed workspace. ' +
                  'Sign in with your workspace email or contact your administrator.',
              );
          } else {
              setError(err.message);
          }
      } else {
          setError('Login failed');
      }
  }
  ```

  Notes: (a) `ApiClientError.code` is typed `ErrorCodeValue | 'NETWORK_ERROR'` (`frontend/src/api/client.ts`) — `=== 'FORBIDDEN'` is a valid narrowing. (b) The specialized message is distinct from the backend's `err.message` ('Your Google account is not in the allowed workspace') — frontend adds the actionable suffix. (c) No new component, no new state — the existing `error` state + `role="alert"` `<p>` renders the message. (d) Other error codes (UNAUTHENTICATED for unverified email, INTERNAL_ERROR for Google exchange failure, VALIDATION_FAILED for bad code body) fall through to `err.message` (which is the backend's human-readable message). (e) Tailwind class unchanged (`text-red-600`) — no new design token (F28 may add `--color-danger`).

- **`frontend/src/pages/LoginPage.test.tsx`** (MODIFY — add FORBIDDEN scenario). Scenario names:

  - **shows specialized workspace message on FORBIDDEN** — mock `loginWithGoogle` to reject with `new ApiClientError('Your Google account is not in the allowed workspace', 403, 'FORBIDDEN')`; trigger login; assert the `role="alert"` element contains 'Your Google account is not in the allowed workspace. Sign in with your workspace email'.
  - **shows generic message on UNAUTHENTICATED (unverified email)** — mock reject with `ApiClientError('Email not verified by Google', 401, 'UNAUTHENTICATED')`; assert the alert shows 'Email not verified by Google' (NOT the specialized workspace message).
  - **shows generic message on INTERNAL_ERROR** — mock reject with `ApiClientError('Authentication failed', 500, 'INTERNAL_ERROR')`; assert the alert shows 'Authentication failed'.
  - **shows 'Login failed' on non-ApiClientError** — mock reject with `new Error('network')`; assert alert shows 'Login failed'.
  - **Existing scenarios still pass** (regression) — renders Sign in button; calls loginWithGoogle with code; sets user + navigates on success; respects `from` location state; shows error on GIS onError.

  Notes: `ApiClientError` constructor signature is `(message, status, code, details?)` per `frontend/src/api/client.ts`. Import it in the test: `import { ApiClientError } from '@/api/client';`. The FORBIDDEN assertion uses a substring match (Testing Library `getByRole('alert')` + `toHaveTextContent(/workspace email/i)`).

**Acceptance Criteria:**
- [ ] `LoginPage` branches on `err.code === 'FORBIDDEN'` → specialized workspace message.
- [ ] Other `ApiClientError` codes fall through to `err.message`.
- [ ] Non-`ApiClientError` falls through to 'Login failed'.
- [ ] All 4 new + existing regression scenarios above pass.
- [ ] `npm run typecheck -w frontend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** F05 T10 (LoginPage skeleton). Does NOT depend on T3 (backend) — tests mock the API client. Manual smoke (T6) needs T3 live.

---

### T6 — Integration verification & sign-off

**Batch:** D (terminal) · **Depends on:** T3, T5 · **Parallel with:** —

**Description:** The final definition-of-done gate. Run every tool against the as-merged feature, exercise the F06-specific behaviors via curl, verify the partial unique index is live, fill the integration record in §7. This task owns no files — it's pure verification + documentation.

**Steps:**

1. **Clean tree check:**
   ```bash
   git status  # clean — all F06 commits on main
   git log --oneline | grep SLYK-F06  # list F06 commits
   ```

2. **Lint + format + typecheck + test (all workspaces):**
   ```bash
   npm run lint
   npm run format:check
   npm run typecheck
   npm test -ws
   ```
   All exit 0. Note any F02 pre-existing `db.test.ts` Postgres auth failures (F05 §7 documents these as non-regressions; F06 adds no new DB-touching unit tests that would compound — the migration is verified via `\di` in step 5).

3. **Build both workspaces:**
   ```bash
   npm run build -w backend
   npm run build -w frontend
   ```

4. **Apply the migration against a live Postgres:**
   ```bash
   docker compose up -d  # Postgres
   npm run db:migrate -w backend
   psql "$DATABASE_URL" -c '\di users_one_admin'
   ```
   Expect: `users_one_admin` index exists, defined as `btree (role) WHERE role = 'ADMIN'`, UNIQUE. Paste the `\di` output into the integration record.

5. **Partial unique index live check** (manual SQL):
   ```bash
   psql "$DATABASE_URL" -c "INSERT INTO \"Users\" (google_id, email, full_name, role) VALUES ('a', 'a@x.com', 'A', 'ADMIN');"
   psql "$DATABASE_URL" -c "INSERT INTO \"Users\" (google_id, email, full_name, role) VALUES ('b', 'b@x.com', 'B', 'ADMIN');"  # should FAIL
   ```
   Expect: second insert fails with `ERROR: duplicate key value violates unique constraint "users_one_admin"`. Paste the error into the integration record. Clean up: `TRUNCATE "Users" RESTART IDENTITY CASCADE;`

6. **First-admin promotion smoke (unseeded DB):**
   ```bash
   docker compose down -v && docker compose up -d  # fresh Postgres
   npm run db:migrate -w backend  # apply 0000 + 0001
   # DO NOT seed — leave Users empty
   npm run dev:api
   curl -X POST http://localhost:3000/api/auth/google \
     -H 'Content-Type: application/json' \
     -d '{"code": "<real-google-auth-code>"}'
   ```
   Expect: `200`, `body.data.user.role === 'ADMIN'` (first-user promotion worked). Paste the response into the integration record. **Requires a live Google OAuth code** (follow F05 T13 step 1-4 to obtain via the GIS popup). If live Google smoke is blocked, skip this step and note it as pending (mirrors F05 T13/T14 pending status).

7. **Subsequent-user MEMBER smoke (after first admin exists):**
   - Repeat step 6 with a DIFFERENT Google account (different `googleId`).
   - Expect: `200`, `body.data.user.role === 'MEMBER'`.

8. **Domain restriction smoke (ALLOWED_DOMAIN set):**
   - Set `ALLOWED_DOMAIN=<your-gsuite-domain>` in `backend/.env`.
   - Restart `npm run dev:api`.
   - Sign in with a Google account whose email is NOT in the allowed domain.
   - Expect: `403`, `body.error.code === 'FORBIDDEN'`, `body.error.message === 'Your Google account is not in the allowed workspace'`.
   - Sign in with a Google account in the allowed domain.
   - Expect: `200` (allowed).

9. **Verified-email smoke (manual — Google does not normally return unverified emails for G-Suite, so this is a negative-test via mock):**
   - This step is verified via the T1 unit test (googleOAuth.test.ts "throws UNAUTHENTICATED when email_verified is false"). Manual reproduction requires a Google account with an unverified email, which is atypical. Document the unit test as the authoritative proof.

10. **`/me` re-fetch smoke:**
    - Sign in (any user) → capture the JWT.
    - Directly mutate the DB: `psql -c "UPDATE \"Users\" SET role='ADMIN' WHERE email='...';"` (simulate a role change).
    - `curl -H "Authorization: Bearer <jwt>" http://localhost:3000/api/auth/me`.
    - Expect: `200`, `body.data.user.role === 'ADMIN'` (DB-fresh, NOT the JWT's stale role). Paste the response into the integration record.
    - Clean up: revert the DB change.

11. **Frontend FORBIDDEN UX smoke:**
    - Set `ALLOWED_DOMAIN=allowed.com` (a domain no test account belongs to).
    - Open `http://localhost:5173` → click "Sign in with Google" → pick any Google account.
    - Expect: the `role="alert"` `<p>` shows the specialized message ("Your Google account is not in the allowed workspace. Sign in with your workspace email or contact your administrator."). Screenshot into the integration record.

12. **Env example completeness:**
    - `backend/.env.example` has the expanded `ALLOWED_DOMAIN` comment (T4).
    - No real secrets committed.

13. **Error code vocabulary unchanged:**
    - `backend/src/utils/envelope.ts:5-12` still lists exactly the 6 F03 codes. F06 uses `FORBIDDEN` (403, first app-level use) + `UNAUTHENTICATED` (401, for unverified email). No new codes added.

14. **Schema delta verified:**
    - `backend/src/db/schema.ts` has the `usersOneAdminIndex` declaration.
    - `backend/src/db/migrations/0001_*.sql` committed + applied.
    - `\di users_one_admin` confirms the live index.

15. **Fill the integration record** in §7 with commit SHAs, curl outputs, `\di` output, screenshots, lint/format/typecheck/test exit codes.

**Acceptance Criteria:**
- [ ] `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test -ws` all exit 0.
- [ ] `npm run build -w backend` + `-w frontend` produce `dist/`.
- [ ] Migration `0001_*.sql` applied; `\di users_one_admin` confirms the live partial unique index.
- [ ] Direct SQL insert of a second ADMIN row fails with `23505` (index is the hard guarantee).
- [ ] First-user promotion smoke: `role: 'ADMIN'` returned (or noted pending if live Google blocked).
- [ ] Subsequent-user smoke: `role: 'MEMBER'` returned (or noted pending).
- [ ] Domain restriction smoke: `403 FORBIDDEN` on mismatch (or noted pending).
- [ ] `/me` re-fetch smoke: DB-fresh role returned.
- [ ] Frontend FORBIDDEN UX smoke: specialized message rendered (screenshot captured).
- [ ] `backend/.env.example` doc complete (T4).
- [ ] Error code vocabulary unchanged (6 F03 codes).
- [ ] §7 integration record filled.

**Dependencies:** T3 (backend live), T5 (frontend live). T4 (docs) recommended but not blocking.

---

## 7. Final F06 Acceptance Checklist

- [ ] **Email domain checked against `ALLOWED_DOMAIN` when set; mismatch → 403 with clear message.** `accessControl.ts` (T1, D3+D6+D13) exports `assertDomainAllowed(email)` which no-ops when `env.allowedDomain` is unset, else normalizes both sides (trim + lastIndexOf + lowercase) and throws `AppError(FORBIDDEN, 'Your Google account is not in the allowed workspace')`. Wired into `POST /api/auth/google` between exchange and upsert (T3). Verified via T6 step 8 (domain restriction smoke). (Acceptance bullet 1.)
- [ ] **Empty `Users` table → first signup becomes `ADMIN` atomically.** `userService.ts` (T2, D1+D12) runs `db.transaction` with a counted query (`tx.select({rowCount: count()}).from(users)`) — `count === 0` → role 'ADMIN'. Race-safe via the `users_one_admin` partial unique index (T2 schema + migration) + app-layer 23505 retry as MEMBER. Verified via T6 step 5 (direct SQL second-admin fails) + step 6 (first signup returns ADMIN). (Acceptance bullet 2 + edge case 1.)
- [ ] **Subsequent signups → `MEMBER`.** Same transactional count — `count > 0` → role 'MEMBER'. Verified via T6 step 7. (Acceptance bullet 3.)
- [ ] **Role persisted on the `Users` row and carried in the JWT.** Schema column `role` (F05, `schema.ts:14`) is the persistence; `signJwt({sub, email, role})` (F05, `jwt.ts:14,18`) is the claim. F06 ensures the correct role is set before sign (T2's transactional insert + T3's `/me` re-fetch). (Acceptance bullet 4.)
- [ ] **Domain check runs on the verified Google email (not a raw claim).** `googleOAuth.ts` (T1, D2) asserts `payload.email_verified === true` before returning `GoogleUserInfo`; failure → `AppError(UNAUTHENTICATED, 'Email not verified by Google')`. `accessControl.ts` then trusts `info.email` unconditionally. (Edge case 3.)
- [ ] **`/me` reflects DB-authoritative role.** `auth.routes.ts` (T3, D4) calls `findUserById(req.user.id)` instead of re-signing from JWT-sourced `req.user`. Verified via T6 step 10. Token invalidation for mid-session role changes flagged for F07.
- [ ] **Race-safe first-admin (edge case 1).** Partial unique index `users_one_admin` + transactional count + 23505 retry (T2). Verified via T6 step 5.
- [ ] **Dev-seed caveat documented (edge case).** T4 documents that seeded DBs suppress first-admin promotion (count > 0); unseeded DB required to test promotion. (Cross-cutting.)
- [ ] **Whitelist explicitly deferred to F25 (scope boundary).** F06 ships ONLY `ALLOWED_DOMAIN` enforcement. No `whitelisted` column, no `AllowedEmails` table, no whitelist endpoints. (D10.)
- [ ] **Frontend FORBIDDEN UX message.** `LoginPage.tsx` (T5, D8) branches on `err.code === 'FORBIDDEN'` → specialized "workspace not allowed" message. Verified via T6 step 11.
- [ ] **No new error codes.** F03's 6-code vocabulary unchanged. F06 uses `FORBIDDEN` (403, first app-level use) + `UNAUTHENTICATED` (401, for unverified email). (D7.)
- [ ] **Schema delta: `users_one_admin` partial unique index.** `schema.ts` declaration + `0001_*.sql` migration committed + applied. (D1, D11, §8.)
- [ ] **Keep `pgEnum('Role')` (D5).** No TEXT+CHECK migration churn. Documented as future-hardening.
- [ ] **`requireRole('ADMIN')` middleware NOT added (scope).** Role is on JWT + `req.user`; downstream gating is F07/F17/F25.
- [ ] Lint + format checks pass on an empty change.
- [ ] Typecheck + tests pass (`npm run typecheck && npm test -ws` exit 0; F02 pre-existing `db.test.ts` failures noted as non-F06).
- [ ] `npm run build -w backend` + `-w frontend` produce `dist/`.
- [ ] Commits land on `main` as `SLYK-F06: <msg>` (single-line); rebase-and-merge only (no squash, no merge commits) per `git-guidelines.md`.
- [ ] `.gitignore` retains `node_modules/`, `.env`, `dist/`, `build/`, `*.log`, `.DS_Store` (no F06 change).
- [ ] Security mandates: no `console.log` in prod, no raw SQL (Drizzle query builder), no secrets in code (all via `env.*`), CORS locked to `FRONTEND_URL`, `Bearer` enforced on `/me`, domain check server-side (verified email), `JWT_SECRET` ≥32 chars (F05).

**Integration record (fill during T6):**
- Feature commit SHAs: `________` (list all `SLYK-F06:` commits)
- `\di users_one_admin` output: `________`
- Direct SQL second-admin insert error (`23505`): `________`
- First-user promotion response (HTTP 200 body, role field): `________` (or "pending live Google smoke")
- Subsequent-user response (role field): `________` (or "pending")
- Domain-restriction curl output (`403 FORBIDDEN`): `________` (or "pending")
- `/me` re-fetch response (DB-fresh role after SQL update): `________`
- Frontend FORBIDDEN UX screenshot path: `________`
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0` (F02 `db.test.ts` failures noted: ___ of ___)
- `npm run build -w backend` exit code + `dist/` produced: `________`
- `npm run build -w frontend` exit code + `dist/` produced: `________`
- Migration `0001_*.sql` applied + committed: `________`

**Out-of-scope caveats (carried forward to F07/F25):**
- Manual email whitelist / blocklist → **F25** (Whitelist management). F06 ships ONLY `ALLOWED_DOMAIN`.
- `requireRole('ADMIN')` middleware + role-gated UI → **F07 / F17 / F25**.
- Token invalidation (`token_version` / `ver` claim + middleware compare) for mid-session role changes → **F07**. F06's single-admin model has no live-token role transition (first-user promotion happens at insert, before any token exists).
- Retroactive domain eviction → **owner sign-off pending** (D9 recommends grandfather).
- TEXT+CHECK role enum migration → **future hardening** (F06 keeps pgEnum per D5).

---

## 8. Schema deltas owned by this feature

**One schema delta: the `users_one_admin` partial unique index** — the race-safe first-admin guard (D1). The `users` table itself is unchanged from F02/F05; F06 adds only the index.

| Delta | Detail | Migration |
| --- | --- | --- |
| `users_one_admin` | Partial UNIQUE btree index on `Users.role` WHERE `role = 'ADMIN'`. Enforces at-most-one ADMIN row at the DB level (race-safe first-admin guarantee). Declared in `schema.ts` via `uniqueIndex('users_one_admin').on(table.role).where(eq(table.role, 'ADMIN'))`; generated by `drizzle-kit generate` into `backend/src/db/migrations/0001_<auto>.sql`. | `CREATE UNIQUE INDEX IF NOT EXISTS "users_one_admin" ON "Users" USING btree ("role") WHERE "role" = 'ADMIN';` |

**Drizzle schema declaration** (`backend/src/db/schema.ts`, T2):

```typescript
import { pgTable, uuid, text, timestamp, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';

// ...existing roleEnum + users table columns...

export const users = pgTable(
  'Users',
  {
    // ...existing columns unchanged...
  },
  (table) => ({
    usersOneAdminIdx: uniqueIndex('users_one_admin')
      .on(table.role)
      .where(eq(table.role, 'ADMIN')),
  }),
);
```

**Generated SQL** (`backend/src/db/migrations/0001_<auto-name>.sql`, produced by `npm run db:generate -w backend`):

```sql
-- F06 D1: race-safe first-admin guard. At most ONE row may have role='ADMIN'.
CREATE UNIQUE INDEX IF NOT EXISTS "users_one_admin"
  ON "Users" USING btree ("role")
  WHERE "role" = 'ADMIN';
```

**Application:** `npm run db:migrate -w backend` (runs `tsx src/db/migrate.ts` which invokes `drizzle-orm/node-postgres/migrator.migrate` against `migrationsFolder: './src/db/migrations'`). Verified via `\di users_one_admin` in psql (T6 step 4).

**Arbiter note (Hidden coupling):** PostgreSQL's `INSERT ... ON CONFLICT DO UPDATE` matches this index as an arbiter ONLY if the `conflict_target` includes the partial predicate (`ON CONFLICT (role) WHERE role='ADMIN'`). F06 does NOT use ON CONFLICT for the first-admin insert — it uses a transactional count + plain insert + app-layer 23505 retry (T2). This avoids the partial-index-arbiter fragility (SO 46727740; Hasura #3666). Future features that want declarative upsert against this index must include the predicate.

---

## 9. Cross-cutting decisions needing owner sign-off

The following are irreversible or cross-cutting choices that F06 cannot silently pick. Surfaced here for explicit owner approval BEFORE T1/T2 merge. The recommended default is non-binding until the owner confirms.

### (a) Domain-change-over-time: grandfather vs block-on-next-login

- **Question:** When `ALLOWED_DOMAIN` is tightened (e.g. `example.com` → `corp.example.com`), what happens to existing users whose email is now outside the new domain?
- **F06 recommended default: GRANDFATHER.** The domain check runs ONLY on the insert path (new signup). The conflict path (existing `googleId`) skips the domain gate, so current members are not locked out when the env var tightens. Rationale:
  - PRD §REQ-1.2 reads as onboarding-time ("Users must belong to the permitted G-Suite workspace") — not retroactive eviction.
  - Retroactive eviction is destructive; the right tool is an admin-driven blocklist (F25).
  - The alternative (block-on-next-login) is reversible by reverting the env var, but it disrupts currently-logged-in users mid-session and breaks the "stateless JWT" assumption (a valid JWT suddenly fails).
- **If owner picks BLOCK-ON-NEXT-LOGIN:** add `assertDomainAllowed(info.email)` to the conflict path in `upsertByGoogleId` (T2) — runs before the profile refresh. Document the behavior in `.env.example` (T4).
- **Status: PENDING SIGN-OFF.** T1/T2/T3 proceed with the grandfather default; if owner later picks block, T2 adds one line.

### (b) Whitelist scope: confirm deferral to F25 is acceptable

- **Question:** F06 ships ONLY `ALLOWED_DOMAIN` enforcement. Manual email whitelist (allow/block specific emails regardless of domain) is deferred to F25. Is this acceptable?
- **F06 recommended default: DEFER (Option A).** Rationale:
  - PRD §REQ-1.2 mentions "manually whitelisted by an Admin" but provides NO schema, endpoint, or rule for the whitelist mechanism.
  - `features.md` F25 (Phase 7) explicitly owns "Whitelist management allow/block specific emails regardless of domain" and lists F06 as its only dependency.
  - Adding a `whitelisted` column or `AllowedEmails` table now creates schema churn F25 may redesign (e.g. F25 may want `role_override` per whitelisted email — research D-6).
  - Minimal risk: `ALLOWED_DOMAIN` covers the primary G-Suite-restriction use case; manual whitelist is a power-user feature.
- **If owner wants WHITELIST NOW (Option B):** this becomes a much larger feature — new schema (`AllowedEmails` table or `users.whitelisted` column), new admin endpoints (`POST /api/admin/whitelist`, `DELETE /api/admin/whitelist/:email`), new admin UI (F17 dependency), normalization shared between domain check + whitelist lookup. Recommend splitting into F06b.
- **Status: PENDING SIGN-OFF (confirm Option A acceptable).** T1-T6 proceed with Option A.

### (c) Token invalidation / `token_version` deferral to F07

- **Question:** When a user's role changes mid-session (e.g. an admin demotes them via F25), their existing JWT still carries the old role until expiry (8h). Is this acceptable for F06?
- **F06 recommended default: ACCEPTABLE — defer `token_version` to F07.** Rationale:
  - F06's only role transition is the first-user promotion (MEMBER → ADMIN at insert time). This happens BEFORE any JWT exists for that user — there is no stale token to invalidate.
  - Multi-admin demotion (the scenario that needs `token_version`) is introduced by F25, not F06.
  - F06's `/me` re-fetch (D4) mitigates the symptom: a client that calls `/me` gets the DB-fresh role + a freshly-signed JWT. The stale-token window is bounded by (a) JWT TTL (8h) and (b) how often the client calls `/me`.
  - `token_version` column + `ver` JWT claim + middleware compare is the proper fix (research D-4: SO 21978658; Curity JWT best practices) — but it's session-lifecycle work owned by F07.
- **If owner wants `token_version` NOW:** add `users.tokenVersion int default 0 notNull` (schema delta), add `ver` to `JwtUserClaims`, bump `tokenVersion` on role change, `authenticate` middleware compares JWT `ver` to DB `tokenVersion` → 401 if mismatch. This is ~3 tasks of work — recommend splitting into F06c or pulling F07 forward.
- **Status: PENDING SIGN-OFF (confirm deferral to F07 acceptable for F06).** T1-T6 proceed without `token_version`.

---

**End of F06 task breakdown.**
