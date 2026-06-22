# SLYK-F07 — Deferred Follow-ups

Tracked items from the F07 PR review that are accepted for now but must not be
forgotten. Each names the owning future feature.

## L1 — Mount `requireRole` on the first admin backend route

`requireRole('ADMIN')` middleware exists (`backend/src/middleware/requireRole.ts`)
and is unit-tested, but F07 ships **no route that uses it**. Defense-in-depth for
admin actions is therefore frontend-only until a real admin route is mounted.

- **Owning features:** F17 / F25 (whichever adds the first admin endpoint).
- **Rule:** the first `GET /api/settings` (or any admin-scoped endpoint) must be
  mounted with `requireRole('ADMIN')` after `authenticate`. Do **not** add an admin
  route without it.
- Current exposure: **none** — no admin backend route exists yet, so this is latent.

## L10 — Migration reversibility + latent drizzle `$1` enum bug

- **No down-migration convention.** drizzle-kit does not emit down-migrations in
  this repo; rollback is manual SQL. To revert F07's `0002_brief_peter_quill.sql`:
  ```sql
  ALTER TABLE "Users" DROP COLUMN "token_version";
  ```
- **Latent drizzle `$1` bug:** `0002_snapshot.json` metadata carries a `$1`
  placeholder in an enum partial-index definition (the `0001` migration hit this
  for real and was hand-reconciled to the literal `'ADMIN'` — see the
  `drizzle-partial-index-enum-dollar1` memory). `0002` itself is a plain
  `ADD COLUMN` and is **not** affected, but a future Users-table migration could
  re-emit the `$1` SQL and fail at migrate time. When generating the next Users
  migration, grep the emitted `.sql` for `$1` and reconcile to the literal.

## L11 — `bumpTokenVersion` unbounded

`bumpTokenVersion` increments with no upper bound. Theoretical integer overflow at
`2^31` (Postgres `integer`). Not a practical concern — a user would need
~2 billion logouts — but track for **F25** (role-demotion invalidation), where a
guarded reset-on-overflow or a `bigint` column could be added if ever warranted.
