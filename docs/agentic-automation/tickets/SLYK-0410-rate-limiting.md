# SLYK-0410 — Rate limiting: onboarding + chat

**Phase:** 5 — Polish + Admin Tools
**Type:** Feature (backend)
**Depends on:** SLYK-0190, SLYK-0330

## Description

Rate limits from `03-security.md` § Rate limiting:

1. `POST /api/v1/admin/projects` — 1 request / 10s / admin user. 11th...
   rather 2nd-within-10s → `429 TOO_MANY_REQUESTS` (envelope code; add to
   enum if absent) + `Retry-After` header.
2. `POST /api/v1/me/tickets/:id/messages` — 30/min/user → 429 beyond.

Implementation: in-memory fixed-window counter middleware keyed
`userId:route` (single-pod v1 invariant makes in-memory correct; same
seam note as SSE emitter). Configurable constants. `/api/v1/internal/*`
stays unlimited (trusted dispatcher, per `03`).

Mock failure-injection interplay: none needed here — limits are
slykboard-local.

**Tests:** fake timers or shrunken windows — burst 2 onboarding posts →
second 429 + Retry-After; boundary reset after window; chat 31st in a
minute → 429; different users independent; internal routes unaffected.

## Acceptance criteria

- [ ] Onboarding: 2nd request within 10s → 429 + Retry-After; after
      window → allowed.
- [ ] Chat: 31st/min → 429.
- [ ] Limits keyed per user (two users don't share budget).
- [ ] Internal dispatcher routes rate-limit-free.
- [ ] 429 uses the standard error envelope.
- [ ] No effect in plain mode (routes 501 first — ordering verified).

## References

- `docs/agentic-automation/03-security.md` § Rate limiting
- `docs/agentic-automation/09-implementation-phases.md` Phase 5 (rate
  limit task + 429 smoke test)

## Dependencies

- SLYK-0190 (onboarding route to guard)
- SLYK-0330 (chat route to guard)
