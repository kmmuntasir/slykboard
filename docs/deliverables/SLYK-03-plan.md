# Implementation Plan — SLYK-03

**Ticket:** `docs/deliverables/SLYK-03.md`
**Type:** Enhancement
**Title:** Settings Information Architecture
**Generated:** 2026-06-30

---

## Summary

The nav item currently labeled "Settings" is ambiguous: it points at a
workspace-global page (`/settings` → `SettingsPage`, the platform-wide member
roster), collides with two future surfaces (a platform "Settings" and an "Account
Settings"), and Project Settings is a single-column page not laid out for growth.
This ticket consolidates the settings IA:

1. **Rename the nav item "Settings" → "Project Settings"**, retarget it from
   `/settings` to `/projects/:slug/settings`, make it **require a selected
   project** (disabled-tooltip when none — the same state Board/Reports use), and
   restrict its visibility to **Platform Admins** and **Project Admins** of the
   current project (Project Members do not see it).
2. **Rebuild Project Settings as a two-column layout** — a left sidebar of
   sections (General, Member Management, Labels) and a right content pane — where
   the sidebar is the extension point for future sections.
3. **Reserve `/settings`** for the future platform "Settings": render a
   **"Coming Soon"** page there, linked from the **profile menu**, visible to
   **Platform Admins only**.
4. **Add "Account Settings"** to the profile menu (available to **all users**)
   routing to a **"Coming Soon"** page.
5. **Remove the old workspace-global `SettingsPage`** so there is a single,
   unambiguous IA (its member-management capability is superseded by the project
   member management shipped in DEL-02 and the future platform Settings).

This is a **frontend-only** change. No backend routes/controllers/services are
touched (verified — `backend/src` has no settings code; the only hit is a schema
comment at `backend/src/db/schema.ts:105`).

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| Route config | `frontend/src/routes/index.tsx` | Retarget/reshape `/settings` → Coming Soon; remove `SettingsPage` import & route; optionally add `/account` Coming Soon route. |
| Nav | `frontend/src/components/TopNav.tsx` | Rename `Settings` → `Project Settings`; retarget to `/projects/:slug/settings`; add disabled-tooltip-when-no-project; gate visibility on Platform Admin ∪ Project Admin; add two profile-menu entries. |
| Page | `frontend/src/pages/ProjectSettingsPage.tsx` | Rebuild from single-column to two-column sidebar layout; sections become sidebar-driven panes (General / Member Management / Labels). |
| Page (new) | `frontend/src/pages/ComingSoonPage.tsx` | Reusable "Coming Soon" page for `/settings` and `/account`. |
| Page (delete) | `frontend/src/pages/SettingsPage.tsx` | Old workspace-global member roster — removed. |
| Test (delete) | `frontend/src/pages/SettingsPage.test.tsx` | Tests for the removed page. |
| Test | `frontend/src/components/TopNav.test.tsx` | Update Settings-link assertions → Project Settings (project-scoped, disabled state, PA/Project-Admin visibility); add profile-menu entry assertions. |
| Test | `frontend/src/pages/ProjectSettingsPage.test.tsx` | Update/extend for two-column layout & sidebar sections. |
| Guard | `frontend/src/components/RequirePlatformAdmin.tsx` | Reused as-is to gate `/settings` (platform Settings Coming Soon). |
| Hook | `frontend/src/hooks/useProjectMembers.ts` | Source of `useCurrentProjectMembership(slug)` for the Project-Admin gate in TopNav. |

## Proposed Implementation

### Backend Changes

**None.** Verified: no settings routes/controllers exist in `backend/src`. The
old `SettingsPage` consumed generic `/users` endpoints (`frontend/src/api/users.ts`)
which remain in use by `useUserManagement` regardless; those are out of scope.

### Frontend Changes

Build order: page primitives first (Coming Soon), then routing, then the rebuilt
Project Settings shell, then nav/profile-menu rewiring, then test updates.

#### 1. Add `ComingSoonPage` (new)

- **File:** `frontend/src/pages/ComingSoonPage.tsx`
- **What:** A small, reusable placeholder page. Named export `ComingSoonPage`
  accepting an optional `title` prop (default `"Coming Soon"`). Centered card
  (`mx-auto max-w-2xl space-y-6 p-4` — mirroring the body style of
  `ProjectSettingsPage.tsx` container), a heading, and a descriptive
  `<p className="text-sm text-muted-foreground">`.
- **Why:** Two routes need a Coming Soon surface (`/settings` platform, `/account`
  account). One reusable component avoids duplication (project reusability rule:
  ~90% similar surfaces → shared component).
- **Code reference:** Body style mirrors `ProjectSettingsPage.tsx:60-69`; message
  pages pattern mirrors `ForbiddenPage.tsx` / `NotFoundPage.tsx`. There is **no**
  existing Coming Soon page (confirmed by grep) — this is the new convention.

#### 2. Rewire `/settings` route → Coming Soon (platform, PA-only)

- **File:** `frontend/src/routes/index.tsx`
- **What:**
  - Remove `import { SettingsPage }` (line ~12) and replace with
    `import { ComingSoonPage }`.
  - Keep `/settings` as a `RequirePlatformAdmin`-wrapped layout route, but point
    its index child at `<ComingSoonPage title="Settings" />` instead of
    `<SettingsPage />` (currently `routes/index.tsx:111-113`).
  - (Optional, recommended) Register `/account` → `<ComingSoonPage title="Account Settings" />`
    under `RequireAuth` (no admin guard — everyone), so the profile-menu
    "Account Settings" entry has a real target.
- **Why:** Reserves `/settings` for the future platform Settings while removing
  the old roster surface; gives "Account Settings" a destination.
- **Code reference:** Existing `/settings` layout-route guard pattern at
  `routes/index.tsx:111-113`; `RequireAuth` nesting at `routes/index.tsx:48-117`.

#### 3. Rebuild `ProjectSettingsPage` as a two-column layout

- **File:** `frontend/src/pages/ProjectSettingsPage.tsx`
- **What:**
  - Replace the single-column `mx-auto max-w-2xl space-y-6 p-4` shell
    (`ProjectSettingsPage.tsx:60`) with a **two-column flex layout**: a left
    sidebar (`w-48` / `shrink-0`) listing sections and a right content pane
    (`flex-1`). The sidebar is the extension point — render sections from a small
    config array (`{ id, label }`) so future sections append trivially.
  - **Active-section state:** local `useState<'general' | 'members' | 'labels'>`
    defaulting to `'general'`. Sidebar items are buttons/links that set the active
    section; the content pane renders the matching section. (Sidebar navigation is
    in-page state, not separate routes — keeps the IA contained to one page, as
    the ticket describes a "left sidebar of sections and a right content pane".)
  - **General section:** host the existing `ProjectNameSection`
    (`ProjectSettingsPage.tsx:84-127`) + `ProjectColumnsManager`
    (`frontend/src/components/ProjectColumnsManager.tsx`). Project deactivation is
    **out of scope for SLYK-03** (greenfield per DEL-04 — no `active` field on
    `Project`, no API/hook yet); leave a placeholder/TODO or simply omit until
    DEL-04.
  - **Member Management section:** host the DEL-02 member-management UI. Two
    options (see Open Questions): (a) **embed** the member-management content
    (search + `MemberTable` + `AddMemberModal`) directly in the pane, or (b)
    **link** to the existing `/projects/:slug/members` page
    (`ProjectMembersPage.tsx`). The current page already links out to members
    (`ProjectSettingsPage.tsx:74-85`) and `ProjectMembersPage` has a back-link to
    settings (`ProjectMembersPage.tsx:128`, currently a raw `<a href>` — should be
    a router `<Link>`). Recommended minimal approach for this IA ticket: keep the
    **link** behavior but render it as a sidebar section that navigates to
    `/projects/:slug/members`, preserving the standalone page. (Full embedding can
    be a follow-up.)
  - **Labels section:** host the existing `LabelManager`
    (`frontend/src/components/LabelManager.tsx`, currently at
    `ProjectSettingsPage.tsx:72`).
  - **Admin gate broadening:** the current page gates rename/columns on
    `useRequirePlatformAdmin()` only (`ProjectSettingsPage.tsx:21-22`). The ticket
    requires Project Settings to be visible to **Project Admins** too. Broaden the
    in-page gate to `canManage = isPlatformAdmin || isProjectAdmin` using
    `useCurrentProjectMembership(slug)` (`hooks/useProjectMembers.ts:74`), matching
    the established `canManage` pattern in `ProjectMembersPage.tsx:53-61`.
- **Why:** Delivers the two-column rebuild; reuses already-shipped section
  components (no logic rewrite); makes the sidebar the growth extension point.
- **Code reference:** Section components already in `ProjectSettingsPage.tsx`;
  `canManage` pattern at `ProjectMembersPage.tsx:53-61`; project store/slug access
  via `useParams` + `useProjectStore` (pattern at `TopNav.tsx:105-107`).

#### 4. Rewire TopNav: rename, retarget, disable-when-no-project, gate visibility

- **File:** `frontend/src/components/TopNav.tsx`
- **What:**
  - In `ADMIN_NAV_LINKS` (`TopNav.tsx:45-47` / `:56-58`): change the single entry
    from `{ to: '/settings', label: 'Settings' }` to a **Project Settings** entry
    targeting `/projects/:slug/settings`. Because it now needs the project slug
    and a disabled state, it behaves like the `PUBLIC_NAV_LINKS` items (Board /
    Reports) rather than the old always-on admin link — i.e. move it into the
    render path that computes `href` from `projectSlug` and uses `DisabledNavItem`
    when `!hasProject` (`TopNav.tsx:160-185`).
  - **Label:** `"Project Settings"`.
  - **Disabled state (no project):** reuse `DisabledNavItem`
    (`TopNav.tsx:61-86`) with the existing hint `'Select a project first'`
    (`TopNav.tsx:177`). Acceptance: with no project selected, "Project Settings"
    is disabled with a tooltip.
  - **Visibility gate (Project Admin ∪ Platform Admin):** TopNav currently only
    knows `isPlatformAdmin` (`useRequirePlatformAdmin()`, `TopNav.tsx:110`). To
    gate on Project Admin, consume `useCurrentProjectMembership(projectSlug)`
    (`hooks/useProjectMembers.ts:74`) when a project is selected and compute
    `canManageProject = isPlatformAdmin || isProjectAdmin`. Render the Project
    Settings nav item only when `canManageProject` is true; a Project Member
    (non-admin) does not see it. When no project is selected, hide it entirely
    (there is no project to be admin of) — **or** show it disabled; the acceptance
    criteria only require the disabled-tooltip when a project *is* expected but
    none selected. Recommended: hide when no project, since Project Admin is
    meaningless without a project; surface the disabled state only when needed
    for parity with Board/Reports. (Confirm in Open Questions.)
- **Why:** Implements the rename + retarget + require-selected-project + PA/ProjAdmin
  visibility requirements.
- **Code reference:** `DisabledNavItem` at `TopNav.tsx:61-86`; `hasProject` at
  `TopNav.tsx:107`; `projectSlug` derivation at `TopNav.tsx:105-106`;
  `useCurrentProjectMembership` at `hooks/useProjectMembers.ts:74`.

#### 5. Add profile-menu entries ("Settings" PA-only, "Account Settings" everyone)

- **File:** `frontend/src/components/TopNav.tsx` (the `avatarBlock` dropdown,
  `TopNav.tsx:222-285`)
- **What:** Insert two entries between the Theme group's trailing separator and
  the Sign out item (`TopNav.tsx:220-221` boundary):
  - **"Settings"** — visible to **Platform Admins only** (`isAdmin`, already in
    scope at `TopNav.tsx:110` via `useRequirePlatformAdmin()`). `onSelect` →
    `navigate('/settings')`, which now renders the Coming Soon page. Add a
    `<DropdownSeparator/>` before it.
  - **"Account Settings"** — visible to **everyone**. `onSelect` →
    `navigate('/account')` (the new Coming Soon route), or inline Coming Soon if
    `/account` is not registered. Add a `<DropdownSeparator/>` before it.
- **Why:** Stubs the two future settings surfaces in the profile menu per the
  ticket. Follows the existing dropdown entry pattern (append `<DropdownItem>`
  inside `<DropdownContent>`, `TopNav.tsx:229`).
- **Code reference:** Existing entries / insertion pattern at `TopNav.tsx:222-285`;
  `isAdmin` at `TopNav.tsx:110`.

#### 6. Remove the old global `SettingsPage`

- **Files:**
  - Delete `frontend/src/pages/SettingsPage.tsx`.
  - Delete `frontend/src/pages/SettingsPage.test.tsx`.
  - Remove the `SettingsPage` import + route in `frontend/src/routes/index.tsx`
    (covered in step 2).
  - Remove the `ADMIN_NAV_LINKS` Settings entry in `TopNav.tsx` (covered in
    step 4).
  - Update cosmetic comments referencing "SettingsPage roster"
    (`hooks/useUserManagement.ts:5`, `api/users.ts:26`) — optional, low priority.
- **Why:** Single, unambiguous IA. The workspace member-management capability is
  superseded by DEL-02 project members + the future platform Settings (Coming
  Soon for now).
- **Code reference:** Full touch-point list in cross-cutting digest
  (`SettingsPage.tsx`, `SettingsPage.test.tsx`, `routes/index.tsx:12,111-113`,
  `TopNav.tsx:56-58`,238, `TopNav.test.tsx`).

#### 7. Update tests

- **`frontend/src/components/TopNav.test.tsx`:**
  - Replace the three "Settings link" assertions (admin shows / member hides /
    no-project stays enabled) with **Project Settings** assertions: visible only
    to Platform Admin ∪ Project Admin of the selected project; disabled-tooltip
    (or hidden) when no project selected; Project Member does not see it.
  - Add profile-menu assertions: "Settings" entry present for Platform Admin,
    absent for non-admin; "Account Settings" entry present for everyone.
  - Keep the `MemoryRouter` + `QueryClientProvider` + `ThemeProvider` +
    `TooltipProvider` mount harness (`TopNav.test.tsx:64-73`) and the auth-seed
    pattern (`TopNav.test.tsx:111`).
- **`frontend/src/pages/ProjectSettingsPage.test.tsx`:** update/extend for the
  two-column layout — assert sidebar sections render (General / Member
  Management / Labels), active-section switching, and that the existing
  ProjectNameSection / ProjectColumnsManager / LabelManager render under their
  sections.
- **`frontend/src/pages/ComingSoonPage.test.tsx` (new):** minimal render test.
- **`frontend/src/components/RequirePlatformAdmin.test.tsx`:** no change required
  (it mounts its own `/settings` MemoryRouter route and doesn't assert the page
  content); only revisit if the guard's purpose description is updated.
- **`frontend/src/routes/index.test.tsx`:** no settings references found (grep
  empty) — no edits needed beyond what the route change implies if it asserts
  `/settings`.

## Edge Cases & Risks

- **Project-Admin gate in TopNav requires a roster fetch.** `useCurrentProjectMembership(slug)`
  issues a network round-trip (`hooks/useProjectMembers.ts:74-93`); until it
  resolves, `isProjectAdmin` is undefined. TopNav must handle the loading state
  gracefully (hide Project Settings until the membership is known, or default to
  hidden) to avoid a flash where a Project Member briefly sees the link.
- **`isAdmin` vs Project-Admin semantics.** TopNav has never consumed per-project
  role before. Introducing `useCurrentProjectMembership` into TopNav is a new
  coupling; ensure the hook is only called when `projectSlug` is present (it
  requires a slug).
- **No project selected vs. Project Settings.** Project Admin is meaningless
  without a project. Decide hide-vs-disable when no project is selected (see Open
  Questions). The disabled-tooltip parity with Board/Reports is the safer choice
  for UX consistency, but hiding is arguably more correct.
- **Member Management section: embed vs. link.** Embedding duplicates the
  `ProjectMembersPage` surface (and its back-link at `ProjectMembersPage.tsx:128`,
  which is a raw `<a href>` and should become a router `<Link>` regardless).
  Linking preserves a single source of truth but means the sidebar "Member
  Management" navigates away from the two-column shell. Recommend linking for
  this IA ticket; embedding as a follow-up.
- **Project deactivation (DEL-04) is greenfield.** No `active` field on `Project`
  (`types/project.ts`), no `UpdateProjectDto` support, no API/hook. Do **not**
  invent it here — it is explicitly DEL-04. The General section hosts name +
  columns only for now.
- **Old `SettingsPage` removal removes workspace member management.** Until the
  future platform Settings ships, platform-wide member management has no UI.
  Confirm this is acceptable (the Coming Soon page is the explicit placeholder).
- **`/account` route.** If not registered, the "Account Settings" profile entry
  has nowhere to go. Register it (step 2) or make the entry itself a Coming Soon
  stub.
- **Regression:** any deep link to `/settings` still works (now Coming Soon, PA
  only) — non-admins hitting it get `ForbiddenPage` via `RequirePlatformAdmin`
  (unchanged behavior). Deep links to `/projects/:slug/settings` are unaffected
  (same path, rebuilt page).

## Testing

*Follow project conventions — Vitest + Testing Library; table-driven tests; one
behavior per test; co-locate `*.test.tsx` next to source.*

- **Unit/component tests:**
  - `ComingSoonPage.test.tsx` — renders heading + description; respects `title` prop.
  - `ProjectSettingsPage.test.tsx` — sidebar sections render; active-section
    switching updates the content pane; existing section components render under
    their sections; `canManage` (Platform Admin ∪ Project Admin) gate shows
    management UI, Project Member sees read-only/no-management.
  - `TopNav.test.tsx` — Project Settings nav: visible to Platform Admin and to
    Project Admin of selected project; hidden from Project Member;
    disabled-tooltip (or hidden) when no project selected; profile menu
    "Settings" (Platform Admin only) and "Account Settings" (everyone) entries.
- **HTTP tests:** N/A (no backend changes).
- **Integration tests:** Critical flows only — verify the `/settings` route
  renders Coming Soon under `RequirePlatformAdmin` (admin → Coming Soon;
  non-admin → Forbidden), and `/projects/:slug/settings` renders the two-column
  layout for an admin.
- **Manual verification:**
  1. No project selected → "Project Settings" disabled with "Select a project
     first" tooltip (or hidden, per decision).
  2. Select a project as Platform Admin → "Project Settings" enabled; navigate →
     two-column layout with General / Member Management / Labels sidebar.
  3. Sign in as a Project Admin of the project → "Project Settings" visible.
  4. Sign in as a Project Member → "Project Settings" not visible.
  5. Profile menu (Platform Admin) → "Settings" → Coming Soon; "Account Settings"
     → Coming Soon.
  6. Profile menu (any user) → "Account Settings" → Coming Soon; no "Settings".
  7. `/settings` deep link (Platform Admin) → Coming Soon; (non-admin) →
     Forbidden. Old global member roster no longer reachable.

## Acceptance Criteria

- [ ] With no project selected, "Project Settings" is disabled with a tooltip
      (or hidden — per Open Questions decision; disabled-tooltip preferred for
      Board/Reports parity).
- [ ] Selecting a project enables "Project Settings"; navigating there shows the
      two-column layout with the initial sidebar sections (General, Member
      Management, Labels).
- [ ] A Project Member does not see "Project Settings".
- [ ] "Project Settings" is visible to Platform Admins and Project Admins of the
      current project.
- [ ] The profile menu shows "Settings" (Platform Admin only) and "Account
      Settings" (everyone); both lead to "Coming Soon".
- [ ] The old global settings route no longer exists as a primary surface —
      `/settings` renders Coming Soon (PA-only) and the `SettingsPage` roster is
      removed.
- [ ] Nav item is renamed "Settings" → "Project Settings" and retargeted to
      `/projects/:slug/settings`.

## Open Questions

1. **No-project state for "Project Settings":** hide entirely, or show disabled
   with the "Select a project first" tooltip (parity with Board/Reports)?
   Recommendation: disabled-tooltip for parity, but hiding is defensible since
   Project Admin is meaningless without a project.
2. **Member Management section: embed or link?** Embed the DEL-02 UI in the
   content pane (single surface, but duplicates `ProjectMembersPage`), or keep
   the sidebar entry as a link to `/projects/:slug/members` (preserves the
   standalone page)? Recommendation: **link** for this IA ticket; embed as a
   follow-up. Either way, fix the raw `<a href>` back-link in
   `ProjectMembersPage.tsx:128` to a router `<Link>`.
3. **`/account` route registration:** register a real `/account` → Coming Soon
   route (recommended), or make the profile "Account Settings" entry a
   non-navigating Coming Soon stub?
4. **Workspace member management gap:** confirm that removing the old
   `SettingsPage` (and replacing `/settings` with Coming Soon) is acceptable
   until the future platform Settings ships — i.e. no platform-wide member
   management UI in the interim.

## Out of Scope

- **Project deactivation / reactivation** (General section) — that is DEL-04
  (greenfield: needs a `Project.active` field, `UpdateProjectDto` support, API
  method, hook, and confirm-gated UI).
- **The future platform "Settings" and "Account Settings" real content** — this
  ticket only stubs them as Coming Soon.
- **Backend changes** — none required.
- **Promoting nav config to a `constants/` file** — possible refactor, not
  required by the ticket; current convention is inline config in `TopNav.tsx`.
- **Embedding Member Management into the Project Settings pane** (if the link
  approach is chosen) — deferred follow-up.
- **A shared `RequireProjectAdmin` route guard** — not needed; the established
  in-page `canManage` gate is the convention. Could be extracted later if more
  project-admin routes appear.
