# SLYK-0230 — Frontend onboarding form, timeline, admin pages (+ events GET endpoint)

**Phase:** 0.5 — Onboarding MVP
**Type:** Feature (frontend + one backend endpoint)
**Depends on:** SLYK-0160, SLYK-0190, SLYK-0200

## Description

### Backend addition: `GET /api/v1/me/projects/:slug/onboarding/events`

**Doc gap:** `06-frontend-ui.md` has the timeline page polling
`GET /api/v1/me/projects/:slug/onboarding/events`, but `05-backend-routes.md`
never defines it. This ticket adds it: auth via existing `authenticate` +
`resolveProject`/`requireProjectMember` semantics + platform-admin-only in
practice (route under `/api/v1/me/*`, but the UI gates to admins). Response:
`{ project: {name, slug, onboardingState, onboardingError}, events:
[OnboardingEvents rows asc] }`. Mounted on a new
`agent-chat`-style user router or the admin router — follow `11` layering;
keep it behind `requireAgentMode`.

### Frontend

All gated on `useRuntimeConfigStore(s => s.agentMode)` + `__AGENT_MODE__`
build switch; `React.lazy` dynamic imports per SLYK-0120 pattern. Follow
`AddMemberModal.tsx` form conventions (plain useState, UI-kit inputs).

1. **`<OnboardingForm>`** — fields per `06-frontend-ui.md`: name, slug
   (auto-derived from name, editable), subdomain, source-mode toggle ("New
   from template" default / "Existing repo"), conditional GitHub repo URL
   field (SSH preferred hint), stack select, agent backend select (default
   "Use global default" = null), visibility radios, collapsed optional
   initial agent context markdown textarea. Submit → POST
   `/api/v1/admin/projects` → redirect to timeline page on 201; inline 4xx
   errors; 5xx toast.
2. **`<OnboardingTimeline>`** — polls the events endpoint every 3s while
   state in-flight; stops on terminal (LIVE/FAILED/DECOMMISSIONED). Layout
   per `06` (check/spinner/pending rows, error badge + detail).
3. **Pages:** `/admin/onboarding` (form), `/admin/projects/:slug`
   (timeline; also serves the `/admin/projects/:slug/onboarding` alias),
   `/admin/projects` (list with state badges). Register on the agent-routes
   array. Non-admin → redirect `/projects` (existing
   `RequirePlatformAdmin` pattern).
4. **API modules:** `frontend/src/api/onboarding.ts` + queryKeys additions
   per `11-existing-patterns.md`.

## Acceptance criteria

- [ ] Form: toggle switches repo field visibility; validation mirrors
      backend rules client-side (slug pattern, reserved subdomains,
      SSH/HTTPS URL); submit disabled until valid.
- [ ] Happy path against mock: submit → 201 → redirect → timeline populates
      live to LIVE.
- [ ] Timeline polling stops on terminal states.
- [ ] Plain-mode build: none of these components/routes in bundle (grep
      dist for OnboardingForm/OnboardingTimeline → no matches with
      `SLYKBOARD_AGENT_MODE=false`).
- [ ] Non-admin redirected; agent mode off → routes absent.
- [ ] Component tests: toggle UX, validation hints, timeline render +
      poll-stop, gating via mocked store.

## References

- `docs/agentic-automation/06-frontend-ui.md` (form fields, timeline, pages)
- `docs/agentic-automation/05-backend-routes.md` (POST projects shapes)
- `docs/agentic-automation/11-existing-patterns.md` (form pattern, API client pattern)

## Dependencies

- SLYK-0160 (runtime config store populated — gating works)
- SLYK-0190 (create endpoint to call)
- SLYK-0200 (events being written to read)
