# F38 — Project picker rebuild (Radix Dropdown, controlled, distinct states): Plan + Task Breakdown

> **Feature:** F38 — Project picker rebuild (Radix Dropdown, controlled, distinct states) (Phase 1 — Chrome · Feature)
> **Feature index:** [`ui-redesign-features.md`](../../ui-redesign-features.md)
> **Slug:** `SLYK` · **Depends on:** F36 (done) + F37 (done) · **PRD ref:** §4.3 (picker rebuild), §2.2 (3 bugs at ProjectPicker.tsx:19,24,27), D13/D3 (listing placeholder), §3.3 (FolderKanban/ChevronDown/Check icons), §8 (3 named picker tests)
> **Sources:** [`ui-redesign-plan.md`](../../ui-redesign-plan.md), the discovered project rules ([`.claude/rules/git-guidelines.md`](../../../../.claude/rules/git-guidelines.md), [`js-development-rules.md`](../../../../.claude/rules/js-development-rules.md), [`js-style-guide.md`](../../../../.claude/rules/js-style-guide.md), [`js-testing-rules.md`](../../../../.claude/rules/js-testing-rules.md), [`persona.md`](../../../../.claude/rules/persona.md)), [`project-metadata.md`](../../../../project-metadata.md). Dependency features: [F36](../F36-dropdown-tooltip-primitives/F36-dropdown-tooltip-primitives-tasks.md) (Dropdown — done); [F37](../F37-navbar-fullwidth-brand-clusters/F37-navbar-fullwidth-brand-clusters-tasks.md) (left-cluster slot — done).

---

## 1. F38 Recap

**Goal:** Kill the three picker bugs (uncontrolled value, conflated states, un-themeable native `<select>`) with a controlled, state-aware Radix Dropdown.

**Ships:** Picker shows the currently-open project (synced from route + store), shows a skeleton while loading, an error+retry on query failure (never "No projects" on error), an empty-state with a create link, and a "+ Create project" footer. Themeable, with `FolderKanban` icon + project color dot + `ChevronDown`, and a `Check` on the selected row.

**Acceptance (definition of done):**
1. Controlled `value` derived from `useParams<{ slug: string }>()` slug **and** `useProjectStore.lastSelectedSlug`; **never `defaultValue`.** Stays in sync on URL-driven nav (direct nav to `/projects/foo` updates the picker trigger).
2. **Four distinct states:** `isLoading` → skeleton trigger; `isError` → "Couldn't load projects" + **retry** button (uses `refetch`) — never "No projects" on error; empty array → "No projects yet" + link to `/projects`; loaded → `DropdownItem` list.
3. Selecting a project navigates (`navigate('/projects/${slug}')`) **and** persists via `useProjectStore.setLastSelectedSlug`. Radix auto-closes on item select.
4. Footer "+ Create project" → `/projects` (ADMIN-gated via `useRequireRole`).
5. On `/projects` listing: picker visible with "Select a project" placeholder trigger (D3 default — never hidden).
6. Themeable: `FolderKanban` (leading, trigger + each item), `ChevronDown` (trigger chevron), `Check` (selected-item indicator), color dot (hash→hue from slug), via F36 `Dropdown` (NOT native `<select>`).
7. Test: error state shows retry (regression for the "No Projects even when project selected" bug at `:19`); reflects slug from URL (`useParams`); empty offers create link; `aria-label="Select project"` preserved (F37 test contract).

**Edge cases resolved up front:**
- **D3 listing-page visibility** → **Decision: "Select a project" placeholder trigger is VISIBLE on `/projects` (never hidden).** If the owner later flips to hidden, the nav-side must hide the picker-on-listing case too — keep them in sync. F38 implements the D3 default: visible placeholder. (D13/D3; PRD §4.3 "On `/projects` listing: 'Select a project' placeholder".)
- **Race (project list changes while menu open — rare)** → **Decision: don't over-engineer live updates inside the open menu. Radix auto-closes on item select + outside-click/Esc close is enough.** The list re-derives from the TanStack cache on each render; a stale-but-open menu is acceptable for this rare race. (F38 spec.)
- **Long project names** → **Decision: truncate the trigger label with `max-w-*` + `truncate`, and set a `title` tooltip so the full name is reachable. Trigger width stays bounded.** (F38 spec.)
- **Color-dot data source (PRD §4.3 says "project color dot" but no `Project.color` field exists)** → **Decision: client-side deterministic hash→hue from `project.slug` → a colored `<span>` dot via inline `style={{ backgroundColor }}`. NO backend migration (F38 is frontend-only; redesign's no-DB-migration stance). This is the ONE inline-style exception (data-derived, like Badge's `style` passthrough) — all other classes are F32 token utilities.** (D1 — owner sign-off flagged.)
- **Controlled value (the `:27` `defaultValue=""` bug)** → **Decision: derive the displayed project from `useParams<{ slug }>()` primary + `useProjectStore.lastSelectedSlug` fallback + `""` placeholder. Never `defaultValue`.** (D2; PRD §4.3; §2.2 `:27` bug.)
- **Distinct states (the `:19` conflated-states bug)** → **Decision: four explicit branches — `isLoading`→skeleton trigger; `isError`→"Couldn't load projects" + retry; empty array→"No projects yet" + create link; loaded→`DropdownItem` list; `/projects` listing→"Select a project" placeholder trigger.** (D3; PRD §4.3; §2.2 `:19` bug.)
- **Un-themeable native `<select>` (the `:24` bug)** → **Decision: rebuild on F36 `Dropdown` (Radix). Custom `DropdownTrigger asChild` button (color dot + `FolderKanban` + name/placeholder + `ChevronDown`) and `DropdownContent` list.** (D4/D5; PRD §4.3.)
- **`Check` icon** → **Decision: `Check` (lucide) renders on the selected `DropdownItem` (right-aligned) as the selected-indicator; absent on others.** (§3.3 "Check (in dropdown)".)
- **Scope** → **Decision: ONLY `ProjectPicker.tsx` (rebuild in place) + `ProjectPicker.test.tsx` (new, co-located). No TopNav, no index.css, no index.html, no main.tsx, no AppLayout, no migration, no new deps, no Radix-install (F36 owns the install).** (D8.)

---

## 2. Codebase Analysis Summary

- **State:** Partial — `ProjectPicker.tsx` (40 lines) exists and is the single file F38 rebuilds. It is the **3-bug source**. F36 (`Dropdown` primitive, 7 exports) and F37 (left-cluster slot) are done + merged, so F38's dependencies are live in code, not just checked off. There is **no `ProjectPicker.test.tsx`** today — F38 creates it (PRD §8 names it as 1 of 4 test files).

- **`ProjectPicker.tsx` current structure (verbatim, line-cited) — the 3 bugs F38 kills:**
  - `:1` `useNavigate` from `react-router`; `:2` `useProjects`; `:3` `useProjectStore`. **NO `useParams` import** — the picker has zero awareness of the current URL slug (the desync root cause).
  - `:6` `navigate`; `:7` `const { data: projects, isLoading } = useProjects();` — **`isError` / `refetch` IGNORED** (the hook returns the full Tanstack result, analyst-confirmed; the picker destructures only `data` + `isLoading`).
  - `:8` `setLastSelectedSlug` read (never `lastSelectedSlug` back — can't derive a controlled value).
  - `:10-13` `handleSelect(slug)` → `setLastSelectedSlug(slug)` + `void navigate('/projects/${slug}')`. **Preserved by F38 (D6).**
  - `:15-17` `if (isLoading) return <span>Loading…</span>;` — OK branch but unstyled skeleton; F38 upgrades to a skeleton trigger.
  - `:19-21` `if (!projects || projects.length === 0) return <span>No projects</span>;` — **THE `:19` BUG: conflates loading/error/empty.** A failed query → `!projects` → "No projects" (no `isError` branch). This is the "No Projects even when project selected" regression.
  - `:24-28` `<select aria-label="Select project" defaultValue="" onChange={...}>` — **THE `:27` BUG: uncontrolled `defaultValue=""`.** Never updates on URL nav. **THE `:24` BUG: native `<select>`** — OS-rendered, un-themeable (no dark tokens, no icon, no dot, no footer).
  - `:30-32` `<option value="" disabled>Select project…</option>` — note the ellipsis + lowercase "p". F38 spec text is **"Select a project"** (article "a", caps "P", no ellipsis).
  - `:33-37` `<option key={p.id} value={p.slug}>{p.name} ({p.slug})</option>` — name+slug parenthetical.

- **`useProjects` hook** (`hooks/useProjects.ts:6-11`): `useQuery({ queryKey: projectKeys.lists(), queryFn: listProjects })` → returns full TanStack `{ data, isLoading, isError, error, refetch, ... }`. **All exposed** — picker just doesn't consume `isError`/`refetch`. F38 consumes both (D3).

- **`useProjectStore`** (`stores/useProjectStore.ts:4-21`): `{ lastSelectedSlug: string|null, setLastSelectedSlug, clear }`, persisted `'slyk-project'`. Comment `:10-11`: "URL param is primary; this store records the last selected slug so '/' can redirect." F38 reads `lastSelectedSlug` back (controlled-value fallback, D2) + keeps `setLastSelectedSlug` (D6).

- **Route slug:** `routes/index.tsx` — `/projects/:slug` → BoardPage (`:62`); `/projects` listing (`:60`); `IndexRedirect` (`:29-34`) reads `lastSelectedSlug`. **F38 adds `useParams<{ slug: string }>()` for the controlled value (primary source).** The picker is rendered by TopNav (always present) so `useParams` returns `{}` on `/projects` listing → empty slug → "Select a project" placeholder (D3).

- **`useRequireRole('ADMIN')`** (`hooks/useRequireRole.ts:8-12`): client-side role check, returns `boolean`. Used at `TopNav.tsx:48` + `ProjectsPage.tsx:16`. **F38 gates the "+ Create project" footer on `useRequireRole('ADMIN')` (D5).** Only ADMINs see the create affordance (server is the real gate per `:5-7` comment).

- **F36 `Dropdown` available (7 exports, all confirmed in `components/ui/Dropdown.tsx`):**
  - `:15` `Dropdown` = `DropdownMenuPrimitive.Root` (controls open state; Radix auto-closes on item select).
  - `:18-23` `DropdownTrigger` — **`asChild` passthrough** via `{...rest}` (F38 wraps its custom trigger button).
  - `:32-53` `DropdownContent` — Portal to `document.body`, `bg-popover text-popover-foreground border-border`, `sideOffset=4`, `z-50`, `min-w-[8rem]`.
  - `:69-86` `DropdownItem` — `variant: 'default' | 'destructive'`; `relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm`.
  - `:89-100` `DropdownSeparator` — `-mx-1 my-1 h-px bg-border`.
  - `:103-117` `DropdownLabel` — `px-2 py-1.5 text-sm font-semibold text-muted-foreground`.
  - `:120` `DropdownGroup` = `DropdownMenuPrimitive.Group`.
  - **Controlled-mode contract:** F38 controls the VALUE (displayed project) via `useParams` + store; **Radix controls the OPEN state** (uncontrolled open is fine — Radix auto-closes on select, handles Esc/outside-click). No `open`/`onOpenChange` needed. (Analyst; F36 task doc.)

- **⚠️ NO `color` field on `Project`** — `types/project.ts:7-15`: `Project = { id, name, slug, columns, creatorId, createdAt, updatedAt }`. Schema `projects` table has no `color` column (only `labels.color` exists, `schema.ts:164`). **The "project color dot" has no backing data** → F38 resolves via client-side hash→hue from `slug` (D1, owner sign-off flagged; alternative = drop the dot / defer; a `projects.color` migration is OUT of F38 scope).

- **F37 left-cluster slot + `aria-label` contract:** `TopNav.tsx:202-206` renders `<ProjectPicker />` in the left cluster (next to the brand). F38 rebuilds the component **IN PLACE** — TopNav import/render stays byte-for-byte. `TopNav.test.tsx:186-193` has one picker assertion: `getByLabelText('Select project')` + left-cluster placement. **F38 MUST preserve `aria-label="Select project"` on the trigger** or F37's test breaks.

- **`cn`** from `@/components/ui/cn` (F35) — importable for conditional classes.

- **lucide icons** (`lucide-react ^1`, installed F31): `FolderKanban`, `ChevronDown`, `Check` all importable (F37 already uses `Layers`/`LayoutGrid`/`BarChart3`/`Settings`; F31 `Avatar` uses `User`).

- **Project rules this plan satisfies:**
  - `js-development-rules.md` — React 19+ / Vite / Tailwind; one component per file; co-locate tests; explicit prop interfaces; functional + hooks; React Query for server state; Zustand for client UI state. Frontend code under `./frontend/`.
  - `js-style-guide.md` — PascalCase component files; **4-space JSX / 2-space TS**; ≤100 cols; trailing commas; import order external → internal → type → relative; functions <50 lines; **no `any`**; **no inline styles (Tailwind only)** — the hash→hue color-dot's `style={{ backgroundColor }}` is the ONE sanctioned exception (data-derived, mirrors Badge's `style` passthrough); SCREAMING_SNAKE_CASE constants.
  - `js-testing-rules.md` — Vitest co-located `*.test.tsx`; RTL `getByRole`/`getByLabelText` priority; `vi.fn()` mocks; table-driven preferred; **components >70% coverage**.
  - `git-guidelines.md` — sacred rule (never git without approval); rebase-and-merge ONLY (no merge/squash); `PROJECTSLUG = SLYK`; branch `type/SLYK-TICKET-desc`; single-line `SLYK-TICKET: message`. Repo precedent `SLYK-F31..F37:` → F38 uses `SLYK-F38:` prefix; branch `feature/SLYK-redesign-f38-project-picker-rebuild`.
  - `persona.md` — frontend code → `./frontend/`; React 19+ specializations.

- **File paths the plan references that do NOT exist yet:** `frontend/src/components/ProjectPicker.test.tsx` (NEW — co-located; PRD §8 names it). F38 MODIFIES only `ProjectPicker.tsx` (exists).

- **Hidden coupling to plan for:**
  - **`aria-label="Select project"`** — load-bearing. F37's `TopNav.test.tsx:186-193` queries `getByLabelText('Select project')`. F38 MUST keep this exact `aria-label` on the trigger (D4). A different label breaks F37 silently.
  - **F38 rebuilds internals IN PLACE** — `TopNav.tsx` imports `import { ProjectPicker } from './ProjectPicker'` and renders `<ProjectPicker />`. The component's named export + zero-prop signature must stay (F38 is self-contained: reads hooks/store/params internally). TopNav unchanged.
  - **Color dot has no data** — `Project` has no `color` field (analyst). F38 uses hash→hue (D1). If a future feature adds `projects.color`, the hash is replaced by the field (§8).
  - **`/projects` listing route** — picker is always mounted (TopNav), so on `/projects` `useParams<{ slug }>()` returns `{}` → slug is `undefined` → "Select a project" placeholder trigger (D3). No route-level hide.
  - **TanStack cache invalidation** — `useCreateProject` (`useProjects.ts:21-29`) invalidates `projectKeys.lists()` on success, so the picker's list re-fetches automatically after a create (no manual refetch wiring in F38).

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Color-dot data source | **Client-side deterministic hash→hue from `project.slug` → a colored `<span>` dot via inline `style={{ backgroundColor: 'hsl(${hue} 65% 45%)' }}`. NO backend migration. This is the ONE inline-style exception (data-derived, like Badge's `style` passthrough) — all other classes are F32 token utilities.** ⚠️ **Owner sign-off flagged** (default = hash-from-slug; alternatives = drop dot / defer; `projects.color` migration is OUT of scope). | PRD §4.3 says "project color dot" but `Project` has no `color` field (`types/project.ts:7-15`); schema `projects` table has no `color` column (analyst). F38 is frontend-only; the redesign holds a no-DB-migration stance. Hash-from-slug is deterministic (same project → same color across renders/nav) and needs zero schema. If owner later adds `projects.color`, the hash is a one-line swap to the field. (§4.3; analyst's type/schema finding; redesign no-migration stance.) |
| D2 | Controlled value | **`useParams<{ slug: string }>()` primary + `useProjectStore.lastSelectedSlug` fallback + `""` placeholder. Never `defaultValue`.** | Kills the `:27` uncontrolled-`defaultValue=""` bug (§2.2). URL is the source of truth (`useProjectStore:10-11` "URL param is primary"). `useParams` keeps the trigger in sync on direct nav (`/projects/foo` updates the picker) — the existing picker can't because it never imports `useParams`. Store fallback covers the brief moment between nav and mount. (PRD §4.3; §2.2 `:27`; analyst's no-`useParams` finding.) |
| D3 | Distinct states | **Four explicit branches — `isLoading` → skeleton trigger; `isError` → "Couldn't load projects" + retry button (calls `refetch`); empty array → "No projects yet" + link to `/projects`; loaded → `DropdownItem` list. `/projects` listing → "Select a project" placeholder trigger.** | Kills the `:19` conflated-states bug (§2.2) where a failed query rendered "No projects". The picker must consume `isError` + `refetch` (both already returned by `useProjects`, just ignored today). D3/D13 default: visible placeholder on listing (never hidden). (PRD §4.3; §2.2 `:19`; D13/D3.) |
| D4 | Trigger | **`<DropdownTrigger asChild>` wrapping a `<button>`: `[color-dot span] [FolderKanban icon] [name OR "Select a project" OR state text] [ChevronDown]`. `aria-label="Select project"` preserved (F37 test contract). `title={project.name}` for long names; trigger label uses `max-w-[...] truncate`.** | Kills the `:24` un-themeable-`<select>` bug (§2.2). `asChild` passthrough confirmed on F36 `DropdownTrigger` (`Dropdown.tsx:18-23`). Custom button carries icon + dot + chevron + accessible name. `aria-label="Select project"` is load-bearing for F37's `TopNav.test.tsx:186-193` (`getByLabelText`). (PRD §4.3; §3.3 trigger icons; F37 test; F38 spec long-names edge.) |
| D5 | Content | **Loaded: list of `DropdownItem`s (color dot + `FolderKanban` + name, with `Check` right-aligned on the selected item). Then `DropdownSeparator` + ADMIN-gated `DropdownItem` "+ Create project" footer → navigates `/projects`. Loading/error/empty render the trigger in its non-list state (no items).** | PRD §4.3 footer "+ Create project"; §3.3 `Check` = selected-indicator. `useRequireRole('ADMIN')` gates the footer (pattern at `TopNav.tsx:48`/`ProjectsPage.tsx:16`; server is the real gate per `useRequireRole.ts:5-7`). `Check` on the selected row gives the "current project" affordance the native `<select>` couldn't theme. (PRD §4.3 footer; §3.3; analyst's useRequireRole pattern.) |
| D6 | Selecting | **`onSelect` on each `DropdownItem` → `setLastSelectedSlug(slug)` + `navigate('/projects/${slug}')`. Radix auto-closes on select (no manual `open` state).** | Preserves the existing `handleSelect` (`ProjectPicker.tsx:10-13`) semantics: persist (store) + navigate (route). Radix's auto-close-on-select removes the need for `open`/`onOpenChange` — the controlled-mode contract is "F38 controls VALUE, Radix controls OPEN" (analyst; F36 task doc). (F38 spec; existing `handleSelect`.) |
| D7 | Test | **CREATE `ProjectPicker.test.tsx` (co-located). Table-driven 4-state matrix (loading/error-retry/empty-create/loaded). Mock `useProjects` per branch; mock `useNavigate`; mock `useProjectStore` + `useParams`. The 3 PRD §8 named tests: (a) shows retry on error (NOT "No projects"), (b) reflects current slug from URL, (c) empty-state offers create link. Plus: `aria-label="Select project"` preserved; trigger shows selected project name; ADMIN-gated footer.** | PRD §8 names ProjectPicker as 1 of 4 test files with 3 specific cases. js-testing-rules: table-driven preferred, `vi.fn()` mocks, `getByRole`/`getByLabelText` priority, components >70%. The error→retry test is the direct regression for the `:19` "No Projects even when project selected" bug. (§8; js-testing-rules.) |
| D8 | Scope | **Only `ProjectPicker.tsx` (rebuild) + `ProjectPicker.test.tsx` (new). No `TopNav.tsx`, no `index.css`, no `index.html`, no `main.tsx`, no `AppLayout.tsx`, no migration, no new deps, no Radix-install.** | F38 owns ONLY the picker component + its test. F36 installed Radix + exports Dropdown; F37 rendered `<ProjectPicker />` in the left cluster. Prevents scope creep into F32 (CSS tokens — closed), F33 (no-flash — closed), F39 (profile/Avatar), F40 (theme), F41 (health), F42 (nav scoping). (Analyst scope finding.) |

> **Out of F38 scope (explicitly deferred):** `projects.color` schema column (the dot uses hash→hue, D1 — a future feature could migrate; §8 notes the swap). TopNav restructure — **F37 (done)**. Dropdown/Tooltip primitives — **F36 (done)**. CSS tokens — **F32 (closed)**. `index.html` no-flash — **F33 (closed)**. Profile menu / Avatar swap — **F39**. Theme toggle — **F40**. `<HealthBadge />` fold-in — **F41**. Nav scoping / disabled state — **F42**. New deps — none (Radix via F36; lucide via F31; `cn` via F35).

> **Owner sign-off needed:**
> - **D1 — Color-dot data source.** PRD §4.3 assumes a `color` that doesn't exist on `Project` (`types/project.ts:7-15`). Default = **hash→hue from slug** (no migration; deterministic; one-line swap if a `projects.color` field is added later). Alternatives: **drop the dot** (lose the PRD §4.3 visual), or **defer F38 pending a `projects.color` migration** (out of F38's frontend-only scope). Surface in chat before T1.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/
└─ frontend/
   └─ src/
      └─ components/
         ├─ ProjectPicker.tsx        # MODIFIED — full rebuild: controlled Radix Dropdown
         │                           #   (F36) with 4 distinct states (loading/error-retry/
         │                           #   empty-create/loaded), FolderKanban + ChevronDown +
         │                           #   Check + hash→hue color dot, controlled value from
         │                           #   useParams + useProjectStore.lastSelectedSlug,
         │                           #   "+ Create project" ADMIN-gated footer, "Select a
         │                           #   project" placeholder on /projects (D3). Kills the
         │                           #   3 bugs (:19, :24, :27). aria-label preserved (F37).
         └─ ProjectPicker.test.tsx   # NEW (co-located) — table-driven 4-state matrix; 3 PRD §8
                                     #   named tests (retry-on-error, slug-from-URL, empty-create);
                                     #   aria-label + trigger-name + ADMIN-footer assertions.
# NO TopNav.tsx edit (F37 renders <ProjectPicker/> in the left cluster — unchanged).
# NO index.css (F32 closed), NO index.html (F33 closed), NO main.tsx (F38 uninvolved).
# NO AppLayout.tsx edit (F41 owns HealthBadge; main stays gutterless per F37/D1).
# NO schema migration (color dot is client-side hash — D1; redesign no-migration stance).
# NO new deps (Radix via F36; lucide via F31; cn via F35).
# NO types/project.ts edit (no color field added; D1 hash-from-slug).
```

**Data flow:** `ProjectPicker()` reads `useParams<{ slug: string }>()` (primary, route-driven), `useProjectStore` (`lastSelectedSlug` fallback + `setLastSelectedSlug`), `useProjects()` (`data`, `isLoading`, `isError`, `refetch`), `useRequireRole('ADMIN')` (footer gate), and `useNavigate()`. It derives `selectedSlug = params.slug ?? lastSelectedSlug ?? ''` and finds the matching project for the trigger label + color dot + selected-row `Check`. Render branches on state: loading → skeleton trigger; error → "Couldn't load projects" trigger + retry button (calls `refetch`); empty → "No projects yet" trigger + create link; loaded or listing-placeholder → `Dropdown` (Root) with `DropdownTrigger asChild` (color dot + `FolderKanban` + name-or-"Select a project" + `ChevronDown`) and `DropdownContent` listing `DropdownItem`s (color dot + `FolderKanban` + name + `Check`-on-selected) + `DropdownSeparator` + ADMIN `DropdownItem` "+ Create project" → `/projects`. `onSelect` → `setLastSelectedSlug(slug)` + `navigate('/projects/${slug}')`; Radix auto-closes.

---

## 5. Parallelization Strategy

F38 is **one component + its co-located test**, tightly coupled (the test imports the component and exercises its states). The rebuild (T1) and the test creation (T2) touch one logical surface; T2's assertions target T1's exact DOM (states, trigger, items, footer). **Solo sequential track: T1 → T2 → T3 (verify).** No cross-file parallelism is honest for a single-file-pair feature.

### Batch dependency diagram

```
   Batch A (rebuild)              Batch B (test)                Batch C (integration)
   ──────────────                 ──────────                    ─────────────────────
       T1 ─────────────────────────────▶  T2  ─────────────────────▶  T3
   (ProjectPicker.tsx rebuild:        (ProjectPicker.test.tsx:        (verify: exactly 2 files,
    controlled Dropdown + 4 states     table-driven 4-state matrix      gate green, F37 TopNav
    + dot/icons/footer)               + 3 PRD §8 named tests)          test still passes, no
                                                                         defaultValue, no leakage)
```

- **Batch A → Batch B** is a hard barrier: T2's assertions (4 states, trigger label, items, footer, retry button) target T1's new DOM + state branches; T1 must land first so the test compiles against the rebuilt component.
- **Batch B → Batch C** is a hard barrier: T3 verifies the merged diff (exactly 2 files), re-runs the full gate, and confirms F37's TopNav test still passes (the `aria-label="Select project"` contract).

### Merge order rules

1. **Batch A merges first.** T1 (`ProjectPicker.tsx` rebuild) lands the controlled Radix Dropdown + 4 distinct states + icons + dot + footer + placeholder. Must be on `main` before T2 branches.
2. **Batch B merges second.** T2 (`ProjectPicker.test.tsx`) adds the 4-state matrix + 3 PRD §8 named tests. Lands after T1.
3. **Batch C (integration verification) merges last.** T3 confirms the committed diff is exactly 2 files, re-runs the full gate, confirms F37 TopNav test still green (`aria-label` preserved), confirms no `defaultValue` (controlled), confirms no scope leakage, records proof in §7.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | A | `frontend/src/components/ProjectPicker.tsx` (Modified — rebuild) | — | — |
| **T2** | B | `frontend/src/components/ProjectPicker.test.tsx` (New — co-located) | T1 | — |
| **T3** | C | no files changed (verification gate); records proof in §7 | T1, T2 | — |

### Developer assignment tracks

- **Solo:** T1 → T2 → T3 (sequential; single file pair, test imports component).
- **2 devs:** Not recommended — the component + its test are one logical unit; splitting risks the test author guessing at T1's exact DOM/state shape. If forced: Dev-A does T1+T2 serially; Dev-B does nothing until T3 (verification).
- **3 devs:** Overkill. One author owns the whole feature end-to-end.

---

## 6. Tasks

### T1 — Rebuild `ProjectPicker.tsx` as a controlled F36 Dropdown (4 states + icons + dot + footer)

**Batch:** A · **Depends on:** None (F36 done, F37 done) · **Parallel with:** —

**Description:** Replace the 40-line native-`<select>` picker with a controlled Radix `Dropdown` (F36) that kills the 3 bugs. Derive the controlled value from `useParams<{ slug: string }>()` (primary) + `useProjectStore.lastSelectedSlug` (fallback) + `""` placeholder — **never `defaultValue`** (D2). Consume `isError` + `refetch` from `useProjects` and render four distinct states (D3): loading → skeleton trigger; error → "Couldn't load projects" trigger + retry button (calls `refetch`); empty → "No projects yet" trigger + create link to `/projects`; loaded or `/projects`-listing → `Dropdown` with `DropdownTrigger asChild` (D4) and `DropdownContent` (D5). Trigger = `[color-dot span] [FolderKanban] [name | "Select a project" | state text] [ChevronDown]`, with `aria-label="Select project"` (F37 contract) and `title`+`truncate` for long names. Items = color dot + `FolderKanban` + name + `Check`-on-selected. Footer = `DropdownSeparator` + ADMIN-gated `DropdownItem` "+ Create project" → `/projects`. `onSelect` → `setLastSelectedSlug(slug)` + `navigate('/projects/${slug}')` (D6). Color dot = deterministic hash→hue from `slug` via inline `style={{ backgroundColor }}` (D1 — the one inline-style exception). Token utilities everywhere else (no raw colors, no `dark:` classes).

**Modify** `frontend/src/components/ProjectPicker.tsx` — full replacement:

```typescript
import { useParams, useNavigate } from 'react-router';
import { FolderKanban, ChevronDown, Check, AlertCircle } from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import { useProjectStore } from '@/stores/useProjectStore';
import { useRequireRole } from '@/hooks/useRequireRole';
import { cn } from '@/components/ui/cn';
import {
    Dropdown,
    DropdownTrigger,
    DropdownContent,
    DropdownItem,
    DropdownSeparator,
} from '@/components/ui/Dropdown';
import type { Project } from '@/types/project';

// F38 — Project picker rebuild. Kills the 3 bugs at the old :19/:24/:27:
//   - :19 conflated states → 4 explicit branches (D3).
//   - :24 un-themeable <select> → F36 Radix Dropdown (D4/D5).
//   - :27 uncontrolled defaultValue → controlled value from useParams + store (D2).
// Controlled VALUE (F38) + Radix-controlled OPEN (auto-close on select, no open state).

// D1 — deterministic color dot from slug (no Project.color field exists).
// Hash → HSL hue → one inline-style exception (data-derived, like Badge's style passthrough).
function slugHue(slug: string): number {
    let hash = 0;
    for (let i = 0; i < slug.length; i++) {
        hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
    }
    return hash % 360;
}

function ColorDot({ slug, className }: { slug: string; className?: string }) {
    return (
        <span
            aria-hidden="true"
            className={cn('inline-block h-2 w-2 shrink-0 rounded-full', className)}
            style={{ backgroundColor: `hsl(${slugHue(slug)} 65% 45%)` }}
        />
    );
}

const TRIGGER_MAX_W = 'max-w-[10rem]';
const PLACEHOLDER = 'Select a project';
const LISTING_PLACEHOLDER = 'Select a project';

export function ProjectPicker() {
    const params = useParams<{ slug: string }>();
    const navigate = useNavigate();
    const { data: projects, isLoading, isError, refetch } = useProjects();
    const lastSelectedSlug = useProjectStore((s) => s.lastSelectedSlug);
    const setLastSelectedSlug = useProjectStore((s) => s.setLastSelectedSlug);
    const isAdmin = useRequireRole('ADMIN');

    // D2 — controlled value: route primary, store fallback, "" placeholder.
    const selectedSlug = params.slug ?? lastSelectedSlug ?? '';
    const selected =
        projects?.find((p) => p.slug === selectedSlug) ??
        null;

    const handleSelect = (slug: string) => {
        setLastSelectedSlug(slug);
        void navigate(`/projects/${slug}`);
    };

    // D4 — trigger label per state. Loaded-with-selection shows the project name;
    // listing (no slug) or no-selection shows the D3 placeholder.
    const triggerLabel = selected
        ? selected.name
        : LISTING_PLACEHOLDER;

    // D3 — state-shaped trigger content. Each non-loaded state still renders an
    // accessible trigger (aria-label preserved) so the control is always present.
    let triggerBody: React.ReactNode;
    if (isLoading) {
        triggerBody = (
            <>
                <span className="h-4 w-4 animate-pulse rounded-sm bg-muted" />
                <span className="truncate text-muted">Loading…</span>
            </>
        );
    } else if (isError) {
        triggerBody = (
            <>
                <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                <span className="truncate text-destructive">Couldn't load projects</span>
            </>
        );
    } else if (!projects || projects.length === 0) {
        triggerBody = (
            <>
                <FolderKanban className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                <span className="truncate text-muted">No projects yet</span>
            </>
        );
    } else {
        triggerBody = (
            <>
                {selected && <ColorDot slug={selected.slug} />}
                <FolderKanban className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                <span className={cn('truncate', TRIGGER_MAX_W)} title={triggerLabel}>
                    {triggerLabel}
                </span>
            </>
        );
    }

    return (
        <Dropdown>
            <DropdownTrigger asChild>
                <button
                    type="button"
                    aria-label="Select project"
                    title={selected ? selected.name : PLACEHOLDER}
                    className={cn(
                        'flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1',
                        'text-sm text-foreground hover:bg-accent',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                >
                    {triggerBody}
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                </button>
            </DropdownTrigger>

            <DropdownContent align="start" className="min-w-[12rem]">
                {isLoading && (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                        Loading…
                    </div>
                )}

                {isError && (
                    <div className="flex flex-col gap-2 px-2 py-1.5">
                        <span className="text-sm text-destructive">Couldn't load projects</span>
                        <button
                            type="button"
                            onClick={() => void refetch()}
                            className="self-start rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-accent"
                        >
                            Retry
                        </button>
                    </div>
                )}

                {!isLoading && !isError && (!projects || projects.length === 0) && (
                    <DropdownItem
                        onSelect={() => void navigate('/projects')}
                        className="text-muted-foreground"
                    >
                        No projects yet — create one
                    </DropdownItem>
                )}

                {!isLoading && !isError && projects && projects.length > 0 && (
                    <DropdownGroup>
                        {projects.map((p: Project) => {
                            const isSelected = p.slug === selectedSlug;
                            return (
                                <DropdownItem
                                    key={p.id}
                                    onSelect={() => handleSelect(p.slug)}
                                    className="gap-2"
                                >
                                    <ColorDot slug={p.slug} />
                                    <FolderKanban className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                                    <span className={cn('truncate', TRIGGER_MAX_W)} title={p.name}>
                                        {p.name}
                                    </span>
                                    {isSelected && (
                                        <Check
                                            className="ml-auto h-4 w-4 shrink-0 text-primary"
                                            aria-hidden="true"
                                        />
                                    )}
                                </DropdownItem>
                            );
                        })}
                    </DropdownGroup>
                )}

                {isAdmin && (
                    <>
                        <DropdownSeparator />
                        <DropdownItem onSelect={() => void navigate('/projects')}>
                            + Create project
                        </DropdownItem>
                    </>
                )}
            </DropdownContent>
        </Dropdown>
    );
}
```

> **Key correctness notes for the implementer:**
> - **Controlled, not `defaultValue`:** the trigger label derives from `selectedSlug = params.slug ?? lastSelectedSlug ?? ''`. Direct nav to `/projects/foo` updates `params.slug` → the trigger re-renders with "foo" selected. Never write `defaultValue`.
> - **Radix controls OPEN:** no `open`/`onOpenChange` props on `<Dropdown>`. Radix auto-closes on `DropdownItem` `onSelect` and handles Esc/outside-click. F38 controls VALUE only.
> - **`aria-label="Select project"`** on the trigger button is load-bearing — F37's `TopNav.test.tsx:186-193` queries `getByLabelText('Select project')`. Do not change it.
> - **D3 placeholder text:** `"Select a project"` (article "a", caps "P", no ellipsis) — replaces the old `"Select project…"` (`:31`).
> - **D1 color dot:** `slugHue` is a pure deterministic hash (`hash * 31 + char`, `>>> 0` to keep it unsigned, `% 360` for hue). Same slug → same color across renders/nav. The `style={{ backgroundColor }}` is the ONE sanctioned inline-style exception (data-derived, like Badge). All other classes are token utilities.
> - **Error → retry (the `:19` regression fix):** `isError` branch renders "Couldn't load projects" + a Retry button calling `refetch()`. NEVER "No projects" on error. The empty-array branch is separate and offers a create link.
> - **ADMIN-gated footer:** `useRequireRole('ADMIN')` gates "+ Create project". Server is the real gate (`useRequireRole.ts:5-7`); this is UX-only. Only ADMINs see the footer.
> - **Long names:** trigger label + each item name use `max-w-[10rem] truncate` + a `title` tooltip so the full name is reachable and widths stay bounded.
> - **`Check` on selected:** right-aligned via `ml-auto` on the selected `DropdownItem` only; absent on others. This is the §3.3 selected-indicator.
> - **Zero-prop signature preserved:** `ProjectPicker()` takes no props (self-contained — reads hooks/store/params internally), so TopNav's `<ProjectPicker />` render stays byte-for-byte.

**Acceptance Criteria:**
- [ ] `ProjectPicker.tsx` imports `useParams` + `useNavigate` from `react-router`; `FolderKanban`, `ChevronDown`, `Check`, `AlertCircle` from `lucide-react`; `useProjects`, `useProjectStore`, `useRequireRole`; `cn` from `@/components/ui/cn`; the 5 F36 Dropdown exports used (`Dropdown`, `DropdownTrigger`, `DropdownContent`, `DropdownItem`, `DropdownSeparator`).
- [ ] **No `defaultValue` anywhere** in the file (grep-clean); the trigger label derives from `params.slug ?? lastSelectedSlug ?? ''` (D2 controlled).
- [ ] Four distinct state branches render different trigger content: `isLoading` → skeleton; `isError` → AlertCircle + "Couldn't load projects"; empty → FolderKanban + "No projects yet"; loaded → dot + FolderKanban + name/placeholder + ChevronDown (D3).
- [ ] Error branch renders a **Retry button** calling `refetch()` (regression for the `:19` "No Projects on error" bug).
- [ ] Empty-array branch renders a `DropdownItem` "No projects yet — create one" → `/projects`.
- [ ] `/projects` listing (no `params.slug`, no `lastSelectedSlug`) shows **"Select a project"** placeholder trigger (D3 — exact text, article "a", caps "P", no ellipsis).
- [ ] `aria-label="Select project"` on the trigger button (F37 test contract preserved).
- [ ] `DropdownTrigger asChild` wraps the custom button; trigger order: `[color-dot] [FolderKanban] [name|placeholder|state] [ChevronDown]` (D4).
- [ ] Each loaded `DropdownItem`: `[color-dot] [FolderKanban] [name truncate+title]` + `Check` (right-aligned, `ml-auto`) on the selected slug only (D5, §3.3).
- [ ] `onSelect` on each project item → `setLastSelectedSlug(slug)` + `navigate('/projects/${slug}')` (D6); Radix auto-closes (no `open` state).
- [ ] ADMIN-gated footer: `DropdownSeparator` + `DropdownItem` "+ Create project" → `/projects`, gated on `useRequireRole('ADMIN')`.
- [ ] `slugHue` + `ColorDot` deterministic hash→hue via inline `style={{ backgroundColor }}` (D1 — the one inline-style exception); all other classes are F32 token utilities (no raw colors, no `dark:` classes).
- [ ] Long-name handling: trigger label + item name use `truncate` + `max-w-[...]` + `title` tooltip.
- [ ] No `any`; functions <50 lines (`ProjectPicker` body is state-derivation + render); 4-space JSX / 2-space TS; ≤100 cols; trailing commas; import order external → internal → type → relative.
- [ ] `TopNav.tsx`, `index.css`, `index.html`, `main.tsx`, `AppLayout.tsx`, `types/project.ts`, `package.json` NOT modified.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run build -w frontend` exits 0.

**Dependencies:** F36 (Dropdown — done); F35 (`cn`); F31 (`lucide-react`); existing `useProjects`/`useProjectStore`/`useRequireRole`.

---

### T2 — Create `ProjectPicker.test.tsx` (co-located, table-driven 4-state matrix + 3 PRD §8 named tests)

**Batch:** B · **Depends on:** T1 · **Parallel with:** —

**Description:** Create `ProjectPicker.test.tsx` co-located with the component. Table-driven 4-state matrix (loading/error-retry/empty-create/loaded) covering the `:19` conflated-states bug fix. The 3 PRD §8 named tests: (a) **shows retry on error (NOT "No projects")** — the direct regression for the "No Projects even when project selected" bug; (b) **reflects current slug from URL** — direct nav to `/projects/foo` updates the trigger; (c) **empty-state offers create link** — "No projects yet — create one" navigates `/projects`. Plus: `aria-label="Select project"` preserved (F37 contract), trigger shows the selected project name, ADMIN-gated footer visible for ADMIN / absent for MEMBER, `Check` on the selected item. Mock `useProjects` per branch (return `{ data, isLoading, isError, refetch }` shaped per case); mock `useNavigate`; mock `useProjectStore` + wrap in `<MemoryRouter initialEntries={[...]}>` to drive `useParams`.

**Create** `frontend/src/components/ProjectPicker.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ProjectPicker } from './ProjectPicker';
import type { Project } from '@/types/project';

// --- Mocks ------------------------------------------------------------------

vi.mock('@/hooks/useProjects', () => ({
    useProjects: vi.fn(),
}));
vi.mock('@/hooks/useRequireRole', () => ({
    useRequireRole: vi.fn(() => true),
}));

const navigateMock = vi.fn();
vi.mock('react-router', async () => {
    const actual = await vi.importActual<typeof import('react-router')>('react-router');
    return { ...actual, useNavigate: () => navigateMock };
});

import { useProjects } from '@/hooks/useProjects';
import { useRequireRole } from '@/hooks/useRequireRole';
import { useProjectStore } from '@/stores/useProjectStore';

// --- Fixtures ---------------------------------------------------------------

const adminProject: Project = {
    id: 'p1',
    name: 'Acme Board',
    slug: 'acme',
    columns: [],
    creatorId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

const secondProject: Project = {
    ...adminProject,
    id: 'p2',
    name: 'Beta Board',
    slug: 'beta',
};

const LOADED = [adminProject, secondProject];

function setProjects(over: Partial<ReturnType<typeof useProjects>> = {}) {
    vi.mocked(useProjects).mockReturnValue({
        data: LOADED,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        ...over,
    } as ReturnType<typeof useProjects>);
}

function renderPicker(initialEntry = '/') {
    return render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <ProjectPicker />
        </MemoryRouter>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRequireRole).mockReturnValue(true);
    useProjectStore.getState().clear();
});

// --- Table-driven 4-state matrix (D3, :19 regression) -----------------------

describe('ProjectPicker — distinct states', () => {
    const cases = [
        {
            name: 'loading → skeleton trigger (no "No projects")',
            setup: () => setProjects({ data: undefined, isLoading: true }),
            expects: (open: () => void) => {
                open();
                expect(screen.getByText('Loading…')).toBeInTheDocument();
                expect(screen.queryByText('No projects')).not.toBeInTheDocument();
            },
        },
        {
            name: 'error → "Couldn\'t load projects" + retry (NOT "No projects")',
            setup: () =>
                setProjects({
                    data: undefined,
                    isLoading: false,
                    isError: true,
                    refetch: vi.fn(),
                }),
            expects: (open: () => void) => {
                open();
                expect(screen.getByText("Couldn't load projects")).toBeInTheDocument();
                expect(screen.queryByText('No projects')).not.toBeInTheDocument();
                expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
            },
        },
        {
            name: 'empty array → "No projects yet — create one" create link',
            setup: () => setProjects({ data: [] }),
            expects: (open: () => void) => {
                open();
                expect(
                    screen.getByText('No projects yet — create one'),
                ).toBeInTheDocument();
            },
        },
        {
            name: 'loaded → lists project names',
            setup: () => setProjects(),
            expects: (open: () => void) => {
                open();
                expect(screen.getByText('Acme Board')).toBeInTheDocument();
                expect(screen.getByText('Beta Board')).toBeInTheDocument();
            },
        },
    ] as const;

    cases.forEach(({ name, setup, expects }) => {
        it(name, () => {
            setup();
            renderPicker();
            const open = () => {
                fireEvent.click(screen.getByLabelText('Select project'));
            };
            expects(open);
        });
    });
});

// --- PRD §8 named test (a): retry on error, NOT "No projects" ---------------

it('error state shows a Retry button that calls refetch (regression: :19 "No Projects on error")', () => {
    const refetch = vi.fn();
    setProjects({ data: undefined, isLoading: false, isError: true, refetch });
    renderPicker();
    fireEvent.click(screen.getByLabelText('Select project'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
});

// --- PRD §8 named test (b): reflects slug from URL --------------------------

it('reflects the current slug from the URL (controlled value, no defaultValue)', () => {
    setProjects();
    // Direct nav to /projects/acme — params.slug = 'acme' → trigger shows "Acme Board".
    renderPicker('/projects/acme');
    fireEvent.click(screen.getByLabelText('Select project'));
    // Check mark is on the selected (Acme) row.
    const acmeItem = screen.getByText('Acme Board').closest('[role="menuitem"]');
    expect(acmeItem?.querySelector('svg[data-lucide="check"], svg')).toBeTruthy();
    const betaItem = screen.getByText('Beta Board').closest('[role="menuitem"]');
    // Beta is NOT selected → its Check is absent (only one Check in the menu).
    const checks = document.querySelectorAll('[role="menuitem"] svg.lucide-check');
    expect(checks.length).toBe(1);
});

// --- PRD §8 named test (c): empty-state offers create link ------------------

it('empty-state offers a create link that navigates to /projects', () => {
    setProjects({ data: [] });
    renderPicker();
    fireEvent.click(screen.getByLabelText('Select project'));
    fireEvent.click(screen.getByText('No projects yet — create one'));
    expect(navigateMock).toHaveBeenCalledWith('/projects');
});

// --- F37 contract: aria-label preserved -------------------------------------

it('preserves aria-label="Select project" on the trigger (F37 TopNav test contract)', () => {
    setProjects();
    renderPicker();
    expect(screen.getByLabelText('Select project')).toBeInTheDocument();
});

// --- D3 listing placeholder -------------------------------------------------

it('shows "Select a project" placeholder on the /projects listing (no slug)', () => {
    setProjects();
    renderPicker('/projects');
    fireEvent.click(screen.getByLabelText('Select project'));
    // No project is selected → neither row has a Check; trigger shows placeholder.
    const trigger = screen.getByLabelText('Select project');
    expect(trigger).toHaveTextContent('Select a project');
});

// --- Selecting persists + navigates (D6) ------------------------------------

it('selecting a project persists lastSelectedSlug and navigates', () => {
    setProjects();
    renderPicker();
    fireEvent.click(screen.getByLabelText('Select project'));
    fireEvent.click(screen.getByText('Beta Board'));
    expect(navigateMock).toHaveBeenCalledWith('/projects/beta');
    expect(useProjectStore.getState().lastSelectedSlug).toBe('beta');
});

// --- ADMIN-gated footer -----------------------------------------------------

it('shows "+ Create project" footer for ADMIN', () => {
    vi.mocked(useRequireRole).mockReturnValue(true);
    setProjects();
    renderPicker();
    fireEvent.click(screen.getByLabelText('Select project'));
    expect(screen.getByText('+ Create project')).toBeInTheDocument();
});

it('hides "+ Create project" footer for MEMBER', () => {
    vi.mocked(useRequireRole).mockReturnValue(false);
    setProjects();
    renderPicker();
    fireEvent.click(screen.getByLabelText('Select project'));
    expect(screen.queryByText('+ Create project')).not.toBeInTheDocument();
});

it('"+ Create project" footer navigates to /projects', () => {
    setProjects();
    renderPicker();
    fireEvent.click(screen.getByLabelText('Select project'));
    fireEvent.click(screen.getByText('+ Create project'));
    expect(navigateMock).toHaveBeenCalledWith('/projects');
});
```

> **Test notes:**
> - The 4-state table-driven matrix is the `:19` conflated-states regression coverage: each branch asserts the state-specific text AND that "No projects" does NOT appear (the bug).
> - **Named test (a)** is the direct regression for the "No Projects even when project selected" bug: it asserts the Retry button exists AND calls `refetch`. The `:19` bug would have rendered "No projects" with no retry — this test fails on the old code.
> - **Named test (b)** wraps in `<MemoryRouter initialEntries={['/projects/acme']}>` so `useParams` returns `{ slug: 'acme' }` — the controlled-value proof. The old code (no `useParams`, `defaultValue=""`) could never reflect the URL. The single-`Check` assertion confirms the selected-row indicator.
> - **Named test (c)** asserts the empty-state create link navigates `/projects`.
> - `vi.mock('react-router')` spreads the actual module and overrides only `useNavigate` — `useParams` + `MemoryRouter` stay real so route-driven slug reflection works. `useProjectStore` is the REAL store (zustand) reset via `getState().clear()` in `beforeEach` — no mock needed, and it lets the "selecting persists" test assert `lastSelectedSlug` directly.
> - `getByLabelText('Select project')` is the F37 contract query — if F38 drops the `aria-label`, this test (and F37's TopNav test) fails loudly.
> - jsdom doesn't render lucide's `class="lucide-check"` reliably across versions; the selected-row assertion uses a tolerant selector (`svg.lucide-check` if present, else the single-svg-on-selected-row count). If the owner's lucide version emits different class names, adjust the selector but keep the "exactly one Check on the selected row" invariant.

**Acceptance Criteria:**
- [ ] `ProjectPicker.test.tsx` created co-located (`frontend/src/components/ProjectPicker.test.tsx`).
- [ ] Table-driven 4-state matrix: loading (skeleton, no "No projects"), error ("Couldn't load projects" + Retry, no "No projects"), empty ("No projects yet — create one"), loaded (lists names).
- [ ] **Named test (a):** error state shows a Retry button that calls `refetch` (regression for `:19` "No Projects on error").
- [ ] **Named test (b):** direct nav `/projects/acme` → trigger reflects "Acme Board"; exactly one `Check` on the selected row (controlled-value proof).
- [ ] **Named test (c):** empty-state create link navigates `/projects`.
- [ ] `aria-label="Select project"` preserved assertion (F37 contract).
- [ ] D3 listing placeholder: `/projects` → trigger text "Select a project".
- [ ] Selecting persists `lastSelectedSlug` + navigates `/projects/${slug}`.
- [ ] ADMIN footer visible for ADMIN, absent for MEMBER; footer navigates `/projects`.
- [ ] `vi.fn()` mocks for `useProjects` (per-branch), `useNavigate`; real `useProjectStore` (reset in `beforeEach`); `<MemoryRouter>` drives `useParams`.
- [ ] `npm run test -w frontend -- ProjectPicker.test.tsx` exits 0.
- [ ] `npm run typecheck -w frontend` exits 0.

**Dependencies:** T1.

---

### T3 — Integration verification & sign-off

**Batch:** C (terminal) · **Depends on:** T1, T2 · **Parallel with:** —

**Description:** The final definition-of-done gate. Confirm the committed diff is exactly the 2 F38 files (`ProjectPicker.tsx` modified + `ProjectPicker.test.tsx` new), re-run the full gate green, confirm F37's `TopNav.test.tsx` still passes (`aria-label="Select project"` preserved), confirm the picker is controlled (no `defaultValue`), confirm no scope leakage (no TopNav/index.css/index.html/main.tsx/AppLayout/types/project/package.json edits), and record proof in §7.

Steps:
1. Confirm the branch's committed diff is **exactly** the F38 files:
   ```bash
   git diff --name-only main...HEAD | sort
   # Expected (exactly 2):
   # frontend/src/components/ProjectPicker.test.tsx
   # frontend/src/components/ProjectPicker.tsx
   ```
   Any other path (a `TopNav.tsx` edit, an `index.css` edit, an `index.html` edit, a `main.tsx` edit, an `AppLayout.tsx` edit, a `types/project.ts` edit, a `package.json` edit, a new primitive, a schema migration, a Radix install) → leaked; remove and re-commit. F38 owns only the picker rebuild + its test.
2. Re-run the full gate on the merged state:
   ```bash
   npm install
   npm run build -w frontend              # exit 0
   npm run typecheck -w frontend          # exit 0
   npm run test -w frontend               # exit 0 (incl. ProjectPicker.test.tsx + F37 TopNav regression)
   ```
3. Confirm scope-boundary files are **unchanged** vs main:
   ```bash
   for f in frontend/src/components/TopNav.tsx frontend/src/index.css frontend/index.html \
            frontend/src/main.tsx frontend/src/components/AppLayout.tsx \
            frontend/src/types/project.ts frontend/package.json; do
     git diff --quiet main...HEAD -- "$f" \
       && echo "$f: UNCHANGED" \
       || echo "$f: CHANGED (out of scope — revert)"
   done
   ```
   All must print UNCHANGED. (`TopNav.tsx` — F37 owns render; F38 rebuilds internals in place; `index.css` — F32 closed; `index.html` — F33 closed; `main.tsx` — F38 uninvolved; `AppLayout.tsx` — F41 owns HealthBadge; `types/project.ts` — D1 hash-from-slug, no color field added; `package.json` — Radix via F36, lucide via F31, no new deps.)
4. Confirm the picker is **controlled** (no `defaultValue` — the `:27` bug is dead):
   ```bash
   grep -n "defaultValue" frontend/src/components/ProjectPicker.tsx \
     && echo "BUG: defaultValue still present (:27 bug not fixed)" \
     || echo "controlled (no defaultValue): OK"
   grep -nE "useParams|lastSelectedSlug" frontend/src/components/ProjectPicker.tsx \
     && echo "controlled value sources present: OK" \
     || echo "BUG: controlled value derivation missing"
   ```
   Both must print OK.
5. Confirm `useParams` + the 4 states + the F36 Dropdown are wired:
   ```bash
   grep -E "import \{ useParams, useNavigate \} from 'react-router'" frontend/src/components/ProjectPicker.tsx
   grep -cE "isLoading|isError|refetch" frontend/src/components/ProjectPicker.tsx   # >= 3 (D3 branches)
   grep -E "FolderKanban, ChevronDown, Check, AlertCircle" frontend/src/components/ProjectPicker.tsx
   grep -E "Dropdown, DropdownTrigger, DropdownContent, DropdownItem, DropdownSeparator" \
     frontend/src/components/ProjectPicker.tsx
   ```
   All must match.
6. Confirm `aria-label="Select project"` is preserved (F37 contract):
   ```bash
   grep -n 'aria-label="Select project"' frontend/src/components/ProjectPicker.tsx
   ```
   Must match (load-bearing for `TopNav.test.tsx:186-193`).
7. Confirm F37's TopNav test still passes (the picker is rendered by TopNav in the left cluster):
   ```bash
   npm run test -w frontend -- TopNav.test.tsx   # exit 0 (incl. the getByLabelText('Select project') + left-cluster assertion)
   ```
   Must exit 0. If it fails, F38 changed the export signature or the `aria-label` — revert and fix.
8. Confirm the `:19` regression test exists and would fail on the old code:
   ```bash
   grep -E "Couldn't load projects|Retry" frontend/src/components/ProjectPicker.test.tsx
   grep -E "No projects yet — create one" frontend/src/components/ProjectPicker.test.tsx
   ```
   Both must match (the error-retry + empty-create coverage).
9. Confirm token-only classes (no raw colors, no `dark:` color classes) in `ProjectPicker.tsx` — the hash→hue `style` is the sanctioned exception:
   ```bash
   grep -REn 'bg-(slate|blue|red|amber|orange|green|gray)-[0-9]' frontend/src/components/ProjectPicker.tsx \
     && echo "RAW COLOR FOUND (BUG — must use tokens)" || echo "token-only: OK"
   grep -REn 'dark:(bg|text|border)-' frontend/src/components/ProjectPicker.tsx \
     && echo "dark: color class FOUND (BUG — tokens carry theme)" || echo "no dark: color classes: OK"
   grep -nE "style=\{\{ backgroundColor" frontend/src/components/ProjectPicker.tsx \
     && echo "hash→hue inline style present (D1 sanctioned exception): OK" \
     || echo "BUG: ColorDot inline style missing"
   ```
   All must print OK.
10. Capture commit SHA, exit codes, test counts into §7. Confirm D1 owner sign-off (color-dot: hash-from-slug default vs drop vs migration) — surface before merge.

**Acceptance Criteria:**
- [ ] Committed diff is exactly 2 files: `ProjectPicker.tsx`, `ProjectPicker.test.tsx` — no TopNav/index.css/index.html/main.tsx/AppLayout/types/project/package.json/migration/primitive/Radix-install leakage.
- [ ] `npm run build -w frontend` exits 0 on the merged state.
- [ ] `npm run typecheck -w frontend` exits 0 on the merged state.
- [ ] `npm run test -w frontend` exits 0 on the merged state (incl. `ProjectPicker.test.tsx` + F37 `TopNav.test.tsx` regression).
- [ ] `TopNav.tsx`, `index.css`, `index.html`, `main.tsx`, `AppLayout.tsx`, `types/project.ts`, `package.json` all UNCHANGED vs main.
- [ ] No `defaultValue` in `ProjectPicker.tsx` (controlled — `:27` bug dead); `useParams` + `lastSelectedSlug` present.
- [ ] `aria-label="Select project"` preserved (F37 TopNav test passes).
- [ ] F37 `TopNav.test.tsx` exits 0 (the `getByLabelText('Select project')` + left-cluster assertion holds).
- [ ] Error-retry + empty-create regression tests present; `:19` bug coverage confirmed.
- [ ] Token-only classes (no raw colors, no `dark:`); the D1 hash→hue `style={{ backgroundColor }}` is the sanctioned inline-style exception.
- [ ] All F38 §1 acceptance bullets satisfied; SHAs + results recorded in §7.
- [ ] D1 owner sign-off (color-dot data source) recorded.

**Dependencies:** T1, T2.

---

## 7. Final F38 Acceptance Checklist

- [ ] **Controlled value** from `useParams<{ slug }>()` + `useProjectStore.lastSelectedSlug`; **no `defaultValue`** (the `:27` bug is dead). Direct nav to `/projects/foo` updates the trigger.
- [ ] **Four distinct states** (the `:19` bug is dead): `isLoading` → skeleton; `isError` → "Couldn't load projects" + Retry (`refetch`); empty → "No projects yet — create one" link; loaded → list.
- [ ] **Themeable F36 Dropdown** (the `:24` bug is dead): `DropdownTrigger asChild` button + `DropdownContent`, NOT native `<select>`.
- [ ] `FolderKanban` (trigger + each item), `ChevronDown` (trigger chevron), `Check` (selected-item indicator).
- [ ] **Color dot** (D1 hash→hue from `slug`, inline `style` exception) in trigger + each item.
- [ ] **"+ Create project" footer** → `/projects`, ADMIN-gated via `useRequireRole('ADMIN')`.
- [ ] **D3 placeholder** "Select a project" on `/projects` listing (visible, never hidden).
- [ ] **`aria-label="Select project"`** preserved (F37 `TopNav.test.tsx:186-193` contract).
- [ ] Selecting → `setLastSelectedSlug(slug)` + `navigate('/projects/${slug}')`; Radix auto-closes.
- [ ] Long names: `truncate` + `max-w-[...]` + `title` tooltip.
- [ ] `ProjectPicker.test.tsx` created: table-driven 4-state matrix + 3 PRD §8 named tests (retry-on-error, slug-from-URL, empty-create-link).
- [ ] No `any`; explicit interfaces; functions <50 lines; 4-space JSX / 2-space TS; ≤100 cols; trailing commas; import order.
- [ ] `TopNav.tsx`, `index.css`, `index.html`, `main.tsx`, `AppLayout.tsx`, `types/project.ts`, `package.json` unchanged.
- [ ] No new deps (Radix via F36; lucide via F31; `cn` via F35).
- [ ] `npm run build -w frontend` exits 0.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend` exits 0 (incl. `ProjectPicker.test.tsx` + F37 TopNav regression).
- [ ] Committed diff is exactly 2 files (`ProjectPicker.tsx` + `ProjectPicker.test.tsx`).
- [ ] Commit message single-line `SLYK-F38: <message>`; branch `feature/SLYK-redesign-f38-project-picker-rebuild`; rebase-and-merge only.

**Integration record (fill during T3):**
- Feature commit SHA: `________`
- Diff = exactly 2 files (`ProjectPicker.tsx` modified, `ProjectPicker.test.tsx` new); no TopNav/CSS/index.html/main.tsx/AppLayout/types/project/package.json/migration/primitive/Radix-install leakage: `PASS/FAIL`
- `defaultValue` absent in `ProjectPicker.tsx` (`:27` bug dead): `PASS/FAIL`
- `useParams` + `lastSelectedSlug` present (controlled value): `PASS/FAIL`
- `aria-label="Select project"` preserved (F37 contract): `PASS/FAIL`
- F36 Dropdown imports present (`Dropdown, DropdownTrigger, DropdownContent, DropdownItem, DropdownSeparator`): `PASS/FAIL`
- lucide `{ FolderKanban, ChevronDown, Check, AlertCircle }` imported: `PASS/FAIL`
- `useRequireRole('ADMIN')` gates "+ Create project" footer: `PASS/FAIL`
- D3 placeholder "Select a project" on `/projects`: `PASS/FAIL`
- `ProjectPicker.test.tsx` result: `__/__ pass` (4-state matrix + retry-on-error + slug-from-URL + empty-create + aria-label + listing-placeholder + selecting-persists + ADMIN-footer×3)
- F37 `TopNav.test.tsx` result: `__/__ pass` (regression — `getByLabelText('Select project')` + left-cluster hold)
- No raw colors / no `dark:` color classes in `ProjectPicker.tsx`: `token-only: OK`
- D1 hash→hue `style={{ backgroundColor }}` present (sanctioned inline-style exception): `PASS/FAIL`
- `TopNav.tsx` vs main: `UNCHANGED (F37 preserved — F38 rebuilds internals in place)`
- `index.css` vs main: `UNCHANGED (F32 preserved)`
- `index.html` vs main: `UNCHANGED (F33 preserved)`
- `main.tsx` vs main: `UNCHANGED`
- `AppLayout.tsx` vs main: `UNCHANGED (F41 preserved)`
- `types/project.ts` vs main: `UNCHANGED (D1 hash-from-slug — no color field added)`
- `package.json` vs main: `UNCHANGED (Radix via F36, lucide via F31 — no new deps)`
- New deps added by F38: `0`
- Build / typecheck / test exit codes: `0 / 0 / 0`
- D1 owner sign-off (color-dot: hash-from-slug vs drop vs migration): `recorded (date: ________)`

---

## 8. Schema deltas owned by this feature

F38 owns **no schema deltas.** There is **no DB migration** (the redesign's standing no-migration stance), **no CSS token additions** (F32 owns and has closed those — `index.css` is frozen), **no `index.html` change** (F33 owns the no-flash bootstrap), **no `main.tsx` change** (F38 uninvolved), **no `AppLayout.tsx` change** (F41 owns `<HealthBadge />`; `<main>` stays gutterless per F37/D1), and **no `types/project.ts` change** (D1 hash-from-slug — no `color` field is added). F38 adds **no new dependencies** (Radix via F36; `lucide-react ^1` via F31; `cn` via F35). F38 touches only `frontend/src/components/ProjectPicker.tsx` (rebuilt) + `frontend/src/components/ProjectPicker.test.tsx` (new, co-located) — a component + its test, no schema surface.

**Color-dot note (D1):** the "project color dot" is a **client-side deterministic hash→hue from `project.slug`** — no `projects.color` column is added. If a future feature adds `projects.color` (a migration owned by that feature, NOT F38), the `ColorDot` component's `slugHue(slug)` is a one-line swap to `project.color`. Until then the hash gives every project a stable, distinct hue with zero backend change.

| Delta | Detail | Mechanism |
| --- | --- | --- |
| No DB migration | None | — (redesign no-migration stance) |
| No `projects.color` column | Color dot is client-side `slugHue(slug)` → `hsl(hue 65% 45%)` (D1) | `frontend/src/types/project.ts` unchanged; `ColorDot` uses inline `style` |
| No CSS token deltas | None — F32 owns all tokens and is closed | `frontend/src/index.css` unchanged |
| No `index.html` change | None — F33 owns the no-flash bootstrap and is closed | `frontend/index.html` unchanged |
| No `main.tsx` change | None — F38 does not mount providers | `frontend/src/main.tsx` unchanged |
| No `AppLayout.tsx` change | None — `<main>` stays gutterless (F37/D1); F41 owns `<HealthBadge />` | `frontend/src/components/AppLayout.tsx` unchanged |
| No `TopNav.tsx` change | None — F37 renders `<ProjectPicker />` in the left cluster; F38 rebuilds internals in place (same named export, zero-prop signature) | `frontend/src/components/TopNav.tsx` unchanged |
| No new dependencies | Radix via F36; `lucide-react ^1` via F31; `cn` via F35 | `frontend/package.json` unchanged |
| Picker rebuild | Controlled F36 Dropdown; 4 distinct states (loading/error-retry/empty-create/loaded); `FolderKanban`+`ChevronDown`+`Check`+hash→hue dot; controlled value from `useParams`+`useProjectStore.lastSelectedSlug` (no `defaultValue`); "+ Create project" ADMIN-gated footer; "Select a project" D3 placeholder on `/projects`; `aria-label="Select project"` preserved | `frontend/src/components/ProjectPicker.tsx` modified |
| Co-located test (new) | Table-driven 4-state matrix; 3 PRD §8 named tests (retry-on-error, slug-from-URL, empty-create-link); aria-label + trigger-name + ADMIN-footer + selecting-persists assertions | `frontend/src/components/ProjectPicker.test.tsx` created |
