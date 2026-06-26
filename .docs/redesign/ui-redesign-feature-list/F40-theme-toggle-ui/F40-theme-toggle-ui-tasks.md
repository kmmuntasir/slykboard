# F40 — Theme toggle UI (3-way segmented control in navbar + profile menu): Plan + Task Breakdown

> **Feature:** F40 — Theme toggle UI (3-way segmented control in navbar + profile menu) (Phase 1 — Chrome · Feature)
> **Feature index:** [`ui-redesign-features.md`](../../ui-redesign-features.md)
> **Slug:** `SLYK` · **Depends on:** F34 (done) + F36 (done) + F37 (done) · **PRD ref:** §3.2 (toggle UI), §4.2 (far-right placement), §3.3 (Sun/Monitor/Moon icons), §1.6 (system respect)
> **Sources:** [`ui-redesign-plan.md`](../../ui-redesign-plan.md), the discovered project rules ([`.claude/rules/git-guidelines.md`](../../../../.claude/rules/git-guidelines.md), [`js-development-rules.md`](../../../../.claude/rules/js-development-rules.md), [`js-style-guide.md`](../../../../.claude/rules/js-style-guide.md), [`js-testing-rules.md`](../../../../.claude/rules/js-testing-rules.md), [`persona.md`](../../../../.claude/rules/persona.md)), [`project-metadata.md`](../../../../project-metadata.md). Dependency features: [F34](../F34-theme-provider-use-theme/F34-theme-provider-use-theme-tasks.md) (useTheme — done); [F37](../F37-navbar-fullwidth-brand-clusters/F37-navbar-fullwidth-brand-clusters-tasks.md) (navbar right-cluster slot — done); [F39](../F39-avatar-profile-dropdown/F39-avatar-profile-dropdown-tasks.md) (profile Dropdown — done, hosts the optional mirror).

---

## 1. F40 Recap

**Goal:** Give the user a visible, in-app theme control wired to `useTheme` — a Sun/Monitor/Moon segmented control in the navbar right cluster (and mirrored inside the profile menu), so theme changes are one click away at all times.

**Ships:** A reusable `ThemeToggle` segmented control (Sun = light / Monitor = system / Moon = dark) mounted in `TopNav` (authed app) and on `LoginPage` (pre-auth), plus an optional mirror as three `DropdownItem`s inside the F39 profile menu. Clicking any segment calls `setTheme`; `.dark` on `<html>` updates immediately; the preference persists (localStorage via F34 ThemeProvider). Both navbar and profile-menu instances read the single `useTheme` Context — no divergent local state.

**Acceptance (definition of done):**
1. Segmented control renders `SunIcon` (light) / `MonitorIcon` (system) / `MoonIcon` (dark); the active segment is visually indicated (`bg-accent text-accent-foreground`).
2. Clicking a segment calls `setTheme('light' | 'system' | 'dark')`; `.dark` on `<html>` updates immediately; preference persists across reload (F34 localStorage).
3. Control is keyboard-reachable (native `<button>` per segment), `aria-pressed` on each segment and `role="group"` + `aria-label="Theme"` on the wrapper are correct.
4. Toggle is available **pre-auth** on `LoginPage` (§6) — mounted directly there (ThemeProvider scope covers it).
5. Profile-menu mirror (optional per PRD §3.2 "mirrored in profile menu") — three `DropdownItem`s (Sun→light, Monitor→system, Moon→dark) with a `Check` icon on the active entry (§3.3). Both instances share `useTheme` (single source).
6. Tests: active-segment indication, click → `setTheme`/`.dark`, `role="group"`, `aria-pressed`, keyboard activation; `TopNav.test.tsx` harness wraps `<ThemeProvider>` (load-bearing).

**Edge cases resolved up front:**
- **Pre-auth placement** → **Decision: extract a reusable `ThemeToggle` component; mount it in `TopNav` (authed) AND directly on `LoginPage` (pre-auth).** `main.tsx:24` wraps `RouterProvider` in `<ThemeProvider>`, so `LoginPage` (a standalone route at `routes/index.tsx:41-43`, no `AppLayout`/`TopNav`) is still inside the provider — `useTheme()` works there. Mounting the same component in both places satisfies the "available pre-auth" acceptance without a second provider or a duplicate toggle primitive. (D4.)
- **Single source of truth (no competing toggles)** → **Decision: both the navbar segmented control AND the profile-menu mirror read `useTheme` (single React Context).** No local `useState` for theme anywhere in F40. The profile menu calls the same `setTheme` the navbar does; both reflect the same `theme` value. (D5.)
- **Component structure** → **Decision: extract `frontend/src/components/ThemeToggle.tsx`** (reusable across `TopNav`, `LoginPage`, and the profile-menu mirror). Co-located `ThemeToggle.test.tsx`. The profile-menu mirror uses the same `useTheme` wiring but renders as `DropdownItem`s inside the F39 `Dropdown` — implemented inline in `TopNav` (the menu already lives there per F39 D5). (D1.)
- **Segmented-control a11y pattern** → **Decision: `<div role="group" aria-label="Theme">` wrapping three raw `<button>`s, each with `aria-pressed={isActive}` and a distinct `aria-label` ("Light"/"System"/"Dark").** Raw `<button>`s with `cn()` — NOT the F35 `Button` primitive (Button has no built-in `aria-pressed`; raw buttons are simpler and semantically exact for a segmented control). Active = `bg-accent text-accent-foreground`; inactive = `text-muted-foreground hover:text-foreground`. Token-only classes. (D2.)

---

## 2. Codebase Analysis Summary

- **State:** Greenfield component + three integration points. F40 creates `ThemeToggle.tsx` + `ThemeToggle.test.tsx` (new) and modifies `TopNav.tsx` (fill the F37 theme slot + add profile-menu mirror) + `TopNav.test.tsx` (wrap `<ThemeProvider>` in the harness — load-bearing) + `LoginPage.tsx` (mount the toggle pre-auth). All deps are done and live in code: F34 (`useTheme`), F36 (Dropdown — for the profile mirror), F37 (navbar right-cluster slot), F39 (profile Dropdown shell).

- **F34 `useTheme`** (`hooks/useTheme.ts:11-17`) — the single source F40 wires to:
  - Returns `{ theme: 'light' | 'dark' | 'system', setTheme: (t) => void, resolvedTheme: 'light' | 'dark' }`.
  - `setTheme` writes localStorage + toggles `.dark` on `<html>` (+ `matchMedia` listener for `'system'`). **F40 calls only `setTheme`/reads `theme` — no direct DOM/localStorage.** F34 owns the side effects.
  - Must be called inside `<ThemeProvider>` (`main.tsx:24` wraps `RouterProvider` → all routes including `LoginPage`).

- **F37 navbar theme slot — the fill target** (`TopNav.tsx:245`): `<div data-slot="theme" aria-hidden="true" />`. Sits in the right cluster as `[theme-slot]` → `[avatarBlock (F39 Dropdown)]` → `[hamburger]`. F40 replaces this placeholder with `<ThemeToggle />`. No test queries `data-slot="theme"` directly (verified) — safe to swap.

- **F39 profile Dropdown** (`TopNav.tsx:180-224`) — the optional mirror host: F39 explicitly OMITTED a theme item (F39 D2, comment at `:179`). F40 MAY add three `DropdownItem`s here (Sun/Monitor/Moon + `Check` on active). PRD §3.2 says "mirrored in profile menu"; F39 deferred it to F40. **Decision D5: include the mirror** (both instances read `useTheme` — no divergence).

- **Pre-auth gap** — `LoginPage` is at `routes/index.tsx:41-43`, a standalone route (no `AppLayout`/`TopNav`). BUT it is inside `<ThemeProvider>` (`main.tsx:24` wraps `RouterProvider`). So `useTheme()` works on `LoginPage`; F40 just mounts `<ThemeToggle />` there directly (D4). No second provider, no `TopNav` import on `LoginPage`.

- **Test-harness risk (LOAD-BEARING):** `TopNav.test.tsx` `renderTopNav()` (`:41-47`) wraps in `<MemoryRouter>` but NOT `<ThemeProvider>`. Once `TopNav` renders `<ThemeToggle />` (which calls `useTheme()`), **every existing TopNav test throws "must be used within ThemeProvider."** T2 MUST update `renderTopNav()` to wrap in `<ThemeProvider>` (or mock `useTheme`). No existing test queries `data-slot="theme"` — the slot swap is test-safe; the provider wrap is the only harness break.

- **F35 `Button`** (`components/ui/Button.tsx`): `variant="ghost"` available (`hover:bg-accent`). **F40 does NOT use it** — raw `<button>`s with `cn()` give exact `aria-pressed` semantics for a segmented control without primitive extension (D2).

- **lucide icons** — `Sun`, `Monitor`, `Moon`, `Check` importable from `lucide-react` (F31; `TopNav.tsx:3` already imports from lucide). Standard icons, no new dep.

- **F36 `Dropdown`** (`components/ui/Dropdown.tsx`) — for the profile-menu mirror: `DropdownItem` (`variant: 'default' | 'destructive'`; `onSelect` passthrough), `DropdownSeparator`, `DropdownLabel` — all exported (F39 confirmed 7 exports). The mirror uses `default`-variant `DropdownItem`s with `onSelect={() => setTheme(...)}`.

- **`LoginPage.tsx`** — exists; F40 adds `<ThemeToggle />` to its chrome (e.g. top-right corner). Exact placement decided in T3 (a `fixed`/`absolute` corner or inline in the login card header — both inside `<ThemeProvider>`).

- **Build gate:** `dev` / `build` / `typecheck` / `test`.

- **Project rules this plan satisfies:**
  - `js-development-rules.md` — React 19+ / Vite / Tailwind; one component per file; explicit prop interfaces; functional + hooks; Zustand for client UI state (theme is in React Context via F34, not Zustand — correct, F34 owns it). Frontend code under `./frontend/`.
  - `js-style-guide.md` — PascalCase component files (`ThemeToggle.tsx`); **4-space JSX / 2-space TS**; ≤100 cols; trailing commas; import order external → internal → type → relative; functions <50 lines; **no `any`**; no inline styles (Tailwind only); SCREAMING_SNAKE_CASE constants; avoid prop drilling (theme via Context — correct).
  - `js-testing-rules.md` — Vitest co-located `*.test.tsx`; RTL `getByRole`/`getByLabelText` priority (`group`, `button`); `vi.fn()` mocks; table-driven preferred; **components >70% coverage**; `aria-pressed` assertions.
  - `git-guidelines.md` — sacred rule (never git without approval); rebase-and-merge ONLY (no merge/squash); `PROJECTSLUG = SLYK`; branch `type/SLYK-TICKET-desc`; single-line `SLYK-TICKET: message`. Repo precedent `SLYK-F31..F39:` → F40 uses `SLYK-F40:` prefix; branch `feature/SLYK-redesign-f40-theme-toggle-ui`.
  - `persona.md` — frontend code → `./frontend/`; React 19+ specializations. Reply concise.

- **File paths the plan references that do NOT exist yet:**
  - `frontend/src/components/ThemeToggle.tsx` (new — T1).
  - `frontend/src/components/ThemeToggle.test.tsx` (new — T1).
  - (Modified, exist:) `frontend/src/components/TopNav.tsx`, `frontend/src/components/TopNav.test.tsx`, `frontend/src/pages/LoginPage.tsx` (or wherever `LoginPage` lives — confirmed in T3).

- **Hidden coupling to plan for:**
  - **Test-harness provider wrap (load-bearing)** — `TopNav.test.tsx` `renderTopNav()` must wrap `<ThemeProvider>` once `TopNav` calls `useTheme` via `<ThemeToggle />`. Every existing TopNav test throws otherwise. T2 owns this; it's the single highest-risk break.
  - **F39 profile Dropdown co-location** — the profile menu lives inline in `TopNav.tsx` (F39 D5). The F40 mirror adds `DropdownItem`s inside that same inline `DropdownContent`. Touches the same file as the slot fill — T2 owns both edits to `TopNav.tsx` (no cross-task conflict).
  - **`LoginPage` standalone (no TopNav)** — pre-auth has no navbar, so the toggle must be mounted directly on `LoginPage`. Disjoint file from `TopNav` → T3 owns it, parallel-safe with T2.
  - **Single Context, no local state** — both navbar + profile mirror + LoginPage instance must call the same `useTheme()`. No `useState(theme)` anywhere in F40 (would diverge from the Context). D3/D5 enforce this.
  - **F34 owns side effects** — F40 never touches `document.documentElement.classList`, `localStorage`, or `matchMedia` directly. All via `setTheme`. D3.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Component structure | **Extract `frontend/src/components/ThemeToggle.tsx`** (reusable: TopNav + LoginPage + profile-menu mirror wiring). Co-located `ThemeToggle.test.tsx`. The profile-menu mirror itself renders as `DropdownItem`s inline in `TopNav` (the F39 menu lives there) but shares the `useTheme` call. | One component, three mount sites. Avoids duplicating the icon/label/active logic. PRD §3.2 "segmented control in navbar + mirrored in profile menu" — extracting the core keeps the segmented control DRY while the menu mirror is a thin inline consumer. (Analyst; PRD §3.2.) |
| D2 | Segmented-control a11y + styling | **`<div role="group" aria-label="Theme">` wrapping three raw `<button aria-pressed={isActive} aria-label="Light"/"System"/"Dark">`** carrying `Sun`/`Monitor`/`Moon` icons. Active = `bg-accent text-accent-foreground`; inactive = `text-muted-foreground hover:text-foreground hover:bg-accent/50`. Raw `<button>`s + `cn()` — NOT the F35 `Button` primitive. | F35 `Button` has no built-in `aria-pressed`; raw buttons give exact `aria-pressed` semantics for a segmented control without extending the primitive. `role="group"` + per-button `aria-pressed` is the WAI-IAA pattern for a mutually-exclusive toggle group (F40 acceptance: "`aria-pressed`/`role="group"` correct"). Token-only classes (no raw colors, no `dark:`). (F40 acceptance; WAI-ARIA; js-style-guide token-only.) |
| D3 | Wiring | **`const { theme, setTheme } = useTheme()`** in `ThemeToggle`. Active segment = `theme === 'light'/'system'/'dark'`. Click → `setTheme('light' | 'system' | 'dark')`. `.dark` + localStorage handled entirely by F34 ThemeProvider. | F34 (`hooks/useTheme.ts:11-17`) owns the side effects (`matchMedia`, `.dark` class, localStorage). F40 is a pure consumer — no direct DOM/localStorage, no local `useState` (would diverge from the Context). Single source of truth. (Analyst; F34 contract.) |
| D4 | Pre-auth placement | **Mount `<ThemeToggle />` directly on `LoginPage`.** `main.tsx:24` wraps `RouterProvider` (all routes) in `<ThemeProvider>`, so `LoginPage` (standalone, no `AppLayout`/`TopNav`) is inside the provider — `useTheme()` works. | Satisfies F40 acceptance "available pre-auth on LoginPage (§6)" without a second provider or a duplicate primitive. The same `ThemeToggle` component renders in both authed and pre-auth contexts. (Analyst pre-auth finding; F40 acceptance §6.) |
| D5 | Profile-menu mirror | **Include** — add three `DropdownItem`s inside the F39 profile `DropdownContent` (Sun→light, Monitor→system, Moon→dark), with a `Check` icon on the active entry (§3.3). Both the navbar segmented control and the menu items call the same `setTheme` from the same `useTheme()` Context. | PRD §3.2 explicitly says "mirrored inside the profile menu." Both instances read the single Context → no divergent state (the F40 edge case "Don't render two competing toggles with divergent state" is satisfied by construction). F39 deferred this to F40 (F39 D2). §3.3 lists `Check` for the active theme item. (PRD §3.2, §3.3; F39 D2 deferral.) |
| D6 | Test harness (load-bearing) | **Wrap `renderTopNav()` in `<ThemeProvider>`** in `TopNav.test.tsx` (around the existing `<MemoryRouter>`). Plus add toggle tests (active segment, click → setTheme, `role="group"`, `aria-pressed`, keyboard). `ThemeToggle.test.tsx` wraps in `<ThemeProvider>` from the start. | Once `TopNav` renders `<ThemeToggle />` (which calls `useTheme()`), every existing TopNav test throws "must be used within ThemeProvider" because the harness (`:41-47`) only wraps `<MemoryRouter>`. This is the single highest-risk break — T2 must fix it or the whole suite goes red. (Analyst test-harness finding.) |
| D7 | Scope | **5 files:** `ThemeToggle.tsx` (new) + `ThemeToggle.test.tsx` (new) + `TopNav.tsx` (fill slot + profile mirror) + `TopNav.test.tsx` (wrap provider + toggle tests) + `LoginPage.tsx` (add toggle). | F40 owns ONLY the toggle UI + its three mount sites. No `useTheme`/ThemeProvider changes (F34), no Dropdown primitive changes (F36), no navbar layout changes (F37 — only the slot's contents), no auth changes (§10), no CSS/DB. (Analyst scope finding.) |

> **Out of F40 scope (explicitly deferred):** `useTheme` / ThemeProvider internals — **F34 (done)**. Dropdown/Tooltip primitives — **F36 (done)**. Navbar right-cluster layout / theme slot shell — **F37 (done)** (F40 fills the slot's contents only). Profile Dropdown shell — **F39 (done)** (F40 adds menu items inside it). Avatar primitive — **F35 (done)**. CSS tokens — **F32 (closed)**. `index.html` no-flash — **F33 (closed)**. Auth flow — **untouched (§10)**. HealthBadge — **F41**. Nav scoping — **F42**. New deps — none (lucide `Sun`/`Monitor`/`Moon`/`Check` via F31; `Dropdown` parts via F36).

> **Owner sign-off needed:**
> - **D4 → add `<ThemeToggle />` to `LoginPage`** (vs. a separate minimal pre-auth toggle). Default chosen: reuse the same component on `LoginPage`. Surface for sign-off: confirms the login page chrome should host the full segmented control.
> - **D5 → include the profile-menu mirror** (vs. omit, navbar-only). Default chosen: include (PRD §3.2 "mirrored"). Surface for sign-off: confirms the F39 profile menu grows three theme items.
> No further sign-off blocking F40.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/
└─ frontend/
   └─ src/
      ├─ components/
      │  ├─ ThemeToggle.tsx        # NEW — reusable 3-way segmented control:
      │  │                         #   <div role="group" aria-label="Theme"> wrapping 3 raw
      │  │                         #   <button aria-pressed> with Sun/Monitor/Moon icons.
      │  │                         #   useTheme() → theme (active), setTheme (click). Token-only.
      │  ├─ ThemeToggle.test.tsx   # NEW — co-located: active segment, click → setTheme,
      │  │                         #   role="group", aria-pressed, keyboard; wrapped in
      │  │                         #   <ThemeProvider>.
      │  ├─ TopNav.tsx             # MODIFIED — replace the F37 theme-slot placeholder
      │  │                         #   (:245 <div data-slot="theme" aria-hidden="true" />)
      │  │                         #   with <ThemeToggle />. Add the profile-menu mirror:
      │  │                         #   3 DropdownItems (Sun→light, Monitor→system, Moon→dark)
      │  │                         #   + Check icon on active, inside the F39 DropdownContent.
      │  └─ TopNav.test.tsx        # MODIFIED — wrap renderTopNav() in <ThemeProvider>
      │                            #   (load-bearing); add toggle tests (active, click,
      │                            #   role="group", aria-pressed, keyboard, profile mirror).
      └─ pages/
         └─ LoginPage.tsx          # MODIFIED — mount <ThemeToggle /> (pre-auth, §6).
                                  #   Inside <ThemeProvider> (main.tsx:24 covers all routes).
# NO useTheme/ThemeProvider change (F34). NO Dropdown primitive change (F36).
# NO navbar layout change (F37 — only slot contents). NO profile shell change (F39 —
#   only items added inside). NO index.css (F32 closed), NO index.html (F33 closed),
# NO main.tsx, NO AppLayout (F41). NO schema migration. NO new deps
#   (lucide via F31; Dropdown parts via F36).
```

**Data flow:** `ThemeToggle()` calls `useTheme()` → reads `theme` (which segment is active) and `setTheme`. Clicking a segment (navbar) or a `DropdownItem` (profile menu) calls `setTheme('light' | 'system' | 'dark')`. F34's ThemeProvider (mounted at `main.tsx:24`, wrapping `RouterProvider` → every route including `LoginPage`) applies the side effects: writes localStorage, toggles `.dark` on `<html>`, and (for `'system'`) listens to `matchMedia`. All three mount sites (TopNav segmented control, TopNav profile menu items, LoginPage segmented control) read the same Context → no divergent state. F40 performs zero direct DOM/localStorage/matchMedia access.

---

## 5. Parallelization Strategy

F40 has one prerequisite (the reusable `ThemeToggle` component + its test), then two disjoint integration sites (`TopNav` and `LoginPage`), then a verification gate. T1 is the barrier; T2 and T3 touch disjoint files and can run in parallel; T4 verifies the merged whole.

### Batch dependency diagram

```
   Batch A (primitive)              Batch B (integration)                Batch C (verify)
   ────────────────                 ─────────────────────                ─────────────────
       T1 ─────────────────────────────┬─▶  T2  ─────────────────────────┬─▶  T4
   (ThemeToggle.tsx +                  │  (TopNav.tsx: fill slot +        (verify: 5 files,
    ThemeToggle.test.tsx)              │   profile mirror; TopNav.test:    gate green, single
                                       │   wrap ThemeProvider + tests)     Context, no scope
                                       │                                   leakage, F34 owns
                                       └─▶  T3  ───────────────────────────┘    side effects)
                                          (LoginPage.tsx: add toggle)
```

- **Batch A → Batch B** is a hard barrier: T2 and T3 both `import { ThemeToggle } from '@/components/ThemeToggle'` — the component must exist and be typed before either integration compiles.
- **Batch B (T2 ‖ T3)** — disjoint file sets: T2 touches `TopNav.tsx` + `TopNav.test.tsx`; T3 touches `LoginPage.tsx`. Zero merge conflict. Either order.
- **Batch B → Batch C** is a hard barrier: T4 verifies the merged 5-file diff, re-runs the full gate, confirms the single-Context invariant, confirms F34 owns side effects.

### Merge order rules

1. **Batch A merges first.** T1 (`ThemeToggle.tsx` + `ThemeToggle.test.tsx`) lands the reusable primitive. Must be on `main` before T2/T3 branch.
2. **Batch B merges second (either order).** T2 (`TopNav` slot fill + profile mirror + test-harness provider wrap + toggle tests) and T3 (`LoginPage` toggle) are disjoint — merge independently.
3. **Batch C (integration verification) merges last.** T4 confirms the committed diff is exactly 5 files, re-runs the full gate, confirms a single `useTheme` Context backs all three mount sites, confirms no scope leakage, records proof in §7.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | A | `frontend/src/components/ThemeToggle.tsx` (new), `frontend/src/components/ThemeToggle.test.tsx` (new) | — | — |
| **T2** | B | `frontend/src/components/TopNav.tsx` (Modified — fill slot + profile mirror), `frontend/src/components/TopNav.test.tsx` (Modified — wrap provider + tests) | T1 | T3 |
| **T3** | B | `frontend/src/pages/LoginPage.tsx` (Modified — add toggle) | T1 | T2 |
| **T4** | C | no files changed (verification gate); records proof in §7 | T1, T2, T3 | — |

### Developer assignment tracks

- **Solo:** T1 → (T2 ‖ T3) → T4.
- **2 devs:** Dev-A: T1 → T2. Dev-B: wait on T1, then T3. Then either runs T4.
- **3 devs:** Overkill — Dev-A: T1; Dev-B: T2 (after T1); Dev-C: T3 (after T1); Dev-A or B: T4.

---

## 6. Tasks

### T1 — Create `ThemeToggle.tsx` (reusable 3-way segmented control) + co-located test

**Batch:** A · **Depends on:** None (F34 done) · **Parallel with:** —

**Description:** Build the reusable segmented control that T2 and T3 mount. It calls `useTheme()` (F34), renders a `role="group"` wrapper around three raw `<button>`s (Sun/Monitor/Moon), each with `aria-pressed` reflecting whether it's the active theme, and calls `setTheme` on click. Token-only classes. The co-located test wraps in `<ThemeProvider>` and covers: active-segment indication, click → `setTheme` + `.dark` on `<html>`, `role="group"` + `aria-label="Theme"`, per-button `aria-pressed`, and keyboard activation (Enter/Space). No local `useState` (D3 — single Context source).

**Create** `frontend/src/components/ThemeToggle.tsx`:

```typescript
import { Moon, Monitor, Sun } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/utils/cn';

type ThemeValue = 'light' | 'system' | 'dark';

interface ThemeOption {
    value: ThemeValue;
    label: string;
    Icon: LucideIcon;
}

const THEME_OPTIONS: readonly ThemeOption[] = [
    { value: 'light', label: 'Light', Icon: Sun },
    { value: 'system', label: 'System', Icon: Monitor },
    { value: 'dark', label: 'Dark', Icon: Moon },
] as const;

/**
 * F40 — 3-way theme segmented control (Sun / Monitor / Moon). Wired to F34
 * useTheme: active segment reflects `theme`, click calls `setTheme`. F34 owns
 * .dark + localStorage + matchMedia side effects; this component is a pure
 * consumer (no local state, no direct DOM).
 */
export function ThemeToggle({ className }: { className?: string }) {
    const { theme, setTheme } = useTheme();

    return (
        <div
            role="group"
            aria-label="Theme"
            className={cn(
                'flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5',
                className,
            )}
        >
            {THEME_OPTIONS.map(({ value, label, Icon }) => {
                const isActive = theme === value;
                return (
                    <button
                        key={value}
                        type="button"
                        aria-pressed={isActive}
                        aria-label={label}
                        title={label}
                        onClick={() => setTheme(value)}
                        className={cn(
                            'inline-flex h-7 w-7 items-center justify-center rounded-sm transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            isActive
                                ? 'bg-accent text-accent-foreground'
                                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                        )}
                    >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                    </button>
                );
            })}
        </div>
    );
}
```

> **Key correctness notes for the implementer:**
> - **`useTheme()` only** — read `theme`, call `setTheme`. NO `useState`, NO `document.documentElement`, NO `localStorage`, NO `matchMedia` (all F34). D3.
> - **Raw `<button>`s, not F35 `Button** — `aria-pressed` is the segmented-control semantic; F35 Button has no built-in `aria-pressed`. D2.
> - **`role="group"` + `aria-label="Theme"`** on the wrapper; each button has `aria-pressed={isActive}` + a distinct `aria-label` ("Light"/"System"/"Dark"). Satisfies F40 acceptance "`aria-pressed`/`role="group"` correct." D2.
> - **Active styling** — `bg-accent text-accent-foreground` (active) vs `text-muted-foreground hover:text-foreground hover:bg-accent/50` (inactive). Token-only (no raw colors, no `dark:`). D2.
> - **Table-driven** — `THEME_OPTIONS` const array (js-style-guide SCREAMING_SNAKE_CASE for constants; table-driven preferred per js-testing-rules). Makes adding/removing segments a one-line change.
> - **`cn()` merge** — accept an optional `className` prop so mount sites can adjust sizing/positioning without touching internals.
> - **No `any`**; `LucideIcon` type import for the icon field; explicit `ThemeValue` union. Functions <50 lines. 4-space JSX / 2-space TS. ≤100 cols. Trailing commas. Import order: external (lucide) → internal (`@/hooks`, `@/utils`) → (no relative).
> - **Verify `cn` location** — confirm `@/utils/cn` is the project's classname-merge utility (F31/F32-era); if it lives elsewhere (e.g. `@/lib/utils`), adjust the import. The implementer must grep for the existing `cn` export before finalizing the path.

**Create** `frontend/src/components/ThemeToggle.test.tsx`:

```typescript
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { ThemeToggle } from './ThemeToggle';
import { ThemeProvider } from '@/components/ThemeProvider'; // confirm export path in T1

function renderToggle() {
    return render(
        <ThemeProvider>
            <ThemeToggle />
        </ThemeProvider>,
    );
}

describe('ThemeToggle', () => {
    beforeEach(() => {
        // Reset DOM + storage between tests so `theme` defaults deterministically.
        document.documentElement.classList.remove('dark');
        window.localStorage.removeItem('slykboard-theme'); // confirm key with F34 in T1
    });

    const cases = [
        { value: 'light' as const, label: 'Light' },
        { value: 'system' as const, label: 'System' },
        { value: 'dark' as const, label: 'Dark' },
    ];

    it.each(cases)('renders a $label segment button', ({ label }) => {
        renderToggle();
        expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    });

    it('wraps segments in role="group" labelled "Theme"', () => {
        renderToggle();
        expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
    });

    it.each(cases)(
        'marks the $value segment aria-pressed=true when active (others false)',
        ({ value, label }) => {
            renderToggle();
            fireEvent.click(screen.getByRole('button', { name: label }));

            cases.forEach(({ label: otherLabel, value: otherValue }) => {
                const btn = screen.getByRole('button', { name: otherLabel });
                expect(btn.getAttribute('aria-pressed')).toBe(
                    otherValue === value ? 'true' : 'false',
                );
            });
        },
    );

    it('clicking Dark adds .dark to <html>; clicking Light removes it', () => {
        renderToggle();
        fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
        expect(document.documentElement.classList.contains('dark')).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Light' }));
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('persists the choice to localStorage (F34)', () => {
        renderToggle();
        fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
        // Exact key comes from F34 — confirm in T1; this asserts setTheme wired through.
        expect(window.localStorage.getItem('slykboard-theme')).toBe('dark');
    });

    it.each(['Light', 'System', 'Dark'] as const)(
        'activates via keyboard (Enter) on the %s segment',
        (label) => {
            renderToggle();
            const btn = screen.getByRole('button', { name: label });
            btn.focus();
            expect(document.activeElement).toBe(btn);
            fireEvent.keyDown(btn, { key: 'Enter' });
            // Native button fires click on Enter; assert the segment became active.
            expect(btn.getAttribute('aria-pressed')).toBe('true');
        },
    );
});
```

> **Test notes:**
> - **`<ThemeProvider>` wrap is mandatory** — `ThemeToggle` calls `useTheme()`; rendering without the provider throws. Mirror this in T2's `renderTopNav()`. D6.
> - **Confirm F34 export paths + storage key** in T1: the `ThemeProvider` export location and the localStorage key (`slykboard-theme` here — placeholder) come from F34. Grep `hooks/useTheme.ts` + the provider file before finalizing; adjust the test to match. The assertions are structurally correct; only the string literals may need the real key/export.
> - **js-testing-rules:** `getByRole` priority (`group`, `button`), table-driven (`it.each`), `vi.fn()` not needed here (F34 owns side effects; we assert on `.dark` + localStorage), components >70%.
> - **No mocking of `useTheme`** — exercise the real provider so the `.dark` + localStorage side effects are proven end-to-end (PRD §8: "useTheme persists, toggles .dark, system follows matchMedia").

**Acceptance Criteria:**
- [ ] `ThemeToggle.tsx` created at `frontend/src/components/ThemeToggle.tsx`; exports `ThemeToggle` (named).
- [ ] Calls `useTheme()` (F34); reads `theme`, calls `setTheme`. NO `useState`, NO direct DOM/localStorage/matchMedia.
- [ ] Renders `<div role="group" aria-label="Theme">` wrapping three raw `<button>`s with `Sun`/`Monitor`/`Moon` icons and `aria-label` "Light"/"System"/"Dark".
- [ ] Each button has `aria-pressed={theme === value}`; active = `bg-accent text-accent-foreground`, inactive = `text-muted-foreground hover:text-foreground hover:bg-accent/50`.
- [ ] `THEME_OPTIONS` table-driven const; `cn()` merge; optional `className` prop.
- [ ] No `any`; `LucideIcon` type; explicit interfaces; functions <50 lines; 4-space JSX / 2-space TS; ≤100 cols; trailing commas; token-only classes.
- [ ] `ThemeToggle.test.tsx` created; wraps in `<ThemeProvider>`; covers: 3 segment buttons, `role="group"`, `aria-pressed` per segment, Dark→`.dark` + Light→no-`.dark`, localStorage persistence, keyboard (Enter) activation.
- [ ] `npm run test -w frontend -- ThemeToggle.test.tsx` exits 0.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run build -w frontend` exits 0.

**Dependencies:** F34 (`useTheme`/`ThemeProvider` — done); F31 (`lucide-react` `Sun`/`Monitor`/`Moon`); existing `cn` utility.

---

### T2 — Wire `ThemeToggle` into `TopNav` (fill slot + profile-menu mirror) + fix the test harness

**Batch:** B · **Depends on:** T1 · **Parallel with:** T3

**Description:** Two edits to `TopNav.tsx` and a load-bearing harness fix in `TopNav.test.tsx`. (1) Replace the F37 theme-slot placeholder (`:245` `<div data-slot="theme" aria-hidden="true" />`) with `<ThemeToggle />`. (2) Add the profile-menu mirror (D5): inside the F39 `DropdownContent`, add three `DropdownItem`s (Sun→light, Monitor→system, Moon→dark) with a `Check` icon on the active entry (§3.3). Both call the same `useTheme()` from a single `const { theme, setTheme } = useTheme()` at the top of `TopNav` — no local state. (3) **Load-bearing:** update `renderTopNav()` in `TopNav.test.tsx` to wrap in `<ThemeProvider>` (around the existing `<MemoryRouter>`), or every existing TopNav test throws "must be used within ThemeProvider" once `TopNav` calls `useTheme`. Then add toggle tests: navbar segmented control renders, active segment, click → `setTheme`, `role="group"`, profile-menu mirror items appear + invoke `setTheme`.

**Modify** `frontend/src/components/TopNav.tsx`:

Add imports (alongside the F39 imports):
```typescript
import { Sun, Monitor, Moon, Check } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useTheme } from '@/hooks/useTheme';
```

Call `useTheme` at the top of the component (with the other hooks, e.g. near `:46` `useAuthStore`):
```typescript
    // F40 — single source of truth for theme. Both the navbar segmented control
    // and the profile-menu mirror read this same Context (D3/D5: no local state).
    const { theme, setTheme } = useTheme();
```

Fill the F37 theme slot (replace `:245` `<div data-slot="theme" aria-hidden="true" />`):
```typescript
    // F40 — fill the F37 theme slot with the reusable segmented control.
    <ThemeToggle />
```

Add the profile-menu mirror inside the F39 `DropdownContent` (after the F39 `DropdownSeparator` + before/after the destructive Sign-out item — place a labelled group above Sign out):
```typescript
    {/* F40 (D5) — profile-menu mirror. Same useTheme Context as the navbar
        segmented control (no divergent state). Check icon marks the active theme. */}
    <DropdownLabel>Theme</DropdownLabel>
    <DropdownItem onSelect={() => setTheme('light')}>
        <Sun className="h-4 w-4" aria-hidden="true" />
        <span>Light</span>
        {theme === 'light' && <Check className="ml-auto h-4 w-4" aria-hidden="true" />}
    </DropdownItem>
    <DropdownItem onSelect={() => setTheme('system')}>
        <Monitor className="h-4 w-4" aria-hidden="true" />
        <span>System</span>
        {theme === 'system' && <Check className="ml-auto h-4 w-4" aria-hidden="true" />}
    </DropdownItem>
    <DropdownItem onSelect={() => setTheme('dark')}>
        <Moon className="h-4 w-4" aria-hidden="true" />
        <span>Dark</span>
        {theme === 'dark' && <Check className="ml-auto h-4 w-4" aria-hidden="true" />}
    </DropdownItem>
    <DropdownSeparator />
```

> **Key correctness notes for the implementer:**
> - **Single `useTheme()` call** at the top of `TopNav` — both the navbar `<ThemeToggle />` and the profile-menu items read `theme`/`setTheme` from this one Context. D3/D5. The `<ThemeToggle />` component ALSO calls `useTheme()` internally — that's fine; React Context returns the same value to every consumer in the tree. No local `useState`.
> - **`<ThemeToggle />` replaces the slot placeholder** — the F37 `<div data-slot="theme" aria-hidden="true" />` is gone; `<ThemeToggle />` takes its place in the right cluster (`[theme] → [avatar] → [hamburger]`). No test queried `data-slot="theme"` (verified), so the swap is test-safe.
> - **Profile-menu mirror placement** — inside the existing F39 `DropdownContent`. Add a `DropdownLabel "Theme"`, the three `DropdownItem`s, and a trailing `DropdownSeparator` before the destructive Sign-out item. Uses `default`-variant `DropdownItem`s (not `destructive`). `Check` icon on the active entry per §3.3.
> - **`onSelect={() => setTheme(...)}`** — Radix fires `onSelect` on click + Enter and auto-closes. Calling `setTheme` here is identical to clicking the navbar segment — same Context, same side effects (F34).
> - **F39 `handleSignOut` UNCHANGED** — F40 does NOT touch the sign-out item or `handleSignOut` (§10). Only adds theme items above it.
> - **F37 right-cluster preserved** — only the slot's contents change; the cluster container, the avatar (F39), and the hamburger stay. Mobile D11 panel unaffected (the toggle is in the always-visible right cluster, not the panel).
> - **Token-only classes** — F36 Dropdown primitives carry their own tokens; F40 adds no raw colors / no `dark:`.
> - **No `any`**; functions <50 lines; 4-space JSX / 2-space TS; ≤100 cols; trailing commas; import order.

**Modify** `frontend/src/components/TopNav.test.tsx`:

**Load-bearing** — wrap `renderTopNav()` (`:41-47`) in `<ThemeProvider>`:
```typescript
import { ThemeProvider } from '@/components/ThemeProvider'; // confirm export path

function renderTopNav() {
    return render(
        // F40 — TopNav now calls useTheme via <ThemeToggle />; must be inside
        // <ThemeProvider> or every test throws "must be used within ThemeProvider".
        <ThemeProvider>
            <MemoryRouter>
                <TopNav />
            </MemoryRouter>
        </ThemeProvider>,
    );
}
```

Add toggle tests (after the F39 profile-menu tests):
```typescript
    // --- F40 theme-toggle coverage (navbar segmented control + profile mirror) ----

    it('renders the theme segmented control (role="group" labelled "Theme")', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'System' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Dark' })).toBeInTheDocument();
    });

    it('clicking the Dark segment adds .dark to <html>', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
        expect(document.documentElement.classList.contains('dark')).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Light' }));
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('profile-menu mirror: Theme items appear and invoke setTheme', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        fireEvent.pointerDown(screen.getByRole('button', { name: 'Account menu' }), {
            button: 0,
        });

        // Three theme menuitems appear (D5 mirror).
        fireEvent.click(screen.getByRole('menuitem', { name: /Dark/ }));
        expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('profile-menu mirror marks the active theme with a Check', () => {
        useAuthStore.getState().setUser(fullUser);
        renderTopNav();

        // Set dark via the navbar segment, open the menu, assert the Dark item is checked.
        fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Account menu' }), {
            button: 0,
        });

        const darkItem = screen.getByRole('menuitem', { name: /Dark/ });
        expect(darkItem.querySelector('[aria-hidden="true"]')).toBeInTheDocument(); // Check icon
    });
```

> **Test notes:**
> - **The `<ThemeProvider>` wrap is the load-bearing fix** — without it, the entire existing TopNav suite throws on the first `useTheme()` call. This is the single highest-risk break in F40. D6.
> - **Confirm the `ThemeProvider` export path** with F34 (grep the provider file) before finalizing the import. The wrap structure is correct regardless of the exact path.
> - **No mocking of `useTheme`** — exercise the real provider so `.dark` toggling is proven end-to-end (PRD §8). Reset `document.documentElement.classList` + localStorage in a `beforeEach` if cross-test state leaks (the F39 tests don't touch theme, so they're unaffected).
> - **Profile-menu mirror tests** use the same Radix `pointerDown`-open pattern as F39 (`fireEvent.pointerDown(trigger, { button: 0 })`), then `click` the `menuitem`.
> - The F39-era tests (avatar, sign-out, brand, clusters) remain valid — the provider wrap only adds context, it doesn't change their DOM assertions.

**Acceptance Criteria:**
- [ ] `TopNav.tsx` imports `Sun`, `Monitor`, `Moon`, `Check` from `lucide-react`; `ThemeToggle` from `@/components/ThemeToggle`; `useTheme` from `@/hooks/useTheme`.
- [ ] Single `const { theme, setTheme } = useTheme()` at the top of `TopNav`; no local `useState` for theme.
- [ ] F37 theme-slot placeholder (`:245`) replaced with `<ThemeToggle />`.
- [ ] Profile-menu mirror added inside the F39 `DropdownContent`: `DropdownLabel "Theme"` + three `DropdownItem`s (Sun→light, Monitor→system, Moon→dark) with `Check` on the active entry, trailing `DropdownSeparator`.
- [ ] `handleSignOut` (F39) UNCHANGED; F37 right-cluster container + hamburger UNCHANGED.
- [ ] No `any`; functions <50 lines; 4-space JSX / 2-space TS; ≤100 cols; token-only classes.
- [ ] `renderTopNav()` in `TopNav.test.tsx` wraps in `<ThemeProvider>` (around `<MemoryRouter>`).
- [ ] New tests: `role="group"` + 3 segment buttons; Dark→`.dark` + Light→no-`.dark`; profile mirror items appear + invoke `setTheme`; profile mirror `Check` on active.
- [ ] All existing F37/F39 TopNav tests still pass (the provider wrap doesn't break them).
- [ ] `npm run test -w frontend -- TopNav.test.tsx` exits 0.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run build -w frontend` exits 0.

**Dependencies:** T1; F37 (slot — done); F39 (profile Dropdown — done); F34 (`useTheme`/`ThemeProvider` — done).

---

### T3 — Mount `<ThemeToggle />` on `LoginPage` (pre-auth, §6)

**Batch:** B · **Depends on:** T1 · **Parallel with:** T2

**Description:** Satisfies the F40 acceptance "available pre-auth on `LoginPage` (§6)." `LoginPage` is a standalone route (`routes/index.tsx:41-43`) with no `AppLayout`/`TopNav`, but it is inside `<ThemeProvider>` (`main.tsx:24` wraps `RouterProvider` → all routes), so `useTheme()` works there. Mount `<ThemeToggle />` in the login page chrome (e.g. top-right corner). The same component, same Context — no second provider, no duplicate primitive. Disjoint from T2's `TopNav` files → parallel-safe.

**Modify** `frontend/src/pages/LoginPage.tsx` (confirm exact path in T3):

```typescript
import { ThemeToggle } from '@/components/ThemeToggle';
```

Mount the toggle in the page chrome — e.g. a fixed/absolute top-right anchor outside the login card:
```typescript
    {/* F40 (D4) — pre-auth theme control. LoginPage is inside <ThemeProvider>
        (main.tsx:24 wraps RouterProvider) so useTheme works here even though
        there's no TopNav. Same component as the navbar; same Context. */}
    <div className="fixed right-4 top-4 z-50">
        <ThemeToggle />
    </div>
```

> **Key correctness notes for the implementer:**
> - **Confirm `LoginPage` location + structure** — grep for the `LoginPage` component (likely `frontend/src/pages/LoginPage.tsx` or `frontend/src/routes/...`). Place the toggle so it doesn't overlap the login card on small screens (test responsive). A `fixed`/`absolute` corner is the lightest touch; if the page already has a header chrome, mount it there instead.
> - **No second provider** — `main.tsx:24` already covers `LoginPage`. Adding a second `<ThemeProvider>` would reset the Context and diverge from the navbar instance. D4.
> - **`z-50`** keeps the toggle above the login card; `right-4 top-4` mirrors the navbar's far-right placement (§4.2). Adjust to the page's existing layout tokens.
> - **No `any`**; token-only classes; functions <50 lines; 4-space JSX / 2-space TS.
> - **Test** (optional but recommended): a `LoginPage.test.tsx` case asserting the toggle renders (`getByRole('group', { name: 'Theme' })`) — only if a LoginPage test file already exists; do NOT create a new test file just for this (T4 covers integration). If a test exists, it must already wrap in `<ThemeProvider>` (since `LoginPage` is inside the provider in `main.tsx`, the test harness should mirror that — verify and fix if missing, same load-bearing pattern as T2).

**Acceptance Criteria:**
- [ ] `LoginPage.tsx` imports `ThemeToggle` from `@/components/ThemeToggle`; mounts `<ThemeToggle />` in the page chrome (top-right corner or existing header).
- [ ] No second `<ThemeProvider>` (reuse the `main.tsx:24` provider scope).
- [ ] Toggle is visible and usable pre-auth (not hidden behind the login card; `z-50` or equivalent).
- [ ] No `any`; token-only classes; functions <50 lines; 4-space JSX / 2-space TS; ≤100 cols.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run build -w frontend` exits 0.
- [ ] (If `LoginPage.test.tsx` exists) the test harness wraps in `<ThemeProvider>` and the toggle renders.

**Dependencies:** T1; F34 (`ThemeProvider` scope at `main.tsx:24` — done).

---

### T4 — Integration verification & sign-off

**Batch:** C (terminal) · **Depends on:** T1, T2, T3 · **Parallel with:** —

**Description:** The final definition-of-done gate. Confirm the committed diff is exactly the 5 F40 files, re-run the full gate green, confirm a single `useTheme` Context backs all three mount sites (navbar segmented control + profile menu + LoginPage), confirm F34 owns all side effects (no direct DOM/localStorage/matchMedia in F40 code), confirm `handleSignOut` (F39) + the F37 right-cluster are untouched, confirm no scope leakage, and record proof in §7.

Steps:
1. Confirm the branch's committed diff is **exactly** the 5 F40 files:
   ```bash
   git diff --name-only main...HEAD | sort
   # Expected (exactly 5):
   # frontend/src/components/ThemeToggle.test.tsx
   # frontend/src/components/ThemeToggle.tsx
   # frontend/src/components/TopNav.test.tsx
   # frontend/src/components/TopNav.tsx
   # frontend/src/pages/LoginPage.tsx
   ```
   Any other path (a `useTheme.ts`/`ThemeProvider.tsx` edit, an `index.css` edit, a `main.tsx`/`AppLayout.tsx` edit, a `Dropdown.tsx`/`Button.tsx` edit, a schema migration, a lucide/Radix install) → leaked; remove and re-commit.
2. Re-run the full gate on the merged state:
   ```bash
   npm install
   npm run build -w frontend              # exit 0
   npm run typecheck -w frontend          # exit 0
   npm run test -w frontend               # exit 0 (ThemeToggle + TopNav + LoginPage + F39 regression)
   ```
3. Confirm scope-boundary files are **unchanged** vs main:
   ```bash
   for f in frontend/src/hooks/useTheme.ts frontend/src/components/ThemeProvider.tsx \
            frontend/src/components/ui/Dropdown.tsx frontend/src/components/ui/Button.tsx \
            frontend/src/index.css frontend/index.html frontend/src/main.tsx \
            frontend/src/components/AppLayout.tsx frontend/package.json; do
     git diff --quiet main...HEAD -- "$f" \
       && echo "$f: UNCHANGED" \
       || echo "$f: CHANGED (out of scope — revert)"
   done
   ```
   All must print UNCHANGED. (`useTheme.ts`/`ThemeProvider.tsx` — F34; `Dropdown.tsx` — F36; `Button.tsx` — F35; `index.css` — F32 closed; `index.html` — F33 closed; `main.tsx` — F40 doesn't mount providers; `AppLayout.tsx` — F41; `package.json` — lucide via F31, Dropdown via F36, no new deps.) Adjust the `ThemeProvider.tsx` path to the real F34 location.
4. Confirm F40 code has **no direct side effects** (F34 owns them):
   ```bash
   grep -REn 'document\.documentElement|classList\.(add|remove|toggle)|localStorage|matchMedia' \
     frontend/src/components/ThemeToggle.tsx frontend/src/components/TopNav.tsx \
     frontend/src/pages/LoginPage.tsx \
     && echo "BUG: F40 touches DOM/storage/matchMedia directly (F34 owns these)" \
     || echo "F40 pure consumer (F34 owns side effects): OK"
   ```
   Must print OK.
5. Confirm a **single `useTheme` Context** — no local `useState(theme)` in F40 code:
   ```bash
   grep -REn 'useState.*theme|const \[theme' frontend/src/components/ThemeToggle.tsx \
     frontend/src/components/TopNav.tsx frontend/src/pages/LoginPage.tsx \
     && echo "BUG: local theme state found (would diverge from Context)" \
     || echo "single useTheme Context, no local state: OK"
   ```
   Must print OK.
6. Confirm the F40 wiring is present:
   ```bash
   # ThemeToggle.tsx
   grep -n "import { Moon, Monitor, Sun } from 'lucide-react'" frontend/src/components/ThemeToggle.tsx
   grep -n "import { useTheme } from '@/hooks/useTheme'" frontend/src/components/ThemeToggle.tsx
   grep -n 'role="group"' frontend/src/components/ThemeToggle.tsx
   grep -n 'aria-pressed' frontend/src/components/ThemeToggle.tsx
   # TopNav.tsx
   grep -n "import { ThemeToggle } from '@/components/ThemeToggle'" frontend/src/components/TopNav.tsx
   grep -n "<ThemeToggle />" frontend/src/components/TopNav.tsx
   grep -n "DropdownLabel>Theme" frontend/src/components/TopNav.tsx  # adjust to JSX
   grep -nE "onSelect=\{\(\) => setTheme\('(light|system|dark)'\)\}" frontend/src/components/TopNav.tsx
   # LoginPage.tsx
   grep -n "import { ThemeToggle } from '@/components/ThemeToggle'" frontend/src/pages/LoginPage.tsx
   grep -n "<ThemeToggle />" frontend/src/pages/LoginPage.tsx
   ```
   All must match.
7. Confirm the F37 slot placeholder is GONE and `<ThemeToggle />` took its place:
   ```bash
   grep -n 'data-slot="theme"' frontend/src/components/TopNav.tsx \
     && echo "BUG: F37 slot placeholder still present" \
     || echo "F37 slot filled by <ThemeToggle />: OK"
   ```
8. Confirm the **load-bearing test-harness wrap** landed:
   ```bash
   grep -n "<ThemeProvider>" frontend/src/components/TopNav.test.tsx
   grep -n "getByRole('group', { name: 'Theme' })" frontend/src/components/TopNav.test.tsx
   ```
   Both must match.
9. Confirm `handleSignOut` (F39) + the F37 right-cluster are **unchanged**:
   ```bash
   git diff main...HEAD -- frontend/src/components/TopNav.tsx | grep -E '^[-+].*(await logout|clear\(\)|broadcastLogout|navigate\(.\/login)'
   # No -/+ lines touching handleSignOut body.
   grep -n 'aria-label="Toggle navigation"' frontend/src/components/TopNav.tsx  # hamburger stays
   ```
10. Confirm token-only classes (no raw colors, no `dark:` color classes) in F40-added code:
    ```bash
    grep -REn 'bg-(slate|blue|red|amber|orange|green|gray)-[0-9]' \
      frontend/src/components/ThemeToggle.tsx frontend/src/components/TopNav.tsx \
      frontend/src/pages/LoginPage.tsx \
      && echo "RAW COLOR FOUND (BUG)" || echo "token-only: OK"
    grep -REn 'dark:(bg|text|border)-' frontend/src/components/ThemeToggle.tsx \
      frontend/src/components/TopNav.tsx frontend/src/pages/LoginPage.tsx \
      && echo "dark: color class FOUND (BUG)" || echo "no dark: color classes: OK"
    ```
    Both must print OK.
11. Manual smoke (optional): run `npm run dev -w frontend`, open `LoginPage` → toggle Dark → confirm `.dark` on `<html>` + persistence on reload; log in → confirm the navbar segmented control reflects the same theme; open the profile menu → confirm the mirror items + `Check` on active. Record screenshots/observations in §7.
12. Capture commit SHA, exit codes, test counts into §7. Confirm D4 (LoginPage toggle) + D5 (profile mirror) owner sign-offs — surface defaults before merge.

**Acceptance Criteria:**
- [ ] Committed diff is exactly 5 files: `ThemeToggle.tsx`, `ThemeToggle.test.tsx`, `TopNav.tsx`, `TopNav.test.tsx`, `LoginPage.tsx` — no useTheme/ThemeProvider/Dropdown/Button/index.css/index.html/main.tsx/AppLayout/package.json/migration leakage.
- [ ] `npm run build -w frontend` exits 0 on the merged state.
- [ ] `npm run typecheck -w frontend` exits 0 on the merged state.
- [ ] `npm run test -w frontend` exits 0 on the merged state (incl. `ThemeToggle.test.tsx` + `TopNav.test.tsx` + F39 regression).
- [ ] F40 code is a pure consumer: no direct `document.documentElement`/`classList`/`localStorage`/`matchMedia` access (F34 owns side effects).
- [ ] Single `useTheme` Context; no local `useState(theme)` anywhere in F40.
- [ ] F37 slot placeholder gone; `<ThemeToggle />` in its place; `<ThemeToggle />` on `LoginPage`.
- [ ] Profile-menu mirror present: `DropdownLabel "Theme"` + 3 `DropdownItem`s + `Check` on active.
- [ ] Load-bearing test-harness wrap: `TopNav.test.tsx` wraps `<ThemeProvider>`.
- [ ] `handleSignOut` (F39) body unchanged; F37 hamburger unchanged.
- [ ] Token-only classes (no raw colors, no `dark:`).
- [ ] All F40 §1 acceptance bullets satisfied; SHAs + results recorded in §7.
- [ ] D4/D5 owner sign-offs recorded.

**Dependencies:** T1, T2, T3.

---

## 7. Final F40 Acceptance Checklist

- [ ] **Segmented control** renders `Sun`/`Monitor`/`Moon` with the active segment indicated (`bg-accent text-accent-foreground`).
- [ ] **Click → `setTheme`**; `.dark` on `<html>` updates immediately; preference persists (F34 localStorage).
- [ ] **Keyboard-reachable** (native `<button>`s); `aria-pressed` on each segment; `role="group"` + `aria-label="Theme"` on the wrapper.
- [ ] **Pre-auth** — `<ThemeToggle />` mounted on `LoginPage` (D4); inside the `main.tsx:24` `<ThemeProvider>` scope.
- [ ] **Profile-menu mirror** (D5) — 3 `DropdownItem`s + `Check` on active; both navbar + menu read the same `useTheme` Context (single source).
- [ ] **D1 extracted component** — `ThemeToggle.tsx` reusable across TopNav + LoginPage; co-located `ThemeToggle.test.tsx`.
- [ ] **D2 raw buttons + a11y** — `role="group"` + per-button `aria-pressed`; raw `<button>`s with `cn()` (not F35 Button).
- [ ] **D3 pure consumer** — F40 calls only `setTheme`/reads `theme`; F34 owns `.dark`/localStorage/matchMedia.
- [ ] **D6 load-bearing harness** — `TopNav.test.tsx` `renderTopNav()` wraps `<ThemeProvider>`.
- [ ] F37 right-cluster preserved (slot contents swapped; container + hamburger unchanged); F39 `handleSignOut` + profile shell unchanged (only items added).
- [ ] No `any`; explicit interfaces; functions <50 lines; 4-space JSX / 2-space TS; ≤100 cols; trailing commas; import order; token-only classes.
- [ ] `useTheme.ts`/`ThemeProvider.tsx`, `Dropdown.tsx`, `Button.tsx`, `index.css`, `index.html`, `main.tsx`, `AppLayout.tsx`, `package.json` unchanged.
- [ ] No new deps (lucide `Sun`/`Monitor`/`Moon`/`Check` via F31; Dropdown parts via F36).
- [ ] `npm run build -w frontend` exits 0.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend` exits 0 (incl. `ThemeToggle.test.tsx` + `TopNav.test.tsx` + F39 regression).
- [ ] Committed diff is exactly 5 files.
- [ ] Commit message single-line `SLYK-F40: <message>`; branch `feature/SLYK-redesign-f40-theme-toggle-ui`; rebase-and-merge only.

**Integration record (fill during T4):**
- Feature commit SHA: `________`
- Diff = exactly 5 files (`ThemeToggle.tsx` new, `ThemeToggle.test.tsx` new, `TopNav.tsx` modified, `TopNav.test.tsx` modified, `LoginPage.tsx` modified); no useTheme/ThemeProvider/Dropdown/Button/index.css/index.html/main.tsx/AppLayout/package.json/migration leakage: `PASS/FAIL`
- `ThemeToggle.tsx` calls `useTheme()`; no `useState`/direct DOM/localStorage/matchMedia (F34 owns side effects): `PASS/FAIL`
- `role="group" aria-label="Theme"` + 3 `<button aria-pressed>` (Sun/Monitor/Moon): `PASS/FAIL`
- Active = `bg-accent text-accent-foreground`; inactive = `text-muted-foreground hover:text-foreground`: `PASS/FAIL`
- F37 slot (`:245`) placeholder replaced by `<ThemeToggle />`: `PASS/FAIL`
- Profile-menu mirror: `DropdownLabel "Theme"` + 3 `DropdownItem`s + `Check` on active: `PASS/FAIL`
- Single `useTheme` Context in `TopNav`; navbar + menu share it: `PASS/FAIL`
- `<ThemeToggle />` mounted on `LoginPage` (pre-auth, §6); no second provider: `PASS/FAIL`
- `TopNav.test.tsx` `renderTopNav()` wraps `<ThemeProvider>` (load-bearing): `PASS/FAIL`
- `handleSignOut` (F39) body unchanged; F37 hamburger unchanged: `PASS/FAIL`
- `ThemeToggle.test.tsx` result: `__/__ pass` (3 segments, role=group, aria-pressed ×3, Dark→`.dark`/Light→no-`.dark`, localStorage, keyboard)
- `TopNav.test.tsx` result: `__/__ pass` (F37 + F39 tests + new F40 toggle/mirror tests)
- F39 `TopNav` regression (avatar/sign-out/menu): `PASS/FAIL`
- No raw colors / no `dark:` color classes in F40-added code: `token-only: OK`
- `useTheme.ts` vs main: `UNCHANGED (F34 preserved)`
- `ThemeProvider.tsx` vs main: `UNCHANGED (F34 preserved)`
- `Dropdown.tsx` vs main: `UNCHANGED (F36 preserved)`
- `Button.tsx` vs main: `UNCHANGED (F35 preserved)`
- `index.css` vs main: `UNCHANGED (F32 preserved)`
- `index.html` vs main: `UNCHANGED (F33 preserved)`
- `main.tsx` vs main: `UNCHANGED`
- `AppLayout.tsx` vs main: `UNCHANGED (F41 preserved)`
- `package.json` vs main: `UNCHANGED (lucide via F31, Dropdown via F36 — no new deps)`
- New deps added by F40: `0`
- Build / typecheck / test exit codes: `0 / 0 / 0`
- Manual smoke (LoginPage Dark → `.dark` + persist; navbar reflects same; profile mirror + Check): `PASS/FAIL/skipped`
- D4 owner sign-off (LoginPage toggle vs separate minimal toggle): `recorded (date: ________)`
- D5 owner sign-off (include profile mirror vs omit): `recorded (date: ________)`

---

## 8. Schema deltas owned by this feature

F40 owns **no schema deltas.** There is **no DB migration** (the redesign's standing no-migration stance), **no CSS token additions** (F32 owns and has closed those — `index.css` is frozen), **no `index.html` change** (F33 owns the no-flash bootstrap), **no `main.tsx` change** (F40 doesn't mount providers — F34's `<ThemeProvider>` at `main.tsx:24` already covers all routes), **no `AppLayout.tsx` change** (F41 owns `<HealthBadge />`), **no `useTheme.ts`/`ThemeProvider.tsx` change** (F34 owns the hook/provider — frozen), and **no primitive changes** (`Dropdown.tsx` is F36; `Button.tsx` is F35 — both frozen; F40 uses raw `<button>`s anyway). F40 adds **no new dependencies** (lucide `Sun`/`Monitor`/`Moon`/`Check` via F31; `Dropdown` parts via F36). F40 creates `ThemeToggle.tsx` + `ThemeToggle.test.tsx` (new component + test) and modifies `TopNav.tsx` (slot fill + profile mirror), `TopNav.test.tsx` (provider wrap + tests), and `LoginPage.tsx` (toggle mount) — a component + its test + three integration edits, no schema surface.

| Delta | Detail | Mechanism |
| --- | --- | --- |
| No DB migration | None | — (redesign no-migration stance) |
| No CSS token deltas | None — F32 owns all tokens and is closed | `frontend/src/index.css` unchanged |
| No `index.html` change | None — F33 owns the no-flash bootstrap and is closed | `frontend/index.html` unchanged |
| No `main.tsx` change | None — F34's `<ThemeProvider>` at `main.tsx:24` already wraps all routes (incl. LoginPage) | `frontend/src/main.tsx` unchanged |
| No `AppLayout.tsx` change | None — F41 owns `<HealthBadge />` | `frontend/src/components/AppLayout.tsx` unchanged |
| No `useTheme.ts` / `ThemeProvider.tsx` change | None — F34 owns the hook/provider (frozen); F40 is a pure consumer | `frontend/src/hooks/useTheme.ts` + provider file unchanged |
| No `Dropdown.tsx` / `Button.tsx` change | None — F36/F35 own the primitives (frozen); F40 uses raw `<button>`s + existing Dropdown exports | `frontend/src/components/ui/Dropdown.tsx`, `Button.tsx` unchanged |
| No new dependencies | lucide `Sun`/`Monitor`/`Moon`/`Check` via F31; `Dropdown` parts via F36 | `frontend/package.json` unchanged |
| New `ThemeToggle` component + test | `ThemeToggle.tsx` — reusable 3-way segmented control (`role="group"` + 3 `aria-pressed` `<button>`s with Sun/Monitor/Moon; `useTheme` → active + `setTheme`; token-only). `ThemeToggle.test.tsx` — co-located, wrapped in `<ThemeProvider>`. | `frontend/src/components/ThemeToggle.tsx` + `ThemeToggle.test.tsx` created |
| TopNav slot fill + profile-menu mirror | F37 theme-slot placeholder (`:245`) replaced by `<ThemeToggle />`; profile-menu mirror added inside the F39 `DropdownContent` (`DropdownLabel "Theme"` + 3 `DropdownItem`s with `Check` on active). Single `useTheme()` at top of `TopNav`. | `frontend/src/components/TopNav.tsx` modified |
| TopNav test-harness provider wrap + toggle tests | `renderTopNav()` wraps `<ThemeProvider>` (load-bearing — every test throws otherwise); + tests for `role="group"`, segments, click→`.dark`, profile mirror. | `frontend/src/components/TopNav.test.tsx` modified |
| LoginPage pre-auth toggle | `<ThemeToggle />` mounted in `LoginPage` chrome (inside the `main.tsx:24` provider scope); no second provider. | `frontend/src/pages/LoginPage.tsx` modified |
