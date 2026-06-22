# ADR 0001 — Per-request DB lookup in `authenticate`

- **Status:** Accepted
- **Date:** 2026-06-22
- **Context:** SLYK-F07 (Session Lifecycle & Auth Guards)

## Context

`authenticate` (`backend/src/middleware/auth.ts`) performs a primary-key lookup on
every protected request to compare the JWT `ver` claim against the database
`token_version` column. This is the server-authoritative session-invalidation gate
introduced by F07: a `POST /auth/logout` atomically increments `token_version`, and
every outstanding JWT for that user is hard-expired on its next request.

## Decision

Accept the per-request DB-direct lookup at the project's current scale. Do **not**
introduce an in-memory cache now.

- Sign-off **D3** ("DB-direct, PK sub-ms") explicitly chose this: the lookup is a
  primary-key index hit, sub-millisecond on Postgres at the expected internal-team
  volume, and avoids a cache-invalidation distributed-coordination problem.
- The cache alternative (short TTL in-memory map keyed by `sub`, invalidated on
  `bumpTokenVersion`) is deferred — its correctness depends on a reliable
  cross-process invalidation signal that is not worth building at current load.

## Consequences

- **Positive:** invalidation is always correct and race-safe; no stale-cache window;
  no second system to keep consistent.
- **Negative:**
  - Any DB hiccup (transient connection blip, failover) now 401s an otherwise valid
    session — previously only expired tokens failed. Surface as a re-login, not a
    silent error.
  - A cold boot burst (board + reports + current-user) issues N synchronous
    Postgres round-trips per tab. At current scale this is fine; it becomes a
    latency concern only at much higher request volume.
- **Revisit trigger:** if per-tab boot latency or protected-request pips grow
  meaningfully, introduce a short-TTL (≈5s) in-memory cache keyed by `sub`,
  invalidated whenever `bumpTokenVersion` runs (bump must clear the cached entry).
  Re-evaluate then; until that trigger fires, the DB-direct path is the choice.

## References

- F07 PR review finding **M1** (`.docs/features/F07-session-lifecycle-auth-guards/F07-pr-review.md`).
- F07 sign-off **D3** (`F07-session-lifecycle-auth-guards-tasks.md`).
- `backend/src/services/tokenVersion.ts` (`bumpTokenVersion`, `findUserTokenVersion`).
