# Implementation Verification Report — F06

**Source:** [`F06-onboarding-workspace-roles-tasks.md`](./F06-onboarding-workspace-roles-tasks.md)
**Verified:** 2026-06-22
**Branch:** `feature/SLYK-F06-onboarding-workspace-roles`
**Method:** 3 parallel read-only subagents (backend / frontend / docs+cross-cutting) + orchestrator live gates + live Postgres index/D1 check.
**Total Tasks:** 6 · **Implemented:** 5 (T1-T5) · **Partial:** 1 (T6 — automated gates pass, live-Google smoke pending owner)

---

## Summary

| Status | Count | Tasks |
|--------|-------|-------|
| ✅ Implemented | 5 | T1, T2, T3, T4, T5 |
| ⚠️ Partial | 1 | T6 (automated verification ✅; live Google OAuth smoke pending owner — mirrors F05 T13/T14) |
| ❌ Missing | 0 | — |
| 🔄 Modified | 0 | — |

**Headline:** Implementation layer (T1-T5) is complete, spec-faithful, and verified passing. Scope boundaries (closed error vocab, 2-value role enum, no whitelist, no `requireRole`, no `token_version`) all intact — zero scope violations. T6's automated gates (typecheck/lint/format/test/build + migration apply + partial-index D1 check) all PASS; the remaining T6 items require a live Google OAuth code + interactive browser and are deferred to the owner.

---

## Task-by-Task Results

| Task | Status | Files | Tests |
|------|--------|-------|-------|
| **T1** accessControl + email_verified gate | ✅ | `accessControl.ts` (NEW), `accessControl.test.ts` (NEW), `googleOAuth.ts` (MOD), `googleOAuth.test.ts` (MOD) | 10 + 10 PASS |
| **T2** first-admin logic + partial unique index | ✅ | `schema.ts` (MOD), `0001_oval_captain_britain.sql` (NEW), `userService.ts` (MOD), `userService.test.ts` (MOD) | 9 PASS |
| **T3** route wiring (domain gate + /me re-fetch) | ✅ | `auth.routes.ts` (MOD), `auth.routes.test.ts` (MOD) | 13 PASS |
| **T4** docs (env doc + decisions record) | ✅ | `backend/.env.example` (MOD), `decisions.md` (NEW) | n/a (docs) |
| **T5** frontend FORBIDDEN UX branch | ✅ | `LoginPage.tsx` (MOD), `LoginPage.test.tsx` (MOD) | 10 PASS |
| **T6** integration verification & sign-off | ⚠️ | (no files) | automated gates ✅; live Google smoke pending |

---

## Detailed Gap Analysis

### Backend (T1, T2, T3) — ✅ no gaps

Verified by independent subagent with file:line evidence + live test/typecheck runs.

- **T1** `accessControl.ts:9-29` exports `normalizeEmailDomain` (trim + `lastIndexOf('@')` + lowercase, `''` on malformed/trailing-`@`) + `assertDomainAllowed` (no-op when `env.allowedDomain` unset per D13; exact case-insensitive domain match, no subdomain wildcard; first app-level use of `ErrorCode.FORBIDDEN` with the exact message). `googleOAuth.ts:31-33` asserts `payload.email_verified === true` → `AppError(UNAUTHENTICATED, 'Email not verified by Google')`; catch restructured at `:42` to re-throw `AppError` as-is (`if (cause instanceof AppError) throw cause;`) before the generic `INTERNAL_ERROR` wrap. Tests: 10 accessControl (table-driven) + 10 googleOAuth (incl. 2 new `email_verified` false/undefined + happy-path `true` added to existing mocks). All 20 PASS.
- **T2** `schema.ts:26-29` declares `usersOneAdminIdx` via table-config callback (`uniqueIndex('users_one_admin').on(table.role).where(eq(table.role, 'ADMIN'))`); `eq` from `drizzle-orm`, `uniqueIndex` from `drizzle-orm/pg-core` (import-fix note respected). `0001_oval_captain_britain.sql:6` = literal `CREATE UNIQUE INDEX IF NOT EXISTS "users_one_admin" ON "Users" USING btree ("role") WHERE "role" = 'ADMIN';` — **hand-reconciled from drizzle-kit 0.31's broken `= $1` enum form** (documented inline `:1-5`); matches §8 verbatim and is the only apply-able expression. `userService.ts:19-69` transactional upsert: conflict-on-googleId refreshes profile preserving `role`+`id` (no `role`/`id` in `.set()`); insert path counts inside the txn (`tx.select({rowCount: count()}).from(users)`, `count()` from `drizzle-orm` not `db.$count`) → `0` ADMIN else MEMBER; catches `23505` → single retry (`retryAsMemberOrRefresh`, `:71-107`); non-23505 re-thrown. `findUserById(id)` exported (`:110-113`), `UserRow | undefined`. Tests: 9 scenarios incl. 23505→retry-MEMBER, 23505→googleId-refresh, rethrow-non-23505, findUserById found/undefined. All 9 PASS.
- **T3** `auth.routes.ts:20-25` wires `assertDomainAllowed(info.email)` exactly between `exchangeCodeForUser` (`:20`) and `upsertByGoogleId` (`:25`). `/me` (`:46-64`) re-fetches via `findUserById(req.user!.id)`, throws `AppError(UNAUTHENTICATED, 'User no longer exists')` when absent, re-signs with DB-fresh `user.role`, returns the **FULL row** `{id,email,fullName,avatarUrl,role}` (spec decision (i) at tasks.md:680 — preserves F05 `AuthResponseUser` contract). Tests: 6 new F06 scenarios (ADMIN-on-allowed, 403-FORBIDDEN-mismatch w/ upsert-not-called, allow-all, 401-unverified-email short-circuit, /me DB-fresh JWT-MEMBER→DB-ADMIN, /me user-not-found 401) + 7 regressions. All 13 PASS.

### Frontend (T5) — ✅ no gaps

- `LoginPage.tsx:31-45` branches on `err.code === 'FORBIDDEN'` → specialized message "Your Google account is not in the allowed workspace. Sign in with your workspace email or contact your administrator."; other `ApiClientError` → `err.message`; non-`ApiClientError` → `'Login failed'`. `role="alert"` `text-red-600` rendering unchanged. Tests: 4 new (FORBIDDEN specialized, UNAUTHENTICATED generic, INTERNAL_ERROR generic, non-ApiClientError) + 6 regressions. **10/10 PASS.**

### Docs + Cross-cutting (T4 + §7 + scope) — ✅ no gaps, zero scope violations

- **T4** `backend/.env.example:15-20` ALLOWED_DOMAIN comment expanded (verified-email-at-signup, RFC 5321 case-insensitive, EXACT subdomain match, grandfather semantics, F25 deferral); value still empty. `decisions.md` (381 lines) documents D1-D13 + 3 §9 sign-off items + seed/first-admin dev caveat.
- **Error vocab unchanged** — `envelope.ts:5-12` still exactly the 6 F03 codes; F06 reuses `FORBIDDEN` (403) + `UNAUTHENTICATED` (401); no seventh code.
- **pgEnum kept (D5)** — `schema.ts:5` `pgEnum('Role', ['ADMIN','MEMBER'])`; no `VIEWER`, no TEXT+CHECK churn.
- **No whitelist (D10)** — grep `whitelisted|AllowedEmails|allowlist|blocklist` → no matches; no column/table/endpoints.
- **No `requireRole`** — grep `requireRole` → no matches; role on JWT claim + `req.user` only.
- **No `token_version` / `ver`** — `JwtUserClaims` = `{sub,email,role}`; no column; deferred to F07.
- **`.gitignore`** retains `node_modules/`, `.env`, `dist/`, `build/`, `*.log`, `.DS_Store`.

---

## T6 — Automated Verification Results (PASS)

| Gate | Command | Result |
|------|---------|--------|
| Typecheck (both ws) | `npm run typecheck` | ✅ exit 0 |
| Lint | `npm run lint` (`eslint .`) | ✅ exit 0 |
| Format | `npm run format:check` | ✅ "All matched files use Prettier code style!" |
| Backend tests (F06 files) | `vitest run` accessControl+googleOAuth+userService+auth.routes | ✅ 42/42 |
| Frontend tests | `npm test -w frontend` | ✅ 49/49 |
| LoginPage tests | `vitest run LoginPage.test.tsx` | ✅ 10/10 |
| Build backend | `npm run build -w backend` | ✅ `dist/` produced |
| Build frontend | `npm run build -w frontend` | ✅ `dist/` produced (index.html + assets) |
| Migration apply | `npm run db:migrate -w backend` (cattle-test-pg) | ✅ "migrations applied successfully" |
| Live index check | `\di users_one_admin` | ✅ index exists on `Users` |
| **D1 guarantee (live)** | 2nd ADMIN insert | ✅ **FAILS `23505`: `duplicate key value violates unique constraint "users_one_admin"`** |

**Pre-existing non-regression:** `backend/src/db/db.test.ts` fails with PG `28P01` ("password authentication failed for user test") — documented in F05 §7; not F06-related (needs a live Postgres with a `test` role). Excluded from the F06 test runs above.

### T6 items PENDING owner (require live Google OAuth code + interactive browser)

Mirrors F05 T13/T14 pending status. These cannot run headless:

- Step 6 — First-admin promotion smoke (unseeded DB, real Google code) → expect `role: 'ADMIN'`.
- Step 7 — Subsequent-user smoke (different Google account) → expect `role: 'MEMBER'`.
- Step 8 — Domain restriction smoke (`ALLOWED_DOMAIN` set) → expect `403 FORBIDDEN` on mismatch.
- Step 10 — `/me` re-fetch smoke (DB role mutation) → expect DB-fresh role.
- Step 11 — Frontend FORBIDDEN UX screenshot.
- Step 9 (verified-email) — covered authoritatively by the T1 unit test; manual repro atypical.

The unit-test layer fully covers these behaviors; the pending items are end-to-end smokes against real Google, not logic gaps.

---

## Integration Record (T6 §15)

- **Feature commit SHAs:**
  - `439862b` SLYK-F06: Add accessControl domain gate + email_verified assertion (T1)
  - `6e7e262` SLYK-F06: Race-safe first-admin upsert + users_one_admin partial index (T2)
  - `e615f8a` SLYK-F06: Wire domain gate + DB-authoritative /me into auth routes (T3)
  - `a055412` SLYK-F06: Document ALLOWED_DOMAIN semantics + decisions record (T4)
  - `db62db8` SLYK-F06: Specialize LoginPage error UX for FORBIDDEN workspace gate (T5)
- **`\di users_one_admin`:** `public | users_one_admin | index | user | Users`
- **Direct SQL 2nd-ADMIN insert error (23505):** `ERROR: duplicate key value violates unique constraint "users_one_admin"  DETAIL:  Key (role)=(ADMIN) already exists.` — 1st ADMIN + MEMBER inserts succeed.
- **First-user promotion response:** pending live Google smoke (unit-tested: `userService.test.ts` first-user→ADMIN).
- **Subsequent-user response:** pending (unit-tested: subsequent→MEMBER).
- **Domain-restriction curl (403 FORBIDDEN):** pending (unit-tested: `auth.routes.test.ts` 403 mismatch).
- **`/me` re-fetch response (DB-fresh role):** pending live (unit-tested: `/me` DB-MEMBER-claim→DB-ADMIN).
- **Frontend FORBIDDEN UX screenshot:** pending.
- **Lint / format / typecheck / test exit codes:** `0 / 0 / 0 / 0` (F06 files; F02 `db.test.ts` PG-auth failure noted: pre-existing non-regression).
- **`npm run build -w backend`:** exit 0, `dist/` produced.
- **`npm run build -w frontend`:** exit 0, `dist/` produced.
- **Migration `0001_oval_captain_britain.sql`:** applied + committed.

---

## Owner Sign-off Items (§9 — pending, not defects)

The code ships the recommended defaults; these are owner-approval items to resolve before F07/F25 consume F06:

1. **D9 — grandfather vs block-on-next-login.** Default shipped: grandfather (domain check on insert path only). If owner picks block-on-next-login, add `assertDomainAllowed` to the conflict path in `upsertByGoogleId`.
2. **Whitelist deferral to F25 (Option A).** F06 ships `ALLOWED_DOMAIN` only.
3. **`token_version` deferral to F07.** F06's single-admin model has no live-token role transition.

---

## Quick Reference: Task Status

```
T1: ✅ Implemented  (accessControl + email_verified gate)
T2: ✅ Implemented  (first-admin upsert + users_one_admin index)
T3: ✅ Implemented  (route wiring: domain gate + /me re-fetch)
T4: ✅ Implemented  (docs: env doc + decisions record)
T5: ✅ Implemented  (frontend FORBIDDEN UX branch)
T6: ⚠️ Partial     (automated gates ✅; live Google smoke + §9 sign-offs pending owner)
```

**Verdict:** F06 implementation is complete and verified at the unit + automated-integration level. Pending items are live-Google end-to-end smoke (owner) + three §9 owner sign-offs — consistent with the F05 precedent. Recommend marking F06 `[~]` partial in `features.md` until live smoke completes.
