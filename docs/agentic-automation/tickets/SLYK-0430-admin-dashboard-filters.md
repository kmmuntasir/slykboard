# SLYK-0430 — Admin project dashboard: filters + search

**Phase:** 5 — Polish + Admin Tools
**Type:** Feature (frontend, minor backend)
**Depends on:** SLYK-0230

## Description

Upgrade `/admin/projects` from the SLYK-0230 basic list to the full
dashboard per `06-frontend-ui.md`.

1. **Backend support** — extend the projects list source with onboarding
   state + meta fields joined (if the SLYK-0230 list endpoint lacks
   them): return `{slug, name, onboardingState, onboardingError,
   stack, subdomain, createdAt}` per project. Server-side filter param
   `?state=` + `?q=` (name/slug ILIKE) — or client-side filter if the
   project count is naturally tiny; prefer server-side (dashboard pattern
   for growth), keep it simple (no pagination yet).
2. **Frontend** — state-badge chips as filter row (multi-select states),
   search input (debounced 300ms), empty states, FAILED rows show error
   detail + link to timeline page. Rows link to `/admin/projects/:slug`.
3. Badge colors per state (PENDING grey, provisioning/wiring amber, LIVE
   green, FAILED red, DECOMMISSION* slate).

## Acceptance criteria

- [ ] Filter by one + multiple states narrows list correctly.
- [ ] Search matches name + slug, case-insensitive.
- [ ] FAILED row shows onboardingError + links to timeline.
- [ ] Non-admin redirected; plain-mode absent.
- [ ] Component tests: filter interaction, search debounce, badge render
      per state.

## References

- `docs/agentic-automation/06-frontend-ui.md` § `/admin/projects`
- `docs/agentic-automation/09-implementation-phases.md` Phase 5 (project
  admin dashboard task)

## Dependencies

- SLYK-0230 (page + list baseline)
