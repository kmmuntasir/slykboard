# SLYK-0240 — `<DecommissionDialog>`: slug-match destructive confirm

**Phase:** 0.5 — Onboarding MVP
**Type:** Feature (frontend)
**Depends on:** SLYK-0210, SLYK-0230

## Description

Confirmation modal for project decommission, per `06-frontend-ui.md`. Lives
on the project admin page ("Remove" button from SLYK-0230's timeline page).

**Requirements:**

1. Modal content per the `06` sketch: warning icon, bulleted consequences
   (destroy LXC `<ctid>`, delete Zoraxy proxy `<subdomain>.kmlab.dev`,
   deregister repo from agent, delete GitHub repo **iff
   `githubRepoCreated === true`** — else bullet becomes "close any open
   onboarding PR (repo left intact)"), "This action cannot be undone."
2. "Type the project slug to confirm" input; Remove button disabled until
   typed text === `project.slug` exactly.
3. Submit → POST `/api/v1/admin/projects/:slug/decommission` with
   `{confirmSlug}`. On 202 → close modal, timeline shows DECOMMISSIONING,
   polling continues to DECOMMISSIONED. On 400 → inline error. On 502 →
   toast "dispatcher unavailable — retry from project page".
4. Cancel always available; Escape closes.

**Tests:** button stays disabled through near-misses (case mismatch, extra
space, wrong slug); enabled on exact match; correct payload posted; bullet
variation on `githubRepoCreated` false; 202/400/502 handling.

## Acceptance criteria

- [ ] All test cases above pass.
- [ ] Full manual cycle against mock `decommission` scenario: onboard →
      remove → type slug → DECOMMISSIONING → DECOMMISSIONED in UI.
- [ ] Component absent from plain-mode bundle.
- [ ] Destructive-action repo rule honored (modal + typed confirmation).

## References

- `docs/agentic-automation/06-frontend-ui.md` § DecommissionDialog
- `docs/agentic-automation/03-security.md` § Decommission safety
- `docs/agentic-automation/09-implementation-phases.md` Phase 0.5 smoke tests

## Dependencies

- SLYK-0210 (endpoint exists)
- SLYK-0230 (admin pages exist to host the dialog)
