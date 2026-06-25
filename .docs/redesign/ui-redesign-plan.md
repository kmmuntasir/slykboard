# Slykboard UI Redesign Plan

**Status:** Draft for review
**Scope:** Frontend only (`frontend/`)
**Goal:** Simple, elegant, consistent UI — full-width alignment, tidy navigation, a real dark mode, iconography, and a Jira-style create/edit ticket modal.

---

## 1. Design Principles

1. **Calm and roomy.** Generous whitespace, restrained color, one accent (`--color-primary`). Density only where it earns its keep (board columns, tables).
2. **Semantic tokens, never raw colors.** Components use `bg-background`, `text-foreground`, `bg-card`, `border-border`, etc. Light/dark then "just work" by swapping token values. No `bg-white`, `text-gray-700`, `border-gray-300` left in components.
3. **Full-width chrome.** Navbar and content share one horizontal rhythm (same `px-*` gutter). Nothing is arbitrarily centered at `max-w-5xl` while the board next to it runs edge-to-edge.
4. **Icons carry meaning.** Add `lucide-react`. Icons for nav, menus, fields, empty states, health. Not decorative noise.
5. **Reuse over copy-paste.** A small set of primitives (`Button`, `Field`, `TextInput`, `SelectInput`, `Avatar`, `Dropdown`, `Badge`, `Modal` with size prop) so spacing/padding/focus rings are defined once.
6. **Respect the user's system.** Light / Dark / System theme, persisted, no flash on load.

---

## 2. Current-State Audit (problems found)

### 2.1 Layout & navigation
- **`AppLayout.tsx:11`** — `<HealthBadge />` sits as its own full-width bar (`HealthBadge.tsx:25` → `bg-muted px-4 py-1 text-xs`) directly under the navbar. Wastes a whole horizontal row just to say "Healthy". Visual noise.
- **`TopNav.tsx:41`** — inner `<nav>` is `mx-auto flex max-w-5xl ... px-4 py-3`. Navbar content caps at 1024px and centers, but `<main>` (`AppLayout.tsx:12`, `flex-1`) is full-width. Navbar and content are misaligned — the user's exact complaint.
- **`TopNav.tsx:42`** — brand is plain text "Slykboard", no mark/icon.
- **`TopNav.tsx:88`** — `<ProjectPicker />` is on the **right** side, after the nav links.
- **`TopNav.tsx:102-108`** — "Sign out" is a **flat text button** next to the avatar. No menu. No "you are signed in as". Profile icon does nothing on its own.
- Nav links (`PUBLIC_NAV_LINKS`, `ADMIN_NAV_LINKS`) are always rendered on every authenticated route. There is **no project-scoping** of the "Board" item and no visual treatment when no project is selected (the "Board" link to `/` just triggers `IndexRedirect` → `/projects`).

### 2.2 Project picker bugs (`ProjectPicker.tsx`)
- **`:19`** `if (!projects || projects.length === 0)` conflates three states: still-loading-but-not-flagged, **query error**, and genuinely empty. A failed `useProjects()` falls through to the literal text `No projects` instead of an error/retry. → "shows 'No Projects' even when a project is selected / sometimes" symptom.
- **`:27`** `<select defaultValue="">` is **uncontrolled**. The dropdown never reflects the currently open project. Land directly on `/projects/foo` → picker still shows "Select project…". Selecting sets store + navigates, but the picker value drifts on any URL-driven navigation.
- **`:24`** Native `<select>` — can't be themed for dark mode, can't show an icon, can't show project color dot. Looks generic.
- Lives on the wrong side (right) and competes for space with the avatar.

### 2.3 Theme / dark mode
- **`index.css`** — Tailwind v4 via `@tailwindcss/vite`. `@theme` block defines only `--color-background, --color-foreground, --color-primary, --color-muted, --color-border`. All hardcoded **light** hex. **No `dark` variant, no `.dark` class, no `prefers-color-scheme`, no theme store, no toggle.** App is light-only.
- **Undefined-token bug (real, present today):** components reference tokens that do **not** exist in `@theme`:
  - `bg-card` (`TicketCard.tsx:15`, `RichTextEditor.tsx`)
  - `text-muted-foreground` (`TicketCard.tsx:18`)
  - `text-primary-foreground`, `hover:bg-primary/90` (`TicketAttributeForm.tsx:168`)
  - `bg-secondary`, `hover:bg-secondary` (`TicketAttributeForm.tsx:177`)
  - `bg-muted/40` (`BoardColumn.tsx:22`)

  In Tailwind v4 these resolve to **nothing** (no color emitted) because `muted-foreground`, `card`, `primary-foreground`, `secondary` were never declared. Cards/inputs/buttons are effectively unstyled or transparent in places. A redesign must define these.
- ~147 raw `gray-*` usages across components that bypass the token system entirely.
- **No `<meta name="color-scheme">`** in `index.html` → scrollbars/form controls flash light in dark mode.

### 2.4 Icons
- `lucide-react` is **not installed**. No icon library at all. Close buttons use the literal `×` glyph (`Modal.tsx:60`), empty states use emoji/none, health uses a plain `<span>` dot.

### 2.5 Create/Edit ticket modal & forms
- **`Modal.tsx:48`** — hard `w-full max-w-lg` (512px). No size prop. `bg-white` hardcoded (breaks dark mode). Close = `×` glyph.
- **`TicketAttributeForm.tsx:81`** — single `space-y-4` column, everything vertically stacked in a 512px card. Narrow and long.
- **Padding/border inconsistencies across fields** (the user's complaint):
  | Element | Class | Issue |
  |---|---|---|
  | Title input (`:92`) | `border-gray-300 p-2` | baseline |
  | Priority/User `<select>` | `border-gray-300 p-2` | ok |
  | RichTextEditor outer | `border` (gray-200) + `p-2` | **different border color**, no focus ring |
  | LabelMultiSelect | `min-h-[40px] p-2` | taller than siblings |
  | Checklist items | `px-2 py-1` | **thinner** vertical padding |
  | ManualEntryForm inputs | `border-gray-200` + `focus:ring-1 focus:ring-primary` | only field **with** a focus ring; others have none |
  | Primary form button (`:168`) | `px-4 py-2` | |
  | Confirm-dialog buttons | `px-3 py-1.5` | **smaller** than form buttons |
  | ManualEntry "Log Time" | `px-3 py-1` | **third** button size |

  No shared `Field`/`Input`/`Select` primitive exists — each control reinvents its own label+input+padding+border markup, so the drift above is structural, not a one-off.

---

## 3. Design-System Foundations (do first — everything depends on this)

### 3.1 Expand the token set + dark mode (`index.css`)
- Switch to **CSS-variable-backed semantic tokens** (shadcn-style). Declare a `:root` (light) and `.dark` block, then map them into Tailwind v4 via `@theme inline`.
- Tokens to define (both light + dark):
  - `--background`, `--foreground`
  - `--card`, `--card-foreground`
  - `--popover`, `--popover-foreground` (for dropdowns)
  - `--primary`, `--primary-foreground`
  - `--secondary`, `--secondary-foreground`
  - `--muted`, `--muted-foreground`
  - `--accent`, `--accent-foreground`
  - `--border`, `--input`, `--ring`
  - `--destructive`, `--destructive-foreground`
  - status tints: `--success`, `--warning`, `--danger` (for health/priority badges)
- Enable **class-based** dark mode in Tailwind v4:
  ```css
  @import 'tailwindcss';
  @custom-variant dark (&:where(.dark, .dark *));
  ```
- Add `<meta name="color-scheme" content="light dark">` to `index.html`.

### 3.2 Theme provider + toggle
- New `frontend/src/components/ThemeProvider.tsx` + `hooks/useTheme.ts`.
  - State: `'light' | 'dark' | 'system'`, persisted to `localStorage` (key `slykboard-theme`).
  - Applies/removes `.dark` on `document.documentElement`.
  - Subscribes to `window.matchMedia('(prefers-color-scheme: dark)')` for `system`.
- **No-flash:** inline script in `index.html` `<head>` reads localStorage and sets `.dark` **before** React mounts (prevents white flash on dark-mode refresh).
- Mount `<ThemeProvider>` in `main.tsx` above `RouterProvider`.
- **Theme toggle UI:** a 3-way segmented control (Sun / Monitor / Moon icons from lucide) placed in the navbar (right cluster) and mirrored inside the profile menu. `<SunIcon>` / `<MonitorIcon>` / `<MoonIcon>`.

### 3.3 Icons (`lucide-react`)
- `rtk pnpm add lucide-react` in `frontend/`.
- Icon plan (lucide names):
  - **Nav:** `LayoutGrid` (Board), `BarChart3` (Reports), `Settings` (Settings).
  - **Brand:** a small `Layers`/`Trello`-style mark next to "Slykboard".
  - **Project picker:** `FolderKanban` (leading), `ChevronDown`/`Check` (in dropdown).
  - **Profile menu:** `User` (header), `LogOut` (sign out), `Sun/Monitor/Moon` (theme).
  - **Health:** `Activity` + colored dot.
  - **Modal:** `X` replaces `×`.
  - **Ticket fields:** `Flag` (priority), `UserCircle` (assignee), `Tags` (labels), `ListChecks` (checklist), `AlignLeft` (description).
  - **Buttons:** `Plus` (new ticket), `Search`, `X` (clear filters).
  - **Empty states:** `Inbox`, `FolderOpen`, `SearchX`, `CircleSlash`.

### 3.4 Shared primitives (`frontend/src/components/ui/`)
Create a small primitive layer so the spacing/focus/border drift stops recurring:
- `Button` — variants (`primary`, `secondary`, `ghost`, `destructive`, `outline`), sizes (`sm`, `md`, `lg`). One padding spec per size. Resolves the 3-button-size drift.
- `Field` — `<label>` + `<span>` label + child input + error `<p role="alert">`. Owns the `mb-1 block text-sm font-medium` label + `mt-1 text-sm text-destructive` error so every field is identical.
- `TextInput` / `Textarea` — shared `border border-input rounded-md px-3 py-2 bg-background text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary` (with focus ring on **every** field).
- `SelectInput` — styled native `<select>` wrapper (or headlessui-style custom later).
- `Avatar` — consolidates `AssigneeAvatar` + the TopNav initials/img logic (one component, `size` prop).
- `Dropdown` — themed wrapper over **Radix UI** `react-dropdown-menu` (a11y handled by Radix: focus, outside-click, Esc). Used for profile menu + project picker + future menus. (Decided §9.2.)
- `Badge` — unifies `PriorityBadge` + label/status badges.
- `Card` — standard surface (`bg-card border border-border rounded-lg`).

---

## 4. Layout & Navigation Redesign

### 4.1 Full-width alignment
- Remove `max-w-5xl mx-auto` from `TopNav.tsx:41`. Navbar `<nav>` becomes full-width with a single shared gutter, e.g. `px-4 md:px-6`. `<main>` uses the same gutter. Navbar and content now share left/right edges end to end.
- Board keeps its own internal scroll (columns overflow horizontally); the gutter only governs the chrome.

### 4.2 Navbar — new structure (left → right)

```
[ mark + "Slykboard" ]   [ ▾ Project picker ]          [ Board  Reports  Settings ]   [ ☀️/🖥️/🌙 theme ]   [ avatar ▾ ]
```

- **Left cluster:** brand mark + name, immediately followed by the **project picker** (moved from right). The active project becomes the contextual anchor of the whole app, right where the brand is.
- **Center/right cluster:** primary nav (`Board`, `Reports`, `Settings` for admin).
- **Far right:** theme toggle + **avatar dropdown** (replaces flat Sign-out).
- **Health indicator folds into the navbar** — a small `Activity` icon + colored dot at the far left of the right-cluster (or beside the brand), tooltip "Healthy / Unhealthy". **Delete the standalone `<HealthBadge />` row** from `AppLayout.tsx:11`. (Health stays informational; on `unhealthy` the dot goes red and the tooltip explains. No full-width bar.)
- Responsive: below `md`, collapse nav into a slide-down panel (reuse existing `open` state) but keep brand + picker + avatar visible.

### 4.3 Project picker — rebuilt (fixes all bugs)
- Custom `Dropdown` (not native `<select>`) so it is themeable, shows a `FolderKanban` icon, the project color dot, and a `ChevronDown`.
- **Controlled value:** derive the current slug from the route (`useParams`) **and** `useProjectStore.lastSelectedSlug`; set `value`, never `defaultValue`. Stays in sync on URL-driven navigation.
- **Distinct states** (fixes the "No Projects when project selected" bug):
  - `isLoading` → skeleton/spinner.
  - `isError` → "Couldn't load projects" + retry (does **not** say "No projects").
  - empty array → "No projects yet" + link/button to `/projects` (create one).
  - loaded → dropdown listing projects; selecting navigates + persists.
- Footer of the dropdown: "+ Create project" → `/projects`.
- Hidden entirely on `/projects` (listing page) where it would be redundant? → keep visible but show "Select a project" placeholder. (See §9 decision.)

### 4.4 Avatar → profile menu
- Avatar becomes a `Dropdown` trigger.
- Menu header: avatar + name + email ("signed in as").
- Items: theme toggle (or omit if in navbar), and **Sign out** (`LogOut` icon) → existing `handleSignOut` logic reused.
- Removes the floating "Sign out" text.

### 4.5 Nav visibility rule (decided — §9.1, §9.3)
`Board` and `Reports` are **project-scoped**. `Settings` (admin user management) stays **global**.
- **Project selected:** `Board` → `/projects/:slug`; `Reports` → `/projects/:slug/reports`. Both enabled, reflect the open project.
- **No project selected** (fresh login, `/projects` listing, cleared store): `Board` and `Reports` nav items render **muted + disabled with a "Select a project first" tooltip**. The `/projects` page is the project-selection landing — keep it as the natural empty state: clear "Select a project" heading, project list, "Create project" CTA. (`EmptyState` with `FolderOpen` icon.)
- `Settings` always enabled (admin only) — not project-dependent.
- Behavior: **nav persistent across all authed routes, project-aware, muted when project-less** (not hidden). Satisfies "menu stays visible" and makes the project scope explicit.

### 4.6 Reports becomes project-scoped (decided — §9.3)
Current Reports is global: routes `/reports` (`routes/index.tsx:77`), API `GET /reports/time` + `GET /reports/tickets` (`api/reports.ts`), hook `useReport(period, offset)` (`hooks/useReport.ts`) — **no project filter anywhere**. Scoping it requires both ends:
- **Route:** move `/reports` → `/projects/:slug/reports`. Add a redirect from the old `/reports` → last-selected project's reports (or `/projects` if none) so existing links don't 404.
- **API:** backend report endpoints must accept a project filter (e.g. `/projects/:slug/reports/time` or `?projectId=`). Today they aggregate across all projects — backend change required (see Phase 5).
- **Hook + page:** `useReport` + `fetchTimeReport`/`fetchTicketSummary` take `projectSlug`; `ReportsPage` reads `:slug` from params and passes it through; `reportKeys` includes the slug.

---

## 5. Create/Edit Ticket Modal — Jira-style two-column

### 5.1 Modal width + size prop (`Modal.tsx`)
- Add a `size?: 'sm' | 'md' | 'lg' | 'xl'` prop. Map: `sm → max-w-md`, `md → max-w-lg` (default, backward-compatible), `lg → max-w-2xl`, `xl → max-w-4xl`.
- Create/Edit ticket uses `xl`.
- Swap `bg-white` → `bg-background`, add `text-foreground border border-border`. Replace `×` with `<X size={20} />`.
- Keep existing a11y (`useModalA11y`, focus trap, Esc, scroll lock) untouched.

### 5.2 Two-column form (`TicketAttributeForm.tsx`)
At `xl` width, render a `grid grid-cols-1 lg:grid-cols-3 gap-6`:

- **Left (span 2) — primary content:**
  - Title (`TextInput`, full width, larger text).
  - Description (`RichTextEditor`, full width).
  - (Optional) a collapsible "Activity"/comments area for edit mode.
- **Right (span 1) — meta sidebar** (each field wrapped in `Field`, consistent `space-y-4`):
  - Priority (`PrioritySelect` + `Flag` icon).
  - Assignee (`UserSelect` + `UserCircle`).
  - Labels (`LabelMultiSelect` + `Tags`).
  - Checklist (`ChecklistEditor` + `ListChecks`).
  - (Edit mode only) time-tracking summary block.

Footer (full width, sticky bottom of modal body): Cancel (secondary) + Create/Save (primary), right-aligned, single `Button` size.

On narrow viewports the grid collapses to one column; meta fields move below the description.

### 5.3 Form consistency (kills the padding drift)
- Every field uses `Field` + `TextInput`/`SelectInput`/`Textarea` primitives → identical `px-3 py-2`, `border-input`, and a **uniform focus ring** on all of them.
- Fix `RichTextEditor` outer border → `border-input` (matches siblings), add focus-within ring.
- Fix `ChecklistEditor` item padding → same `px-3 py-2` family (or a deliberately smaller "dense" variant, but chosen, not accidental).
- All buttons via `Button` → one size vocabulary. Confirm-dialog and ManualEntry buttons adopt the same `sm`/`md` sizes.

---

## 6. Other surfaces (lighter touches, same system)

- **`TicketCard`** — already clean; switch raw grays → tokens; add `Clock` icon for time, `CheckCircle2` for checklist progress instead of `✓` text. Hover/elevate on hover (`hover:shadow-md transition`).
- **`BoardColumn`** — `bg-muted/40` → defined `bg-muted` token; column header gets a subtle count badge.
- **`ReportsPage`** — now **project-scoped** (§4.6, Phases 5–6). Wrap both tables in `Card`; period toggle → `Button` variant group; empty states use lucide (`Inbox`/`BarChart3`). No charts this pass (tables only, refreshed).
- **`ProjectsPage` / empty states** — use lucide `Inbox`/`FolderOpen` via `EmptyState`'s `icon` prop (already supported).
- **`LoginPage`** — center card (`Card`), Google `G` mark, theme toggle available even pre-auth.
- **`OfflineBanner`** — keep full-width red, it's correctly an alert.

---

## 7. Implementation Phases (T1..Tn)

Each phase is independently shippable. Suggested branch prefix `feature/SLYK-redesign-<phase>` (ticket numbers TBD — see `.claude/rules/git-guidelines.md`).

**Phase 1 — Foundations (no visual breakage, enables the rest)**
- T1.1 Expand `index.css` tokens (light + dark), add `@custom-variant dark`, define all missing tokens (`card`, `muted-foreground`, `primary-foreground`, `secondary`, `input`, `ring`, `destructive`).
- T1.2 Add `<meta name="color-scheme">` + no-flash inline script to `index.html`.
- T1.3 `ThemeProvider` + `useTheme` + `localStorage` + `matchMedia`; mount in `main.tsx`.
- T1.4 Install `lucide-react`.
- T1.5 Build primitives: `Button`, `Field`, `TextInput`, `Textarea`, `SelectInput`, `Avatar`, `Badge`, `Card`.
- T1.6 Install **Radix UI** (`@radix-ui/react-dropdown-menu`); build a themed `Dropdown` wrapper (tokens, icons, focus already handled by Radix). Used by profile menu + project picker.

**Phase 2 — Chrome (navbar, picker, profile, health)**
- T2.1 Full-width navbar gutter; new left/right cluster layout; brand mark.
- T2.2 Move + rebuild project picker (controlled value, distinct error/empty/loading states, custom dropdown).
- T2.3 Avatar → profile `Dropdown` with Sign out (reuse `handleSignOut`).
- T2.4 Theme toggle in navbar + profile menu.
- T2.5 Fold `HealthBadge` into navbar as icon+dot; remove the standalone bar from `AppLayout`.
- T2.6 Project-aware nav per §4.5: Board/Reports enabled when project selected; **muted + disabled + "Select a project first" tooltip when no project**; routes to `/projects` if clicked. Settings always enabled.
- T2.7 Reports nav link → project-scoped (`/projects/:slug/reports`); reflects selected project.

**Phase 3 — Ticket modal & forms**
- T3.1 `Modal` size prop; themeable panel; `X` icon.
- T3.2 Two-column `TicketAttributeForm` (grid, meta sidebar).
- T3.3 Migrate fields to `Field`/`TextInput`/`SelectInput`; fix RichText/Checklist borders + add focus rings; unify buttons.

**Phase 4 — Token migration sweep (correctness + polish)**
- T4.1 Replace all raw `gray-*` / `bg-white` / hardcoded hex in components with semantic tokens.
- T4.2 Migrate `PriorityBadge`, `LabelChip`, `AssigneeAvatar` → `Badge`/`Avatar` where sensible.
- T4.3 Visual QA in light + dark for every route (Board, Reports, Projects, Settings, ProjectSettings, Login, ticket modal, confirm dialogs, empty/error/loading states).

**Phase 5 — Backend: project-scoped Reports (unblocks Phase 6)**
- T5.1 Add project filter to report endpoints. Preferred: `GET /projects/:slug/reports/time` + `GET /projects/:slug/reports/tickets` (mirror existing `/reports/*` shape, just scoped). Alternatively keep `/reports/*` and require `?projectId=`. Aggregate only tickets/time within that project.
- T5.2 Authorize: caller must be a member of `:slug`'s project (reuse existing project-membership middleware).
- T5.3 Keep the old global `/reports/*` routes for one release (deprecate) or remove — decide. Update F23/F24 contracts + tests.
- T5.4 Backend tests: scoped aggregation correct; non-member → 403.

**Phase 6 — Frontend: project-scoped Reports**
- T6.1 Move route `/reports` → `/projects/:slug/reports` (`routes/index.tsx`); add redirect old `/reports` → last project's reports or `/projects`.
- T6.2 `fetchTimeReport`/`fetchTicketSummary` take `projectSlug`; call the new scoped endpoints. `reportKeys` include slug.
- T6.3 `useReport(period, offset, projectSlug)`; `ReportsPage` reads `:slug`, passes through.
- T6.4 Update `ReportsPage` tests + TopNav Reports link target (T2.7).

---

## 8. Testing

- **Unit/component (Vitest + RTL):** update existing `TopNav`, `ProjectPicker`, `Modal`, `TicketAttributeForm` tests for new markup; add tests for:
  - Project picker: shows retry on error (not "No projects"); reflects current slug from URL; empty-state offers create link.
  - Profile menu: opens, Sign out calls `handleSignOut`.
  - Theme: `useTheme` persists, toggles `.dark`, `system` follows `matchMedia`.
  - `TicketAttributeForm`: two-column still submits all fields; dirty/`readOnly` behavior unchanged.
  - `Modal`: `size` prop applies correct `max-w-*`.
- **A11y:** keep `useModalA11y` semantics; verify `Dropdown` focus trap + Esc + outside-click + `aria-expanded`.
- **Visual:** manual light/dark pass per T4.3; screenshot Board + Create modal before/after.
- No new framework; project uses Vitest co-located `*.test.tsx` (see `.claude/rules/js-testing-rules.md`).

---

## 9. Decisions (resolved)

1. **Nav visibility + project scope — DECIDED.** Board and Reports are project-scoped; Settings is global. When no project selected, Board/Reports nav items are **muted + disabled + "Select a project first" tooltip** (not hidden); `/projects` is the selection landing. Details in §4.5.
2. **Dropdown primitive — DECIDED: Radix UI.** Adopt `@radix-ui/react-dropdown-menu` (profile menu, project picker) and `@radix-ui/react-dialog` can replace/augment the hand-rolled `Modal` later (optional). `Modal` keeps its current `useModalA11y` shell for now; Radix used for menus. Install in Phase 1.
3. **Reports — DECIDED: project-specific.** Scope route + API + hook + page to `/projects/:slug/reports`. Backend change required (today `/reports/*` is global). Phases 5 (BE) + 6 (FE); details §4.6.

Still open (low-risk, default if not told otherwise):
4. **Brand mark.** Default: small lucide mark (`Layers`) + "Slykboard" text. Confirm or supply a logo.
5. **Old global `/reports/*` backend routes.** Default: deprecate one release, then remove. Confirm keep-vs-remove.

---

## 10. Out of Scope

- **Auth flow, routing guards, and `useModalA11y`** — untouched (Reports route *relocation* in §4.6 is the one allowed routing change; auth/RequireAuth/RequireRole behavior unchanged).
- **New features** beyond what's stated: charts in Reports, CSV export, comments, real profile editing, custom field editor. Visual/token refresh + the explicitly-decided Reports-scoping only.
- **`react-hook-form` / Zod schema in `TicketAttributeForm`** — unchanged; only layout + primitives wrapping change.
- **Backend** — *only* the Reports-scoping endpoints in Phase 5 are in scope; no other backend changes.
