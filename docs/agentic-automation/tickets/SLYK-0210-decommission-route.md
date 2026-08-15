# SLYK-0210 — `POST /api/v1/admin/projects/:slug/decommission`

**Phase:** 0.5 — Onboarding MVP
**Type:** Feature (backend)
**Depends on:** SLYK-0190, SLYK-0180

## Description

Destructive decommission trigger with slug-match confirmation. Replaces the
admin-router stub. Safety model from `03-security.md` § Decommission safety.

**Behavior:**

1. Zod: `{ confirmSlug: string }`.
2. Load project + meta by slug → 404 if absent.
3. `confirmSlug !== project.slug` → `400 VALIDATION_FAILED` (details
   `{expected: <slug>}` — do NOT echo anything beyond the slug; slug is
   public in URLs anyway).
4. Update meta `onboardingState = 'DECOMMISSIONING'` + append
   `OnboardingEvents` row (audit: initiating user id + timestamp in
   detail — per `03-security.md` safety layer 5).
5. POST dispatcher `/decommission` with
   `{ projectId, slug, repoUrl, lxcCtid, zoraxyProxyId,
   githubRepoCreated, agentBackend }` per `07-dispatcher-contract.md`.
6. Dispatcher 202 → respond `202`; terminal `DECOMMISSIONED` arrives later
   via the onboarding-events callback (SLYK-0200).
7. Dispatcher failure → keep state DECOMMISSIONING, return 502, admin
   retries manually (no auto-recur — safety layer 4).

One-shot POST, no background job, idempotent teardown owned by dispatcher.

## Acceptance criteria

- [ ] Correct confirmSlug + mock 202 → 202, state DECOMMISSIONING, audit
      event row exists with user id.
- [ ] Wrong confirmSlug → 400; missing field → 400.
- [ ] Unknown slug → 404.
- [ ] Non-admin → 403; plain mode → 501.
- [ ] Dispatcher down → 502, state stays DECOMMISSIONING (no auto retry
      loop — a second manual call is allowed).
- [ ] Mock streams DECOMMISSIONING→DECOMMISSIONED events → state lands
      DECOMMISSIONED.

## References

- `docs/agentic-automation/05-backend-routes.md` § decommission
- `docs/agentic-automation/03-security.md` § Decommission safety (5 layers)
- `docs/agentic-automation/07-dispatcher-contract.md` POST `/decommission`
- Repo rule: destructive actions need confirmation — enforced by
  confirmSlug gate + UI dialog (SLYK-0240)

## Dependencies

- SLYK-0190 (projects exist with meta to decommission)
- SLYK-0180 (dispatcherClient)
