# Slykboard — UI Redesign Feature Breakdown

> Source of truth for scope: [`ui-redesign-plan.md`](./ui-redesign-plan.md). Project slug: `SLYK`.
>
> This document decomposes the **UI redesign** of the existing Slykboard app into **small, shippable, sequential features**. Each feature is an independently mergeable increment that leaves the system in a working state and is a prerequisite for later features. The redesign builds on a shipped product (features `F01`–`F30` already done in `../../features.md`), so this index starts at **`F31`**.
>
> Redesign scope is frontend-heavy (`frontend/`) with a tightly-scoped backend carve-out — a project-membership middleware (`F47`) plus project-scoped Reports (`F48`/`F49`). **Backend is explicitly in scope** for this redesign. Stack: React 19 + Vite + Tailwind v4 (`@tailwindcss/vite`, in-band `@theme` config, **no JS config**) + Express + PostgreSQL.

## How to read a feature

| Field | Meaning |
| --- | --- |
| **Goal** | One-sentence outcome. |
| **Ships** | What an end user can concretely do once merged. |
| **Depends on** | Features that must land first. |
| **PRD** | Linked requirement(s) from the PRD (`§x` / `REQ` / `Tx.y`). |
| **Acceptance** | Observable checks — treat as the feature's definition of done. |
| **Edge cases** | Traps and gaps the PRD leaves open. Resolve before/during implementation. |

---

## Pre-existing prerequisites (NOT features — do not reinvent)

- **`@/` path alias already configured.** `frontend/tsconfig.json` paths map `@/*`→`./src/*`; `frontend/vite.config.ts` wires `resolve.alias`. No work here — every feature below imports via `@/` freely.
- **Stack pinned.** Tailwind v4 via `@tailwindcss/vite` with in-band `@theme` (no `tailwind.config.js`). React Query 30s server polling + Zustand client state already in use (`useProjectStore` persists `lastSelectedSlug`).
- **Shipped baseline.** `F01`–`F30` in `../../features.md` are all `[x]`. The redesign layers on top; it does not re-found the product.

---

## Feature Index

> **Categories:** 🏗 Scaffolding · 🔧 Infrastructure · ✨ Feature · ⬆ Enhancement · 🚀 Deployment
>
> - 🏗 **Scaffolding** — empty skeleton, tooling, project bootstrap. No domain logic.
> - 🔧 **Infrastructure** — cross-cutting runtime plumbing (DB, API contract, auth guards) every feature leans on. Design-system foundations live here.
> - ✨ **Feature** — distinct user-facing capability; an end user does something concrete.
> - ⬆ **Enhancement** — refines an existing feature; not standalone.
> - 🚀 **Deployment** — packaging, hosting, release.

**Phase 0 — Foundations (design-system plumbing; hard prerequisite for all visible work)**
- [x] **F31** Install redesign deps (lucide-react + Radix dropdown/tooltip) — 🏗 Scaffolding · _deps: —_
- [x] **F32** Define full semantic token set + `@custom-variant dark` — 🔧 Infrastructure · _deps: F31_
- [x] **F33** No-flash theme bootstrap (`color-scheme` meta + pre-React script) — 🔧 Infrastructure · _deps: F32_
- [x] **F34** ThemeProvider + `useTheme` hook (persist + matchMedia + `.dark` toggle) — 🔧 Infrastructure · _deps: F33_
- [x] **F35** Shared UI primitives (Button/Field/TextInput/Textarea/SelectInput/Avatar/Badge/Card) — 🔧 Infrastructure · _deps: F32_
- [x] **F36** Dropdown + Tooltip primitives (Radix wrappers, `.dark`-aware portals) — 🔧 Infrastructure · _deps: F35_

**Phase 1 — Chrome (navbar, picker, profile, health, nav scoping)**
- [x] **F37** Full-width navbar gutter + brand mark + cluster layout — ✨ Feature · _deps: F35_
- [x] **F38** Project picker rebuild (Radix Dropdown, controlled, distinct states) — ✨ Feature · _deps: F36, F37_
- [x] **F39** Avatar → profile Dropdown menu with Sign out — ✨ Feature · _deps: F36, F37_
- [x] **F40** Theme toggle UI (3-way segmented control in navbar + profile menu) — ✨ Feature · _deps: F34, F36, F37_
- [x] **F41** Fold HealthBadge into navbar (Activity icon + dot, delete standalone bar) — ⬆ Enhancement · _deps: F37_
- [x] **F42** Project-aware nav (Board/Reports muted+disabled+tooltip when project-less) — ✨ Feature · _deps: F36, F37_

**Phase 2 — Ticket modal & forms**
- [x] **F43** Modal size prop + themeable panel + X icon (keep useModalA11y) — ⬆ Enhancement · _deps: F35_
- [x] **F44** Two-column TicketAttributeForm (grid + meta sidebar) — ✨ Feature · _deps: F43_
- [x] **F45** Field/input consistency sweep (Field/TextInput/SelectInput migration, focus rings, button sizes) — ⬆ Enhancement · _deps: F35, F44_

**Phase 3 — Token migration sweep (correctness + polish)**
- [x] **F46** Raw-color → semantic-token sweep (gray-*/bg-white/hex) — ⬆ Enhancement · _deps: F32, F35_

**Phase 4 — Backend: project-scoped Reports (unblocks F49)**
- [x] **F47** Build project-membership middleware (scope correction — does not exist) — 🔧 Infrastructure · _deps: —_
- [ ] **F48** Project-scoped report endpoints + membership authz + deprecate old routes — ✨ Feature · _deps: F47_

**Phase 5 — Frontend: project-scoped Reports**
- [ ] **F49** Move Reports route + API client + hook to `/projects/:slug/reports`, add 403/loading/empty surfaces — ✨ Feature · _deps: F48, F42_

**Phase 6 — Gates, testing & release**
- [ ] **F50** Test-update cascade + merge gate (tsc/vite build/lint/prettier green per phase) — 🔧 Infrastructure · _deps: F31–F49_
- [ ] **F51** Light/dark visual QA across all routes + ship redesign release — 🚀 Deployment · _deps: F50_

---

## Phase 0 — Foundations

### F31 — Install redesign deps (lucide-react + Radix dropdown/tooltip)
**Goal:** Land the icon library and the two Radix packages every downstream primitive needs, so no later feature blocks on a missing dependency.
**Ships:** Nothing user-visible; `frontend/package.json` gains `lucide-react`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-tooltip`. CI install stays green.
**Depends on:** —.
**PRD:** §3.3 (icons), §3.4 (Radix dropdown, decided §9.2), implied by D5 (tooltip for disabled nav).
**Acceptance:**
- `rtk pnpm add lucide-react @radix-ui/react-dropdown-menu @radix-ui/react-tooltip` in `frontend/`; versions pinned in `package.json` + lockfile updated.
- `import { Layers } from 'lucide-react'` resolves in a throwaway smoke component; `import * as DropdownMenu from '@radix-ui/react-dropdown-menu'` and `@radix-ui/react-tooltip` resolve.
- `rtk pnpm install` (or `rtk vite build`) succeeds with zero new peer warnings.
**Edge cases:**
- `@radix-ui/react-tooltip` is **beyond the PRD's §3.4 list** (which names only dropdown-menu). Required by D5: a `disabled` button is not pointer/focus-reachable, so the "Select a project first" affordance (`F42`) needs a real tooltip primitive. **Decided (owner sign-off): add it** — confirmed scope addition.
- Pin major versions; Radix minor bumps have broken portal behavior before. Lock to a single resolved version per package.

### F32 — Define full semantic token set + `@custom-variant dark`
**Goal:** Make every currently-broken Tailwind utility (`bg-card`, `text-muted-foreground`, `text-primary-foreground`, `bg-secondary`, `bg-muted/40`) actually emit color, in both light and dark.
**Ships:** Components that are silently transparent today (TicketCard, RichTextEditor, TicketAttributeForm buttons, BoardColumn) render correctly in light; dark values exist even if no toggle is wired yet.
**Depends on:** F31.
**PRD:** §3.1 (full token list, `@custom-variant dark`), §2.3 (undefined-token bug), §9.2.
**Acceptance:**
- `frontend/src/index.css` declares `:root` (light) and `.dark` blocks with the full shadcn-style set: `--background/--foreground`, `--card/--card-foreground`, `--popover/--popover-foreground`, `--primary/--primary-foreground`, `--secondary/--secondary-foreground`, `--muted/--muted-foreground`, `--accent/--accent-foreground`, `--border`, `--input`, `--ring`, `--destructive/--destructive-foreground`, and status tints `--success/--warning/--danger`.
- `@theme inline` maps those CSS vars to Tailwind utilities (the `inline` keyword is what makes `bg-card`/`text-muted-foreground` resolve in v4).
- `@custom-variant dark (&:where(.dark, .dark *));` present.
- **Spike/verify (load-bearing):** build a smoke component using `bg-card text-muted-foreground border-border` and confirm computed color is non-transparent in light **and** with `.dark` on `<html>`. The live bug (§2.3: `bg-card` emits nothing) is exactly a missing-`inline`/missing-token symptom — this step proves the fix, not just the code change.
**Edge cases:**
- **Tailwind v4 `@theme inline` vs plain `@theme`.** Plain `@theme` copies values at build; `inline` keeps the var reference so `.dark` overrides work. Getting this wrong silently re-breaks dark mode. The acceptance spike above exists to catch it.
- Keep the 5 existing light tokens as the seed; do not delete `--color-primary` etc. mid-sweep or `F46` churns harder.
- Status tint tokens (`--success/--warning/--danger`) are new vs the PRD's §3.1 list but required by the health dot (`F41`) and priority badges. Noted as addition.

### F33 — No-flash theme bootstrap (`color-scheme` meta + pre-React script)
**Goal:** Eliminate the white flash on dark-mode refresh and stop native controls/scrollbars flashing light.
**Ships:** A user with a persisted dark preference who hard-refreshes sees dark from first paint; scrollbars/form controls honor the scheme.
**Depends on:** F32 (tokens must exist for `.dark` to mean anything).
**PRD:** §3.1 (meta tag), §3.2 (no-flash inline script).
**Acceptance:**
- `frontend/index.html` `<head>` gains `<meta name="color-scheme" content="light dark">`.
- Inline `<script>` in `<head>` reads `localStorage['slykboard-theme']` and, if `dark` (or `system` + `matchMedia('(prefers-color-scheme: dark)').matches`), adds class `dark` to `document.documentElement` **before** `main.tsx` mounts.
- Script is inline (not a module fetch) so it runs synchronously pre-paint; no FOUC on refresh in either theme.
**Edge cases:**
- **localStorage unavailable** (private mode / disabled storage): script must `try/catch` and fall back to `system` per D8 (default). Never throw on first paint.
- Script ordering: must be the first thing in `<head>` after charset/viewport, before any stylesheet, or the flash still happens.
- Key name `slykboard-theme` is fixed by §3.2; renaming is a breaking change to existing users' preference (cross-cutting decision, do not change).

### F34 — ThemeProvider + `useTheme` hook
**Goal:** Give the app a React-side theme controller that owns the `'light'|'dark'|'system'` state, persists it, and reacts to OS scheme changes.
**Ships:** Programmatic theme control available app-wide; `useTheme()` returns `{ theme, setTheme, resolvedTheme }`; `.dark` class on `<html>` always matches the resolved preference.
**Depends on:** F33 (the pre-React script already set the initial class; provider must not fight it).
**PRD:** §3.2.
**Acceptance:**
- `frontend/src/components/ThemeProvider.tsx` + `frontend/src/hooks/useTheme.ts` created.
- Provider mounted in `main.tsx` **above** `RouterProvider`.
- State persisted to `localStorage` key `slykboard-theme`; `.dark` added/removed on `document.documentElement` to match resolved value.
- Subscribes to `window.matchMedia('(prefers-color-scheme: dark)')` `change` events when theme is `system`; unsubscribes on cleanup.
- `useTheme()` outside provider throws a clear error (no silent undefined).
**Edge cases:**
- **D8 localStorage fallback:** provider must `try/catch` writes; on failure fall back to `system` (default) and keep working in-memory.
- Provider's initial state must agree with the no-flash script's DOM mutation, or React's first render will toggle the class and re-flash. Read the same key, same resolution logic.
- `resolvedTheme` (the actual `light`/`dark` after system resolution) is what components need for things like picking an icon — expose it distinct from the user's `theme` choice.

### F35 — Shared UI primitives
**Goal:** Collapse the structural drift (3 button sizes, missing focus rings, reinvented label/input markup) into one primitive layer so later features stop re-creating it.
**Ships:** `frontend/src/components/ui/` (which does **not** exist today) populated with `Button`, `Field`, `TextInput`, `Textarea`, `SelectInput`, `Avatar`, `Badge`, `Card` — importable via `@/components/ui/...`. No page uses them yet; they're ready for `F37`+.
**Depends on:** F32 (primitives consume semantic tokens).
**PRD:** §3.4 (full primitive spec), §5.3 (drift this kills).
**Acceptance:**
- `Button` — variants `primary|secondary|ghost|destructive|outline`, sizes `sm|md|lg`; one padding spec per size; uses `bg-primary text-primary-foreground` etc. (tokens from F32).
- `Field` — `<label>` + label `<span>` + child + `role="alert"` error `<p>`; owns `mb-1 block text-sm font-medium` label and `mt-1 text-sm text-destructive` error.
- `TextInput`/`Textarea` — shared `border border-input rounded-md px-3 py-2 bg-background text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary` (**focus ring on every field** — the gap in §2.5 ManualEntryForm row).
- `SelectInput` — styled native `<select>` wrapper (themeable, dark-able).
- `Avatar` — consolidates `AssigneeAvatar` + TopNav initials/img logic; `size` prop.
- `Badge` — unifies `PriorityBadge` + label/status badges.
- `Card` — `bg-card border border-border rounded-lg`.
- Co-located `*.test.tsx` per primitive (RTL `getByRole`); renders with tokens in light + dark.
**Edge cases:**
- **No `any`** (`js-style-guide.md`); explicit prop interfaces, PascalCase files (`js-style-guide.md`), 4-space JSX / 2-space TS, ≤100 cols, trailing commas.
- `Button` must forward refs and spread rest props — `Modal`/forms rely on native button attributes (`form`, `type`, `disabled`).
- `Avatar` fallback chain (img → initials → generic icon) must be decided once here, not per call site.

### F36 — Dropdown + Tooltip primitives (Radix wrappers)
**Goal:** Provide the two portal-based interactive primitives the navbar and disabled-nav tooltip depend on, with a11y handled by Radix.
**Ships:** `@/components/ui/Dropdown` and `@/components/ui/Tooltip` ready for `F38` (picker), `F39` (profile menu), `F42` (disabled-nav tooltip). Themed, keyboard-accessible, portal-rendered.
**Depends on:** F35 (primitive layer + tokens).
**PRD:** §3.4 Dropdown (Radix `react-dropdown-menu`, decided §9.2); Tooltip is an implied dep from D5/`F42`.
**Acceptance:**
- `Dropdown` wraps Radix `DropdownMenu`: trigger, content, item, separator, label/header, footer slot. Themed via `bg-popover text-popover-foreground border-border`. Focus trap, outside-click, Esc, `aria-expanded` all from Radix.
- `Tooltip` wraps Radix `Tooltip`: trigger-as-child so it can wrap a `disabled` button (Radix tooltip uses a wrapper span, making disabled elements reachable — the core reason D5 needs it).
- Both render into a portal at `document.body`.
- Tests: `Dropdown` opens on trigger, closes on Esc/outside-click, items reachable via arrow keys; `Tooltip` shows on hover **and** focus, including wrapping a disabled button.
**Edge cases:**
- **Portal dark inheritance (load-bearing):** Radix portals mount at `document.body`, which is inside `<html>`. `.dark` lives on `<html>`, so `bg-popover` resolves correctly — but only because `F33`/`F34` put `.dark` on `documentElement`, not on a child div. Verify in the dark visual QA (`F51`). If anyone later moves `.dark` to a wrapper, portals break silently.
- Tooltip delay-duration: set a sane default (300–700ms) so the disabled-nav hint isn't twitchy.

---

## Phase 1 — Chrome (navbar, picker, profile, health, nav scoping)

### F37 — Full-width navbar gutter + brand mark + cluster layout
**Goal:** Make navbar and content share one horizontal rhythm and give the brand a mark.
**Ships:** Navbar spans full width with a single `px-4 md:px-6` gutter matching `<main>`; brand shows mark + "Slykboard"; left/center/right clusters established (brand+picker left, nav center, theme+avatar right). No content-centered-at-1024px-while-board-is-full-width mismatch.
**Depends on:** F35 (brand mark is a lucide icon; layout uses primitives).
**PRD:** §4.1 (full-width), §4.2 (cluster structure + brand mark), §2.1 (`TopNav.tsx:41` max-w-5xl).
**Acceptance:**
- `TopNav.tsx:41` `mx-auto flex max-w-5xl` removed; nav uses full-width container with shared gutter; `<main>` gutter matches.
- Brand = lucide `Layers` (D1 default) + "Slykboard" text, left cluster.
- Clusters present in DOM order even if `F38`/`F39`/`F40` fill them later (placeholder slots ok).
- Board's internal horizontal scroll still works (gutter governs chrome only — §4.1).
- Responsive: below `md`, brand + picker + avatar stay visible; nav collapses to slide-down (D11).
**Edge cases:**
- **D11 mobile slide-down a11y:** the collapsed panel needs focus management/trap (default: trap). Don't just `display:none` the links — keyboard users lose them. Fold the focus-trap into this feature or split it; do not leave it implicit.
- **D1 brand mark:** `Layers` is the default; if a logo asset is supplied later it's a drop-in. Don't bake the icon choice into CSS.

### F38 — Project picker rebuild
**Goal:** Kill the three picker bugs (uncontrolled value, conflated states, un-themeable native select) with a controlled, state-aware Radix Dropdown.
**Ships:** Picker shows the currently-open project (synced from route + store), shows a spinner while loading, an error+retry on query failure (never "No projects" on error), an empty-state with a create link, and a "+ Create project" footer. Themeable, with `FolderKanban` icon + project color dot + `ChevronDown`.
**Depends on:** F36 (Dropdown + Tooltip), F37 (moved to left cluster).
**PRD:** §4.3, §2.2 (three bugs at `ProjectPicker.tsx:19,24,27`).
**Acceptance:**
- Controlled `value` derived from `useParams` slug **and** `useProjectStore.lastSelectedSlug`; never `defaultValue`. Stays in sync on URL-driven nav (direct nav to `/projects/foo` updates the picker).
- `isLoading` → skeleton; `isError` → "Couldn't load projects" + retry (not "No projects"); empty array → "No projects yet" + link to `/projects`; loaded → list.
- Selecting navigates + persists via `useProjectStore`.
- Footer "+ Create project" → `/projects`.
- On `/projects` listing: visible with "Select a project" placeholder (D3 default).
- Test: error state shows retry (regression for the "No Projects even when project selected" bug); reflects slug from URL; empty offers create link.
**Edge cases:**
- **D3 listing-page visibility:** default is "Select a project" placeholder, not hidden. If owner flips to hidden, the nav also needs to hide the picker-on-listing case — keep them in sync.
- Race: project list changes while open (rare) — close on outside-click is enough; don't over-engineer live updates inside the open menu.
- Long project names: truncate with `title` tooltip so the trigger width stays bounded.

### F39 — Avatar → profile Dropdown menu with Sign out
**Goal:** Replace the floating flat "Sign out" text with a proper profile menu.
**Ships:** Avatar is a Dropdown trigger; menu header shows avatar + name + email ("signed in as"); items include theme toggle (optional, mirrored from navbar) and Sign out (`LogOut` icon) calling the existing `handleSignOut`.
**Depends on:** F36 (Dropdown), F37 (avatar slot in right cluster).
**PRD:** §4.4, §2.1 (`TopNav.tsx:102-108` flat Sign out).
**Acceptance:**
- Avatar opens the Dropdown; header renders signed-in user's avatar/name/email.
- Sign out item calls the **existing** `handleSignOut` (no new auth logic — §10 auth untouched).
- Floating "Sign out" text removed from `TopNav`.
- Test: menu opens, Sign out invokes `handleSignOut`.
**Edge cases:**
- Don't duplicate the theme toggle if `F40` already ships it in the navbar — decide one source of truth, mirror the other. PRD §4.4 allows omitting it from the menu if navbar has it.
- User object shape: reuse whatever `useAuth`/session hook already returns; don't invent a new user fetch.

### F40 — Theme toggle UI (3-way segmented control)
**Goal:** Give the user a visible, in-app theme control wired to `useTheme`.
**Ships:** A Sun/Monitor/Moon segmented control in the navbar right cluster (and optionally mirrored in the profile menu). Clicking changes theme instantly, persists, and updates `.dark`.
**Depends on:** F34 (useTheme), F36 (Tooltip/icons), F37 (navbar slot).
**PRD:** §3.2 (toggle UI), §4.2 (far-right placement).
**Acceptance:**
- Segmented control with `SunIcon` (light) / `MonitorIcon` (system) / `MoonIcon` (dark); active segment indicated.
- Clicking a segment calls `setTheme`; `.dark` on `<html>` updates immediately; preference persists.
- Control reachable by keyboard, `aria-pressed`/`role="group"` correct.
- Available pre-auth on `LoginPage` too (§6).
**Edge cases:**
- Pre-auth placement: `LoginPage` isn't under `TopNav`; either mount a minimal toggle there or ensure `ThemeProvider` scope covers it. Decide once.
- Don't render two competing toggles (navbar + profile) with divergent state — both read `useTheme`, single source.

### F41 — Fold HealthBadge into navbar
**Goal:** Remove the standalone full-width "Healthy" bar and surface health as a compact navbar indicator.
**Ships:** Navbar shows an `Activity` icon + colored dot (green healthy / red unhealthy) with a tooltip explaining status; the standalone `<HealthBadge />` row is deleted from `AppLayout`.
**Depends on:** F37 (navbar layout), F36 (Tooltip).
**PRD:** §4.2 (health folds in), §2.1 (`AppLayout.tsx:11` standalone bar), §3.3 (`Activity` icon).
**Acceptance:**
- `AppLayout.tsx:11` standalone `<HealthBadge />` row removed.
- Navbar shows `Activity` + status dot; tooltip reads "Healthy"/"Unhealthy" with detail.
- Status tint uses `--success`/`--danger` tokens (added in F32).
- No layout shift when health flips between states.
**Edge cases:**
- Tooltip here reuses `F36` Tooltip primitive; don't hand-roll a `title` attribute (a11y).
- If health check is slow/in-flight, show a neutral state, not a false green.

### F42 — Project-aware nav (muted+disabled+tooltip when project-less)
**Goal:** Make Board/Reports nav reflect project scope per the decided rule, without hiding the menu.
**Ships:** With a project selected, Board → `/projects/:slug`, Reports → `/projects/:slug/reports`, both enabled. With no project (fresh login, `/projects`, cleared store), Board and Reports render muted + disabled + a "Select a project first" tooltip; Settings stays enabled (admin). `/projects` is the natural selection landing with a clear empty state.
**Depends on:** F36 (Tooltip — disabled buttons need it), F37 (nav structure). (Reports link **target** finalized in `F49`.)
**PRD:** §4.5, §9.1 (decided).
**Acceptance:**
- Project present: Board + Reports enabled, route to the open project.
- Project absent: Board + Reports `disabled` + muted class + Tooltip "Select a project first"; not hidden.
- Settings always enabled (admin only), independent of project.
- `/projects` page: "Select a project" heading + list + Create CTA, `EmptyState` with `FolderOpen`.
- Test: disabled state has the tooltip; enabled state routes correctly.
**Edge cases:**
- **D5 a11y trap:** `disabled` buttons don't receive focus, so the tooltip can't trigger on focus. Radix Tooltip wraps the trigger in a span wrapper — confirm this works for the disabled case (the reason `F36` exists). Without it the hint is unreachable to keyboard users.
- Reports target points to `/projects/:slug/reports` which doesn't exist until `F49`. Land this feature with Reports routing to the **old** `/reports` temporarily, or land `F42`'s Reports-disabled logic now and flip the target in `F49`. Pick one; document it. (Cleaner: Reports stays disabled-but-correct until `F49`.)

---

## Phase 2 — Ticket modal & forms

### F43 — Modal size prop + themeable panel + X icon
**Goal:** Make `Modal` size-aware and theme-correct without touching its a11y shell.
**Ships:** `Modal` accepts `size?: 'sm'|'md'|'lg'|'xl'` (`md` default, backward-compatible); panel uses `bg-background text-foreground border-border` (no `bg-white`); close button uses `<X size={20} />`.
**Depends on:** F35 (tokens + primitives).
**PRD:** §5.1, §2.5 (`Modal.tsx:48` hardcoded).
**Acceptance:**
- `size` maps `sm→max-w-md`, `md→max-w-lg` (default), `lg→max-w-2xl`, `xl→max-w-4xl`.
- `Modal.tsx:48` `bg-white` swapped for tokens; `×` → `<X>`.
- **`useModalA11y` untouched** (focus trap, Esc, scroll lock) — §5.1/§10.
- Existing Modal consumers (confirm dialogs etc.) still work at default size.
- Test: `size` prop applies correct `max-w-*`; Esc still closes.
**Edge cases:**
- Radix `react-dialog` swap is **explicitly deferred** (§9.2) — do not migrate the Modal to Radix now. Keep the hand-rolled shell.
- Backward compat: every existing `<Modal>` call must keep working without passing `size`.

### F44 — Two-column TicketAttributeForm
**Goal:** Replace the narrow 512px single-column form with a Jira-style two-column layout at `xl`.
**Ships:** Create/Edit ticket modal renders `grid grid-cols-1 lg:grid-cols-3 gap-6` — left 2/3: Title + Description (+ optional Activity); right 1/3: Priority/Assignee/Labels/Checklist (each in `Field`, edit mode adds time-tracking summary). Sticky footer: Cancel + Create/Save, right-aligned, single `Button` size.
**Depends on:** F43 (Modal needs `xl`), F35 (Field/Button).
**PRD:** §5.2, §2.5 (`TicketAttributeForm.tsx:81` single column).
**Acceptance:**
- At `lg`+: two columns; below `lg`: single column, meta below description.
- All fields still submit; dirty/`readOnly` behavior unchanged.
- Footer sticky, single button size.
- Icons: `Flag`, `UserCircle`, `Tags`, `ListChecks`, `AlignLeft` per §3.3.
- Test: two-column still submits all fields; readOnly mode unchanged.
**Edge cases:**
- **`react-hook-form`/Zod schema frozen (§10)** — only layout + primitive wrapping change. Don't touch the form state model.
- Collapsible Activity area is "optional" per §5.2 — decide in-PR; don't leave it half-wired.
- Long checklists in the narrow right column: ensure the sidebar scrolls independently rather than stretching the modal.

### F45 — Field/input consistency sweep
**Goal:** Make every field in the form (and confirm/ManualEntry dialogs) use the primitives, killing the padding/border/focus-ring drift.
**Ships:** `RichTextEditor` outer border = `border-input` with focus-within ring; `ChecklistEditor` item padding deliberate; all buttons via `Button` (one size vocabulary); confirm-dialog and ManualEntry buttons adopt `sm`/`md`.
**Depends on:** F35 (primitives), F44 (form is two-column so the sweep lands clean).
**PRD:** §5.3, §2.5 (drift table).
**Acceptance:**
- Every form field routes through `Field` + `TextInput`/`SelectInput`/`Textarea`: identical `px-3 py-2`, `border-input`, uniform focus ring.
- `RichTextEditor` focus-within ring added.
- `ChecklistEditor` padding either matches family or is a deliberately-chosen "dense" variant (commented).
- Confirm-dialog + ManualEntry buttons use `Button` `sm`/`md`.
- Visual: no three-button-size drift remains.
**Edge cases:**
- Don't re-scope this into a repo-wide sweep — that's `F46`. This feature is form + dialogs only.
- Dense variant for checklist items, if chosen, must be a named variant, not a one-off className.

---

## Phase 3 — Token migration sweep (correctness + polish)

### F46 — Raw-color → semantic-token sweep
**Goal:** Remove every `gray-*`, `bg-white`, and hardcoded hex from components so light/dark "just work" via tokens.
**Ships:** Components render correctly in dark mode with no raw-color leaks. Worst offenders (`ReportsPage` 27, `TimeLog` 17, `SettingsPage` 14, `LabelManager` 6, +6 `bg-white`, ~44 hex) migrated.
**Depends on:** F32 (tokens), F35 (Card/Badge/Avatar to migrate onto).
**PRD:** §2.3 (~147 raw usages — note: live audit says ~103 `gray-*` + 6 `bg-white` + ~44 hex ≈ 153; sweep all), §4 (T4.1/T4.2).
**Acceptance:**
- `rg "gray-|bg-white|#[0-9a-fA-F]{6}" frontend/src/components frontend/src/pages` returns zero hits in component markup (constants/types excluded).
- `PriorityBadge`/`LabelChip`/`AssigneeAvatar` migrated onto `Badge`/`Avatar` where sensible (§4 T4.2).
- Light + dark visual pass on Board, Reports, Projects, Settings, ProjectSettings, Login, ticket modal, confirm dialogs, empty/error/loading states.
**Edge cases:**
- **Test-update cascade (load-bearing):** raw-color sweep + new markup will break snapshots/assertions beyond the 4 PRD-named files (`TopNav`, `ProjectPicker`, `Modal`, `TicketAttributeForm`). `F50` exists to catch the rest, but this feature should fix the tests for the files it touches.
- Hardcoded hex in constants (e.g. label colors) may be intentional data — don't blindly tokenize; route through a token map or leave as data with a comment.
- `bg-white` on `OfflineBanner` — §6 says keep it red/alert; don't tokenize the alert away.

---

## Phase 4 — Backend: project-scoped Reports (unblocks F49)

### F47 — Build project-membership middleware (scope correction)
**Goal:** Create the `requireProjectMember` middleware the PRD assumes exists but does not.
**Ships:** `backend/src/middleware/requireProjectMember.ts` (or `.js`) that resolves `:slug` → project, verifies the authenticated user is a member, attaches `req.project`, else 403. Modeled on `requireRole.ts`; reuses `accessControl.ts` patterns where applicable.
**Depends on:** —.
**PRD:** §5.2 T5.2 ("reuse existing project-membership middleware") — **scope correction**: it does not exist (see Pre-existing prerequisites / repo audit). `backend/src/middleware/` has only `auth`, `requireRole`, `validateRequest`, `errorMiddleware`, `notFound`, `requestLogger`, `pingRoute`.
**Acceptance:**
- Middleware created; resolves slug via the existing project lookup; checks membership against the project-member table; 403 on non-member, 404 on unknown slug (decide: leak via 404 vs 403 — default 403 to mirror BE pattern), passes `req.project` downstream.
- Composes after `authenticate`; unit tests for member/non-member/unknown-slug.
**Edge cases:**
- **This is a scope correction vs the PRD.** `T5.2` says "reuse"; there is nothing to reuse. Surface to owner: the middleware must be built (default), not borrowed. The closest existing logic (`accessControl.ts`) only does signup-time domain check — insufficient for per-project membership.
- 404 vs 403 for unknown slug: 404 leaks existence, 403 hides it. Mirror whatever the rest of the BE does for project routes (check `requireRole` + existing project routes for precedent).
- Admin override: should admins bypass membership? Decide explicitly; default yes (admin = super-member).

### F48 — Project-scoped report endpoints + deprecate old routes
**Goal:** Add project-scoped Reports API and authorize it via the new membership middleware.
**Ships:** `GET /api/projects/:slug/reports/time` and `GET /api/projects/:slug/reports/tickets` aggregating only that project's tickets/time, membership-gated. Old global `/api/reports/*` routes handled per D2 (default: deprecated for one release, then removed).
**Depends on:** F47 (membership middleware).
**PRD:** §4.6, §5 (T5.1/T5.3/T5.4).
**Acceptance:**
- Scoped endpoints mirror existing `/reports/*` response shape; `reportService` gains a `projectId`/`slug` filter in every WHERE clause (today it aggregates all projects — `backend/src/services/reportService.ts`).
- `authenticate` + `requireProjectMember` applied.
- Non-member → 403; scoped aggregation correct (only project's data).
- Old routes: present-but-deprecated (header/log warning) per D2 default, with a removal ticket filed.
- Backend tests: scoped aggregation correctness; non-member 403.
**Edge cases:**
- **D2 keep-vs-remove:** default deprecate-one-release. Do not silently delete — existing FE links and any external consumers will 404. If owner picks remove-now, the `F49` redirect must land in the same release.
- Period/offset window math is UTC today; confirm scoping doesn't shift the window. Only the project filter changes.
- The existing `reportService` signature `getTimeReport({period,offset})` becomes `getTimeReport({period,offset,projectId})` — update all callers.

---

## Phase 5 — Frontend: project-scoped Reports

### F49 — Move Reports route + API + hook to `/projects/:slug/reports` (+ FE 403/loading/empty)
**Goal:** Make the Reports FE project-scoped end-to-end, with the error/loading/empty surfaces the PRD under-specifies.
**Ships:** Reports lives at `/projects/:slug/reports`; `ReportsPage` reads `:slug`, passes to `fetchTimeReport`/`fetchTicketSummary` (new scoped endpoints) via `useReport(period, offset, projectSlug)`; `reportKeys` includes slug; old `/reports` redirects; non-member direct-nav shows a 403 surface; tables wrapped in `Card`; empty states use lucide icons.
**Depends on:** F48 (BE scoped endpoints), F42 (nav already points Reports project-scoped).
**PRD:** §4.6, §6 (ReportsPage), §5 (T6.1–T6.4).
**Acceptance:**
- Route moved (`routes/index.tsx`); old `/reports` → redirect to last-selected project's reports or `/projects` (D6 default: drop `?period`/`?offset` query on redirect).
- `api/reports.ts` takes `projectSlug`; `useReport(period, offset, projectSlug)`; `ReportsPage` reads `:slug`.
- `reportKeys` includes slug (cache correctness).
- **D7 non-member direct-nav:** on BE 403 (from `requireProjectMember`), FE redirects to `/projects` (decided) — not a 403 surface.
- Loading skeleton, error/retry, empty-state (lucide `Inbox`/`BarChart3`) all present.
- Tables in `Card`; period toggle = `Button` variant group.
- `ReportsPage` tests updated; TopNav Reports link target finalized (was tentatively set in F42).
**Edge cases:**
- **FE↔BE dependency (hard):** this feature is blocked until `F48` ships. Do not land the FE calling non-existent endpoints.
- **D6 redirect query preservation:** default drop `?period`/`?offset` (they're project-relative and the new URL has a different scope). If owner wants preservation, remap explicitly.
- **D9 routing change scope:** this is the **only** allowed routing/auth change (§10). Don't sneak other route tweaks in here.
- `useReport` cache key must include slug or users see stale cross-project data on switch.

---

## Phase 6 — Gates, testing & release

### F50 — Test-update cascade + merge gate
**Goal:** Make "independently shippable" a verifiable claim, not a hope. Fix every test the redesign broke and enforce a green gate per phase.
**Ships:** A documented gate (`tsc --noEmit` + `vite build` + `lint` + `prettier --check`) that every redesign PR must pass green; all snapshot/assertion breakages from the raw-color sweep + new markup fixed.
**Depends on:** F31–F49 (this is the catch-all gate across the redesign).
**PRD:** §8 (testing), implied by §7 "independently shippable" (PRD names no gate — this feature defines it).
**Acceptance:**
- Gate script documented (e.g. in `.docs/redesign/` or CI): `rtk tsc --noEmit && rtk vite build && rtk lint && rtk prettier --check` (all green).
- Beyond the 4 PRD-named test files (`TopNav`, `ProjectPicker`, `Modal`, `TicketAttributeForm`), every file touched by `F46`/`F44`/`F38`/`F49` has updated tests.
- New tests added: picker retry-on-error, profile menu Sign out, `useTheme` persistence/toggle/system-follow, two-column form submit, `Modal` size prop, Reports non-member → redirect to `/projects`, membership middleware (BE).
- A11y: `useModalA11y` semantics intact; Dropdown focus/Esc/outside-click/`aria-expanded`; Tooltip reachable on disabled + focus.
- Coverage targets per `js-testing-rules.md`: business logic >80%, components >70%.
**Edge cases:**
- This is infrastructure/polish mapping to no single PRD REQ — justified as the implied gate the PRD's "independently shippable" claim requires.
- Don't let this become a dumping ground; if a feature's tests are broken, fix them **in that feature**, not here. This feature owns only the gate + genuinely cross-cutting test updates.

### F51 — Light/dark visual QA across all routes + ship redesign release
**Goal:** Prove the redesign works visually everywhere and cut a release.
**Ships:** Signed-off light/dark visual QA on every route; before/after screenshots of Board + Create modal; redesign release tagged.
**Depends on:** F50 (gate green).
**PRD:** §7 Phase 4 T4.3, §8 (visual pass).
**Acceptance:**
- Manual light + dark pass: Board, Reports (project-scoped), Projects, Settings, ProjectSettings, Login, ticket modal, confirm dialogs, empty/error/loading states.
- Screenshots before/after captured for Board + Create/Edit modal.
- Release tagged per `git-guidelines.md` (branch `release/x.y.z` — version only).
**Edge cases:**
- Radix portal `.dark` inheritance spot-checked here (the risk flagged in `F36`).
- No-flash verified on hard refresh in both themes (closes the loop opened by `F33`).

---

## Schema deltas vs. PRD

The redesign requires **no database migration**. Be explicit about this — do not conflate CSS tokens with schema.

| Delta | Reason | Feature |
| --- | --- | --- |
| **CSS token additions** (full semantic set: `card`, `card-foreground`, `popover`, `popover-foreground`, `primary-foreground`, `secondary`, `secondary-foreground`, `muted-foreground`, `accent`, `accent-foreground`, `input`, `ring`, `destructive`, `destructive-foreground`, `success`, `warning`, `danger` — light + dark values) | Today's `@theme` defines only 5 light tokens; components reference undefined ones (`bg-card`, `text-muted-foreground`, etc.) that emit **no color** in Tailwind v4. Defining the set is a correctness fix, not polish. | F32 |
| **`@custom-variant dark` + `.dark` block** | Enables class-based dark mode in Tailwind v4 (no JS config). | F32 |
| **No DB migration** | Reports scoping = a `WHERE projectId` clause in `reportService` + a membership check in new middleware. No new tables, columns, or indexes. | F47, F48 |

---

## Cross-cutting decisions (resolved)

These irreversible / cross-cutting choices were settled with the owner before dependent features start. Each is locked to the chosen value; features below must honor it.

1. **Radix choice (decided §9.2):** `@radix-ui/react-dropdown-menu` for menus; `Modal` keeps hand-rolled `useModalA11y` (Radix `react-dialog` swap **deferred**). Owned by `F36`/`F43`.
2. **localStorage key `slykboard-theme` (fixed by §3.2):** Changing this is a breaking change (existing users lose their preference). Never rename. Owned by `F34`.
3. **No-flash script ordering:** inline `<head>` script before any stylesheet, key `slykboard-theme`. Owned by `F33`.
4. **Radix Tooltip — DECIDED: add `@radix-ui/react-tooltip`** (owner sign-off). Required so the disabled-nav "Select a project first" hint (`F42`) is focus-reachable; `disabled` buttons aren't tooltip-reachable without a wrapper. Widens PRD §3.4 dep list. Installed in `F31`; primitive built in `F36`.
5. **Old global `/reports/*` BE routes — DECIDED: deprecate one release, then remove** (owner sign-off). Old routes stay present-but-deprecated (header/log warning) for one release; a removal ticket is filed. `F49` redirect lands regardless. Owned by `F48`.
6. **Brand mark — DECIDED: lucide `Layers` + "Slykboard" text** (owner sign-off). Drop-in replaceable if a logo asset arrives later. Owned by `F37`.
7. **Membership middleware — DECIDED: BUILD, not reuse** (owner sign-off; backend in scope). PRD §5.2 T5.2 assumed reuse; no such middleware exists (`backend/src/middleware/` has no such file). Build `requireProjectMember` modeled on `requireRole.ts`. Adds backend feature `F47`. Backend is in scope for this redesign.
8. **Reports FE↔BE dependency:** `F49` is hard-blocked on `F48`. Sequential (BE first). Owned by `F47`→`F48`→`F49`.
9. **Non-member direct-nav to `/projects/:slug/reports` — DECIDED: redirect to `/projects`** (owner sign-off; overrode the 403-surface default). FE catches BE 403 from `requireProjectMember` and redirects to `/projects`. Owned by `F49`.
10. **localStorage unavailable — DECIDED: fall back to `system`** (owner sign-off on minor defaults). Owned by `F33`/`F34`.
11. **Reports redirect query — DECIDED: drop `?period`/`?offset`** (owner sign-off on minor defaults). Owned by `F49`.
12. **Mobile slide-down nav focus management — DECIDED: trap focus** (owner sign-off on minor defaults). Owned by `F37`.
13. **Project picker on `/projects` listing — DECIDED: "Select a project" placeholder** (owner sign-off on minor defaults). Owned by `F38`.
14. **Routing/auth change scope — DECIDED: Reports relocation is the only routing/auth change** (owner sign-off on minor defaults). Guards `F49` scope creep.

---

## Explicitly deferred (post-redesign)

Per PRD §10. These are **not** features above.

- **Auth flow, routing guards, and `useModalA11y`** — untouched (Reports route *relocation* in §4.6 is the one allowed routing change; auth/`RequireAuth`/`RequireRole` behavior unchanged).
- **New features** beyond what's stated: charts in Reports, CSV export, comments, real profile editing, custom field editor. Visual/token refresh + the explicitly-decided Reports-scoping only.
- **`react-hook-form` / Zod schema in `TicketAttributeForm`** — unchanged; only layout + primitives wrapping change.
- **Backend** — *only* the Reports-scoping endpoints (Phase 4) are in scope; no other backend changes.
- **Radix `react-dialog` Modal swap** — optional/deferred (§9.2); `Modal` keeps `useModalA11y` for now.

---

## Coverage summary

Every PRD section/REQ maps to ≥1 feature; no orphans.

| PRD ref | Feature(s) |
| --- | --- |
| §3.1 tokens + dark variant | F32 |
| §3.1 meta `color-scheme` + §3.2 no-flash | F33 |
| §3.2 ThemeProvider + useTheme | F34 |
| §3.2 theme toggle UI | F40 |
| §3.3 icons (lucide) | F31, F37–F44 |
| §3.4 primitives (Button/Field/TextInput/Textarea/SelectInput/Avatar/Badge/Card) | F35 |
| §3.4 Dropdown (Radix) | F36 |
| §3.4 Tooltip (implied, D5) | F36 (scope addition) |
| §4.1 full-width gutter | F37 |
| §4.2 navbar clusters + brand + health fold-in | F37, F41 |
| §4.3 project picker rebuild | F38 |
| §4.4 avatar → profile menu | F39 |
| §4.5 project-aware nav (muted+disabled+tooltip) | F42 |
| §4.6 Reports project-scoped (route+API+hook+page) | F48 (BE), F49 (FE) |
| §5.1 Modal size + themeable + X icon | F43 |
| §5.2 two-column form | F44 |
| §5.3 field/input consistency | F45 |
| §6 other surfaces (TicketCard/BoardColumn/ReportsPage wrapping/LoginPage/EmptyState icons) | F46 (token sweep), F49 (Reports surfaces) |
| §2.3 undefined-token bug | F32 (correctness fix) |
| §2.5 padding/button drift | F35, F45 |
| §5.2 T5.2 membership middleware (scope correction) | F47 |
| §8 testing (4 named files + cascade) | F50 |
| §7 "independently shippable" gate (implied) | F50 |
| §7 T4.3 visual QA | F51 |
| D5 tooltip-on-disabled a11y (implied) | F36 |
| D11 mobile nav focus mgmt (implied) | F37 |
| FE 403/loading/empty for Reports (implied, PRD §6 under-specifies) | F49 |
| Tailwind v4 `@theme inline` spike (implied by §2.3 bug) | F32 acceptance |
| localStorage try/catch (implied, D8) | F33, F34 |
| Portal `.dark` inheritance check (implied) | F36 edge, F51 QA |

**No orphan features.** `F50` (gate) and `F51` (QA/release) map to no single PRD REQ but are justified as the implied infrastructure and deployment gate the PRD's "independently shippable" + visual-QA claims require.

**Dependency-graph integrity:** No cycles. The one hard FE↔BE dependency (`F49` ← `F48`) is flagged and sequenced. The one scope correction (`F47` middleware must be built, not reused) is surfaced as an owner sign-off, not silently absorbed.
