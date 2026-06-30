# Task Breakdown — SLYK-03 (Settings Information Architecture)

**Plan:** `docs/deliverables/SLYK-03-plan.md`
**Type:** Enhancement (frontend-only — no backend changes)
**Generated:** 2026-06-30

---

## How to read this document

Six self-contained tasks organized into three batches by dependency order.
Every task within a batch touches a **disjoint** set of files, so all tasks in a
batch can be implemented in parallel with **zero merge conflicts**. Each task
specifies exact files, line anchors (current as of 2026-06-30), symbol names, and
verifiable acceptance criteria.

> ⚠️ **Line-number caveat.** The original plan's line citations for
> `TopNav.tsx` (+40–50 lines) and `ProjectSettingsPage.tsx` (+7–10 lines) are
> stale. The line numbers below were re-derived against the current source and
> are accurate, but **always confirm before editing**.

---

## Parallelization Strategy

### Execution model

1. **Batch 1 → Batch 2 → Batch 3**, strictly in dependency order.
2. **Within a batch, all tasks run in parallel** — disjoint file sets guarantee
   no merge conflicts.
3. **Merge-order rules:**
   - All of Batch 1 must merge before Batch 2 starts (Batch 2 references
     `ComingSoonPage` and the rebuilt `ProjectSettingsPage`).
   - Batch 3's deletion task (#5) **must not merge** until both #3 (routes) and
     #4 (TopNav) are merged — otherwise the build breaks on a dangling
     `SettingsPage` import/route/nav reference.
   - #6 (`ProjectMembersPage` back-link) is independent and can merge anytime.

### Visual batch diagram

```
                  SLYK-03 — Settings IA (frontend-only)
 ┌────────────────────────────────────────────────────────────────────┐
 │                                                                    │
 │   BATCH 1  (page primitives — no deps, disjoint files)            │
 │   ┌──────────────────────────────────┐  ┌───────────────────────┐ │
 │   │ #1  ComingSoonPage.tsx (+ test)  │  │ #2  ProjectSettings   │ │
 │   │     NEW leaf page                │  │     Page two-column   │ │
 │   │                                  │  │     rebuild + test    │ │
 │   └────────────────┬─────────────────┘  └──────────┬────────────┘ │
 │                    │ enables                        │              │
 │   ═════════════════╪════════════════════════════════╪════════════ │
 │                    ▼                                ▼              │
 │   BATCH 2  (rewire — depends on #1, disjoint files)               │
 │   ┌──────────────────────────────────┐  ┌───────────────────────┐ │
 │   │ #3  routes/index.tsx             │  │ #4  TopNav.tsx        │ │
 │   │     /settings → ComingSoon       │  │     rename/retarget/  │ │
 │   │     /account  (new)              │  │     gate nav +        │ │
 │   │                                  │  │     profile-menu +    │ │
 │   └────────────────┬─────────────────┘  │     test              │ │
 │                    │                    └───────────┬───────────┘ │
 │   ═════════════════╪════════════════════════════════╪════════════ │
 │                    ▼ build-safe after #3 + #4        ▼             │
 │   BATCH 3  (cleanup — depends on #3, #4)                           │
 │   ┌──────────────────────────────────┐  ┌───────────────────────┐ │
 │   │ #5  Delete SettingsPage.tsx +    │  │ #6  ProjectMembersPage│ │
 │   │     SettingsPage.test.tsx;       │  │     raw <a href> →    │ │
 │   │     reword comments              │  │     router <Link>     │ │
 │   └──────────────────────────────────┘  └───────────────────────┘ │
 │                                                                    │
 └────────────────────────────────────────────────────────────────────┘

 Edge meanings:
   #1 ─▶ #3   ComingSoonPage must exist before /settings & /account point at it
   #1 ─▶ #4   profile-menu targets render Coming Soon
   #2 ─▶ #4   behavioral correctness of the rebuilt Project Settings target
   #3 ─▶ #5   SettingsPage import+route removed → safe to delete the file
   #4 ─▶ #5   ADMIN_NAV_LINKS Settings entry removed → no dangling nav reference
   #6 ─ (none)  Independent file; batched in B3 for merge safety only
```

### Summary table

| # | Batch | Target File(s) | Dependencies | Can Parallel With |
|---|-------|----------------|--------------|-------------------|
| 1 | B1 | `frontend/src/pages/ComingSoonPage.tsx` (+ `.test.tsx`) — **NEW** | None | #2 |
| 2 | B1 | `frontend/src/pages/ProjectSettingsPage.tsx` (+ `.test.tsx`) | None | #1 |
| 3 | B2 | `frontend/src/routes/index.tsx` | #1 | #4 |
| 4 | B2 | `frontend/src/components/TopNav.tsx` (+ `.test.tsx`) | #1, #2 (behavioral) | #3 |
| 5 | B3 | DELETE `SettingsPage.tsx`, DELETE `SettingsPage.test.tsx`; edit `hooks/useUserManagement.ts:5`, `api/users.ts:26` | #3, #4 | #6 |
| 6 | B3 | `frontend/src/pages/ProjectMembersPage.tsx:127-131` | None | #5 |

### Developer assignment tracks

- **Track A — IA spine (critical path):** `#1 → #3 → #4 → #5`. Owns the page
  primitive → route rewire → nav/profile-menu rewire → SettingsPage deletion.
  Gates Batch 3.
- **Track B — Project Settings shell (parallel):** `#1 (sync) → #2 → #6`.
  Rebuilds the two-column layout, then the `ProjectMembersPage` back-link fix
  (same page family). Disjoint files from Track A.
- **Track C — Tests & verification (parallel, light):** runs after each source
  task to extend co-located tests; can fold into A/B if devs co-own tests.

**Recommended merge order:** `#1 → (#2 ∥ #3 ∥ #4) → (#5 ∥ #6)`. #5 must merge
only after both #3 and #4 are in.

---

## Task 1 — Create `ComingSoonPage` placeholder page + test

**Batch:** 1 · **Type:** CREATE · **Dependencies:** None · **Parallel with:** #2

### Description

Create a reusable "Coming Soon" placeholder page that renders inside the app
shell. This did not previously exist (verified: no `Coming Soon` string or page
exists in `frontend/src`). It will be the target for two future surfaces in this
ticket (`/settings` platform, `/account` account) and is the convention for any
section whose navigation entry ships before its content.

**Files:**
- `frontend/src/pages/ComingSoonPage.tsx` (NEW)
- `frontend/src/pages/ComingSoonPage.test.tsx` (NEW)

**`ComingSoonPage.tsx` shape & conventions:**

- **Named export** `ComingSoonPage` (named-export convention is consistent with
  sibling pages — do not default-export).
- **Props interface:** `{ title?: string }`, default `title = 'Coming Soon'`.
- **Surface:** use the shared `Card` primitive from `frontend/src/components/ui/`
  (do NOT create a new card component). Wrap content in `<Card className="p-4 ...">`.
- **Container:** replicate `ProjectSettingsPage`'s container style —
  `mx-auto max-w-2xl space-y-6 p-4` — for visual consistency (this is the page
  body style the plan calls out). Keep the outer container class identical.
- **Inside the Card:**
  - **Heading:** render the `title` prop. Use the heading element/class matching
    the project's existing heading treatment (`<h1>` with a `text-2xl font-semibold`-style
    class, matching sibling pages).
  - **Description paragraph:** `<p className="text-sm text-muted-foreground">`
    with generic body copy (e.g. "This section isn't available yet.") — keep it
    non-feature-specific since the page is reused.
- Use the `cn` utility (`frontend/src/components/ui/cn.ts`) for any class
  composition.
- **No data fetching, no hooks, no routing logic** — pure presentational leaf.

**`ComingSoonPage.test.tsx` shape (Vitest 3 + Testing Library):**

- Co-located next to source per `AGENTS.md`.
- Cases:
  1. Renders the default heading (`'Coming Soon'`) and the muted description.
  2. Respects the `title` prop — when passed `title="Settings"`, the heading
     text becomes `"Settings"` (default is NOT rendered).
- Query priority per `AGENTS.md`: `getByRole('heading', ...)` > `getByText`.
  Avoid `getByTestId`.
- Plain `render(<ComingSoonPage />)` should suffice (no router/provider needed
  unless `Card` requires it — mirror `ProjectSettingsPage.test.tsx`'s harness if so).

### Acceptance Criteria

- [ ] `frontend/src/pages/ComingSoonPage.tsx` exists with a **named** export `ComingSoonPage`.
- [ ] Accepts optional `title` prop, default `'Coming Soon'`.
- [ ] Renders inside a shared `Card` (from `components/ui/`) with `p-4`.
- [ ] Outer container uses `mx-auto max-w-2xl space-y-6 p-4`.
- [ ] Heading element present; description is a `<p className="text-sm text-muted-foreground">`.
- [ ] No new UI primitive created — reuses `Card` and `cn`.
- [ ] `ComingSoonPage.test.tsx` passes: default heading + description render; `title` prop overrides heading.
- [ ] `npm test -- ComingSoonPage` green; `tsc` clean; no `any`.

### Dependencies

None.

---

## Task 2 — Rebuild `ProjectSettingsPage` as two-column layout + broaden management gate

**Batch:** 1 · **Type:** MODIFY · **Dependencies:** None · **Parallel with:** #1

### Description

Replace the current single-column shell (`ProjectSettingsPage.tsx:53`,
`mx-auto max-w-2xl space-y-6 p-4`) with a two-column layout: a left navigation
sidebar listing setting sections, and a right content pane showing the active
section. Simultaneously broaden the in-page management gate from **Platform-Admin
only** (`useRequirePlatformAdmin()` at `ProjectSettingsPage.tsx:30`) to
**Platform-Admin OR Project-Admin** (`canManage = isPlatformAdmin || isProjectAdmin`),
mirroring the canonical gate at `ProjectMembersPage.tsx:52-60`.

**Files:**
- `frontend/src/pages/ProjectSettingsPage.tsx` (EDIT)
- `frontend/src/pages/ProjectSettingsPage.test.tsx` (EDIT)

### Layout rebuild — `ProjectSettingsPage.tsx`

1. **Outer container:** change from single-column `max-w-2xl` to a two-column
   flex. Keep page padding `p-4`; wrap in a horizontal `flex gap-*`. Right pane
   occupies `flex-1`; sidebar is `w-48 shrink-0`.
   - There is **NO** existing sidebar component (verified) — build it inline with
     plain Tailwind + `cn`. **Do NOT** create a new shared `Sidebar` component in
     `components/ui/` (out of scope for SLYK-03).

2. **Section config array:** introduce a local array of
   `{ id: SectionId; label: string }` where `SectionId = 'general' | 'members' | 'labels'`:
   - `general` → "General"
   - `members` → "Members"
   - `labels` → "Labels"
   The sidebar maps over this array to render a button per section. **This config
   is the extension point** — future sections append trivially.

3. **Active-section state:** `const [active, setActive] = useState<SectionId>('general')`.
   Sidebar buttons call `setActive(id)`; the active button gets a distinct style
   (e.g. `bg-muted`/font-weight) via `cn(...)`. Use a plain `<button>` styled
   with Tailwind; set `aria-current` on the active item.

4. **Right content pane — render by active section:**
   - **General** → hosts `ProjectNameSection` + `ProjectColumnsManager`.
   - **Members** → a `<Link to={`/projects/${slug}/members`}>` (**LINK** approach,
     not an embed of the members page — preserves `ProjectMembersPage` as the
     single source of truth). Relocate the existing Members `<Link>` into this pane.
   - **Labels** → hosts `LabelManager`.

5. **Gate broadening — the core logic change:**
   - Add: `const { isProjectAdmin } = useCurrentProjectMembership(slug);`
     (from `hooks/useProjectMembers.ts`).
   - Keep the existing platform-admin source and combine:
     `const canManage = isPlatformAdmin || isProjectAdmin;` — exactly mirroring
     the expression form at `ProjectMembersPage.tsx:52-60`.
   - Gate **all management UI** (rename flow, columns editing, label editing) on
     `canManage`. When `!canManage`, render sections read-only / hide management
     controls — consistent with `ProjectMembersPage`'s treatment of non-admins.
   - **CRITICAL — loading state:** `useCurrentProjectMembership` returns
     `{ membership, isProjectAdmin }` with **no** loading flag (verified). Read
     loading separately from `useProjectMembers(slug).isLoading` (or
     `useProject(slug)` as appropriate). Handle loading explicitly so the page
     does not flash management UI then hide it — render a neutral/loading state
     until membership resolves.

6. **Preserve existing data hooks** (project fetch, rename mutation). This task
   changes layout + gate only — not data flow. Project deactivation is **out of
   scope** (DEL-04 — `types/project.ts` has no `active` field); do not invent it.

### Test updates — `ProjectSettingsPage.test.tsx`

Existing tests assert heading / `LabelManager` / `ColumnsManager` / admin-gate /
rename-flow. Update/extend:

- [ ] Sidebar renders all three sections ("General", "Members", "Labels").
- [ ] Default active section is General; its content (name/columns) visible on
      initial render.
- [ ] Clicking "Members" switches the right pane to the Members section (shows
      the `<Link>`); clicking "Labels" shows `LabelManager`.
- [ ] **Gate — admin (`canManage === true`):** management UI visible (rename
      flow, columns editing) — simulate `isProjectAdmin: true` OR platform-admin.
- [ ] **Gate — member (`canManage === false`):** management UI NOT rendered
      (read-only); section navigation still works.
- [ ] **Loading state:** before membership resolves, management UI is not shown
      (no flash) — mock the loading branch distinctly.

Mock guidance: mock `useCurrentProjectMembership` to return
`{ isProjectAdmin: true/false }` per case; mock `useProjectMembers` for the
loading branch.

### Acceptance Criteria

- [ ] Page renders a two-column layout: left sidebar `w-48 shrink-0` (section
      list from config array), right content pane `flex-1`.
- [ ] `useState<SectionId>('general')` drives the active section; sidebar click
      switches content; active item visually distinct + `aria-current`.
- [ ] General section = `ProjectNameSection` + `ProjectColumnsManager`.
- [ ] Members section = `<Link to={/projects/:slug/members}>` (link, not embed).
- [ ] Labels section = `LabelManager`.
- [ ] Gate uses `canManage = isPlatformAdmin || isProjectAdmin` via
      `useCurrentProjectMembership(slug)`, mirroring `ProjectMembersPage.tsx:52-60`.
- [ ] Management UI visible iff `canManage`; member sees read-only / no
      management controls.
- [ ] Loading state handled (no flash), reading loading from the underlying
      `useProjectMembers(slug)` query.
- [ ] No new shared `Sidebar` component created (inline Tailwind + `cn` only).
- [ ] `ProjectSettingsPage.test.tsx` updated and passing.
- [ ] `tsc` clean; no `any`; `AGENTS.md` style respected.

### Subtasks

1. Replace outer shell with two-column flex + section config array +
   `useState<SectionId>` + sidebar render.
2. Wire right pane to render General/Members/Labels by active section.
3. Broaden gate to `canManage` via `useCurrentProjectMembership`; add explicit
   loading handling; gate all management UI.
4. Update tests (sidebar, switching, both gate branches, loading).

### Dependencies

None. (The Members `<Link>` target already exists at `ProjectMembersPage`;
`useCurrentProjectMembership` already exists in `hooks/useProjectMembers.ts`.)

---

## Task 3 — Rewire `routes/index.tsx`: `/settings` → Coming Soon, add `/account`

**Batch:** 2 · **Type:** MODIFY · **Dependencies:** #1 · **Parallel with:** #4

### Description

After #1 ships `ComingSoonPage` (named export, optional `title` prop), rewire
the router in `frontend/src/routes/index.tsx`.

**File:** `frontend/src/routes/index.tsx` (only).

### Changes

1. **Imports (top, lines 1–18):**
   - **Remove** `import { SettingsPage } from '@/pages/SettingsPage';` (line 12).
   - **Add** `import { ComingSoonPage } from '@/pages/ComingSoonPage';`
     (alphabetical position near the other page imports, ~line 8).

2. **`/settings` block (lines 111–114):** Keep the `RequirePlatformAdmin`
   layout-route wrapper **exactly as-is** (PA-only; non-admin renders
   `ForbiddenPage` — unchanged). Change the index child from `<SettingsPage />`:
   ```tsx
   children: [{ index: true, element: <ComingSoonPage title="Settings" /> }]
   ```
   Preserve `path: '/settings'` and the guard — only the element changes.

3. **Add `/account` route:** Inside the `RequireAuth` + `AppLayout` +
   `RouteErrorBoundary` children (same nesting level as `/settings`, `/forbidden`),
   add a sibling route **without** `RequirePlatformAdmin` (everyone authenticated
   can reach it):
   ```tsx
   { path: '/account', element: <ComingSoonPage title="Account Settings" /> }
   ```
   Placement: immediately before or after the `/settings` block, before
   `/forbidden` (line ~116).

### Code anchors

- Import block ends at line 18; line 12 is the `SettingsPage` import to delete.
- `/settings` route object literal: lines 111–114.
- `RequirePlatformAdmin` element: line 112 (untouched).
- Index child `element`: line 113 (rewire target).
- `/forbidden`: line 116 (sibling anchor for `/account` insertion).

### Acceptance Criteria

- [ ] `SettingsPage` import gone; `ComingSoonPage` import present.
- [ ] `/settings` index child renders `<ComingSoonPage title="Settings" />`;
      still wrapped in `RequirePlatformAdmin`.
- [ ] `/account` route exists under `RequireAuth`/`AppLayout`/`RouteErrorBoundary`
      (NO admin guard) → `<ComingSoonPage title="Account Settings" />`.
- [ ] Non-admin deep-linking `/settings` still hits `RequirePlatformAdmin` →
      `ForbiddenPage` (behavior preserved).
- [ ] `npm test -- frontend/src/routes` green; no TS errors from the removed
      import anywhere.
- [ ] `routes/index.test.tsx` — note it only tests a local `IndexRedirect` copy
      (no settings assertions); no edit required unless a new assertion is added.

### Dependencies

**#1** (ComingSoonPage must exist with named export). **Disjoint files:** touches
only `routes/index.tsx` (does NOT touch `TopNav.tsx`).

### Risks/notes

- `RequirePlatformAdmin` renders `ForbiddenPage` in-place (no redirect) —
  verified; non-admin `/settings` behavior is unchanged.
- `/account` deliberately has no admin guard — per ticket, Account Settings is
  available to everyone.

---

## Task 4 — Rewire `TopNav.tsx` (nav + profile menu) + test

**Batch:** 2 · **Type:** MODIFY · **Dependencies:** #1, #2 (behavioral) · **Parallel with:** #3

### Description

`frontend/src/components/TopNav.tsx` + `frontend/src/components/TopNav.test.tsx`.
This is the core IA rewiring. Touches two files; **disjoint from Task #3**.

### Subtask A — Move the Settings nav item into the project-scoped render path

Currently `ADMIN_NAV_LINKS` (lines 45–47) is a single
`{ to: '/settings', label: 'Settings', end: false, icon: Settings }` entry
rendered only when `isAdmin` (lines ~187–204) as a plain unconditional `NavLink`.

- **Remove** the `ADMIN_NAV_LINKS` array (lines 45–47) entirely and its render
  block (lines ~187–204). **Keep** the `Settings` icon import (needed for the
  profile-menu "Settings" entry).
- **Add** a **Project Settings** item rendered after the `PUBLIC_NAV_LINKS.map`
  loop (lines ~153–185):
  - **Label:** `"Project Settings"`, icon `Settings`.
  - **Enabled href:** `` `/projects/${projectSlug}/settings` `` (same `projectSlug`
    derivation as Board/Reports — lines ~105–107: `params.slug ?? lastSelectedSlug`).
  - **Disabled when `!hasProject`:** reuse `<DisabledNavItem label="Project Settings" icon={Settings} hint="Select a project first" />`
    (component at lines 61–86; same hint string as Board/Reports).
  - **Visibility gate:** `canManageProject = isPlatformAdmin || isProjectAdmin`.
    Consume `useCurrentProjectMembership(projectSlug)` (`hooks/useProjectMembers.ts`)
    **only when `projectSlug` is present** (the hook requires a slug — guard the
    call so it isn't invoked with `undefined`). `isPlatformAdmin` comes from the
    existing `isAdmin` (sync off auth store, line ~110).
  - **CRITICAL — flash-avoidance:** `useCurrentProjectMembership` exposes **no
    loading flag** — until the roster resolves, `isProjectAdmin` is
    `undefined`/`false`. To prevent a Project Member from briefly seeing the
    item, **default-hide**: render Project Settings only when `isPlatformAdmin`
    is true **or** `isProjectAdmin` is explicitly truthy. Never render on the
    `undefined` state. (Platform admins see it immediately — `isAdmin` is sync.)
  - **No-project decision (document in code):** When no project is selected,
    **hide Project Settings entirely** (do not render), because Project Admin is
    meaningless without a project. Rationale: Board/Reports need a disabled state
    because their content is navigable once a project is chosen; Project Settings
    has no existence outside a project. The acceptance criteria allow either
    hide-or-disabled; this task picks **hide** and documents why.

**Code shape (after the `PUBLIC_NAV_LINKS.map(...)` loop):**
```tsx
{(() => {
  if (!hasProject) return null;          // hide — no project context
  if (!canManageProject) return null;    // hide — flash-avoidance + Project Member exclusion
  return (
    <li>
      <NavLink to={`/projects/${projectSlug}/settings`} className={navLinkClass}>
        <Settings className="h-4 w-4" aria-hidden="true" />
        <span>Project Settings</span>
      </NavLink>
    </li>
  );
})()}
```
(In practice `DisabledNavItem` is not reached for Project Settings since the
no-project branch hides it. If Board/Reports parity is later preferred, swap the
`!hasProject` branch to render `DisabledNavItem` — keep the decision documented.)

### Subtask B — Add profile-menu entries in `avatarBlock` (lines ~222–285)

Insert into `<DropdownContent>` between the Theme group's trailing
`<DropdownSeparator/>` and the Sign out item:

1. **"Settings"** (Platform Admin only):
   - Precede with `<DropdownSeparator />`.
   - Render `{isAdmin && <DropdownItem onSelect={() => navigate('/settings')}>… Settings …</DropdownItem>}`.
   - `isAdmin` in scope (line ~110); `navigate` in scope (line ~109).
   - Target `/settings` exists via #3 (Coming Soon).

2. **"Account Settings"** (everyone):
   - Precede with `<DropdownSeparator />`.
   - Render `<DropdownItem onSelect={() => navigate('/account')}>… Account Settings …</DropdownItem>` (no gate).
   - Target `/account` exists via #3.

   Add a leading lucide icon to each item (e.g. `Settings` / `User`), matching
   the existing theme-item pattern (icon + `<span>` label). Radix auto-closes the
   menu on `onSelect` — no manual `setOpen` needed.

Keep `handleSignOut` **verbatim** — unchanged.

### Subtask C — Update `TopNav.test.tsx`

- **Replace** existing "Settings link" assertions (admin shows / member hides /
  no-project behavior) with **Project Settings** assertions:
  - Platform Admin with a selected project → "Project Settings" visible.
  - Project Admin of the selected project → "Project Settings" visible (mock
    `useCurrentProjectMembership` to return admin role).
  - Project Member of the selected project → "Project Settings" **not** visible.
  - No project selected → "Project Settings" **not present** (hidden).
  - **Flash assertion:** when membership is resolving (mock loading) and the user
    is **not** a Platform Admin → "Project Settings" **not** rendered (default-hidden).
- **Add profile-menu assertions** (open dropdown, assert):
  - Platform Admin → "Settings" entry present + "Account Settings" present.
  - Non-admin → "Settings" entry **absent**, "Account Settings" present.
- Preserve the existing mount harness (`MemoryRouter` + `QueryClientProvider` +
  `ThemeProvider` + `TooltipProvider`) and the auth-store seed pattern. New
  mocks: `useCurrentProjectMembership`, `useProjectMembers` query resolution.

### Acceptance Criteria

- [ ] `ADMIN_NAV_LINKS` array + its render block removed.
- [ ] "Project Settings" nav item: visible only to Platform Admin or Project
      Admin of the selected project; hidden from Project Member; hidden when no
      project selected.
- [ ] During membership loading (non-platform-admin), "Project Settings" is
      **not** rendered (no flash).
- [ ] Profile menu shows "Settings" for Platform Admin only; "Account Settings"
      for everyone.
- [ ] "Settings" → navigates `/settings`; "Account Settings" → navigates `/account`.
- [ ] `handleSignOut` unchanged; existing Theme behavior unchanged.
- [ ] `npm test -- frontend/src/components/TopNav.test.tsx` green.

### Dependencies

- **#1** (ComingSoonPage — profile-menu targets render Coming Soon).
- **#2** (rebuilt `ProjectSettingsPage` — behavioral correctness of the target;
  the link works regardless, but the rebuilt page is the IA intent).
- **#3** (`/settings` + `/account` routes must be registered for `navigate()`
  targets) — **file-disjoint** (no `routes/index.tsx` edit here).

### Risks/notes

- New coupling: TopNav has **never** consumed per-project role
  (`useCurrentProjectMembership`). This introduces a network call into TopNav;
  ensure it's only invoked when `projectSlug` is present and loading is handled
  by default-hide.
- `useRequirePlatformAdmin()` is sync — Platform Admins see Project Settings
  immediately, sidestepping the loading-flash risk.

---

## Task 5 — Remove old global `SettingsPage` + reword stale comments

**Batch:** 3 · **Type:** DELETE + EDIT · **Dependencies:** #3, #4 · **Parallel with:** #6

### Description

Single, unambiguous IA: the workspace member-management capability is superseded
by DEL-02 project members + the future platform Settings (Coming Soon for now).
Delete the old roster page and reword stale comments referencing it.

> ⚠️ **Must not merge before #3 and #4** — otherwise the build breaks on a
> dangling `SettingsPage` import (routes) and nav reference (TopNav).

**Files:**
- DELETE `frontend/src/pages/SettingsPage.tsx`
- DELETE `frontend/src/pages/SettingsPage.test.tsx`
- EDIT `frontend/src/hooks/useUserManagement.ts:5` (stale comment)
- EDIT `frontend/src/api/users.ts:26` (stale comment)

### Changes

1. **Delete** `frontend/src/pages/SettingsPage.tsx` and
   `frontend/src/pages/SettingsPage.test.tsx`.
2. **Reword stale comments** (the `/users` endpoints + `useUserManagement`
   remain in use elsewhere — **do NOT** remove them, only reword the comments):
   - `hooks/useUserManagement.ts:5` — comment reads "so the SettingsPage roster
     refetches on success". Reword to drop the `SettingsPage` reference.
   - `api/users.ts:26` — comment reads "so SettingsPage can render the management
     table". Reword to drop the `SettingsPage` reference.

> The `routes/index.tsx` import/route removal and the `TopNav.tsx`
> `ADMIN_NAV_LINKS` removal are handled by #3 and #4 respectively — **do not**
> duplicate them here (they would conflict).

### Acceptance Criteria

- [ ] `frontend/src/pages/SettingsPage.tsx` deleted.
- [ ] `frontend/src/pages/SettingsPage.test.tsx` deleted.
- [ ] `hooks/useUserManagement.ts:5` comment reworded — no `SettingsPage` reference.
- [ ] `api/users.ts:26` comment reworded — no `SettingsPage` reference.
- [ ] `/users` endpoints + `useUserManagement` remain (not removed).
- [ ] No remaining `SettingsPage` references in `frontend/src` (`rg SettingsPage`
      returns nothing).
- [ ] Build green (`tsc -b && vite build`); `npm test` green.

### Dependencies

- **#3** (routes `SettingsPage` import+route already removed).
- **#4** (`ADMIN_NAV_LINKS` Settings entry already removed).

### Risks/notes

- Until the future platform Settings ships, platform-wide member management has
  no UI. The Coming Soon page is the explicit placeholder (Open Question #4).

---

## Task 6 — Fix `ProjectMembersPage` back-link: raw `<a href>` → router `<Link>`

**Batch:** 3 · **Type:** EDIT · **Dependencies:** None · **Parallel with:** #5

### Description

`frontend/src/pages/ProjectMembersPage.tsx:127-131` has a raw `<a href>` back-link
to `/projects/:slug/settings` — it currently triggers a full-page reload instead
of client-side navigation. Convert it to a router `<Link>` (Open Question #2 in
the plan; independent fix regardless of the embed-vs-link decision).

**File:** `frontend/src/pages/ProjectMembersPage.tsx` (only).

### Changes

- The file currently imports only `Navigate`, `useParams` from `react-router`
  (verified). **Add** `Link` to the import.
- Convert lines 127–131:
  ```tsx
  // before
  <a href={`/projects/${slug}/settings`} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
      Settings
  </a>
  ```
  to:
  ```tsx
  // after
  <Link to={`/projects/${slug}/settings`} className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
      Settings
  </Link>
  ```
- Preserve the `ArrowLeft` icon, the className, and the label text exactly.

### Acceptance Criteria

- [ ] `Link` imported from `react-router` in `ProjectMembersPage.tsx`.
- [ ] Back-link at lines ~127–131 renders `<Link to={/projects/:slug/settings}>`
      (client-side navigation — no full-page reload).
- [ ] Icon, className, and label text unchanged.
- [ ] `tsc` clean; `npm test -- ProjectMembersPage` green (no assertion broken).

### Dependencies

None. (Independent file; grouped in Batch 3 for merge safety.)

---

## Notes for implementers

- **Re-derive line numbers before editing.** Line anchors were accurate as of
  2026-06-30 but shift as earlier tasks in the batch land.
- **`require-projects` test harness** for `TopNav`/pages: `MemoryRouter` +
  `QueryClientProvider` + `ThemeProvider` + `TooltipProvider` + auth-store seed
  (see `TopNav.test.tsx` existing harness).
- **Query priority** (`AGENTS.md`): `getByRole` > `getByLabelText` > `getByText`
  > `getByTestId` (last resort).
- **Style** (`AGENTS.md`): Prettier; 100 cols; 4-space JSX / 2-space JS;
  trailing commas; `import type` for type-only imports; no `any`; no
  `console.log`; one component per file.
