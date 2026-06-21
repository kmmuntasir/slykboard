# F06 — Decisions Record (Onboarding, workspace restriction & roles)

> **Purpose:** Single source of truth for *why* F06 picked each design choice. Read this
> before changing any F06 behavior. Mirrors §3 (D1-D13) + §9 (owner sign-off) of
> [F06-onboarding-workspace-roles-tasks.md](./F06-onboarding-workspace-roles-tasks.md) in a
> standalone, human-readable form. Future owners — especially **F07** (Session lifecycle) and
> **F25** (Whitelist management) — start here.
>
> **Status key:** ✅ binding · ⏳ pending owner sign-off (recommended default documented; see §9).
>
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), `.claude/rules/*.md`, F05 task doc, external research cited per decision.

---

## D1 — Race-safe first-admin promotion ✅

**Choice:** Two-layer guard.

1. **DB arbiter** — partial unique index `users_one_admin ON users(role) WHERE role='ADMIN'`.
   The database itself refuses a second ADMIN row regardless of concurrency.
2. **App path** — transactional count-then-insert inside `upsertByGoogleId`:
   `db.transaction(async (tx) => { count users in txn → role = count === 0 ? 'ADMIN' : 'MEMBER' → insert })`.
   On `23505` (unique_violation) caught at the app layer, retry once as `MEMBER`.

The index is the hard guarantee; the count minimizes contention.

**Rationale:** A plain `COUNT` + branch is the documented anti-pattern — two concurrent first-signups
can both observe `count === 0` and both insert `ADMIN`. Only a DB-level constraint closes the window.
The partial unique index is the cleanest declarative form (it constrains only the `ADMIN` rows, leaving
unbounded `MEMBER` growth). The app-layer `23505` retry is the backstop for the rare race the index
catches — it converts the losing request to `MEMBER`.

**Cite:** PostgreSQL partial-indexes §11.8; Stack Overflow 46727740 (ON CONFLICT vs partial index);
Hasura #3666; DbVisualizer upsert guide.

**See also:** D11 (Drizzle declaration), D12 (count-in-transaction), §8 (schema delta).

---

## D2 — Verified-email gate ✅

**Choice:** Assert `payload.email_verified === true` inside `exchangeCodeForUser`
(`backend/src/services/googleOAuth.ts`) BEFORE returning `GoogleUserInfo` — i.e. before the domain
check runs. On absent or `!== true`, throw `AppError(UNAUTHENTICATED, 'Email not verified by Google')`.
The catch is restructured so an `AppError` propagates as-is rather than being re-wrapped as
`INTERNAL_ERROR`.

**Rationale:** `email_verified` is the authoritative signal that Google has validated the email.
Domain restriction on an unverified email is a trivial bypass — an attacker controls the `email`
claim in a hand-crafted token, so the gate would enforce against attacker-chosen data. The gate
belongs in `googleOAuth.ts` (it is a property of the Google payload, not workspace policy); once
`GoogleUserInfo.email` is returned, `accessControl.ts` trusts it unconditionally.

`UNAUTHENTICATED` (401), not `FORBIDDEN` (403): the user's identity is not trustworthy, which is an
auth failure, not an access denial. `payload.email_verified` from `google-auth-library` v10 is
`boolean | undefined`; `!== true` covers both `false` and `undefined`.

**Cite:** Google GSI "verify ID token"; `google-auth-library` v10; `googleapis.dev` TokenInfo `email_verified`.

**See also:** D3 (accessControl location), D7 (error-code reuse).

---

## D3 — Domain-check service location ✅

**Choice:** New file `backend/src/services/accessControl.ts` exporting
`normalizeEmailDomain(email)` + `assertDomainAllowed(email)`.

**Rationale:** Single-responsibility per `js-development-rules.md` layering:

- `userService.ts` = persistence.
- `googleOAuth.ts` = Google I/O.
- `accessControl.ts` = policy (domain gate).

Co-locating normalizer + gate here keeps `userService.ts` focused and makes the policy trivially
unit-testable in isolation (mock `env.allowedDomain` only). The route layer imports
`assertDomainAllowed` and calls it between exchange and upsert.

**See also:** D6 (normalization), D13 (empty = allow all).

---

## D4 — `/me` role propagation ✅

**Choice:** `GET /api/auth/me` re-fetches the user DB row via `findUserById(req.user.id)` instead
of re-signing from the JWT-sourced `req.user`. If the row no longer exists →
`AppError(UNAUTHENTICATED, 'User no longer exists')`. Otherwise re-sign a fresh 8h JWT with the
DB-authoritative `role`.

**Rationale:** The `/me` contract is "current user state", so the DB — not the JWT — is the source of
truth. F06's signup path already signs the correct role at first login (no propagation issue there),
but sourcing `/me` from the DB future-proofs against mid-session role changes (e.g. F25 demotion): a
client that calls `/me` gets the fresh role + a fresh JWT. Cheap UX win; no `token_version`
machinery needed for F06 (see sign-off (c)).

**Response shape:** unchanged from F05 — `/me` returns the full row
`{id, email, fullName, avatarUrl, role}` so `AuthResponseUser` (which types all five as required) is
preserved.

**Cite:** Curity "JWT claims best practices" (treat the role claim as a cache, not a source of truth).

**See also:** §9 (c) — token invalidation deferral to F07.

---

## D5 — Keep `pgEnum('Role')` (defer `TEXT + CHECK`) ✅

**Choice:** Do **not** migrate the `role` column to `TEXT + CHECK`. Keep the `pgEnum('Role', ['ADMIN','MEMBER'])`
shipped by F05 in migration `0000`. Add the partial unique index separately (D1).

**Rationale:** 2025-2026 consensus leans `TEXT + CHECK` for evolvable schemas (F25 may add a third
role like `VIEWER`), BUT F05 already shipped `pgEnum` — churning now breaks F05 and adds migration
risk for zero F06 benefit. `TEXT + CHECK` is recorded as future-hardening and deferred to whenever a
third role is actually introduced.

**Cite:** Close Engineering / Crunchy Data / Cybertec consensus on `enum` vs `TEXT + CHECK`.

---

## D6 — Email normalization ✅

**Choice:** `normalizeEmailDomain(email)`:

1. `trim()`
2. `lastIndexOf('@') + 1`
3. `lowercase()` the domain

Compare the normalized user-email domain to the normalized `env.allowedDomain`. The same normalizer
is reused for both — the configured domain is wrapped as `x@${env.allowedDomain}` so the same code
path extracts it. Returns `''` for malformed input (no `@`, or trailing `@`) — the caller treats an
empty user domain as a FORBIDDEN mismatch, never allowing a malformed email to bypass the gate.

**Rationale:** RFC 5321 domain is case-insensitive; the local-part may be case-insensitive (Gmail)
but the **domain after `@` is what F06 gates on**, so lowercasing the domain is correct and sufficient.
`lastIndexOf` (not `indexOf`) defends against malformed multi-`@` addresses (e.g. `a@b@example.com`
correctly yields `example.com`). Normalize at check-time (not config-load) so the config loader stays
dumb and the normalizer is authoritative in one place.

**Cite:** Stack Overflow 10858813; Salesforce "restrict login domains"; authentik whitelist policy.

---

## D7 — Error-code reuse (closed vocab) ✅

**Choice:** Reuse `FORBIDDEN` (403) for domain mismatch and `UNAUTHENTICATED` (401) for the verified-email
failure (D2). Add **no** new error codes.

**Rationale:** The `ErrorCode` set is closed per the F03 D-pattern — adding codes requires owner
sign-off. `FORBIDDEN` already maps to 403 (`backend/src/utils/envelope.ts`) and was tested at F03 but
never thrown by app code; F06 is its first user. `UNAUTHENTICATED` (401) is the correct status for an
unverified identity (not a server fault, not an access denial).

**Cite:** `js-development-rules.md` security section; F05 D7.

---

## D8 — Frontend FORBIDDEN UX ✅

**Choice:** `frontend/src/pages/LoginPage.tsx` branches on `err.code === 'FORBIDDEN'` → a distinct,
actionable message ("Your Google account is not in the allowed workspace. Sign in with your workspace
email or contact your administrator."). Other `ApiClientError` codes fall through to `err.message`;
non-`ApiClientError` falls through to "Login failed".

**Rationale:** Surfacing the raw backend `err.message` for a 403 works but is user-hostile. The
specialized message satisfies the `features.md` "clear message" acceptance and tells the user what to
do. Branching on `err.code` is the documented frontend pattern — `frontend/src/types/api.ts` mirrors
`ErrorCode`, and `ApiClientError.code` carries `FORBIDDEN` through from the API client.

**Cite:** F06 codebase analysis note C (LoginPage can branch on `err.code`).

---

## D9 — Domain-change-over-time: grandfather existing users ⏳

**Choice (recommended default):** **GRANDFATHER.** The domain check runs ONLY on the insert path (new
signup). The conflict path (existing `googleId`) skips the domain gate, so tightening `ALLOWED_DOMAIN`
does NOT lock out current members.

**Rationale:**

- PRD §REQ-1.2 reads as onboarding-time ("Users must belong to the permitted G-Suite workspace") — not
  retroactive eviction.
- Retroactive eviction is destructive; the right tool for it is an admin-driven blocklist (F25).
- The alternative (block-on-next-login) is reversible by reverting the env var, but it disrupts
  currently-logged-in users mid-session and breaks the stateless-JWT assumption (a previously-valid
  JWT suddenly fails).

**If owner picks BLOCK-ON-NEXT-LOGIN:** add `assertDomainAllowed(info.email)` to the conflict path in
`upsertByGoogleId` (T2) before the profile refresh, and update this doc + `.env.example`.

**Status: PENDING SIGN-OFF.** T1/T2/T3 proceed with the grandfather default; switching later is a
one-line change. See §9 (a).

---

## D10 — Whitelist scope (Option A — defer to F25) ✅

**Choice:** F06 ships domain check + first-admin ONLY. No `whitelisted` column, no `AllowedEmails`
table, no whitelist endpoints. Manual email whitelist/blocklist is deferred to F25.

**Rationale:**

- `features.md` F25 (Phase 7) explicitly owns "Whitelist management — allow/block specific emails
  regardless of domain" and lists F06 as its only dependency.
- PRD §REQ-1.2 mentions "manually whitelisted by an Admin" but gives NO schema, endpoint, or rule.
- Adding whitelist schema now creates churn F25 may redesign (e.g. F25 may want `role_override` per
  whitelisted email).
- `ALLOWED_DOMAIN` covers the primary G-Suite-restriction use case; manual whitelist is a power-user
  feature.

**Cite:** F06 codebase analysis note C (PRD gives no whitelist schema/endpoint/rule); `features.md` F25.

---

## D11 — Drizzle partial-index declaration ✅

**Choice:** Declare the race-safe first-admin index in `backend/src/db/schema.ts`:

```typescript
uniqueIndex('users_one_admin').on(table.role).where(eq(table.role, 'ADMIN'))
```

attached to the `users` table via the `pgTable` config callback `(table) => ({ usersOneAdminIdx: ... })`.
Generate the migration via `drizzle-kit generate`.

**Rationale:** `uniqueIndex().on().where()` is the canonical Drizzle partial-index syntax
(`drizzle-orm/pg-core`). `uniqueIndex` (not `index`) makes the UNIQUE constraint the arbiter. The
generated SQL is:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS "users_one_admin"
  ON "Users" USING btree ("role")
  WHERE "role" = 'ADMIN';
```

The partial predicate `WHERE "role" = 'ADMIN'` MUST match the `eq(table.role, 'ADMIN')` declaration
exactly, or future `ON CONFLICT` arbiter matching breaks (F06 does not use ON CONFLICT for this insert
— it uses app-layer `23505` retry — but future features might).

**See also:** D1, D12, §8.

---

## D12 — First-admin count inside the transaction ✅

**Choice:**

```typescript
db.transaction(async (tx) => {
  const [{ rowCount }] = await tx.select({ rowCount: count() }).from(users);
  const isFirstUser = Number(rowCount) === 0;
  const role = isFirstUser ? 'ADMIN' : 'MEMBER';
  // ... insert with role ...
});
```

**Rationale:** Drizzle's `db.$count(users)` is a non-transactional convenience — it does NOT accept a
transaction object. Inside a txn, use `tx.select({ rowCount: count() }).from(users)` so the count runs
in the transaction's snapshot. PG default `READ COMMITTED` is sufficient because the partial unique
index (D1) is the hard guarantee — `SERIALIZABLE` is not needed. The transaction isolates the
count→insert sequence from concurrent inserts; the `23505` retry (D1) is the app-layer backstop for the
narrow race the index catches.

**See also:** D1, D11.

---

## D13 — `ALLOWED_DOMAIN` empty = allow all ✅

**Choice:**

```typescript
if (env.allowedDomain) {
  assertDomainAllowed(info.email);
}
```

Empty / undefined `env.allowedDomain` skips the check entirely (every Google account may log in).

**Rationale:** Matches `features.md` ("If `ALLOWED_DOMAIN` is set, only that G-Suite workspace can log
in"), the `.env.example` comment ("leave empty to allow all Google accounts"), and the
`js-development-rules.md` env table (`ALLOWED_DOMAIN` optional, default —). `env.allowedDomain` is
typed `string | undefined` (`backend/src/config/env.ts`), read `envSource.ALLOWED_DOMAIN || undefined`.

---

## §9 — Cross-cutting decisions needing owner sign-off

These three are irreversible or cross-cutting; F06 cannot silently pick them. The recommended default
is non-binding until the owner confirms.

### (a) Domain-change-over-time: grandfather vs block-on-next-login ⏳

**Question:** When `ALLOWED_DOMAIN` tightens (e.g. `example.com` → `corp.example.com`), what happens to
existing users whose email is now outside the new domain?

**Recommended default:** GRANDFATHER (D9). Domain check runs on the insert path only; the conflict path
skips it. Current members are not locked out when the env var tightens.

**If BLOCK-ON-NEXT-LOGIN is chosen:** add `assertDomainAllowed(info.email)` to the conflict path in
`upsertByGoogleId` (T2) and update `.env.example`.

**Status: PENDING SIGN-OFF.** T1/T2/T3 ship the grandfather default; switching is a one-line change.

---

### (b) Whitelist scope: confirm deferral to F25 ⏳

**Question:** F06 ships ONLY `ALLOWED_DOMAIN` enforcement. Manual email whitelist (allow/block specific
emails regardless of domain) is deferred to F25. Acceptable?

**Recommended default:** DEFER (Option A, D10). PRD §REQ-1.2 mentions "manually whitelisted by an Admin"
but provides NO schema/endpoint/rule. `features.md` F25 owns "Whitelist management" and depends on F06
only. Adding whitelist schema now risks churn F25 may redesign.

**If WHITELIST NOW (Option B) is chosen:** this becomes a much larger feature — new schema
(`AllowedEmails` table or `users.whitelisted` column), new admin endpoints
(`POST/DELETE /api/admin/whitelist/...`), new admin UI (F17 dependency), normalization shared between
domain check + whitelist lookup. Recommend splitting into F06b.

**Status: PENDING SIGN-OFF (confirm Option A acceptable).**

---

### (c) Token invalidation / `token_version` deferral to F07 ⏳

**Question:** When a user's role changes mid-session (e.g. an admin demotes them via F25), their existing
JWT still carries the old role until expiry (8h). Acceptable for F06?

**Recommended default:** ACCEPTABLE — defer `token_version` to F07. Rationale:

- F06's only role transition is the first-user promotion (MEMBER → ADMIN at insert time). This happens
  BEFORE any JWT exists for that user — there is no stale token to invalidate.
- Multi-admin demotion (the scenario that needs `token_version`) is introduced by F25, not F06.
- F06's `/me` re-fetch (D4) mitigates the symptom: a client calling `/me` gets the DB-fresh role + a
  freshly-signed JWT. The stale-token window is bounded by JWT TTL (8h) and how often the client calls
  `/me`.

**If `token_version` NOW is chosen:** add `users.tokenVersion int default 0 notNull`, add `ver` to
`JwtUserClaims`, bump `tokenVersion` on role change, have `authenticate` compare JWT `ver` to DB
`tokenVersion` → 401 on mismatch. ~3 tasks of work — recommend splitting into F06c or pulling F07
forward.

**Cite:** Stack Overflow 21978658; Curity JWT best practices.

**Status: PENDING SIGN-OFF (confirm deferral to F07 acceptable for F06).**

---

## Dev caveat — seeded DB suppresses first-admin promotion

> **Dev caveat (F06 first-admin logic):** `backend/src/db/seed.ts` inserts ADMIN + MEMBER fixtures →
> the `users` table is non-empty after seeding. F06's first-admin promotion (count === 0) therefore
> yields `MEMBER` for all new dev signups (intended — the seed admin is the dev admin). To test
> first-admin promotion end-to-end, run against an unseeded database:
> `TRUNCATE "Users" RESTART IDENTITY CASCADE;` (or drop + recreate the DB), then sign in with a fresh
> Google account. The partial unique index `users_one_admin` will be respected — only the seed's
> `admin-dev-fixture` row holds ADMIN; any attempt to insert a second ADMIN (via direct SQL, not the
> app) will fail with 23505.

**Why it matters:** The first-admin logic is count-based, so any pre-existing row (including seed
fixtures) suppresses promotion. Developers running F06 locally with a seeded DB will never observe
the ADMIN promotion path through the app — they must drop to an unseeded DB to exercise it. This is
the intended interaction, not a bug.

---

## Out of F06 scope (explicitly deferred — do NOT re-litigate without reading above)

- **Manual email whitelist / blocklist** → **F25** (sign-off (b), D10).
- **`requireRole('ADMIN')` middleware + role-gated UI** → **F07 / F17 / F25.** F06 puts the role on the
  JWT + `req.user`; consumers gate downstream.
- **Token invalidation (`token_version` / `ver` claim + middleware compare)** → **F07** (sign-off (c)).
- **Retroactive domain eviction** → **owner sign-off pending** (sign-off (a); D9 recommends grandfather).
- **Third role (e.g. `VIEWER`)** → F25 may introduce; F06 keeps the 2-value `pgEnum` (D5).

---

**End of F06 decisions record.** For the full task breakdown, acceptance criteria, and integration
record, see [F06-onboarding-workspace-roles-tasks.md](./F06-onboarding-workspace-roles-tasks.md).
