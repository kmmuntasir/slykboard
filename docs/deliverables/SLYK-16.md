# SLYK-16 · [Enhancement] · Project-Scoped Reports

> **Source:** Spun out of `SLYK-01` (Three-Tier Roles & Project Membership) —
> product decision: reports must be project-scoped, not global. Deferred from
> SLYK-01 so the roles/membership foundation can land first.

## Problem

The current reporting surface exposes two **global**, workspace-wide endpoints
(`GET /api/reports/time`, `GET /api/reports/tickets`) in addition to the
project-scoped `GET /api/projects/:slug/reports/*` routes. Under the three-tier
role model introduced in SLYK-01, global reports leak data across projects and
have no clean ownership: a Platform Admin sees everything (acceptable), but there
is no way for a Project Admin / Member to get reporting insights for *their own*
project without the global endpoints.

Reports should be **project-scoped by default** — each project's members and
admins get reporting for their project; the global cross-project surface is
removed or restricted to Platform-Admin-only aggregated views.

## Solution (end-to-end)

- **Project-scoped reports are the primary surface.** Consolidate reporting under
  `GET /api/projects/:slug/reports/*` (already exists, member-read under SLYK-01's
  matrix) and ensure it covers the use cases currently served by the global
  endpoints (time + ticket metrics), filtered to the resolved project.
- **Deprecate / remove the global `GET /api/reports/{time,tickets}` endpoints.**
  SLYK-01 left them gated to Platform Admin (PA-only) to avoid cross-project
  leakage; this ticket finishes the job by either:
  - **Removing** them entirely (preferred unless an explicit PA dashboard need
    exists), **or**
  - Repurposing them as an explicit **Platform-Admin aggregated dashboard**
    (clearly named, documented, no cross-project detail leakage to non-PA users).
- Update the **frontend Reports page** to be project-scoped (drive off the
  selected project's `/reports` endpoint); remove any UI that calls the global
  endpoints unless it is a PA-only aggregated view.
- Ensure all report queries are membership-scoped via the existing
  `requireProjectMember` middleware (PA bypass) — no raw global SQL that ignores
  `project_members`.

## Acceptance criteria

- Project members/admins can view reports for **their own** project via the
  project-scoped endpoint; non-members get the non-revealing 403 (consistent with
  SLYK-01's project visibility).
- No cross-project data is exposed to non-Platform-Admin users via any report
  endpoint.
- The deprecated global `/api/reports/*` endpoints are either removed or clearly
  repurposed as a PA-only aggregated dashboard with no member-facing exposure.
- The frontend Reports page is project-scoped and no longer calls removed global
  endpoints.
- Backend tests assert project-scoping (member sees only own project data; PA
  bypass; non-member denied) and the removal/restriction of the global endpoints.

## Dependencies

SLYK-01 (three-tier roles + project membership matrix + `requireProjectMember`
PA bypass). Handle **after** SLYK-01 lands.

## Out of scope

- Designing a rich PA-level cross-project analytics dashboard beyond the minimum
  needed to replace the global endpoints (separate deliverable if wanted).
- Audit logging of report access.
