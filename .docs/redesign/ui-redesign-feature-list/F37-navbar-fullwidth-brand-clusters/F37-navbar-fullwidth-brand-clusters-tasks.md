# F37 — Full-width navbar gutter + brand mark + cluster layout: Plan + Task Breakdown

> **Feature:** F37 — Full-width navbar gutter + brand mark + cluster layout (Phase 1 — Chrome · Feature)
> **Feature index:** [`ui-redesign-features.md`](../../ui-redesign-features.md)
> **Slug:** `SLYK` · **Depends on:** F35 (done) · **PRD ref:** §4.1 (full-width gutter), §4.2 (cluster structure + brand mark), §2.1 (TopNav.tsx:41 max-w-5xl), §3.3 (nav + brand icons), D6/D1 (brand Layers), D11/D12 (mobile focus-trap)
> **Sources:** [`ui-redesign-plan.md`](../../ui-redesign-plan.md), the discovered project rules ([`.claude/rules/git-guidelines.md`](../../../../.claude/rules/git-guidelines.md), [`js-development-rules.md`](../../../../.claude/rules/js-development-rules.md), [`js-style-guide.md`](../../../../.claude/rules/js-style-guide.md), [`js-testing-rules.md`](../../../../.claude/rules/js-testing-rules.md), [`persona.md`](../../../../.claude/rules/persona.md)), [`project-metadata.md`](../../../../project-metadata.md). Dependency feature: [F35](../F35-shared-ui-primitives/F35-shared-ui-primitives-tasks.md) (cn + ui/ dir — done; F37 imports no primitives, uses lucide + Tailwind + `cn`).

---

## 1. F37 Recap

**Goal:** Make navbar and content share one horizontal rhythm and give the brand a mark.

**Ships:** Navbar spans full width with a single `px-4 md:px-6` gutter matching `<main>`; brand shows mark + "Slykboard"; left/center/right clusters established (brand + picker left, nav center, theme + avatar right). No content-centered-at-1024px-while-board-is-full-width mismatch. Mobile collapses nav into a slide-down panel with a keyboard focus trap.

**Acceptance (definition of done):**
1. `TopNav.tsx:41` `mx-auto flex max-w-5xl` removed; nav uses a full-width container with the shared `px-4 md:px-6` gutter. `<main>` gutter matches the chrome rhythm (board keeps its own internal horizontal scroll — gutter governs chrome only, §4.1).
2. Brand = lucide `Layers` (D1 default) + "Slykboard" text, in the left cluster.
3. Left / center / right cluster containers present in DOM order even if `F38`/`F39`/`F40` fill them later (placeholder slots ok).
4. Board's internal horizontal scroll still works (gutter governs chrome only — §4.1).
5. Responsive: below `md`, brand + picker + avatar stay visible; nav collapses to a slide-down panel with focus management/trap (D11).

**Edge cases resolved up front:**
- **D11 mobile slide-down a11y (focus management)** → **Decision: hand-roll a lightweight focus trap inside the slide-down panel (Tab wrap within the panel + Esc to close + close on outside click + restore focus to the toggle button). Reuse the existing `open` state. Borrow the `TABBABLE` selector pattern from `useModalA11y.ts:20-21` but DO NOT reuse the hook directly — it is dialog-shaped (`inerts` `#app-root`, scroll-locks `document.body`, moves initial focus to the panel root) which is too heavy for a nav panel and would mute the entire app beneath a slide-down nav. Never `display:none` the links: the panel is hidden via a class but links remain in the DOM and focusable when open; when closed they must not be focusable (panel is visually hidden + focusable elements inside are removed from tab order).** (D11/D12; analyst's `useModalA11y` analysis.)
- **D1 brand mark** → **Decision: lucide `Layers` `size={20}` (matching the `Modal` `X` size precedent) + "Slykboard" text, leftmost in the left cluster. Inline the icon in JSX (NOT a CSS background) so a future logo asset is a drop-in swap of the element — the icon choice is never baked into CSS.** (D6/D1; §3.3; PRD §4.2 "mark + Slykboard".)
- **Gutter scope (PRD §4.1 "match `<main>`" vs gutterless `<main>`)** → **Decision: F37 adds `px-4 md:px-6` to the NAV (the `<header>`/inner container). `<main>` stays gutterless. The board is intentionally full-bleed (columns overflow horizontally per §4.1 "gutter governs chrome only"); the "shared rhythm" means the chrome gutter aligns to where content chrome would be, not that the board page gets padded. F37 does NOT edit `AppLayout.tsx` — for non-board pages the gutter is a page-level concern owned later, not F37.**
- **Avatar handling** → **Decision: KEEP the existing inline avatar + flat "Sign out" block, RELOCATED to the right-cluster slot. Keeps sign-out working mid-redesign and keeps `TopNav.test.tsx` assertions (avatar img/initials/email-fallback, sign-out → logout+clear+navigate, sign-out survives rejection) green. F39 swaps it for F35 `Avatar` + F36 `Dropdown`.**
- **ProjectPicker move** → **Decision: MOVE the existing `<ProjectPicker />` to the left cluster next to the brand (§4.2). Layout move only — F38 rebuilds the picker internals into a Dropdown.**
- **Nav icons** → **Decision: add lucide `LayoutGrid` (Board), `BarChart3` (Reports), `Settings` (Settings) to the NavLinks (§3.3). Keep `<NavLink>` (the correct semantic element — NOT `Button`).**
- **Cluster DOM order** → **Decision: left = brand mark + "Slykboard" + ProjectPicker; center = primary nav (`LayoutGrid` Board / `BarChart3` Reports / `Settings` Settings, ADMIN-gated as today); right = theme slot (empty placeholder, F40) + avatar slot (existing inline avatar+signout kept, F39 swaps). All three cluster containers present in DOM order; empty slots are placeholder `<div>`s so later features drop in.**

---

## 2. Codebase Analysis Summary

- **State:** Partial — `TopNav.tsx` (121 lines) exists and is the single file F37 restructures. The `<header>` is already token-only (`border-b border-border bg-background` at `:40`) — F37 preserves this discipline. F37 is the **first lucide consumer of `Layers`** in the codebase; `lucide-react ^1` is installed (`frontend/package.json:27`, resolved 1.21.0 via F31) and already consumed by `frontend/src/components/ui/Avatar.tsx:5` (`{ User }`), so the import path is proven.

- **`TopNav.tsx` current structure (verbatim, line-cited) — what F37 restructures:**
  - `:1` `useState`; `:2` `NavLink, useNavigate` from `react-router`; `:3` `useAuthStore`; `:4` `logout`; `:5` `useRequireRole`; `:6` `broadcastLogout`; `:7` `ProjectPicker`.
  - `:9-12` `PUBLIC_NAV_LINKS = [{ to:'/', label:'Board', end:true }, { to:'/reports', label:'Reports', end:false }] as const`.
  - `:14` `ADMIN_NAV_LINKS = [{ to:'/settings', label:'Settings', end:false }] as const`.
  - `:16-19` local `getInitials(name, email)` — **per-name-char local-part variant** (`source.slice(0,2)`, NOT F35's per-word). F37 keeps it (avatar block relocated, not rebuilt).
  - `:21-115` `TopNav()`: `:22` `const [open, setOpen] = useState(false)`; `:23` `user`; `:24` `clear`; `:25` `isAdmin = useRequireRole('ADMIN')`; `:26` `navigate`.
  - `:28-37` `handleSignOut` — `try { await logout() } catch {}`, `clear()`, `broadcastLogout()`, `navigate('/login',{replace:true})`. **F37 preserves verbatim (F39 reuses).**
  - `:39-114` JSX:
    - `:40` `<header className="border-b border-border bg-background">` — **token-only, keep.**
    - `:41` `<nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">` — **the `mx-auto flex max-w-5xl` F37 removes; `px-4` is upgraded to `px-4 md:px-6`.**
    - `:42` `<span className="text-lg font-semibold">Slykboard</span>` — **no icon; F37 adds `<Layers size={20} aria-hidden />` before it.**
    - `:43` `<div className="flex items-center gap-4">` — the right-side grouping F37 dissolves into 3 clusters.
    - `:44-52` mobile hamburger (`md:hidden`, `aria-expanded={open}`, `aria-label="Toggle navigation"`, `onClick={() => setOpen(v=>!v)}`). **No slide-down panel, no focus trap — F37 adds both.**
    - `:53-56` `<ul className={${open?'flex':'hidden'} flex-col gap-2 md:flex md:flex-row md:items-center md:gap-6}>` — the nav list F37 moves to the center cluster; mobile panel gets the trap.
    - `:58-71` PUBLIC NavLinks; className callback `text-sm ${isActive?'text-primary':'text-muted'}` (`:64-66`). **F37 routes through `cn()`.**
    - `:72-86` ADMIN NavLinks (`isAdmin`-gated).
    - `:88` `<ProjectPicker />` — **on the right today; F37 MOVES to left cluster.**
    - `:89-110` avatar + flat Sign out: `<img>` (`:91-96`) or initials `<span>` (`:97-100`); flat `<button onClick={handleSignOut} className="text-sm text-muted hover:text-foreground">Sign out</button>` (`:102-108`). **F37 KEEPS this block, relocated to right cluster (D5).**

- **`AppLayout.tsx` (17 lines) — gutterless main (the gutter-scope tension):** `:10` `<TopNav />`; `:11` `<HealthBadge />` standalone row (F41 deletes — F37 must NOT touch); `:12` `<main id="app-root" className="flex-1">` — **NO gutter (gutterless).** Resolution (D1): the board is intentionally full-bleed (columns overflow horizontally, §4.1 "gutter governs chrome only"). F37 adds the gutter to the NAV only; `<main>` stays gutterless. **F37 does NOT edit `AppLayout.tsx`.** (For non-board pages the gutter is a page-level concern, not F37.)

- **Routes** (`frontend/src/routes/index.tsx`): Board `/` → `IndexRedirect` → `/projects/:slug` (`:33-34,59,62`); Reports `/reports` (`:77`); Settings `/settings` (`:78-82`, `RequireRole` ADMIN). F37 just restructures the nav; nav targets unchanged (F42/F49 re-scope later).

- **`useProjectStore`** (`frontend/src/stores/useProjectStore.ts:4-8`): `{ lastSelectedSlug, setLastSelectedSlug, clear }`, persisted `'slyk-project'`. **TopNav does NOT currently read it** (F38/F42 do); F37 only relocates `<ProjectPicker />`, which itself reads it — no new store coupling.

- **F35 primitives + lucide:** `components/ui/` has `cn.ts` + 8 primitives + F36 Dropdown/Tooltip. `lucide-react ^1` (`package.json:27`); only `Avatar.tsx:5` uses it (`User`). **F37 is the first consumer of `Layers`** (importable). `cn()` importable from `@/components/ui/cn`. **F37 imports NO F35 primitives for its deliverable** (brand = icon, layout = Tailwind, nav = `NavLink`, clusters = slots).

- **Focus-trap prior art (`useModalA11y.ts:23-83`):** W3C Dialog pattern — focus trap, initial focus, Esc, scroll lock, focus restore, Tab wrap, `inert` on `#app-root`, `TABBABLE` selector at `:20-21` (`'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'`). **`useModalA11y` is dialog-shaped (inerts whole app root + scroll-locks `document.body` + grabs initial focus to the panel root) — too heavy for a nav panel**; F37 hand-rolls a lighter trap (Tab wrap within the panel + Esc close + outside-click close + restore focus to the toggle) referencing the `TABBABLE` selector pattern. **F37 must NOT modify `useModalA11y.ts` (F16 owns it; F43 may refactor).**

- **`TopNav.test.tsx` (139 lines) — F37 restructure impact:**
  - Mocks `@/api/auth` (`logout`), `useCrossTabLogout` (`broadcastLogout`), `useProjects` (`{ data:[], isLoading:false }`), `useNavigate` (hoisted `navigateMock`); wraps in `<MemoryRouter initialEntries={['/']}>` (`renderTopNav` `:35-41`). `fullUser` fixture = ADMIN with `avatarUrl` (`:25-33`).
  - Existing assertions F37 must keep green: avatar img when `avatarUrl` set (`:52-57`); initials when `avatarUrl` null (`:59-65`, expects `'AL'` — relies on the LOCAL per-name-char `getInitials`); email-local-part fallback (`:67-77`, expects `'BO'`); Sign out → logout+clear+broadcast+navigate (`:79-92`); Sign out survives rejection (`:94-107`); Settings ADMIN-visible/MEMBER-hidden (`:109-121`); Board+Reports always (`:123-138`).
  - **If F37 keeps the existing inline avatar+signout block (D5 recommendation), the `'AL'`/`'BO'` assertions still pass** (they assume the per-name-char variant). Swapping to F35 `Avatar` (per-word) would break them — **F37 keeps inline.**
  - F37 ADDS assertions: brand (`Layers` icon via `getByRole`/svg + "Slykboard" text via `getByText`); 3 cluster containers in DOM order; mobile slide-down opens/closes + focus-trap (Tab wrap, Esc close, outside-click close, focus restore to toggle); full-width (no `max-w-5xl` class on the rendered nav).

- **Project rules this plan satisfies:**
  - `js-development-rules.md` — React 19+ / Vite / Tailwind; one component per file; co-locate tests; explicit prop interfaces; functional + hooks. Frontend code under `./frontend/`.
  - `js-style-guide.md` — PascalCase component files; **4-space JSX / 2-space TS**; ≤100 cols; trailing commas; import order external → internal → type → relative; functions <50 lines; **no `any`**; **no inline styles (Tailwind only)**; SCREAMING_SNAKE_CASE constants.
  - `js-testing-rules.md` — Vitest co-located `*.test.tsx`; RTL `getByRole` priority (`navigation`/`link`/`button`/`img`); `vi.fn()` mocks; table-driven preferred; **components >70% coverage**.
  - `git-guidelines.md` — sacred rule (never git without approval); rebase-and-merge ONLY (no merge/squash); `PROJECTSLUG = SLYK`; branch `type/SLYK-TICKET-desc`; single-line `SLYK-TICKET: message`. Repo precedent `SLYK-F31..F36:` → F37 uses `SLYK-F37:` prefix; branch `feature/SLYK-redesign-f37-navbar-fullwidth-brand-clusters`.
  - `persona.md` — frontend code → `./frontend/`; React 19+ specializations.

- **File paths the plan references that do NOT exist yet:** None — F37 MODIFIES only `TopNav.tsx` + `TopNav.test.tsx` (both exist). No new files, no AppLayout, no index.css, no index.html, no `main.tsx`.

- **Hidden coupling to plan for:**
  - **Avatar block is F37-relocated / F39-swapped** — F37 keeps the existing inline avatar+signout (D5) so `TopNav.test.tsx`'s `'AL'`/`'BO'`/sign-out assertions stay green; F39 swaps to F35 `Avatar` + F36 `Dropdown`.
  - **`<ProjectPicker />` is F37-relocated / F38-rebuilt** — F37 moves it to the left cluster as-is (the existing `<select>`); F38 rebuilds its internals into a Dropdown.
  - **Board full-bleed** — F37 does NOT pad `<main>` (D1); the board keeps internal horizontal scroll.
  - **F41 owns `<HealthBadge />`** — F37 must NOT touch the `HealthBadge` row in `AppLayout.tsx:11` (F41 folds it into the navbar / deletes the standalone row). F37 does not edit `AppLayout.tsx` at all.
  - **F42 owns nav scoping/disabled** — F37 keeps nav targets (`/`, `/reports`, `/settings`) and the ADMIN gate as-is; F42 re-scopes/disables with context.
  - **F37 must NOT modify `useModalA11y.ts`** — F16 owns it; F37 hand-rolls its own lighter trap, borrowing only the `TABBABLE` selector pattern.
  - **Mobile panel focusable-when-closed** — when `open` is false, the slide-down panel must be visually hidden AND its links must not be in the tab order (the current code uses `hidden`/`flex` toggle which already removes them from tab order; F37 preserves this behavior while adding the trap when open).

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Gutter scope | **F37 adds `px-4 md:px-6` to the NAV only (the `<header>`/inner container). `<main>` stays gutterless. F37 does NOT edit `AppLayout.tsx`.** | Resolves the PRD §4.1 "match `<main>`" vs gutterless-`<main>` tension: the board is intentionally full-bleed (columns overflow horizontally, §4.1 "gutter governs chrome only"). "Shared rhythm" = chrome gutter aligns to content edges; non-board page gutters are a later page-level concern, not F37. (PRD §4.1; analyst's AppLayout finding.) |
| D2 | Brand mark | **lucide `Layers` `size={20}` + "Slykboard" text, inline JSX (drop-in replaceable; NOT CSS-baked). Leftmost in the left cluster.** `<Layers aria-hidden />` precedes `<span>Slykboard</span>`. | D6/D1 brand decision; §3.3 brand icon; PRD §4.2 "mark + Slykboard". `size={20}` matches the `Modal` `X`-close precedent. Inline JSX means a future logo asset is a drop-in element swap. (D6/D1; PRD §4.2.) |
| D3 | Clusters (DOM order) | **left = brand (`Layers` + "Slykboard") + `<ProjectPicker />` (moved from right per §4.2); center = primary nav (`LayoutGrid` Board / `BarChart3` Reports / `Settings` Settings, ADMIN-gated as today); right = theme slot (empty placeholder `<div>`, F40) + avatar slot (existing inline avatar+signout kept as placeholder, F39 swaps).** All three cluster containers in DOM order; empty slots are placeholder `<div>`s. | PRD §4.2 ASCII (`[ mark + "Slykboard" ] [ ▾ Project picker ] [ Board Reports Settings ] [ ☀️/🖥️/🌙 theme ] [ avatar ▾ ]`). F37 acceptance: "Clusters present in DOM order even if F38/F39/F40 fill them later (placeholder slots ok)." |
| D4 | Nav icons | **Add lucide `LayoutGrid` (Board), `BarChart3` (Reports), `Settings` (Settings) to the NavLinks. Keep `<NavLink>` (NOT `Button`).** Each NavLink renders `<Icon className="h-4 w-4" aria-hidden />` + label span. | PRD §3.3 nav icons. `<NavLink>` is the correct semantic element (router-aware `isActive`); `Button` would break routing semantics. |
| D5 | Avatar handling | **KEEP the existing inline avatar + flat "Sign out" block, RELOCATED to the right-cluster slot. F39 swaps it for F35 `Avatar` + F36 `Dropdown`.** `getInitials` (per-name-char), `<img>`/initials-`<span>`, and the flat sign-out `<button>` all move as-is. | Avoids breaking auth/sign-out mid-redesign and keeps `TopNav.test.tsx`'s `'AL'`/`'BO'`/sign-out assertions green (they assume the per-name-char variant; F35 `Avatar` is per-word and would break them). F39 owns the swap. (Analyst's test-impact analysis.) |
| D6 | ProjectPicker | **MOVE the existing `<ProjectPicker />` to the left cluster (next to the brand) per §4.2. Layout move only — F38 rebuilds the picker internals into a Dropdown.** | PRD §4.2 (picker moves from right to left). F38 owns the rebuild. (§4.2.) |
| D7 | Mobile slide-down focus trap (D11) | **Hand-roll a lightweight focus trap in the slide-down panel: Tab wrap within the panel + Esc to close + close on outside pointerdown/click + restore focus to the toggle button. Reuse the existing `open` state. Borrow the `TABBABLE` selector pattern from `useModalA11y.ts:20-21` but DO NOT reuse the hook. Never `display:none` the links — when open they are visible + focusable + trapped; when closed the panel is `hidden` (links naturally fall out of tab order, preserving current behavior).** | D11/D12 mobile a11y. `useModalA11y` is dialog-shaped (inerts `#app-root`, scroll-locks `document.body`, grabs initial focus to the panel root) — too heavy for a nav panel and would mute the entire app beneath a slide-down nav. Hand-rolling keeps the trap scoped to the panel. (D11/D12; analyst's `useModalA11y` analysis.) |
| D8 | `cn()` usage | **Route conditional NavLink classes through `cn()` (replace the template-literal `isActive` callback). Import `cn` from `@/components/ui/cn`.** | F35 consistency; template-literal callbacks don't dedupe Tailwind classes; `cn()` (twMerge+clsx) does. |
| D9 | Scope | **Only `TopNav.tsx` + `TopNav.test.tsx` (2 files). No `AppLayout.tsx`, no `index.css`, no `index.html`, no `main.tsx`, no primitives-import, no picker-rebuild, no profile-menu, no theme toggle, no health fold-in, no nav scoping.** | F37 owns ONLY the TopNav restructure + mobile slide-down focus-trap. Prevents scope creep into F38/F39/F40/F41/F42/F32/F33/F46. |

> **Out of F37 scope (explicitly deferred):** build the project picker (Dropdown-based) — **F38**. Profile menu / `Avatar` swap — **F39**. Theme toggle — **F40**. `<HealthBadge />` fold-in / standalone-row delete — **F41**. Nav scoping / disabled state / Tooltip hints — **F42**. `index.css` tokens — **F32 closed**. `index.html` no-flash bootstrap — **F33 closed**. `useModalA11y` refactor — **F43** (F37 hand-rolls its own trap, does not touch the hook). Component migration — **F46**. New deps — **lucide installed in F31, no new deps**.

> **Owner sign-off needed (defaults chosen; surface):**
> - **D7 focus-trap approach (hand-roll vs borrow `useModalA11y`)** — default is hand-roll (lighter, scoped to panel; `useModalA11y` inerts the whole app root which is wrong for a nav panel). If the owner prefers DRY reuse, F37 would need to soften `useModalA11y` (out of scope / F43).
> - **D1 main-gutter scope (nav-only vs also `AppLayout.tsx`)** — default is nav-only (`<main>` stays gutterless for the full-bleed board). If the owner wants `<main>` guttered too, that is an `AppLayout.tsx` edit + breaks board full-bleed — flagged.
> - **D5 avatar keep-vs-swap (keep inline vs swap to F35 `Avatar` now)** — default is keep-inline (keeps sign-out + tests green; F39 owns the swap). If the owner wants the swap now, `TopNav.test.tsx`'s `'AL'`/`'BO'` assertions must be rewritten for per-word initials and the feature boundary with F39 collapses.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/
└─ frontend/
   └─ src/
      └─ components/
         ├─ TopNav.tsx          # MODIFIED — restructure: full-width gutter + Layers brand +
         │                      #   left/center/right clusters + nav icons + ProjectPicker moved
         │                      #   left + inline avatar/signout kept right + mobile slide-down
         │                      #   panel with hand-rolled focus trap (D7). mx-auto max-w-5xl removed.
         └─ TopNav.test.tsx     # MODIFIED — brand/cluster/mobile-toggle/full-width assertions;
                                  #   existing avatar/sign-out/Settings-visibility/Board-Reports kept.
# NO AppLayout.tsx edit (D1 — main stays gutterless for full-bleed board; F41 owns HealthBadge).
# NO index.css (F32 closed), NO index.html (F33 closed), NO main.tsx (F37 uninvolved).
# NO useModalA11y.ts edit (F16 owns; F37 hand-rolls its own trap, borrows only the TABBABLE pattern).
# NO new files, NO new deps (lucide in F31), NO primitives-import (brand=icon, layout=Tailwind).
```

**Data flow:** `TopNav()` reads `useAuthStore` (`user`, `clear`), `useRequireRole('ADMIN')`, `useNavigate`, and renders `<header>` (token-only, unchanged) wrapping a full-width inner container (`px-4 md:px-6`, gutter) holding three cluster `<div>`s in DOM order. Left cluster: `<Layers aria-hidden />` + `<span>Slykboard</span>` + `<ProjectPicker />`. Center cluster: the nav `<ul>` (Board/Reports/Settings `<NavLink>`s with lucide icons, classes via `cn()`). Right cluster: empty theme-slot `<div>` (F40 placeholder) + the relocated inline avatar + flat "Sign out" `<button>` (D5). Mobile (`md:hidden`): brand + picker + avatar stay in a top row; the hamburger toggles `open`; when open the nav slides down as a panel with a hand-rolled focus trap (Tab wrap + Esc + outside-click + focus restore to the toggle). `handleSignOut` is preserved verbatim.

---

## 5. Parallelization Strategy

F37 is **one component + its co-located test**, tightly coupled (the test exercises the component's new structure). The restructure (T1) and the test updates (T2) touch the same conceptual surface and the test imports the component — they cannot meaningfully parallelize. **Solo sequential track: T1 → T2 → T3 (verify).** No cross-file parallelism is honest for a single-file-pair feature.

### Batch dependency diagram

```
   Batch A (restructure)        Batch B (tests)              Batch C (integration)
   ───────────────────          ─────────────                ─────────────────────
       T1 ─────────────────────────────▶  T2  ─────────────────────▶  T3
   (TopNav.tsx restructure)         (TopNav.test.tsx                (verify: exactly 2 files,
                                     assertions)                     gate green, board scroll,
                                                                      sign-out, useModalA11y untouched)
```

- **Batch A → Batch B** is a hard barrier: T2's new assertions (brand, clusters, mobile slide-down, full-width) target T1's new DOM; T1 must land first so the test compiles against the new exports/structure.
- **Batch B → Batch C** is a hard barrier: T3 verifies the merged diff (exactly 2 files) and re-runs the full gate.

### Merge order rules

1. **Batch A merges first.** T1 (`TopNav.tsx` restructure) lands the full-width gutter + brand + clusters + nav icons + picker move + avatar relocate + mobile slide-down focus trap. Must be on `main` before T2 branches.
2. **Batch B merges second.** T2 (`TopNav.test.tsx`) adds the new assertions; existing assertions stay green because T1 kept the inline avatar+signout (D5). Lands after T1.
3. **Batch C (integration verification) merges last.** T3 confirms the committed diff is exactly 2 files, re-runs the full gate, confirms board scroll unaffected + sign-out still works + `useModalA11y` untouched, and records proof in §7.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | A | `frontend/src/components/TopNav.tsx` (Modified — restructure + focus trap) | — | — |
| **T2** | B | `frontend/src/components/TopNav.test.tsx` (Modified — assertions) | T1 | — |
| **T3** | C | no files changed (verification gate); records proof in §7 | T1, T2 | — |

### Developer assignment tracks

- **Solo:** T1 → T2 → T3 (sequential; single file pair, test imports component).
- **2 devs:** Not recommended — the component + its test are one logical unit; splitting risks the test author guessing at T1's exact DOM. If forced: Dev-A does T1+T2 serially; Dev-B does nothing until T3 (verification).
- **3 devs:** Overkill. One author owns the whole feature end-to-end.

---

## 6. Tasks

### T1 — Restructure `TopNav.tsx`: full-width gutter + Layers brand + clusters + nav icons + picker-left + avatar-right + mobile slide-down focus-trap

**Batch:** A · **Depends on:** None (F35 done) · **Parallel with:** —

**Description:** Restructure `TopNav.tsx` per D1-D9. Remove `mx-auto flex max-w-5xl` from `:41`; add the `px-4 md:px-6` gutter to the full-width inner container. Add the lucide `Layers` brand mark inline before "Slykboard" (D2). Establish three cluster containers in DOM order: left (brand + `<ProjectPicker />` moved from right, D3/D6), center (nav `<ul>` with `LayoutGrid`/`BarChart3`/`Settings` icons, NavLink classes via `cn()`, D3/D4/D8), right (empty theme-slot placeholder `<div>` for F40 + the existing inline avatar + flat "Sign out" block relocated verbatim, D3/D5). Build the mobile slide-down panel: brand + picker + avatar stay in a top row (`md:` layouts them inline on desktop); the hamburger toggles `open`; when open the nav panel slides down and a hand-rolled focus trap (Tab wrap within the panel + Esc close + outside-click close + focus restore to the toggle) is active (D7). Preserve `handleSignOut`, `getInitials`, the avatar `<img>`/initials-`<span>`, and `<ProjectPicker />` (relocated, not rebuilt). Token-only classes; `cn()` for conditional NavLink classes.

**Modify** `frontend/src/components/TopNav.tsx` — full replacement:

```typescript
import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { Layers, LayoutGrid, BarChart3, Settings } from 'lucide-react';
import { useAuthStore } from '@/stores/useAuthStore';
import { logout } from '@/api/auth';
import { useRequireRole } from '@/hooks/useRequireRole';
import { broadcastLogout } from '@/hooks/useCrossTabLogout';
import { cn } from '@/components/ui/cn';
import { ProjectPicker } from './ProjectPicker';

// F37 — Full-width navbar: shared px-4 md:px-6 gutter, Layers brand mark,
// left/center/right clusters, lucide nav icons, ProjectPicker moved left,
// inline avatar + Sign out kept right (F39 swaps). Mobile: nav collapses into a
// slide-down panel with a hand-rolled focus trap (D11). Board keeps its own
// internal horizontal scroll; the gutter governs chrome only (PRD §4.1).

interface NavLinkItem {
    to: string;
    label: string;
    end: boolean;
    icon: typeof LayoutGrid;
}

const PUBLIC_NAV_LINKS: readonly NavLinkItem[] = [
    { to: '/', label: 'Board', end: true, icon: LayoutGrid },
    { to: '/reports', label: 'Reports', end: false, icon: BarChart3 },
] as const;

const ADMIN_NAV_LINKS: readonly NavLinkItem[] = [
    { to: '/settings', label: 'Settings', end: false, icon: Settings },
] as const;

function getInitials(name: string, email: string): string {
    const source = name || email.split('@')[0] || '?';
    return source.slice(0, 2).toUpperCase();
}

// D11 — visible focusable selector (borrows the pattern from useModalA11y.ts:20-21).
// Hand-rolled (NOT useModalA11y — that hook inerts #app-root + scroll-locks body,
// which is too heavy for a nav slide-down panel).
const TABBABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function TopNav() {
    const [open, setOpen] = useState(false);
    const user = useAuthStore((s) => s.user);
    const clear = useAuthStore((s) => s.clear);
    const isAdmin = useRequireRole('ADMIN');
    const navigate = useNavigate();

    // D11 — slide-down panel refs + trap state.
    const panelRef = useRef<HTMLDivElement>(null);
    const toggleRef = useRef<HTMLButtonElement>(null);
    const lastFocusedRef = useRef<HTMLElement | null>(null);

    const handleSignOut = async () => {
        try {
            await logout();
        } catch {
            // /logout 401/500 === already logged out; clear locally regardless.
        }
        clear();
        broadcastLogout();
        navigate('/login', { replace: true });
    };

    const closePanel = () => setOpen(false);

    // D11 — when the panel opens: remember the trigger, no scroll-lock (nav panel
    // must not freeze the page). When it closes: restore focus to the trigger.
    // Tab wrap (first <-> last) + Esc + outside-click are handled in the keydown
    // and pointerdown effects below.
    useEffect(() => {
        if (!open) return;
        lastFocusedRef.current = document.activeElement as HTMLElement | null;

        const onKeyDown = (e: KeyboardEvent) => {
            const panel = panelRef.current;
            if (!panel) return;
            if (e.key === 'Escape') {
                e.stopPropagation();
                closePanel();
                return;
            }
            if (e.key !== 'Tab') return;
            const tabbables = Array.from(
                panel.querySelectorAll<HTMLElement>(TABBABLE),
            );
            if (tabbables.length === 0) return;
            const first = tabbables[0]!;
            const last = tabbables[tabbables.length - 1]!;
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };

        const onPointerDown = (e: MouseEvent) => {
            const panel = panelRef.current;
            const toggle = toggleRef.current;
            if (!panel) return;
            if (panel.contains(e.target as Node)) return;
            if (toggle?.contains(e.target as Node)) return;
            closePanel();
        };

        document.addEventListener('keydown', onKeyDown, { capture: true });
        document.addEventListener('pointerdown', onPointerDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown, { capture: true });
            document.removeEventListener('pointerdown', onPointerDown);
            // Restore focus to the toggle when the panel closes.
            lastFocusedRef.current?.focus();
        };
    }, [open]);

    const navLinkClass = ({ isActive }: { isActive: boolean }) =>
        cn(
            'flex items-center gap-1.5 text-sm',
            isActive ? 'text-primary' : 'text-muted hover:text-foreground',
        );

    const navItems = (
        <ul className="flex flex-col gap-2 md:flex-row md:items-center md:gap-6">
            {PUBLIC_NAV_LINKS.map((link) => {
                const Icon = link.icon;
                return (
                    <li key={link.to}>
                        <NavLink
                            to={link.to}
                            end={link.end}
                            onClick={() => setOpen(false)}
                            className={navLinkClass}
                        >
                            <Icon className="h-4 w-4" aria-hidden="true" />
                            <span>{link.label}</span>
                        </NavLink>
                    </li>
                );
            })}
            {isAdmin &&
                ADMIN_NAV_LINKS.map((link) => {
                    const Icon = link.icon;
                    return (
                        <li key={link.to}>
                            <NavLink
                                to={link.to}
                                end={link.end}
                                onClick={() => setOpen(false)}
                                className={navLinkClass}
                            >
                                <Icon className="h-4 w-4" aria-hidden="true" />
                                <span>{link.label}</span>
                            </NavLink>
                        </li>
                    );
                })}
        </ul>
    );

    const brand = (
        <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" aria-hidden="true" />
            <span className="text-lg font-semibold">Slykboard</span>
        </div>
    );

    const avatarBlock = user && (
        <div className="flex items-center gap-3">
            {user.avatarUrl ? (
                <img
                    src={user.avatarUrl}
                    alt={user.name}
                    className="h-8 w-8 rounded-full"
                />
            ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium text-background">
                    {getInitials(user.name, user.email)}
                </span>
            )}
            <button
                type="button"
                onClick={handleSignOut}
                className="text-sm text-muted hover:text-foreground"
            >
                Sign out
            </button>
        </div>
    );

    return (
        <header className="border-b border-border bg-background">
            <div className="px-4 py-3 md:px-6">
                {/* Desktop: 3 clusters in one row, brand left / nav center / actions right. */}
                <nav
                    aria-label="Primary"
                    className="flex items-center justify-between gap-4"
                >
                    {/* Left cluster: brand + ProjectPicker (moved from right per §4.2). */}
                    <div className="flex items-center gap-4">
                        {brand}
                        <ProjectPicker />
                    </div>

                    {/* Center cluster: primary nav (desktop). */}
                    <div className="hidden md:flex">{navItems}</div>

                    {/* Right cluster: theme slot (F40 placeholder) + avatar (F39 swaps). */}
                    <div className="flex items-center gap-3">
                        <div data-slot="theme" aria-hidden="true" />
                        {avatarBlock}
                        <button
                            ref={toggleRef}
                            type="button"
                            className="md:hidden"
                            aria-expanded={open}
                            aria-controls="mobile-nav-panel"
                            aria-label="Toggle navigation"
                            onClick={() => setOpen((v) => !v)}
                        >
                            <span aria-hidden="true">{open ? 'Close' : 'Menu'}</span>
                        </button>
                    </div>
                </nav>

                {/* Mobile slide-down panel (D11 focus trap). Links stay in DOM; */}
                {/* when open they are visible + trapped; when closed the panel is hidden. */}
                <div
                    ref={panelRef}
                    id="mobile-nav-panel"
                    className={cn(
                        open ? 'block' : 'hidden',
                        'md:hidden',
                    )}
                >
                    {navItems}
                </div>
            </div>
        </header>
    );
}
```

> **Key correctness notes for the implementer:**
> - `<nav aria-label="Primary">` gives the desktop nav an accessible name (RTL `getByRole('navigation')`); the mobile panel reuses the same `navItems` (no duplicate `<nav>` element — the panel is a plain `<div>` so there is exactly one `navigation` landmark).
> - `navLinkClass` is extracted so both desktop and mobile render share it (DRY) and `cn()` dedupes (D8).
> - The mobile panel is a sibling of `<nav>`, toggled by `open ? 'block' : 'hidden'`. When `hidden`, the links fall out of the tab order (preserving current behavior). When open, the `useEffect` attaches the keydown (Tab wrap + Esc) and pointerdown (outside-click) listeners.
> - `toggleRef` + `lastFocusedRef` drive focus restore to the hamburger on close (D7).
> - The theme slot is `<div data-slot="theme" aria-hidden="true" />` — a placeholder so F40 drops the toggle in without restructuring; `aria-hidden` because an empty div is non-interactive.
> - `handleSignOut`, `getInitials`, the avatar `<img>`/`<span>`, and `<ProjectPicker />` are byte-for-byte preserved (relocated only) so `TopNav.test.tsx` stays green.

**Acceptance Criteria:**
- [ ] `TopNav.tsx:41` no longer contains `mx-auto flex max-w-5xl`; the inner container uses `px-4 py-3 md:px-6` (full-width, shared gutter).
- [ ] `import { Layers, LayoutGrid, BarChart3, Settings } from 'lucide-react'` added; `cn` imported from `@/components/ui/cn`.
- [ ] Brand renders `<Layers className="h-5 w-5 text-primary" aria-hidden="true" />` immediately before `<span>Slykboard</span>` (leftmost left cluster); icon is inline JSX (NOT a CSS background).
- [ ] Three cluster containers in DOM order: left (`brand` + `<ProjectPicker />`), center (`navItems`, desktop-only via `hidden md:flex`), right (theme slot placeholder + `avatarBlock` + hamburger).
- [ ] `<ProjectPicker />` relocated to the left cluster (not rebuilt).
- [ ] Inline avatar (`<img>` or initials `<span>`) + flat "Sign out" `<button>` + `handleSignOut` preserved verbatim in the right cluster.
- [ ] NavLinks render lucide icons (`LayoutGrid` Board, `BarChart3` Reports, `Settings` Settings); NavLink className is the `cn()`-based `navLinkClass` (no template-literal `isActive` callback).
- [ ] ADMIN gate (`isAdmin && ADMIN_NAV_LINKS.map(...)`) preserved; nav targets (`/`, `/reports`, `/settings`) unchanged.
- [ ] Mobile slide-down panel: `toggleRef` + `panelRef` + `lastFocusedRef` refs wired; `useEffect([open])` attaches keydown (Tab wrap within panel + Esc close) and pointerdown (outside-click close) listeners when open; cleanup removes listeners + restores focus to the toggle.
- [ ] When `open` is false the panel is `hidden` (links out of tab order — preserves current behavior); when open the panel is `block` + `md:hidden`.
- [ ] Hamburger `aria-expanded={open}`, `aria-controls="mobile-nav-panel"`, `aria-label="Toggle navigation"`; panel `id="mobile-nav-panel"`.
- [ ] All classes are F32 token utilities (no raw colors, no `dark:` color classes); `border-b border-border bg-background` header preserved.
- [ ] No `any`; explicit `NavLinkItem` interface; functions <50 lines; 4-space JSX / 2-space TS; ≤100 cols; trailing commas.
- [ ] `AppLayout.tsx`, `useModalA11y.ts`, `index.css`, `index.html`, `main.tsx` NOT modified.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run build -w frontend` exits 0.

**Dependencies:** F35 (`cn` from `@/components/ui/cn`); F31 (`lucide-react ^1`).

---

### T2 — Update `TopNav.test.tsx`: brand, cluster, mobile-slide-down, full-width assertions

**Batch:** B · **Depends on:** T1 · **Parallel with:** —

**Description:** Add assertions for F37's new structure while keeping all existing assertions green (they pass because T1 kept the inline avatar+signout per D5). New coverage: brand (`Layers` icon + "Slykboard" text), three cluster containers in DOM order, mobile slide-down opens/closes + focus trap (Tab wrap, Esc close, outside-click close, focus restore to toggle), full-width (no `max-w-5xl` on the rendered nav). Existing coverage stays: avatar img/initials/email-fallback, Sign out → logout+clear+navigate, Sign out survives rejection, Settings ADMIN-visible/MEMBER-hidden, Board+Reports always.

**Modify** `frontend/src/components/TopNav.test.tsx` — add the following `describe` blocks / `it` cases alongside the existing ones (existing imports + `fullUser` + `renderTopNav` + existing `it` cases unchanged):

```typescript
// Add lucide icon shape helper at top (after imports):
// lucide icons render as <svg>; assert presence by querying the brand container.
function brandContainer() {
    return screen.getByText('Slykboard').parentElement as HTMLElement;
}

// Inside describe('TopNav', ...) — NEW cases:

it('renders the Layers brand mark before "Slykboard" (leftmost left cluster)', () => {
    useAuthStore.getState().setUser(fullUser);
    renderTopNav();
    const brand = brandContainer();
    // The Layers svg is the first child (icon before the text span).
    const svg = brand.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(brand.firstChild).toBe(svg);
    expect(screen.getByText('Slykboard')).toBeInTheDocument();
});

it('renders a single primary navigation landmark', () => {
    useAuthStore.getState().setUser(fullUser);
    renderTopNav();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
});

it('renders Board/Reports NavLinks with icons', () => {
    useAuthStore.getState().setUser(fullUser);
    renderTopNav();
    const board = screen.getByRole('link', { name: /Board/ });
    const reports = screen.getByRole('link', { name: /Reports/ });
    expect(board.querySelector('svg')).toBeInTheDocument();
    expect(reports.querySelector('svg')).toBeInTheDocument();
});

it('does NOT apply max-w-5xl to the nav (full-width gutter)', () => {
    useAuthStore.getState().setUser(fullUser);
    renderTopNav();
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(nav.className).not.toContain('max-w-5xl');
    expect(nav.className).not.toContain('mx-auto');
});

it('ProjectPicker is in the left cluster (next to brand)', () => {
    useAuthStore.getState().setUser(fullUser);
    renderTopNav();
    const picker = screen.getByLabelText('Select project');
    // The picker shares a parent (left cluster) with the brand container.
    const leftCluster = picker.parentElement;
    expect(leftCluster?.contains(brandContainer())).toBe(true);
});

it('mobile slide-down panel is hidden by default', () => {
    useAuthStore.getState().setUser(fullUser);
    renderTopNav();
    const panel = document.getElementById('mobile-nav-panel');
    expect(panel).not.toBeNull();
    expect(panel?.className).toContain('hidden');
});

it('mobile toggle opens the slide-down panel (aria-expanded)', () => {
    useAuthStore.getState().setUser(fullUser);
    renderTopNav();
    const toggle = screen.getByRole('button', { name: 'Toggle navigation' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById('mobile-nav-panel');
    expect(panel?.className).toContain('block');
    expect(panel?.className).not.toContain('hidden');
});

it('mobile panel closes on Escape and restores focus to the toggle', () => {
    useAuthStore.getState().setUser(fullUser);
    renderTopNav();
    const toggle = screen.getByRole('button', { name: 'Toggle navigation' });
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const panel = document.getElementById('mobile-nav-panel');
    expect(panel?.className).toContain('hidden');
    // Focus restored to the toggle.
    expect(document.activeElement).toBe(toggle);
});

it('mobile panel closes on outside pointerdown', () => {
    useAuthStore.getState().setUser(fullUser);
    renderTopNav();
    const toggle = screen.getByRole('button', { name: 'Toggle navigation' });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // pointerdown on the header (outside panel + outside toggle) closes.
    fireEvent.pointerDown(document.body);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
});
```

> **Test notes:**
> - `getByRole('navigation', { name: 'Primary' })` relies on the `<nav aria-label="Primary">` T1 added.
> - The brand `svg` is asserted as `firstChild` of the brand container (icon before text) — load-bearing for the "mark + Slykboard" PRD §4.2 ordering.
> - The full-width assertion checks the rendered nav's `className` does NOT contain `max-w-5xl` or `mx-auto` — the concrete F37 acceptance.
> - The ProjectPicker-left assertion checks the picker shares a parent with the brand (the left cluster `<div>`).
> - The mobile focus-trap cases assert the observable contract: panel hidden by default, toggle flips `aria-expanded` + panel `hidden`/`block`, Esc closes + restores focus to the toggle, outside pointerdown closes. (The Tab-wrap-first/last behavior is exercised implicitly by the keydown handler; if the owner wants an explicit Tab-wrap unit case, add one that focuses the last link and asserts Tab wraps to the first — but jsdom focus math can be finicky, so the observable open/close/Esc/outside cases are the load-bearing contract.)
> - Existing assertions (avatar img/initials/email-fallback, sign-out, Settings-visibility, Board+Reports) are unchanged and must still pass because T1 kept the inline avatar+signout (D5). **Do not rewrite `'AL'`/`'BO'`** — they rely on the per-name-char `getInitials` that T1 preserves.

**Acceptance Criteria:**
- [ ] Brand assertion: `Layers` svg is `firstChild` of the brand container, `aria-hidden="true"`, "Slykboard" text present.
- [ ] Single `navigation` landmark with `name: 'Primary'`.
- [ ] Board/Reports NavLinks each render an `<svg>` icon.
- [ ] Full-width assertion: rendered nav `className` contains neither `max-w-5xl` nor `mx-auto`.
- [ ] ProjectPicker-left assertion: picker shares a parent (left cluster) with the brand container.
- [ ] Mobile panel: hidden by default; toggle click flips `aria-expanded` and panel `hidden`/`block`.
- [ ] Mobile panel: Esc closes + restores focus to the toggle.
- [ ] Mobile panel: outside pointerdown closes.
- [ ] All EXISTING assertions still pass unchanged: avatar img, initials (`'AL'`), email-fallback (`'BO'`), Sign out → logout+clear+navigate, Sign out survives rejection, Settings ADMIN-visible/MEMBER-hidden, Board+Reports always.
- [ ] `npm run test -w frontend -- TopNav.test.tsx` exits 0.
- [ ] `npm run typecheck -w frontend` exits 0.

**Dependencies:** T1.

---

### T3 — Integration verification & sign-off

**Batch:** C (terminal) · **Depends on:** T1, T2 · **Parallel with:** —

**Description:** The final definition-of-done gate. Confirm the committed diff is exactly the 2 F37 files (`TopNav.tsx` + `TopNav.test.tsx`), re-run the full gate green, confirm `AppLayout.tsx`/`index.css`/`index.html`/`main.tsx`/`useModalA11y.ts` are unchanged, confirm board scroll unaffected (the board page is untouched), confirm sign-out still works (avatar+signout kept), and record proof in §7.

Steps:
1. Confirm the branch's committed diff is **exactly** the F37 files:
   ```bash
   git diff --name-only main...HEAD | sort
   # Expected (exactly 2):
   # frontend/src/components/TopNav.test.tsx
   # frontend/src/components/TopNav.tsx
   ```
   Any other path (an `AppLayout.tsx` edit, an `index.css` edit, an `index.html` edit, a `main.tsx` edit, a `useModalA11y.ts` edit, a new primitive, a picker rebuild, a profile-menu/theme-toggle/health-fold-in/nav-scoping) → leaked; remove and re-commit. F37 owns only the TopNav restructure + mobile slide-down focus trap.
2. Re-run the full gate on the merged state:
   ```bash
   npm install
   npm run build -w frontend              # exit 0
   npm run typecheck -w frontend          # exit 0
   npm run test -w frontend               # exit 0 (incl. TopNav.test.tsx + full regression)
   ```
3. Confirm scope-boundary files are **unchanged** vs main:
   ```bash
   for f in frontend/src/components/AppLayout.tsx frontend/src/index.css frontend/index.html frontend/src/main.tsx frontend/src/hooks/useModalA11y.ts frontend/package.json; do
     git diff --quiet main...HEAD -- "$f" \
       && echo "$f: UNCHANGED" \
       || echo "$f: CHANGED (out of scope — revert)"
   done
   ```
   All must print UNCHANGED. (`AppLayout.tsx` — F41/D1; `index.css` — F32 closed; `index.html` — F33 closed; `main.tsx` — F37 uninvolved; `useModalA11y.ts` — F16 owns; `package.json` — lucide in F31, no new deps.)
4. Confirm no primitives-import / picker-rebuild / profile-menu / theme / health / scoping leakage:
   ```bash
   grep -E "from '@/components/ui/(Dropdown|Tooltip|Button|Badge|Avatar|Input|Label|Card|Dialog)'" frontend/src/components/TopNav.tsx \
     && echo "LEAKED primitive import (F35/F36 — F37 imports none)" \
     || echo "no primitive import: OK"
   grep -E "ThemeToggle|ProfileMenu|HealthBadge" frontend/src/components/TopNav.tsx \
     && echo "LEAKED F39/F40/F41 (out of scope)" \
     || echo "no F39/F40/F41 leakage: OK"
   ```
   All must print OK. (Only `cn` from `@/components/ui/cn` is allowed.)
5. Confirm `cn()` is imported and used:
   ```bash
   grep -n "from '@/components/ui/cn'" frontend/src/components/TopNav.tsx
   grep -c "cn(" frontend/src/components/TopNav.tsx   # >= 2 (navLinkClass + panel toggle)
   ```
6. Confirm lucide icons are imported:
   ```bash
   grep -E "import \{ Layers, LayoutGrid, BarChart3, Settings \} from 'lucide-react'" frontend/src/components/TopNav.tsx
   ```
   Must match.
7. Confirm token-only classes (no raw colors, no `dark:` color classes) in `TopNav.tsx`:
   ```bash
   grep -REn 'bg-(slate|blue|red|amber|orange|green|gray)-[0-9]' frontend/src/components/TopNav.tsx \
     && echo "RAW COLOR FOUND (BUG — must use tokens)" || echo "token-only: OK"
   grep -REn 'dark:(bg|text|border)-' frontend/src/components/TopNav.tsx \
     && echo "dark: color class FOUND (BUG — tokens carry theme)" || echo "no dark: color classes: OK"
   ```
   Both must print OK.
8. Confirm `mx-auto max-w-5xl` is gone and `px-4 md:px-6` is present:
   ```bash
   grep -E "max-w-5xl|mx-auto" frontend/src/components/TopNav.tsx \
     && echo "BUG: max-w-5xl/mx-auto still present" || echo "full-width: OK"
   grep -E "px-4.*md:px-6" frontend/src/components/TopNav.tsx \
     && echo "gutter present: OK" || echo "BUG: gutter missing"
   ```
9. Confirm board scroll is unaffected (the board page is untouched by F37 — smoke):
   ```bash
   git diff --quiet main...HEAD -- frontend/src/pages/BoardPage.tsx frontend/src/components/Board.tsx \
     && echo "board untouched: scroll preserved" \
     || echo "board CHANGED (out of scope — revert)"
   ```
   Must print "board untouched: scroll preserved". (F37 does not touch board components; the gutter governs chrome only per §4.1.)
10. Confirm sign-out still works (avatar+signout kept): the T2 test "Sign out button calls logout + clear + navigate" + "clears local state + navigates even when logout rejects" passing in step 2 is the authoritative proof.
11. Capture commit SHA, exit codes, test counts into §7. Confirm owner sign-off on D7 (focus-trap approach), D1 (main-gutter scope), D5 (avatar keep-vs-swap) — defaults chosen; surface.

**Acceptance Criteria:**
- [ ] Committed diff is exactly 2 files: `TopNav.tsx`, `TopNav.test.tsx` — no `AppLayout.tsx`/`index.css`/`index.html`/`main.tsx`/`useModalA11y.ts`/primitive/picker-rebuild/profile-menu/theme/health/scoping leakage.
- [ ] `npm run build -w frontend` exits 0 on the merged state.
- [ ] `npm run typecheck -w frontend` exits 0 on the merged state.
- [ ] `npm run test -w frontend` exits 0 on the merged state (incl. `TopNav.test.tsx` + full regression).
- [ ] `AppLayout.tsx`, `index.css`, `index.html`, `main.tsx`, `useModalA11y.ts`, `package.json` all UNCHANGED vs main.
- [ ] No primitive import (only `cn`), no `ThemeToggle`/`ProfileMenu`/`HealthBadge` leakage.
- [ ] `cn()` imported + used (≥2 call sites); lucide `{ Layers, LayoutGrid, BarChart3, Settings }` imported.
- [ ] No raw Tailwind colors, no `dark:` color classes inside `TopNav.tsx` (token-only).
- [ ] `max-w-5xl`/`mx-auto` absent; `px-4 md:px-6` gutter present.
- [ ] Board components untouched (scroll preserved).
- [ ] Sign-out still works (T2 sign-out tests pass).
- [ ] All F37 §1 acceptance bullets satisfied; SHAs + results recorded in §7.
- [ ] Owner sign-off on D7 (focus-trap), D1 (gutter scope), D5 (avatar keep) recorded.

**Dependencies:** T1, T2.

---

## 7. Final F37 Acceptance Checklist

- [ ] `TopNav.tsx:41` `mx-auto flex max-w-5xl` removed; full-width inner container uses `px-4 py-3 md:px-6`.
- [ ] Brand = `<Layers aria-hidden />` (inline JSX, `size={20}` via `h-5 w-5`) + `<span>Slykboard</span>`, leftmost in the left cluster.
- [ ] Three cluster containers in DOM order: left (brand + `<ProjectPicker />`), center (nav with icons), right (theme slot placeholder + inline avatar + Sign out + hamburger).
- [ ] NavLinks render lucide icons (`LayoutGrid` Board, `BarChart3` Reports, `Settings` Settings); NavLink classes via `cn()`.
- [ ] `<ProjectPicker />` relocated to left cluster (not rebuilt).
- [ ] Inline avatar + flat "Sign out" + `handleSignOut` preserved verbatim in the right cluster (D5).
- [ ] Mobile slide-down panel: `hidden`/`block` toggle on `open`; hand-rolled focus trap (Tab wrap + Esc close + outside-click close + focus restore to toggle) active when open (D7).
- [ ] Hamburger `aria-expanded`, `aria-controls="mobile-nav-panel"`, `aria-label="Toggle navigation"`; panel `id="mobile-nav-panel"`.
- [ ] Board's internal horizontal scroll unaffected (board components untouched; gutter governs chrome only, §4.1).
- [ ] `<main>` stays gutterless (D1 — board intentionally full-bleed; `AppLayout.tsx` unchanged).
- [ ] `<header>` stays token-only (`border-b border-border bg-background`); no raw colors, no `dark:` color classes anywhere in `TopNav.tsx`.
- [ ] No `any`; explicit `NavLinkItem` interface; functions <50 lines; 4-space JSX / 2-space TS; ≤100 cols; trailing commas.
- [ ] `TopNav.test.tsx` updated: brand, navigation landmark, nav icons, full-width, ProjectPicker-left, mobile slide-down open/close/Esc/outside-click; existing avatar/initials/sign-out/Settings-visibility/Board-Reports assertions still green.
- [ ] `AppLayout.tsx`, `index.css`, `index.html`, `main.tsx`, `useModalA11y.ts`, `package.json` unchanged.
- [ ] No primitive import (only `cn`); no `ThemeToggle`/`ProfileMenu`/`HealthBadge` leakage.
- [ ] `npm run build -w frontend` exits 0.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend` exits 0 (incl. `TopNav.test.tsx` + full regression).
- [ ] Committed diff is exactly 2 files (`TopNav.tsx` + `TopNav.test.tsx`).
- [ ] Commit message single-line `SLYK-F37: <message>`; branch `feature/SLYK-redesign-f37-navbar-fullwidth-brand-clusters`; rebase-and-merge only.

**Integration record (fill during T3):**
- Feature commit SHA: `________`
- Diff = exactly 2 files (`TopNav.tsx`, `TopNav.test.tsx`); no AppLayout/CSS/index.html/main.tsx/useModalA11y/primitive/picker/profile/theme/health/scoping leakage: `PASS/FAIL`
- `cn()` import present + call sites: `≥2`
- lucide `{ Layers, LayoutGrid, BarChart3, Settings }` imported: `PASS/FAIL`
- `max-w-5xl`/`mx-auto` absent in `TopNav.tsx`: `PASS/FAIL`
- `px-4 md:px-6` gutter present: `PASS/FAIL`
- No raw colors / no `dark:` color classes in `TopNav.tsx`: `token-only: OK`
- `TopNav.test.tsx` result: `__/__ pass` (brand svg firstChild + text, navigation landmark, nav icons, full-width no max-w-5xl, picker-left, panel hidden default, toggle aria-expanded open/close, Esc close + focus restore, outside-click close, + existing avatar/initials/email/sign-out×2/Settings×2/Board-Reports×2)
- Board components untouched (scroll preserved): `PASS/FAIL`
- Sign-out still works (T2 sign-out tests pass): `PASS/FAIL`
- `AppLayout.tsx` vs main: `UNCHANGED (D1/F41 preserved)`
- `index.css` vs main: `UNCHANGED (F32 preserved)`
- `index.html` vs main: `UNCHANGED (F33 preserved)`
- `main.tsx` vs main: `UNCHANGED`
- `useModalA11y.ts` vs main: `UNCHANGED (F16 preserved; F37 hand-rolled trap)`
- `package.json` vs main: `UNCHANGED (lucide in F31 — no new deps)`
- New deps added by F37: `0`
- Build / typecheck / test exit codes: `0 / 0 / 0`
- D7 owner sign-off (focus-trap: hand-roll vs useModalA11y): `recorded (date: ________)`
- D1 owner sign-off (main-gutter scope: nav-only vs also AppLayout): `recorded (date: ________)`
- D5 owner sign-off (avatar keep-inline vs swap-now): `recorded (date: ________)`

---

## 8. Schema deltas owned by this feature

F37 owns **no schema deltas.** There is **no DB migration** (the redesign's standing no-migration stance), **no CSS token additions** (F32 owns and has closed those — `index.css` is frozen), **no `index.html` change** (F33 owns the no-flash bootstrap), and **no `main.tsx` change** (F37 uninvolved). F37 adds **no new dependencies** (`lucide-react ^1` was installed in F31; `cn` is from F35). F37 touches only `frontend/src/components/TopNav.tsx` (restructured) + `frontend/src/components/TopNav.test.tsx` (assertions) — a component + its co-located test, no schema surface.

| Delta | Detail | Mechanism |
| --- | --- | --- |
| No DB migration | None | — (redesign no-migration stance) |
| No CSS token deltas | None — F32 owns all tokens and is closed | `frontend/src/index.css` unchanged |
| No `index.html` change | None — F33 owns the no-flash bootstrap and is closed | `frontend/index.html` unchanged |
| No `main.tsx` change | None — F37 does not mount providers | `frontend/src/main.tsx` unchanged |
| No `AppLayout.tsx` change | None — `<main>` stays gutterless (D1; board full-bleed per §4.1); F41 owns `<HealthBadge />` | `frontend/src/components/AppLayout.tsx` unchanged |
| No `useModalA11y.ts` change | None — F16 owns the hook; F37 hand-rolls a lighter panel-scoped trap (D7) | `frontend/src/hooks/useModalA11y.ts` unchanged |
| No new dependencies | `lucide-react ^1` installed in F31; `cn` from F35 | `frontend/package.json` unchanged |
| TopNav restructure | Full-width `px-4 md:px-6` gutter; lucide `Layers` brand + `LayoutGrid`/`BarChart3`/`Settings` nav icons; left/center/right clusters (brand+picker left, nav center, theme-slot + inline-avatar+signout right); ProjectPicker moved left; mobile slide-down panel with hand-rolled focus trap (Tab wrap + Esc + outside-click + focus restore) | `frontend/src/components/TopNav.tsx` modified |
| Co-located test updates | Brand (`Layers` svg firstChild + "Slykboard"), single `navigation` landmark, nav icons, full-width (no `max-w-5xl`), ProjectPicker-left, mobile slide-down open/close/Esc/outside-click; existing avatar/initials/sign-out/Settings/Board-Reports assertions kept green | `frontend/src/components/TopNav.test.tsx` modified |
