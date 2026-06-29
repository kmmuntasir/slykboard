# Slykboard — Deliverables

> Source of truth for the current delivery cycle. Each item below is a single,
> **complete, end-to-end** deliverable — a feature, a bugfix, or an enhancement.
> No deliverable is split by layer: if a requirement touches data, APIs, and UI,
> all of that ships together as one unit.
>
> Status legend: 🔴 not started · 🟡 in progress · 🟢 done. All items are 🔴 unless
> marked otherwise.

---

## Table of Contents

1. [Context & Locked Decisions](#context--locked-decisions)
2. [Glossary](#glossary)
3. [Deliverables Index](#deliverables-index)
4. [Dependency Graph & Suggested Phasing](#dependency-graph--suggested-phasing)
5. [Deliverable Details](#deliverable-details)
6. [Cross-Cutting Concerns](#cross-cutting-concerns)

---

## Context & Locked Decisions

These decisions were clarified with the product owner and are **binding** for every
deliverable. Implementations must not deviate without re-confirming.

### Authentication & Provisioning

- **Google SSO is the only authentication method.**
- **Login is restricted to pre-provisioned users.** First-time Google login for an
  email with no existing user row is **rejected** (even if the domain matches
  `ALLOWED_DOMAIN`). Auto-provisioning on first login is removed.
- Existing users are matched by email on Google login, and their `googleId` is
  linked on first login.
- `ALLOWED_DOMAIN`, when set, is enforced **only at user-creation time**. Unset =
  any domain allowed.
- Creating a user whose email already exists returns an *"already exists"* error;
  a wrong-domain email returns a *"domain not allowed"* error.

### Bootstrap Admin

- On first deployment, a single Platform Admin is auto-created from environment
  variables (`BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_FULL_NAME`,
  `BOOTSTRAP_ADMIN_DISPLAY_NAME`).
- **`BOOTSTRAP_ADMIN_EMAIL` must use the allowed domain** (when `ALLOWED_DOMAIN` is
  set). If it does not, **bootstrapping fails and the process exits**.
- Idempotent: re-runs are no-ops once a Platform Admin exists.
- The bootstrap admin is always created active + `isPlatformAdmin = true`.

### Roles (three-tier)

- **Platform Admin** — global flag on the user (`users.isPlatformAdmin`). Sees all
  projects, can create/rename/**deactivate** projects, manages platform-wide user
  state, is an implicit member of every project.
- **Project Admin** — per-project role in a `project_members` table. Full control
  inside their own projects; **cannot** create new projects.
- **Project Member** — per-project role. Works on tickets/labels/checklists within
  their project.
- The old workspace-global `ADMIN`/`MEMBER` enum is **retired**.

### Membership & Visibility

- A user who is not a member of a project (and is not a Platform Admin) must not
  even discover that project exists (no listing, non-revealing 404/forbidden on
  deep links).
- Platform Admins are default members of all projects.

### Settings Information Architecture

- The nav item currently labeled **"Settings"** is renamed to **"Project
  Settings"** and points to `/projects/:slug/settings`. It **requires a selected
  project** (disabled-tooltip state when none, like Board/Reports today).
- **Project Settings** is a **two-column layout** (left sidebar of sections + right
  content). "Member Management" is one sidebar item; more will follow.
- `/settings` is **reserved** for the future platform-wide **"Settings"** — renders
  a **"Coming Soon"** page, reachable from the profile menu, **Platform Admins only**.
- An **"Account Settings"** stub (also "Coming Soon") is added under the profile
  menu, available to all users.

### Projects

- **No hard delete.** Projects are **deactivated** (soft-hide) for now; hard delete
  is deferred.
- Deactivating a project **stops all running timers in it immediately**, hides it
  from the picker for project users, preserves all data, and is reactivate-able by
  Platform Admins.

### Comments

- A brand-new per-ticket **Comments** feature. No realtime; **refetch-on-open** is
  sufficient. Any project member may comment. Author may **edit** own comment;
  author or any admin may **delete**. Edit/delete are recorded in the activity log
  as a **summary** ("User X edited a comment"), never the content.

### Data Migration

- The system is **not yet live**. The **entire existing migration chain is to be
  discarded** and replaced with a single fresh migration reflecting the new schema.
  No data preservation is required.

### Confirmation of scope

- **No new** "last platform admin" demotion/deactivation path beyond the guard.
- **Self-deactivation and self-removal are blocked everywhere** (UI disables the
  control on the current user's own row; the API rejects targeting self).

---

## Glossary

| Term | Meaning |
| --- | --- |
| **Platform Admin** | Global admin (`users.isPlatformAdmin = true`). Superuser across all projects. |
| **Project Admin** | Per-project manager role in `project_members`. |
| **Project Member** | Per-project worker role in `project_members`. |
| **Project user** | Anyone who is a Project Admin or Member of a given project. |
| **Member Management** | The project-scoped section (formerly "User Management") for managing a project's members. |
| **Deactivated project** | A project in the soft-hidden state; data preserved, unreachable to project users. |
| **Deactivated user** | A platform user blocked from login (`blocked = true`). Platform-Admin-only action. |
| **Display Name** | A short name usable in the UI in place of the full name. |

---

## Deliverables Index

| ID | Type | Title | Blocked by |
| --- | --- | --- | --- |
| [DEL-01](#del-01--feature--three-tier-roles--project-membership) | Feature | Three-Tier Roles & Project Membership | — |
| [DEL-02](#del-02--feature--member-management-project-scoped) | Feature | Member Management (project-scoped) | DEL-01, DEL-03 |
| [DEL-03](#del-03--enhancement--settings-information-architecture) | Enhancement | Settings Information Architecture | DEL-01 |
| [DEL-04](#del-04--feature--project-deactivation) | Feature | Project Deactivation | DEL-01 |
| [DEL-05](#del-05--bugfix--prevent-self-deactivation--self-removal) | Bugfix | Prevent Self-Deactivation & Self-Removal | DEL-01, DEL-02 |
| [DEL-06](#del-06--bugfix--theme-contrast-fixes) | Bugfix | Theme Contrast Fixes | — |
| [DEL-07](#del-07--bugfix--dropdown-item-icontext-spacing) | Bugfix | Dropdown Item Icon/Text Spacing | — |
| [DEL-08](#del-08--bugfix--labels-field-empty-in-ticket-modal) | Bugfix | Labels Field Empty in Ticket Modal | — |
| [DEL-09](#del-09--enhancement--ticket-details-modal-full-width) | Enhancement | Ticket Details Modal Full Width | — |
| [DEL-10](#del-10--enhancement--compact-ticket-metadata-header) | Enhancement | Compact Ticket Metadata Header | — |
| [DEL-11](#del-11--enhancement--ticket-details-modal-tabbed-layout) | Enhancement | Ticket Details Modal Tabbed Layout | DEL-12, DEL-13 |
| [DEL-12](#del-12--bugfix--timer-stale-update-on-startstop) | Bugfix | Timer Stale Update on Start/Stop | — |
| [DEL-13](#del-13--feature--ticket-comments) | Feature | Ticket Comments | DEL-01 |
| [DEL-14](#del-14--bugfix--form-field-label-icontext-alignment) | Bugfix | Form Field Label Icon/Text Alignment | — |
| [DEL-15](#del-15--bugfix--ticket-modal-sticky-footer-gap) | Bugfix | Ticket Modal Sticky Footer Gap | — |

---

## Dependency Graph & Suggested Phasing

```
DEL-01 (roles/membership) ──┬─► DEL-02 (member mgmt) ────► DEL-05 (self-protection)
                            ├─► DEL-03 (settings IA) ────► DEL-02 (hosts it)
                            ├─► DEL-04 (deactivate proj) ─► DEL-05
                            └─► DEL-13 (comments, membership-gated)

Modal cluster (independent of roles):
  DEL-12 (timer bugfix) ──► DEL-11 (tabbed layout)
  DEL-13 (comments) ──────► DEL-11 (tabbed layout)
  DEL-09 (full width), DEL-10 (metadata), DEL-14 (labels), DEL-15 (footer): standalone

Standalone UI bugfixes (anytime, parallel-safe):
  DEL-06 (theme), DEL-07 (dropdown), DEL-08 (labels empty)
```

**Suggested phasing**

- **Phase 1 — Foundation:** DEL-01. (Everything else that touches access builds on this.)
- **Phase 2 — Access & Settings:** DEL-03 → DEL-02 → DEL-04 → DEL-05.
- **Phase 3 — Modal redesign:** DEL-09, DEL-10, DEL-12, DEL-14, DEL-15 → DEL-13 → DEL-11.
- **Phase 4 — Parallel polish:** DEL-06, DEL-07, DEL-08 (can slot in anywhere).

---

## Cross-Cutting Concerns

- **Migration reset.** DEL-01 discards the full existing migration chain and
  replaces it with one fresh initial migration. Every schema-touching deliverable
  (DEL-01, DEL-02's user columns, DEL-04's project flag, DEL-13's comments table)
  must land in a coherent single migration (or a clean additive sequence) with no
  reliance on preserved data.
- **Tests.** Each deliverable ships with tests covering its new behavior and
  regression risks (permission gates, login gate, Add-Member branches, timer cache
  invalidation, comments authorization, theme tokens, etc.). Follow the existing
  backend/frontend test conventions already in the repo.
- **Non-revealing access errors.** Any deliverable that touches project visibility
  (DEL-01, DEL-04) must keep "not a member" and "does not exist"
  indistinguishable to the caller.
- **Activity log discipline.** Only DEL-13 adds activity entries; those entries are
  summary-only (no content). No other deliverable should leak sensitive content
  into the activity feed.
- **Theme parity.** Every UI-touching deliverable (DEL-06, DEL-07, DEL-09, DEL-10,
  DEL-11, DEL-14, DEL-15) must be verified in **both** light and dark mode.
