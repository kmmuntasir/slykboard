# SLYK-0200 — Internal onboarding events + deploy-target endpoints

**Phase:** 0.5 — Onboarding MVP
**Type:** Feature (backend)
**Depends on:** SLYK-0140, SLYK-0150

## Description

Two dispatcher-callback endpoints replacing stubs in
`internal.routes.ts`.

**Files:** `backend/src/routes/internal.routes.ts` +
`internal.schema.ts`, `backend/src/services/onboardingEventService.ts`,
repositories as needed.

### 1. `POST /api/v1/internal/projects/:slug/onboarding/events`

Zod: `{ fromState: OnboardingState|null, toState: OnboardingState,
detail?: record }`.

Behavior (transaction):
1. Load `ProjectAgentMeta` by slug → 404 if absent.
2. Insert `OnboardingEvents` row (fromState, toState, detail).
3. Update meta `onboardingState = toState`.
4. `toState === 'LIVE'` → also set `onboardedAt = now()`.
5. `toState === 'FAILED'` → set `onboardingError = detail.error`.
6. Return 200 envelope.

### 2. `GET /api/v1/internal/projects/:slug/deploy-target`

Behavior:
1. Join `projects` + `ProjectAgentMeta` on id where slug matches → 404 if
   absent.
2. `onboardingState !== 'LIVE'` → `409 CONFLICT` (project not ready for
   deploys).
3. Else return `{ lxcCtid, lanIp, systemdService, subdomain, stack }`
   envelope.

Both behind `requireAgentMode → agentTokenAuth` (already mounted).

## Acceptance criteria

- [ ] Signed event POST inserts event + advances state; `LIVE` sets
      onboardedAt; `FAILED` stores error text.
- [ ] Event POST for unknown slug → 404 envelope.
- [ ] Invalid toState → 400 VALIDATION_FAILED.
- [ ] Deploy-target returns the five fields for a LIVE project.
- [ ] Deploy-target on non-LIVE project → 409; unknown slug → 404.
- [ ] Unsigned requests → 401; plain mode → 501.
- [ ] Idempotency note: duplicate same-state event POSTs append rows
      (append-only log — allowed by spec).

## References

- `docs/agentic-automation/05-backend-routes.md` § internal routes
- `docs/agentic-automation/04-schema.md` (OnboardingEvents, meta columns)

## Dependencies

- SLYK-0140 (tables exist)
- SLYK-0150 (internal router + HMAC mounted)
