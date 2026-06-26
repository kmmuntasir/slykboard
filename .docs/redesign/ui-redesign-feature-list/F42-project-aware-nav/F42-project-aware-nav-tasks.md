# F42 — Project-aware nav (Board/Reports muted+disabled+tooltip when project-less): Plan + Task Breakdown

> **Feature:** F42 — Project-aware nav (Board/Reports muted+disabled+tooltip when project-less) (Phase 1 — Chrome · Feature)
> **Feature index:** [`ui-redesign-features.md`](../../ui-redesign-features.md)
> **Slug:** `SLYK` · **Depends on:** F36 (done) + F37 (done) · **PRD ref:** §4.5 (nav visibility rule), §9.1 (decided), D5 (tooltip-on-disabled), D9/D14 (routing scope — Reports relocation only)
> **Sources:** PRD `[ui-redesign-plan.md](../../ui-redesign-plan.md)`, rules, metadata. Deps: [F36](../F36-dropdown-tooltip-primitives/F36-dropdown-tooltip-primitives-tasks.md); [F37](../F37-navbar-fullwidth-brand-clusters/F37-navbar-fullwidth-brand-clusters-tasks.md).

---

## 1. F42 Recap

**Goal:** Make Board/Reports nav reflect project scope per the decided rule, without hiding the menu.

**Ships:** With a project selected, Board → `/projects/:slug` (enabled). With no project (fresh login, `/projects`, cleared store), Board and Reports render muted + disabled + a "Select a project first" tooltip; Settings stays enabled (admin). `/projects` is the natural selection landing with a clear empty state. Reports is **disabled-until-F49** in all cases (its target route `/projects/:slug/reports` does not exist yet).

**Acceptance (definition of done):**
- Project present: Board enabled and routes to `/projects/:slug`; Reports stays muted + disabled + tooltip (disabled-until-F49 — see D3).
- Project absent: Board and Reports both `disabled` + muted class + Tooltip "Select a project first"; **not hidden** (menu structure intact).
- Settings always enabled (admin only), independent of project scope.
- `/projects` page: "Select a project" heading + project list + Create CTA, `EmptyState` with `FolderOpen` icon.
- Test: disabled state has the tooltip; enabled state routes Board correctly to the open project.

**Edge cases resolved up front:**
- **D5 a11y trap (disabled elements aren't tooltip-reachable)** → **Decision: confirmed solved upstream by F36.** Radix Tooltip's `TooltipTrigger asChild` wraps the trigger in a focusable span; the disabled nav item renders as `<span role="link" aria-disabled="true" tabIndex={-1}>` (NOT a native `<button disabled>`, which Radix can't wrap focus onto). The Radix wrapper span receives `pointerenter`/`focus`, so the tooltip fires on hover and (via the wrapper's own focusability) keyboard focus. F42 verifies this in the test suite (T3).
- **Reports target points to `/projects/:slug/reports` which doesn't exist until F49** → **Decision (OWNER SIGN-OFF, option 2 — "cleaner"):** Reports stays **disabled-until-F49** in ALL cases. When a project is present, Board is enabled + routed to `/projects/:slug`; Reports stays muted + disabled with the tooltip "Reports coming soon" (because routing it to a non-existent `/projects/:slug/reports` would 404, and routing it to the old `/reports` is wrong-scope and would need a flip in F49). F49 flips Reports to enabled and sets its target to `/projects/:slug/reports`.
  - **Alternative rejected (option 1):** temporarily route Reports to the existing `/reports` route. Works today but (a) wrong scope (global, not project-scoped), (b) requires a flip in F49, (c) creates a transient inconsistency with the PRD §4.5 rule. Documented here for traceability; not implemented.

---

## 2. Codebase Analysis Summary

- **State:** Greenfield for the project-scoping branch; F36 (Tooltip) and F37 (nav structure) are merged and active. `TopNav.tsx` already imports the F36 Tooltip primitives and uses them for the F41 health indicator — the seam F42 reuses exists.
- **Existing structure this feature builds on:**
  - `frontend/src/components/TopNav.tsx` (~371 lines): `PUBLIC_NAV_LINKS` (`:53-56` — Board `/` `end:true`, Reports `/reports`), `ADMIN_NAV_LINKS` (`:58-60` — Settings `/settings`). NavLink className callback via `cn()` (`:167-171`). `navItems` JSX block at `:173-209` maps both arrays to `<NavLink>` — this is the branch point F42 rewrites. Neither `useProjectStore` nor `useParams` is currently imported/called.
  - `frontend/src/stores/useProjectStore.ts`: `{ lastSelectedSlug: string|null, setLastSelectedSlug, clear }`, persisted under key `'slyk-project'`. F42 reads `lastSelectedSlug`.
  - `react-router`'s `useParams<{slug:string}>()`: returns `{ slug }` on `/projects/:slug`, `{}` on `/projects` listing and `/`. F42 composes: `useParams<{slug:string}>().slug ?? useProjectStore(s => s.lastSelectedSlug)`.
  - `frontend/src/components/ui/Tooltip.tsx` (F36): exports `Tooltip`, `TooltipTrigger` (forwards `asChild`), `TooltipContent`, `TooltipProvider`. `TooltipProvider` is mounted once at `main.tsx:30` (F41) — F42 uses `<Tooltip>`/`<TooltipTrigger asChild>`/`<TooltipContent>` directly without re-wrapping in a provider.
  - `frontend/src/pages/ProjectsPage.tsx` (`:59`): heading is literally `"Projects"` (F42 changes to `"Select a project"`). `EmptyState` (`:62-78`) has no `icon` prop wired — F42 adds `FolderOpen` from lucide.
  - `frontend/src/routes/index.tsx:77`: `/reports` route exists (global). `/projects/:slug/reports` does **NOT** exist (F49 creates it) — confirms D3.
- **Prior art / partial work:** none — F42 is the first feature to scope nav to the project.
- **File paths the plan references that do NOT exist yet:** none. All three target files exist; this feature only modifies.
- **Project rules** this plan must satisfy: no `any`; PascalCase; 4-space JSX / 2-space TS; ≤100 cols; `cn()` for classes; RTL `getByRole` priority; co-located `*.test.tsx`; git `SLYK-F42:` prefix; rebase-only.
- **Hidden coupling to plan for:**
  - **Test harness breakage.** `TopNav.test.tsx:284-299` ("always renders Board + Reports") and `:319-326` (icon assertions) use `MemoryRouter initialEntries={['/']}` + `localStorage.clear()` in `beforeEach` → project-less → F42's disabled state turns Board/Reports from `<a>` into `<span aria-disabled>`. Those `getByRole('link', …)` calls break. T3 must seed a project for enabled-state tests.
  - **Reports-disabled-until-F49 (D3).** Reports is disabled in BOTH branches. The `PUBLIC_NAV_LINKS` array needs per-item disabled predicates. T1 splits the render.
  - **Persisted store leaking across tests.** `beforeEach` does `localStorage.clear()` which wipes `'slyk-project'`, so by default every test starts project-less.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Project detection source | **`useParams<{slug:string}>().slug ?? useProjectStore((s) => s.lastSelectedSlug)`** | URL param is primary (matches the open board), persisted store is the fallback for `/` and `/projects` listing. Non-null → "project present". Mirrors the `useProjectStore` doc comment (`:11` "URL param is primary"). |
| D2 | Disabled-render primitive | **`<span role="link" aria-disabled="true" tabIndex={-1} className="… muted pointer-events-none">` wrapped in `<Tooltip><TooltipTrigger asChild><span>…</span></TooltipTrigger><TooltipContent>Select a project first</TooltipContent></Tooltip>`** | A native `<button disabled>` is not tooltip-reachable (D5) and a `<NavLink>` always renders `<a href>` (no native disabled). The `<span role="link" aria-disabled>` is semantically a disabled link, is focusable via the Radix `asChild` wrapper span (so the tooltip fires on focus + hover), and `pointer-events-none` blocks click navigation. |
| D3 | Reports target before F49 | **DISABLED-UNTIL-F49 (option 2).** Reports is muted + disabled + tooltip in **both** project-present and project-absent states. F49 flips Reports to enabled and sets `to={`/projects/${slug}/reports`}`. | `/projects/:slug/reports` does not exist — routing there now would 404; routing to the old `/reports` is wrong-scope and would need a flip in F49. Owner sign-off: option 2 (spec's "cleaner" recommendation). |
| D4 | ProjectsPage heading + empty icon | **Heading text `"Select a project"`; `<FolderOpen>` from lucide passed to `EmptyState`'s icon slot.** | PRD §4.5 verbatim: "The `/projects` page is the project-selection landing. `EmptyState` with `FolderOpen` icon." |
| D5 | Scope | **`TopNav.tsx` (M) + `TopNav.test.tsx` (M) + `ProjectsPage.tsx` (M).** No `routes/index.tsx`, no `main.tsx`, no `AppLayout`, no `index.css`. | D9/D14: Reports relocation is the ONLY allowed routing/auth change, and that's F49's job. F42 is pure chrome. |

> **Out of F42 scope (explicitly deferred):** Reports **enabled** state + its `/projects/:slug/reports` route → **F49**. Any route guard / auth change → none (D9/D14). Schema → none.

> **Owner sign-off (resolved 2026-06-27):**
> - **D3 → Reports disabled-until-F49** (option 2 — the spec's "cleaner" recommendation). Temporarily-route-to-`/reports` alternative (option 1) rejected.
> No further sign-off blocking F42.

---

## 4. Architecture Overview (Target Tree)

```
frontend/src/
├── components/
│   ├── TopNav.tsx          # M — add useProjectStore+useParams; branch PUBLIC_NAV_LINKS
│   │                       #     into enabled <NavLink> vs disabled <span>+<Tooltip>;
│   │                       #     Reports always disabled (D3). Split Board/Reports render.
│   └── TopNav.test.tsx     # M — seed project for enabled-state tests; add disabled-state
│                           #     + tooltip tests; fix broken "always renders Board+Reports"
│                           #     assertions.
└── pages/
    └── ProjectsPage.tsx    # M — heading "Projects" → "Select a project"; add FolderOpen
                            #     icon to EmptyState.
```

---

## 5. Parallelization Strategy

Solo sequential: T1 (TopNav scoping) → T3 (tests) → T2 (ProjectsPage) → T4 (verify). T1 defines the DOM contract T3 asserts; T2 is disjoint but logic-coupled.

### Summary table

| # | Batch | Target files | Depends on | Can parallel with |
|---|-------|-------------|------------|-------------------|
| **T1** | A | `TopNav.tsx` | F36, F37 | T2 (disjoint) |
| **T2** | B | `ProjectsPage.tsx` | — | T1 (disjoint) |
| **T3** | C | `TopNav.test.tsx` | T1 | — |
| **T4** | D | (verify-only) | T1, T2, T3 | — |

---

## 6. Tasks

### T1 — Scope TopNav public links to project (Board enabled-on-project, Reports disabled-until-F49)

**Batch:** A · **Depends on:** F36, F37 · **Parallel with:** T2

**Description:** Rewrite the `navItems` JSX in `TopNav.tsx`. Add `useParams` + `useProjectStore` reads (D1). Board: render `<NavLink to={`/projects/${slug}`}>` when `slug` non-null; render the disabled `<span role="link" aria-disabled>` + Tooltip ("Select a project first") when null. Reports: **always** render disabled span + Tooltip (D3); tooltip "Reports coming soon" when project present, "Select a project first" when not. Settings unchanged.

Add imports: `useParams` from `react-router`, `useProjectStore` from `@/stores/useProjectStore`, `Tooltip`/`TooltipTrigger`/`TooltipContent` from `@/components/ui/Tooltip`.

Add project detection:
```tsx
const params = useParams<{ slug: string }>();
const lastSelectedSlug = useProjectStore((s) => s.lastSelectedSlug);
const projectSlug = params.slug ?? lastSelectedSlug;
const hasProject = projectSlug != null;
```

Disabled nav primitive (D2):
```tsx
function DisabledNavItem({ label, icon: Icon, hint }: {
    label: string; icon: typeof LayoutGrid; hint: string;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span role="link" aria-disabled="true" tabIndex={-1}
                    className={cn('flex cursor-not-allowed items-center gap-1.5 text-sm',
                        'text-muted-foreground/60 pointer-events-none')}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>{label}</span>
                </span>
            </TooltipTrigger>
            <TooltipContent>{hint}</TooltipContent>
        </Tooltip>
    );
}
```

Public links render (replaces uniform `.map`):
```tsx
{PUBLIC_NAV_LINKS.map((link) => {
    const Icon = link.icon;
    const isReports = link.label === 'Reports';
    const disabled = isReports || !hasProject;
    const hint = isReports ? 'Reports coming soon' : 'Select a project first';
    return (
        <li key={link.to}>
            {disabled ? (
                <DisabledNavItem label={link.label} icon={Icon} hint={hint} />
            ) : (
                <NavLink to={`/projects/${projectSlug}`} end={link.end}
                    onClick={() => setOpen(false)} className={navLinkClass}>
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>{link.label}</span>
                </NavLink>
            )}
        </li>
    );
})}
```

**Acceptance Criteria:**
- [ ] `useParams` + `useProjectStore` imported; `projectSlug`/`hasProject` derived per D1.
- [ ] Board renders `<NavLink to={`/projects/${slug}`}>` when `hasProject`; disabled span + "Select a project first" tooltip when not.
- [ ] Reports renders disabled span + tooltip in **both** states (D3); "Reports coming soon" when `hasProject`, "Select a project first" when not.
- [ ] Settings unchanged — still `<NavLink to="/settings">`, admin-only.
- [ ] `cn()` for classes; no `any`; ≤100 cols; 4-space JSX / 2-space TS.
- [ ] `npm run build` passes.

**Dependencies:** F36, F37.

---

### T2 — ProjectsPage: "Select a project" heading + FolderOpen icon

**Batch:** B · **Depends on:** None · **Parallel with:** T1

**Description:** Update `ProjectsPage.tsx` per PRD §4.5. Change heading from `"Projects"` to `"Select a project"`. Add `FolderOpen` lucide icon to `EmptyState`.

```tsx
import { FolderOpen } from 'lucide-react';
// ...
<h1 className="text-2xl font-semibold">Select a project</h1>
// EmptyState gets: icon={<FolderOpen className="h-8 w-8 text-muted-foreground" aria-hidden="true" />}
```

**Acceptance Criteria:**
- [ ] `<h1>` reads "Select a project".
- [ ] `EmptyState` shows `FolderOpen` icon when `projects.length === 0`.
- [ ] Create CTA + list behavior unchanged.

**Dependencies:** None.

---

### T3 — TopNav tests: seed project for enabled-state, add disabled + tooltip coverage

**Batch:** C · **Depends on:** T1 · **Parallel with:** —

**Description:** Fix tests F42 breaks + add both-branch coverage. Add `renderTopNavWithProject(slug)` helper (MemoryRouter initialEntries `['/projects/${slug}']`). Update enabled-state tests to seed a project. Add disabled-state tests (project-less Board `aria-disabled`, tooltip text, Settings still enabled, tabIndex=-1, Reports always disabled).

**Acceptance Criteria:**
- [ ] All pre-existing tests pass after seed-project updates.
- [ ] New disabled-state tests: project-less Board is `aria-disabled`, tooltip text present, Settings still a link.
- [ ] New enabled-state tests: Board `href` is `/projects/:slug`; Reports stays disabled with "Reports coming soon".
- [ ] `npm test` green.

**Dependencies:** T1.

---

### T4 — Integration verification & sign-off

**Batch:** D · **Depends on:** T1, T2, T3

**Description:** Run gates, verify scope.

**Acceptance Criteria:**
- [ ] Committed diff = exactly 3 files (TopNav.tsx + TopNav.test.tsx + ProjectsPage.tsx).
- [ ] `npm run build`, `npm run typecheck`, `npm run test` all exit 0.
- [ ] No routes/index.css/main.tsx/AppLayout leakage.

**Dependencies:** T1, T2, T3.

---

## 7. Final F42 Acceptance Checklist

- [ ] Project present: Board is an enabled `<NavLink>` to `/projects/:slug`; Reports muted + disabled + "Reports coming soon" tooltip (D3).
- [ ] Project absent: Board + Reports both muted + disabled + "Select a project first" tooltip; not hidden.
- [ ] Disabled items: `<span role="link" aria-disabled="true" tabIndex={-1} pointer-events-none>` wrapped in F36 `<Tooltip>` (D2/D5).
- [ ] Settings always enabled (admin), independent of project.
- [ ] `/projects` page heading "Select a project"; EmptyState shows `FolderOpen`.
- [ ] build / typecheck / test exit 0.
- [ ] Committed diff = exactly 3 files.

---

## 8. Schema deltas owned by this feature

**None.** F42 is pure chrome (nav-item state + page heading/icon). No tables, columns, indexes, or migrations.

| Delta | Detail | Migration |
| --- | --- | --- |
| — | — | — |
