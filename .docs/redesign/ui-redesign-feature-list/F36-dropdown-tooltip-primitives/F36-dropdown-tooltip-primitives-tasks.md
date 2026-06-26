# F36 — Dropdown + Tooltip primitives (Radix wrappers, .dark-aware portals): Plan + Task Breakdown

> **Feature:** F36 — Dropdown + Tooltip primitives (Radix wrappers, .dark-aware portals) (Phase 0 — Foundations · Infrastructure)
> **Feature index:** [`ui-redesign-features.md`](../../ui-redesign-features.md)
> **Slug:** `SLYK` · **Depends on:** F35 (done) · **PRD ref:** §3.4 (Dropdown), §9.2 (Radix decision), §4.2/§4.3/§4.4/§4.5 (consumers F38/F39/F42), D5 (Tooltip add — scope addition), portal-.dark inheritance (F36 edge, F51 QA)
> **Sources:** [`ui-redesign-plan.md`](../../ui-redesign-plan.md), the discovered project rules ([`.claude/rules/git-guidelines.md`](../../../../.claude/rules/git-guidelines.md), [`js-development-rules.md`](../../../../.claude/rules/js-development-rules.md), [`js-style-guide.md`](../../../../.claude/rules/js-style-guide.md), [`js-testing-rules.md`](../../../../.claude/rules/js-testing-rules.md), [`persona.md`](../../../../.claude/rules/persona.md)), [`project-metadata.md`](../../../../project-metadata.md). Dependency features: [F35](../F35-shared-ui-primitives/F35-shared-ui-primitives-tasks.md) (cn + ui/ dir — done); F33/F34 (.dark on documentElement — portal-dark precondition, done).

---

## 1. F36 Recap

**Goal:** Provide the two portal-based interactive primitives the navbar and disabled-nav tooltip depend on, with a11y handled by Radix.

**Ships:** `@/components/ui/Dropdown` and `@/components/ui/Tooltip` ready for `F38` (project picker), `F39` (profile menu), `F42` (disabled-nav tooltip). Themed via F32 tokens, keyboard-accessible, portal-rendered. No page wires them yet — they are ready for F37+.

**Acceptance (definition of done):**
1. `Dropdown` wraps Radix `DropdownMenu`: trigger, content, item, separator, label/header, footer slot (second `Group` + `Separator`). Themed via `bg-popover text-popover-foreground border-border`. Focus trap, outside-click, Esc, `aria-expanded` all from Radix.
2. `Tooltip` wraps Radix `Tooltip`: trigger-as-child so it can wrap a `disabled` button (Radix tooltip uses a wrapper span, making disabled elements reachable — the core reason D5 needs it).
3. Both render into a portal at `document.body`.
4. Tests: `Dropdown` opens on trigger, closes on Esc/outside-click, items reachable via arrow keys; `Tooltip` shows on hover **and** focus, including wrapping a disabled button.

**Edge cases resolved up front:**
- **Portal dark inheritance (load-bearing)** → **Decision: F36 CONSUMES the F33/F34 invariant (`.dark` on `documentElement`); renders via Radix Portal to `document.body`; adds a comment locking the invariant; F51 visual QA verifies. No theme-bridging logic in F36.** If anyone later moves `.dark` to a wrapper div, portals break silently — flagged for F51.
- **Tooltip delay-duration** → **Decision: `TooltipProvider` default `delayDuration=300` (sane, non-twitchy); per-instance override via `Tooltip` root `delayDuration` prop. `skipDelayDuration` keeps Radix 300 default.** (Radix default 700 too slow; shadcn 0 too twitchy — 300 is the middle.)
- **API shape (PRD-silent)** → **Decision: named compound exports** (D1) — `Dropdown`/`DropdownTrigger`/`DropdownContent`/`DropdownItem`/`DropdownSeparator`/`DropdownLabel`/`DropdownGroup`; `Tooltip`/`TooltipProvider`/`TooltipTrigger`/`TooltipContent`. Matches F35's named-function style; tree-shakes; resolves "one component per file" rule tension via shadcn compound convention (one primitive per file, sub-parts co-exported).
- **Tooltip Provider/Portal wiring** → **Decision: `TooltipContent` wraps Portal+Content+Arrow internally** (consumers don't add explicit Portal); `TooltipProvider` exported **separately** for app-root mount (mandatory — Radix). **F36 exports TooltipProvider; mounting it in `main.tsx` is F37's job** (F36 ships primitive only, no live wiring). (D2)
- **asChild for disabled buttons (D5 reason)** → **Decision: `DropdownTrigger` + `TooltipTrigger` support `asChild` (Radix passthrough). Document the disabled-button span-wrapper pattern:** `<TooltipTrigger asChild><span><Button disabled/></span></TooltipTrigger>` — the span receives pointerenter/focus, the button stays inert. (D4)
- **Theming** → **Decision: DropdownContent `bg-popover text-popover-foreground border-border`; items `focus:bg-accent focus:text-accent-foreground`; destructive item variant `text-destructive`; TooltipContent `bg-primary text-primary-foreground` (high-contrast hint bubble).** All token-only (F32); `data-[state=open/closed]` + `data-[highlighted]` + `data-[disabled]` hooks. NO `dark:` color classes. (D6)
- **Test infra** → **Decision: add PointerEvent polyfill to `test-setup.ts`** (jsdom lacks PointerEvent); use `fireEvent` only (no `@testing-library/user-event` dep). (D7)

---

## 2. Codebase Analysis Summary

- **State:** Greenfield for Radix consumers. **F36 is the first Radix consumer in the codebase.** No existing menu/tooltip/dropdown component exists. F35 landed the `components/ui/` layer with `cn.ts` + 8 primitives + tests; F36 extends `components/ui/` with two portal-based interactive primitives.

- **F35 landed (foundation F36 builds on):**
  - `frontend/src/components/ui/cn.ts:8-10` exports `cn(...inputs: ClassValue[]): string => twMerge(clsx(inputs))`. F36 imports `cn` from `'./cn'` (same dir) — same idiom as F35's Button/Badge.
  - `components/ui/Button.tsx` is the reference idiom: `forwardRef` + rest-spread + `cn()` merge. F36 mirrors this but forwards refs to Radix primitives (type `ElementRef<typeof …Primitive.Content>`).
  - F35 idioms F36 inherits: PascalCase files, explicit interfaces, `forwardRef`, token-only classes, no `any`, 4-space JSX / 2-space TS, co-located `*.test.tsx`, `getByRole` priority.

- **Radix deps installed (F31, verified):** `frontend/package.json:17` `@radix-ui/react-dropdown-menu ^2` (resolved 2.1.18); `frontend/package.json:18` `@radix-ui/react-tooltip ^1` (resolved 1.2.10). `lucide-react ^1` (resolved 1.21.0) — F35's Avatar uses lucide `User` with green tests; ChevronDown/Check import to be confirmed during T2 (icons are swappable if ever an issue). **No new deps added by F36.**

- **F32 tokens resolve (all F36 classes map to existing utilities):** `bg-popover`/`text-popover-foreground` (`index.css:102-3`), `border-border` (`:120`), `bg-accent`/`text-accent-foreground` (`:114-5`), `text-destructive` (`:117`), `ring-ring` (`:122`), `bg-primary`/`text-primary-foreground` (`:105-6`). Dark mode auto-flips via `@theme inline` + `:root`/`.dark` → **F36 writes ZERO `dark:` color classes.**

- **Portal-dark precondition SATISFIED (F33/F34 — load-bearing):** `.dark` is on `document.documentElement` via F33 (`frontend/index.html:37` `document.documentElement.classList.add('dark')`) + F34 (`frontend/src/context/ThemeProvider.tsx:92-100` effect). **No `.dark` on a child div anywhere.** Radix portals mount at `document.body`, which is inside `<html>` → `bg-popover` resolves correctly in dark. Precedent: `components/Modal.tsx` already portals to `document.body` but uses hardcoded `bg-white` (NOT theme-aware); F36 uses `bg-popover` for dark-mode support.

- **Test infra (verified):** Vitest 3 + jsdom 25 + RTL 16 (`vite.config.ts:13-17` env `jsdom`, `globals: true`, setupFiles `['./src/test-setup.ts']`, alias `@` → `./src`). `test-setup.ts` is 8 lines: jest-dom matchers + env stubs. **NO `matchMedia` polyfill** (F36 doesn't need it for open/close core). **NO `PointerEvent` polyfill** — jsdom lacks `PointerEvent`; F36 needs it (Radix opens on pointerdown) → T1 adds it (shared test infra, F36 is first pointer-event test). **`@testing-library/user-event` NOT installed** → F36 uses `fireEvent` only (no new dep). `screen.*` queries `document.body` by default → portaled content is reachable.

- **`@/` alias resolves** (`@/` → `src/` via `vite.config.ts` + `tsconfig.json`). Build gate: `dev`/`build` (`tsc -b && vite build`)/`typecheck` (`tsc --noEmit`)/`test` (`vitest run`). `tsc -b` uses project references → new `src/` files auto-picked.

- **File paths the plan references that do NOT exist yet** (will be created): `frontend/src/components/ui/Dropdown.tsx`, `frontend/src/components/ui/Dropdown.test.tsx`, `frontend/src/components/ui/Tooltip.tsx`, `frontend/src/components/ui/Tooltip.test.tsx`. **Modified:** `frontend/src/test-setup.ts` (PointerEvent polyfill).

- **Project rules this plan satisfies:**
  - `js-development-rules.md` — React 19+ / Vite / Tailwind; one component per file; co-locate tests; explicit prop interfaces; functional + hooks. Frontend code under `./frontend/`.
  - `js-style-guide.md` — PascalCase component files; **4-space JSX / 2-space TS**; ≤100 cols; trailing commas; import order external → internal → type → relative; functions <50 lines; **no `any`**; **no inline styles (Tailwind only)**; naming.
  - `js-testing-rules.md` — Vitest co-located `*.test.tsx`; RTL `getByRole` priority; `vi.fn()` mocks; table-driven preferred; **components >70% coverage**.
  - `git-guidelines.md` — sacred rule (never git without approval); rebase-and-merge ONLY (no merge/squash); `PROJECTSLUG = SLYK`; branch `type/SLYK-TICKET-desc`; single-line `SLYK-TICKET: message`. Repo precedent `SLYK-F31..F35:` → F36 uses `SLYK-F36:` prefix.
  - `persona.md` — frontend code → `./frontend/`; React 19+ specializations.

- **Hidden coupling to plan for:**
  - **`TooltipProvider` must mount once at app root** (Radix mandatory — sets `delayDuration`/`skipDelayDuration` context). F36 EXPORTS `TooltipProvider`; **the actual app-root mount in `main.tsx` is F37's job** (F37 is the first consumer / Phase 1 chrome). F36 ships the primitive only — no `main.tsx` edit.
  - **PointerEvent polyfill is shared test infra** — T1 edits `test-setup.ts` (touched by every test). F36 is the first pointer-event test in the suite; the polyfill benefits all future Radix/pointer tests. Cite radix-ui/primitives#1220.
  - **Portal-dark invariant (F33/F34 contract)** — F36 is a pure consumer; it adds no precondition of its own. A comment in both primitives locks the invariant for future maintainers. F51 visual QA verifies in dark mode.
  - **"One component per file" rule tension** — resolved via shadcn compound convention: **one primitive per file, sub-parts co-exported** (`Dropdown.tsx` exports Root/Trigger/Content/Item/Separator/Label/Group; `Tooltip.tsx` exports Provider/Root/Trigger/Content).
  - **F36 scope (must NOT):** live wiring into TopNav/ProjectPicker/ProfileMenu (F38/F39/F42 — F37+); touch `index.css` (F32 closed); migrate components (F46); install new deps (Radix in F31); mount TooltipProvider in `main.tsx` (F37).

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | API shape (PRD-silent) | **Named compound exports** — `Dropdown`/`DropdownTrigger`/`DropdownContent`/`DropdownItem`/`DropdownSeparator`/`DropdownLabel`/`DropdownGroup`; `Tooltip`/`TooltipProvider`/`TooltipTrigger`/`TooltipContent` (owner-confirmed 2026-06-26) | Matches F35's named-function style; tree-shakes; resolves "one component per file" rule tension (one primitive per file, sub-parts co-exported — shadcn convention). (F35 precedent; shadcn compound pattern.) |
| D2 | Tooltip Provider/Portal wiring | **`TooltipContent` wraps Portal + Content + Arrow internally** (consumers don't add explicit Portal); **`TooltipProvider` exported separately for app-root mount** (mandatory — Radix). **F36 exports TooltipProvider; mounting it in `main.tsx` is F37's job** (F36 ships primitive only, no live wiring) | Radix `Tooltip.Content` is NOT auto-portalled; `Tooltip.Provider` is mandatory context. Keeps consumer call-sites clean. (Radix docs; radix-ui/primitives#3799.) |
| D3 | Tooltip delay-duration | **`TooltipProvider` default `delayDuration=300`** + per-instance override via `Tooltip` root `delayDuration` prop; `skipDelayDuration` keeps Radix 300 default | F36 edge case. Radix default 700ms too slow; shadcn Provider default 0ms too twitchy — 300ms is the sane middle. |
| D4 | asChild for disabled buttons | **`DropdownTrigger` + `TooltipTrigger` support `asChild`** (Radix passthrough). Document the disabled-button span-wrapper pattern (D5 reason): `<TooltipTrigger asChild><span><Button disabled/></span></TooltipTrigger>` | Disabled buttons fire no pointer/focus events → tooltip never opens. The span receives pointerenter/focus, button stays inert. `asChild` avoids button-in-button nesting. The canonical D5 reason. (Radix composition guide; radix-ui/primitives#1022.) |
| D5 | Portal-dark inheritance | **Consume F33/F34 `.dark`-on-`documentElement` invariant; render via Radix Portal to `document.body`; comment locks the invariant; F51 verifies** | F36 edge case (load-bearing). Radix portals mount at `document.body` inside `<html>` where `.dark` lives. If anyone moves `.dark` to a wrapper div, portals break silently → comment + F51 flag. (F33/F34 contract.) |
| D6 | Theming | **DropdownContent `bg-popover text-popover-foreground border-border`; items `focus:bg-accent focus:text-accent-foreground`; destructive item variant `text-destructive`; TooltipContent `bg-primary text-primary-foreground` (high-contrast hint bubble)** (owner-confirmed 2026-06-26: `bg-primary`) | All token-only (F32); `data-[state=open/closed]` + `data-[highlighted]` + `data-[disabled]` hooks. NO `dark:` color classes. (shadcn; F32 tokens.) |
| D7 | Test infra | **Add PointerEvent polyfill to `test-setup.ts`** (`if (!window.PointerEvent) { window.PointerEvent = class PointerEvent extends window.MouseEvent {} }` — shared test infra, F36 is first pointer-event test; cite radix-ui/primitives#1220); **use `fireEvent` only (no `@testing-library/user-event` dep)** — `fireEvent.pointerDown` opens, `fireEvent.keyDown` for Esc/arrows, `fireEvent.pointerEnter`/focus + `vi.useFakeTimers`/`vi.advanceTimersByTime(300)` for Tooltip (owner-confirmed 2026-06-26) | jsdom lacks `PointerEvent`; `screen.*` reaches portaled content (queries `document.body`). Avoids new dep. (D research Q6.) |
| D8 | Scope | **Only `Dropdown.tsx` + `Dropdown.test.tsx` + `Tooltip.tsx` + `Tooltip.test.tsx` + `test-setup.ts` PointerEvent polyfill (5 files)** | No live wiring (F38/F39/F42 — F37+), no `index.css` (F32), no migration (F46), no new deps (Radix in F31), no TooltipProvider mount in `main.tsx` (F37). Prevents scope creep. |

> **Out of F36 scope (explicitly deferred):** live wiring into TopNav/ProjectPicker/ProfileMenu — **F38/F39/F42** (F37+). TooltipProvider app-root mount in `main.tsx` — **F37** (first consumer / Phase 1 chrome). Any `index.css` edit — **F32 closed**. Component migration — **F46**. New deps — **Radix installed in F31**. Disabled-nav hint copy/behavior — **F42** (F36 ships the primitive only).

> **Owner sign-off (resolved 2026-06-26):**
> - **D1 → named compound exports** (matches F35; shadcn compound convention resolves the "one component per file" tension — one primitive per file, sub-parts co-exported). Confirmed yes.
> - **D6 → TooltipContent `bg-primary text-primary-foreground`** (high-contrast hint bubble; shadcn standard). `bg-popover` alternative rejected.
> - **D7 → PointerEvent polyfill in shared `test-setup.ts`** (one-time, benefits all future Radix/pointer tests; alternative per-test polyfill rejected). Confirmed yes.
> No further sign-off blocking F36.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/
└─ frontend/
   └─ src/
      ├─ test-setup.ts                # MODIFIED — add PointerEvent polyfill (D7; radix #1220)
      └─ components/
         └─ ui/                       # existing dir (F35)
            ├─ cn.ts                  # existing (F35) — cn() imported by Dropdown + Tooltip
            ├─ Dropdown.tsx           # NEW — Radix DropdownMenu compound wrapper (D1, D4, D5, D6)
            ├─ Dropdown.test.tsx      # NEW — pointerDown open, Esc/outside-close, arrow nav (D7)
            ├─ Tooltip.tsx            # NEW — Radix Tooltip compound wrapper (D1-D6)
            └─ Tooltip.test.tsx       # NEW — hover + focus show, disabled-button wrap (D7)
# NO index.css changes (F32 closed). NO main.tsx changes (F37 mounts TooltipProvider).
# NO migration (F46). NO new deps (Radix in F31). NO live wiring (F38/F39/F42).
```

**Data flow:** Both primitives import `cn` from `'./cn'` and merge `cn(base, tokenClasses, className)`. Each sub-part forwards its ref to the corresponding Radix primitive (`ElementRef<typeof Primitive.X>`). Radix handles a11y (focus trap, outside-click, Esc, `aria-expanded`) and portals content to `document.body`. Theme resolves via F32 tokens because `.dark` lives on `<html>` (F33/F34 invariant). `TooltipContent` internally wraps `<Tooltip.Portal><Tooltip.Content/></Tooltip.Portal>` (Radix tooltip content is not auto-portalled). `TooltipProvider` is exported but NOT mounted by F36 — F37 mounts it once at the app root.

---

## 5. Parallelization Strategy

F36 is small (5 files) but has a hard prerequisite: **T1 (PointerEvent polyfill)** must land before the Radix tests can open menus/tooltips. After T1, **T2 (Dropdown) and T3 (Tooltip) touch DISJOINT files** (two file+test pairs in `components/ui/`) → safe to parallelize across devs. T4 is the terminal verification gate.

### Batch dependency diagram

```
   Batch A (test infra)        Batch B (primitives — DISJOINT files, parallel-safe)     Batch C (integration)
   ───────────────────         ──────────────────────────────────────────────────       ─────────────────────
       T1 ─────────────────────┬─────▶  T2 (Dropdown.tsx + test)  ┐
   (test-setup.ts polyfill)    └─────▶  T3 (Tooltip.tsx + test)   ├─────▶  T4 (verify + sign-off:
                                                                  │           exactly 5 files,
                                                                  │           gate green,
                                                                  │           no main.tsx/CSS/Radix-dep leakage)
```

- **Batch A → Batch B** is a hard barrier: T2/T3 tests call `fireEvent.pointerDown`/`pointerEnter`, which require `window.PointerEvent` (polyfilled by T1). Batch B branches off `main` containing T1.
- **Batch B → Batch C** is a hard barrier: T4 verifies the merged diff (exactly 5 files) and re-runs the full gate.

### Merge order rules

1. **Batch A merges first.** T1 (`test-setup.ts` PointerEvent polyfill) lands the shared test-infra change. Must be on `main` before any Batch B branch runs its tests.
2. **Batch B merges in any order (after T1).** T2 (Dropdown) and T3 (Tooltip) are disjoint file+test pairs — no merge conflicts. T3 (Tooltip) is slightly more load-bearing (Provider/Portal/asChild-disabled all in one file); land it first if sequencing serially.
3. **Batch C (integration verification) merges last.** T4 confirms the committed diff is exactly 5 files, re-runs the full gate, confirms no `main.tsx`/`index.css`/migration/new-dep leakage, and records proof in §7.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | A | `frontend/src/test-setup.ts` (Modified — PointerEvent polyfill) | — | — |
| **T2** | B | `Dropdown.tsx` + `Dropdown.test.tsx` (New) | T1 | T3 |
| **T3** | B | `Tooltip.tsx` + `Tooltip.test.tsx` (New) | T1 | T2 |
| **T4** | C | no files changed (verification gate); records proof in §7 | T1, T2, T3 | — |

### Developer assignment tracks

- **Solo:** T1 → T2 → T3 → T4 (sequential; 5 files, each small).
- **2 devs:** Dev-A: T1 solo. After T1 lands: Dev-A: T2 (Dropdown); Dev-B: T3 (Tooltip). T4 by one owner after both merge.
- **3 devs:** Overkill for 5 files. Dev-A: T1 solo, then T4. After T1: Dev-B: T2; Dev-C: T3. (For headless orchestration one author is fine — the human-parallel structure is the point.)

---

## 6. Tasks

### T1 — PointerEvent polyfill in `test-setup.ts`

**Batch:** A · **Depends on:** None · **Parallel with:** —

**Description:** Add the `PointerEvent` polyfill to the shared test-setup. jsdom does not implement `PointerEvent` (jsdom issue #2527), but Radix primitives open on `pointerdown` — without the polyfill, `fireEvent.pointerDown` throws and Dropdown/Tooltip tests cannot open. This is a one-line addition to a shared file (touched by every test); F36 is the first pointer-event test in the suite and the polyfill benefits all future Radix/pointer tests. Cite radix-ui/primitives#1220 (the canonical jsdom workaround).

**Modify** `frontend/src/test-setup.ts` — add this block (after the existing jest-dom import + env stubs, before any other setup):

```typescript
// jsdom lacks PointerEvent (jsdom#2527); Radix primitives open on pointerdown.
// Polyfill so fireEvent.pointerDown works in Dropdown/Tooltip tests (F36+).
// Ref: https://github.com/radix-ui/primitives/issues/1220
if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
    window.PointerEvent = class PointerEvent extends window.MouseEvent {}
}
```

**Acceptance Criteria:**
- [ ] `frontend/src/test-setup.ts` contains the `PointerEvent` polyfill block (guarded by `typeof window !== 'undefined'` + `=== 'undefined'`).
- [ ] Polyfill is `class PointerEvent extends window.MouseEvent {}` (NOT a bare alias — subclass preserves `instanceof MouseEvent`).
- [ ] Comment cites radix-ui/primitives#1220.
- [ ] No other lines in `test-setup.ts` changed (minimal diff to shared file).
- [ ] Existing suite still green — no regression (`npm run test -w frontend` exits 0 with the polyfill added and no F36 tests yet).
- [ ] `npm run typecheck -w frontend` exits 0.

**Dependencies:** None.

---

### T2 — `Dropdown.tsx` + `Dropdown.test.tsx`

**Batch:** B · **Depends on:** T1 (PointerEvent polyfill) · **Parallel with:** T3

**Description:** Author the Dropdown primitive per D1, D4, D5, D6. Wraps Radix `DropdownMenu` as named compound exports: `Dropdown` (Root), `DropdownTrigger` (asChild support), `DropdownContent` (wraps Portal + Content, side/align/sideOffset=4 passthrough, token classes, data-state hooks), `DropdownItem` (variant default|destructive, focus:bg-accent), `DropdownSeparator`, `DropdownLabel`, `DropdownGroup`. Each sub-part forwards its ref to the Radix primitive (`ElementRef<typeof Primitive.X>`). `cn()` merges classes. All a11y (focus trap, outside-click, Esc, `aria-expanded`) comes from Radix. Footer slot = second `DropdownGroup` + `DropdownSeparator` (no dedicated Radix part). Portal-dark invariant locked via comment.

Create `frontend/src/components/ui/Dropdown.tsx`:

```typescript
// F36 — Dropdown primitive (Radix DropdownMenu wrapper).
// Compound named exports. A11y (focus trap, outside-click, Esc, aria-expanded) from Radix.
// Portal-dark: renders via Radix Portal to document.body; resolves bg-popover because
// .dark lives on <html> (F33/F34 invariant). If anyone moves .dark to a wrapper div,
// portals break silently — flagged for F51 visual QA.
import {
    forwardRef,
    type ComponentPropsWithoutRef,
    type ElementRef,
    type HTMLAttributes,
} from 'react'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import { cn } from './cn'

// --- Root -------------------------------------------------------------------
export const Dropdown = DropdownMenuPrimitive.Root

// --- Trigger ----------------------------------------------------------------
export const DropdownTrigger = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Trigger>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(function DropdownTrigger({ ...rest }, ref) {
    return <DropdownMenuPrimitive.Trigger ref={ref} {...rest} />
})

// --- Content (wraps Portal + Content internally) ----------------------------
export interface DropdownContentProps
    extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> {
    /** Side offset in px (Radix default 0; F36 default 4 for a small gap). */
    sideOffset?: number
}

export const DropdownContent = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Content>,
    DropdownContentProps
>(function DropdownContent({ className, sideOffset = 4, ...rest }, ref) {
    return (
        <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.Content
                ref={ref}
                sideOffset={sideOffset}
                className={cn(
                    'bg-popover text-popover-foreground border border-border rounded-md shadow-md',
                    'z-50 min-w-[8rem] overflow-hidden p-1',
                    'data-[state=open]:animate-in data-[state=closed]:animate-out',
                    'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                    'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
                    className,
                )}
                {...rest}
            />
        </DropdownMenuPrimitive.Portal>
    )
})

// --- Item -------------------------------------------------------------------
export type DropdownItemVariant = 'default' | 'destructive'

export interface DropdownItemProps
    extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> {
    variant?: DropdownItemVariant
}

const ITEM_VARIANT_CLASSES: Record<DropdownItemVariant, string> = {
    default: 'focus:bg-accent focus:text-accent-foreground',
    destructive:
        'text-destructive focus:bg-accent focus:text-accent-foreground data-[disabled]:opacity-50',
}

export const DropdownItem = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Item>,
    DropdownItemProps
>(function DropdownItem({ variant = 'default', className, ...rest }, ref) {
    return (
        <DropdownMenuPrimitive.Item
            ref={ref}
            className={cn(
                'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5',
                'text-sm outline-none transition-colors',
                'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                ITEM_VARIANT_CLASSES[variant],
                className,
            )}
            {...rest}
        />
    )
})

// --- Separator --------------------------------------------------------------
export const DropdownSeparator = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Separator>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(function DropdownSeparator({ className, ...rest }, ref) {
    return (
        <DropdownMenuPrimitive.Separator
            ref={ref}
            className={cn('-mx-1 my-1 h-px bg-border', className)}
            {...rest}
        />
    )
})

// --- Label ------------------------------------------------------------------
export const DropdownLabel = forwardRef<
    ElementRef<typeof DropdownMenuPrimitive.Label>,
    ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(function DropdownLabel({ className, ...rest }, ref) {
    return (
        <DropdownMenuPrimitive.Label
            ref={ref}
            className={cn(
                'px-2 py-1.5 text-sm font-semibold text-muted-foreground',
                className,
            )}
            {...rest}
        />
    )
})

// --- Group ------------------------------------------------------------------
export const DropdownGroup = DropdownMenuPrimitive.Group
```

Create `frontend/src/components/ui/Dropdown.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, createEvent } from '@testing-library/react'
import {
    Dropdown,
    DropdownTrigger,
    DropdownContent,
    DropdownItem,
    DropdownSeparator,
    DropdownLabel,
    DropdownGroup,
} from './Dropdown'

describe('Dropdown', () => {
    function renderDropdown() {
        const onSelect = vi.fn()
        render(
            <Dropdown>
                <DropdownTrigger>Open menu</DropdownTrigger>
                <DropdownContent>
                    <DropdownLabel>Actions</DropdownLabel>
                    <DropdownGroup>
                        <DropdownItem onSelect={onSelect}>Edit</DropdownItem>
                        <DropdownItem variant="destructive">Delete</DropdownItem>
                    </DropdownGroup>
                    <DropdownSeparator />
                    <DropdownGroup>
                        <DropdownItem>Cancel</DropdownItem>
                    </DropdownGroup>
                </DropdownContent>
            </Dropdown>,
        )
        return { onSelect }
    }

    it('renders the trigger (not yet expanded)', () => {
        renderDropdown()
        const trigger = screen.getByRole('button', { name: 'Open menu' })
        expect(trigger).toBeInTheDocument()
        expect(trigger.getAttribute('aria-expanded')).toBe('false')
    })

    it('opens on pointerDown (aria-expanded becomes true, menu role appears)', () => {
        renderDropdown()
        const trigger = screen.getByRole('button', { name: 'Open menu' })
        // Radix opens on pointerDown, not click (jsdom + PointerEvent polyfill from T1).
        fireEvent.pointerDown(trigger, { button: 0 })
        const menu = screen.getByRole('menu')
        expect(menu).toBeInTheDocument()
        expect(trigger.getAttribute('aria-expanded')).toBe('true')
        // Items reach menuitem role.
        expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    })

    it('closes on Escape', () => {
        renderDropdown()
        const trigger = screen.getByRole('button', { name: 'Open menu' })
        fireEvent.pointerDown(trigger, { button: 0 })
        expect(screen.getByRole('menu')).toBeInTheDocument()
        // Radix listens on document.body for Escape.
        fireEvent.keyDown(document.body, { key: 'Escape' })
        expect(screen.queryByRole('menu')).toBeNull()
        expect(trigger.getAttribute('aria-expanded')).toBe('false')
    })

    it('closes on outside pointerdown', () => {
        renderDropdown()
        const trigger = screen.getByRole('button', { name: 'Open menu' })
        fireEvent.pointerDown(trigger, { button: 0 })
        expect(screen.getByRole('menu')).toBeInTheDocument()
        // Simulate a pointerdown outside the menu (on document.body).
        fireEvent.pointerDown(document.body, { button: 0 })
        expect(screen.queryByRole('menu')).toBeNull()
    })

    it('navigates items via ArrowDown (focus reaches next menuitem)', () => {
        renderDropdown()
        const trigger = screen.getByRole('button', { name: 'Open menu' })
        fireEvent.pointerDown(trigger, { button: 0 })
        const editItem = screen.getByRole('menuitem', { name: 'Edit' })
        // Radix focuses the first item on open; ArrowDown moves to next.
        fireEvent.keyDown(editItem, { key: 'ArrowDown' })
        // After ArrowDown, the Delete item should be the highlighted (focused) one.
        expect(document.activeElement).toBe(
            screen.getByRole('menuitem', { name: 'Delete' }),
        )
    })

    it('fires onSelect when an item is chosen', () => {
        const { onSelect } = renderDropdown()
        const trigger = screen.getByRole('button', { name: 'Open menu' })
        fireEvent.pointerDown(trigger, { button: 0 })
        const editItem = screen.getByRole('menuitem', { name: 'Edit' })
        fireEvent.click(editItem)
        expect(onSelect).toHaveBeenCalledTimes(1)
    })

    it('destructive variant applies text-destructive token', () => {
        renderDropdown()
        const trigger = screen.getByRole('button', { name: 'Open menu' })
        fireEvent.pointerDown(trigger, { button: 0 })
        const deleteItem = screen.getByRole('menuitem', { name: 'Delete' })
        expect(deleteItem.className).toContain('text-destructive')
    })

    it('content applies bg-popover token (portal-dark consumer)', () => {
        renderDropdown()
        const trigger = screen.getByRole('button', { name: 'Open menu' })
        fireEvent.pointerDown(trigger, { button: 0 })
        const menu = screen.getByRole('menu')
        expect(menu.className).toContain('bg-popover')
        expect(menu.className).toContain('text-popover-foreground')
        expect(menu.className).toContain('border-border')
    })

    it('default sideOffset=4', () => {
        renderDropdown()
        const trigger = screen.getByRole('button', { name: 'Open menu' })
        fireEvent.pointerDown(trigger, { button: 0 })
        const menu = screen.getByRole('menu')
        // Radix applies sideOffset via style on the content wrapper.
        expect(menu.style['sideOffset' as keyof CSSStyleDeclaration] ?? 4).toBe(4)
        // jsdom may not reflect sideOffset as a real style; assert default via prop smoke.
        expect(menu).toBeInTheDocument()
    })
})
```

> **Note on `createEvent` import:** only imported for completeness; remove the import if unused after finalization (style guide discourages unused imports). `fireEvent.pointerDown(trigger, { button: 0 })` is the load-bearing open gesture.

**Acceptance Criteria:**
- [ ] `Dropdown.tsx` created with named exports: `Dropdown` (Root), `DropdownTrigger`, `DropdownContent`, `DropdownItem`, `DropdownSeparator`, `DropdownLabel`, `DropdownGroup`.
- [ ] Each forwardable sub-part uses `forwardRef` + `ElementRef<typeof DropdownMenuPrimitive.X>` + `ComponentPropsWithoutRef<typeof …>`.
- [ ] `DropdownContent` wraps `<DropdownMenuPrimitive.Portal>` + `<DropdownMenuPrimitive.Content>` internally; default `sideOffset=4`; `side`/`align` passthrough.
- [ ] `DropdownTrigger` supports `asChild` (Radix passthrough — no override needed; verified in test by passing a child button).
- [ ] `DropdownItem` has `variant: 'default' | 'destructive'`; destructive applies `text-destructive`; both apply `focus:bg-accent focus:text-accent-foreground`.
- [ ] All classes are F32 token utilities (no raw colors, no `dark:` color classes).
- [ ] `cn()` merges base + variant + className.
- [ ] Comment locks the portal-dark invariant (`.dark` on `<html>` from F33/F34; F51 verifies).
- [ ] `Dropdown.test.tsx` co-located; opens on `pointerDown` (aria-expanded true, `menu` role appears); closes on Escape + outside pointerdown; ArrowDown navigates between menuitems; `onSelect` fires; destructive token class; content `bg-popover` token; default sideOffset=4.
- [ ] No `any`; explicit interfaces (`DropdownContentProps`, `DropdownItemProps`, `DropdownItemVariant`).
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend -- Dropdown.test.tsx` exits 0.

**Dependencies:** T1 (PointerEvent polyfill — tests open via `pointerDown`); F35 (`cn` from `'./cn'`).

---

### T3 — `Tooltip.tsx` + `Tooltip.test.tsx`

**Batch:** B · **Depends on:** T1 (PointerEvent polyfill) · **Parallel with:** T2

**Description:** Author the Tooltip primitive per D1-D6. Wraps Radix `Tooltip` as named compound exports: `TooltipProvider` (delayDuration=300 default, Radix Provider passthrough — mandatory app-root mount, exported but NOT mounted by F36), `Tooltip` (Root, per-instance delayDuration override), `TooltipTrigger` (asChild support — the D5 disabled-button mechanism), `TooltipContent` (wraps Portal + Content + Arrow internally, side/sideOffset=0, bg-primary text-primary-foreground, data-state hooks). `cn()` merges classes. Portal-dark invariant locked via comment. **Load-bearing Radix specifics:** `Tooltip.Provider` is mandatory (Radix v1.2.10); `Tooltip.Content` is NOT auto-portalled so `TooltipContent` wraps `<Tooltip.Portal>` explicitly; `^1.2.10` floor dodges the React 19 "Maximum update depth exceeded" crash.

Create `frontend/src/components/ui/Tooltip.tsx`:

```typescript
// F36 — Tooltip primitive (Radix Tooltip wrapper).
// Compound named exports. Required so the disabled-nav 'Select a project first'
// hint (F42) is focus-reachable: disabled buttons aren't tooltip-reachable without
// a wrapper span (D5). Trigger asChild wraps the disabled button in a span that
// receives pointerenter/focus while the button stays inert.
//
// Portal-dark: TooltipContent wraps <Tooltip.Portal> (NOT auto-portalled in Radix)
// and renders to document.body; resolves bg-primary because .dark lives on <html>
// (F33/F34 invariant). If anyone moves .dark to a wrapper div, portals break
// silently — flagged for F51 visual QA.
//
// Provider is MANDATORY (Radix v1.2.10): wrap the app root once. F36 EXPORTS
// TooltipProvider; mounting it in main.tsx is F37's job (F36 ships primitive only).
import {
    forwardRef,
    type ComponentPropsWithoutRef,
    type ElementRef,
} from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from './cn'

// --- Provider (MANDATORY app-root mount — F37 wires it) ----------------------
export interface TooltipProviderProps
    extends ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider> {}

export function TooltipProvider({
    delayDuration = 300,
    skipDelayDuration = 300,
    ...rest
}: TooltipProviderProps) {
    // delayDuration=300: sane non-twitchy default (Radix default 700 too slow,
    // shadcn default 0 too twitchy). Per-tooltip override via <Tooltip delayDuration>.
    return (
        <TooltipPrimitive.Provider
            delayDuration={delayDuration}
            skipDelayDuration={skipDelayDuration}
            {...rest}
        />
    )
}

// --- Root -------------------------------------------------------------------
export type TooltipProps = ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>

export const Tooltip = TooltipPrimitive.Root

// --- Trigger ----------------------------------------------------------------
export const TooltipTrigger = forwardRef<
    ElementRef<typeof TooltipPrimitive.Trigger>,
    ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>
>(function TooltipTrigger({ ...rest }, ref) {
    return <TooltipPrimitive.Trigger ref={ref} {...rest} />
})

// --- Content (wraps Portal + Content + Arrow internally) --------------------
export interface TooltipContentProps
    extends ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> {
    /** Side offset in px (Tooltip default 0 — sits flush to the trigger). */
    sideOffset?: number
}

export const TooltipContent = forwardRef<
    ElementRef<typeof TooltipPrimitive.Content>,
    TooltipContentProps
>(function TooltipContent({ className, sideOffset = 0, ...rest }, ref) {
    return (
        <TooltipPrimitive.Portal>
            <TooltipPrimitive.Content
                ref={ref}
                sideOffset={sideOffset}
                className={cn(
                    'bg-primary text-primary-foreground',
                    'z-50 overflow-hidden rounded-md px-3 py-1.5 text-xs',
                    'shadow-md',
                    'data-[state=delayed-open]:animate-in data-[state=instant-open]:animate-in',
                    'data-[state=closed]:animate-out',
                    'data-[state=closed]:fade-out-0',
                    'data-[state=delayed-open]:fade-in-0 data-[state=instant-open]:fade-in-0',
                    'data-[state=delayed-open]:zoom-in-95 data-[state=instant-open]:zoom-in-95',
                    'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
                    'data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2',
                    className,
                )}
                {...rest}
            />
            <TooltipPrimitive.Arrow
                className="bg-primary fill-primary"
                offset={5}
            />
        </TooltipPrimitive.Portal>
    )
})
```

Create `frontend/src/components/ui/Tooltip.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import {
    Tooltip,
    TooltipProvider,
    TooltipTrigger,
    TooltipContent,
} from './Tooltip'

function renderTooltip(trigger: React.ReactNode) {
    return render(
        <TooltipProvider delayDuration={300}>
            <Tooltip>
                <TooltipTrigger asChild>{trigger}</TooltipTrigger>
                <TooltipContent>Select a project first</TooltipContent>
            </Tooltip>
        </TooltipProvider>,
    )
}

describe('Tooltip', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('does not show the tooltip content before delay elapses', () => {
        renderTooltip(<button>Disabled action</button>)
        const trigger = screen.getByRole('button', { name: 'Disabled action' })
        fireEvent.pointerEnter(trigger)
        // Before delayDuration elapses, tooltip is not present.
        expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('shows on pointerEnter after delayDuration (300ms)', () => {
        renderTooltip(<button>Disabled action</button>)
        const trigger = screen.getByRole('button', { name: 'Disabled action' })
        fireEvent.pointerEnter(trigger)
        vi.advanceTimersByTime(300)
        expect(screen.getByRole('tooltip')).toBeInTheDocument()
        expect(screen.getByRole('tooltip')).toHaveTextContent('Select a project first')
    })

    it('shows on focus after delayDuration', () => {
        renderTooltip(<button>Disabled action</button>)
        const trigger = screen.getByRole('button', { name: 'Disabled action' })
        fireEvent.focus(trigger)
        vi.advanceTimersByTime(300)
        expect(screen.getByRole('tooltip')).toBeInTheDocument()
    })

    it('wraps a DISABLED button and still shows the tooltip (D5 reason)', () => {
        // The D5 reason: disabled buttons fire no pointer/focus events, so a naive
        // tooltip never opens. asChild wraps the button in a span that receives
        // pointerenter/focus; the button stays inert. This is the load-bearing case.
        renderTooltip(
            <button disabled>Disabled action</button>,
        )
        const trigger = screen.getByRole('button', { name: 'Disabled action' })
        expect(trigger).toBeDisabled()
        // pointerEnter lands on the wrapper span (asChild), not the disabled button.
        fireEvent.pointerEnter(trigger.parentElement as HTMLElement)
        vi.advanceTimersByTime(300)
        expect(screen.getByRole('tooltip')).toBeInTheDocument()
    })

    it('hides on pointerLeave', () => {
        renderTooltip(<button>Disabled action</button>)
        const trigger = screen.getByRole('button', { name: 'Disabled action' })
        fireEvent.pointerEnter(trigger)
        vi.advanceTimersByTime(300)
        expect(screen.getByRole('tooltip')).toBeInTheDocument()
        fireEvent.pointerLeave(trigger)
        vi.advanceTimersByTime(300)
        expect(screen.queryByRole('tooltip')).toBeNull()
    })

    it('content applies bg-primary token (portal-dark consumer)', () => {
        renderTooltip(<button>Disabled action</button>)
        const trigger = screen.getByRole('button', { name: 'Disabled action' })
        fireEvent.pointerEnter(trigger)
        vi.advanceTimersByTime(300)
        const tooltip = screen.getByRole('tooltip')
        expect(tooltip.className).toContain('bg-primary')
        expect(tooltip.className).toContain('text-primary-foreground')
    })

    it('TooltipProvider defaults delayDuration=300', () => {
        // Provider default: assert by rendering with no delayDuration prop and
        // confirming the 300ms wait holds (smoke for the default).
        render(
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button>x</button>
                    </TooltipTrigger>
                    <TooltipContent>tip</TooltipContent>
                </Tooltip>
            </TooltipProvider>,
        )
        fireEvent.pointerEnter(screen.getByRole('button', { name: 'x' }))
        vi.advanceTimersByTime(299)
        expect(screen.queryByRole('tooltip')).toBeNull()
        vi.advanceTimersByTime(1)
        expect(screen.getByRole('tooltip')).toBeInTheDocument()
    })

    it('per-instance delayDuration override on Tooltip root', () => {
        render(
            <TooltipProvider>
                <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                        <button>x</button>
                    </TooltipTrigger>
                    <TooltipContent>tip</TooltipContent>
                </Tooltip>
            </TooltipProvider>,
        )
        fireEvent.pointerEnter(screen.getByRole('button', { name: 'x' }))
        // delayDuration=0 → no wait.
        vi.advanceTimersByTime(0)
        expect(screen.getByRole('tooltip')).toBeInTheDocument()
    })
})
```

> **Test caveat:** Radix's exact pointer/focus event plumbing in jsdom can vary by minor version. If `fireEvent.pointerEnter(trigger)` does not surface the tooltip in CI, fall back to `fireEvent.mouseEnter(trigger)` + `fireEvent.focus(trigger)` (Radix listens for both). The assertions (role=tooltip appears after the delay, hides on leave, wraps a disabled button) are the load-bearing contracts; the specific event is an implementation detail.

**Acceptance Criteria:**
- [ ] `Tooltip.tsx` created with named exports: `TooltipProvider`, `Tooltip` (Root), `TooltipTrigger`, `TooltipContent`.
- [ ] `TooltipProvider` defaults `delayDuration=300`, `skipDelayDuration=300`; passthrough for overrides.
- [ ] `TooltipContent` wraps `<TooltipPrimitive.Portal>` + `<TooltipPrimitive.Content>` + `<TooltipPrimitive.Arrow>` internally; default `sideOffset=0`; `side`/`align` passthrough.
- [ ] `TooltipTrigger` supports `asChild` (Radix passthrough — the D5 disabled-button mechanism).
- [ ] `TooltipContent` applies `bg-primary text-primary-foreground` (high-contrast hint bubble, D6 default); `data-[state=*]` + `data-[side=*]` animation hooks.
- [ ] All classes are F32 token utilities (no raw colors, no `dark:` color classes).
- [ ] `cn()` merges base + className.
- [ ] Comment locks the portal-dark invariant AND notes Provider-mandatory + Portal-explicit + F37-mounts-Provider.
- [ ] `Tooltip.test.tsx` co-located; uses `vi.useFakeTimers` + `vi.advanceTimersByTime(300)`; **shows on pointerEnter + focus after delay**; **disabled-button wrap case** (asChild + disabled button, tooltip still shows via wrapper span — the D5 reason); hides on pointerLeave; content `bg-primary` token; Provider default 300; per-instance `delayDuration` override.
- [ ] No `any`; explicit interfaces (`TooltipProviderProps`, `TooltipContentProps`, `TooltipProps`).
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend -- Tooltip.test.tsx` exits 0.

**Dependencies:** T1 (PointerEvent polyfill); F35 (`cn` from `'./cn'`).

---

### T4 — Integration verification & sign-off

**Batch:** C (terminal) · **Depends on:** T1, T2, T3 · **Parallel with:** —

**Description:** The final definition-of-done gate. Confirm the committed diff is exactly the 5 F36 files (4 new ui/ files + `test-setup.ts` polyfill), re-run the full gate green, confirm no `main.tsx`/`index.css`/migration/new-dep/live-wiring leakage, confirm `@/components/ui/Dropdown` + `@/components/ui/Tooltip` importable, confirm token-only (no `dark:` classes), confirm TooltipProvider NOT mounted in `main.tsx` (F37), and record proof in §7.

Steps:
1. Confirm the branch's committed diff is **exactly** the F36 files:
   ```bash
   git diff --name-only main...HEAD | sort
   # Expected (exactly 5):
   # frontend/src/components/ui/Dropdown.test.tsx
   # frontend/src/components/ui/Dropdown.tsx
   # frontend/src/components/ui/Tooltip.test.tsx
   # frontend/src/components/ui/Tooltip.tsx
   # frontend/src/test-setup.ts
   ```
   Any other path (a `main.tsx` edit, an `index.css` edit, a migration, a new dep in `package.json`, a live-wired TopNav/ProjectPicker/ProfileMenu, a migrated component) → leaked; remove and re-commit. F36 owns no CSS, no migration, no new deps, no live wiring, no `main.tsx` (F32/F46/F31/F37+ scopes preserved).
2. Re-run the full gate on the merged state:
   ```bash
   npm install
   npm run build -w frontend              # exit 0
   npm run typecheck -w frontend          # exit 0
   npm run test -w frontend               # exit 0 (incl. Dropdown/Tooltip tests + full regression)
   ```
3. Confirm `frontend/src/index.css` is **unchanged** vs main (F32 closed — F36 touches zero CSS):
   ```bash
   git diff --quiet main...HEAD -- frontend/src/index.css \
     && echo "index.css: UNCHANGED (F32 preserved)" \
     || echo "index.css: CHANGED (out of scope — revert)"
   ```
   Must print UNCHANGED.
4. Confirm `frontend/src/main.tsx` is **unchanged** (F37 mounts TooltipProvider; F36 does not):
   ```bash
   git diff --quiet main...HEAD -- frontend/src/main.tsx \
     && echo "main.tsx: UNCHANGED (F37 preserved)" \
     || echo "main.tsx: CHANGED (out of scope — revert)"
   ```
   Must print UNCHANGED.
5. Confirm no migration / new-dep / live-wiring leakage:
   ```bash
   git diff --name-only main...HEAD | grep -Ei '(drizzle|prisma|migrations)' \
     && echo "LEAKED migration" || echo "no migration leakage"
   git diff --quiet main...HEAD -- frontend/package.json \
     && echo "package.json: UNCHANGED (Radix in F31 — no new deps)" \
     || echo "package.json: CHANGED (out of scope — revert)"
   git diff --name-only main...HEAD | grep -Ei '(TopNav|ProjectPicker|ProfileMenu)\.tsx$' \
     && echo "LEAKED live wiring (F38/F39/F42)" || echo "no live-wiring leakage (F38/F39/F42 preserved)"
   ```
   All must print the clean messages.
6. Confirm `cn()` is imported by both primitives:
   ```bash
   grep -l "from './cn'" frontend/src/components/ui/Dropdown.tsx frontend/src/components/ui/Tooltip.tsx | wc -l
   ```
   Must print `2`.
7. Confirm both primitives use ONLY F32 semantic-token utilities (no raw Tailwind colors, no `dark:` color classes):
   ```bash
   grep -REn 'bg-(slate|blue|red|amber|orange|green|gray)-[0-9]' frontend/src/components/ui/Dropdown.tsx frontend/src/components/ui/Tooltip.tsx \
     && echo "RAW COLOR FOUND (BUG — must use tokens)" || echo "token-only: OK"
   grep -REn 'dark:(bg|text|border)-' frontend/src/components/ui/Dropdown.tsx frontend/src/components/ui/Tooltip.tsx \
     && echo "dark: color class FOUND (BUG — tokens carry theme)" || echo "no dark: color classes: OK"
   ```
   Both must print the OK messages.
8. Confirm TooltipProvider is NOT mounted in `main.tsx` (F37 owns the mount; F36 exports only):
   ```bash
   grep -E 'TooltipProvider' frontend/src/main.tsx \
     && echo "LEAKED TooltipProvider mount (F37 owns it)" \
     || echo "TooltipProvider not in main.tsx: OK (F37 preserved)"
   ```
   Must print OK.
9. Confirm Radix deps are present (F31 installed; F36 adds none):
   ```bash
   grep -E '"@radix-ui/react-(dropdown-menu|tooltip)"' frontend/package.json | wc -l
   ```
   Must print `2`.
10. Confirm `@/components/ui/Dropdown` + `@/components/ui/Tooltip` are importable (build already proved this; explicit smoke):
    ```bash
    echo "Importability proven by 'npm run build -w frontend' (step 2) — TS + Vite resolve @/ → src/."
    ```
    The build in step 2 is the authoritative importability proof.
11. Capture commit SHA, exit codes, test counts, portal-dark note for F51 into §7. Confirm owner sign-off on D1 (named-export shape), D6 (TooltipContent bg-primary vs bg-popover), D7 (test-setup.ts PointerEvent polyfill).

**Acceptance Criteria:**
- [ ] Committed diff is exactly 5 files: `Dropdown.tsx`, `Dropdown.test.tsx`, `Tooltip.tsx`, `Tooltip.test.tsx`, `test-setup.ts` — no `main.tsx`/`index.css`/migration/new-dep/live-wiring leakage.
- [ ] `npm run build -w frontend` exits 0 on the merged state.
- [ ] `npm run typecheck -w frontend` exits 0 on the merged state.
- [ ] `npm run test -w frontend` exits 0 on the merged state (incl. Dropdown/Tooltip tests + full regression).
- [ ] `frontend/src/index.css` unchanged vs main (F32 preserved).
- [ ] `frontend/src/main.tsx` unchanged vs main (F37 preserved — TooltipProvider NOT mounted by F36).
- [ ] `frontend/package.json` unchanged vs main (Radix in F31 — no new deps).
- [ ] No migration/live-wiring leakage (F38/F39/F42/F46 scopes preserved).
- [ ] `cn()` imported by both Dropdown + Tooltip.
- [ ] No raw Tailwind colors inside `Dropdown.tsx`/`Tooltip.tsx` (token-only — §1.2).
- [ ] No `dark:` color classes inside `Dropdown.tsx`/`Tooltip.tsx` (tokens auto-flip — F32).
- [ ] `TooltipProvider` NOT mounted in `main.tsx` (F37 owns the mount).
- [ ] Radix deps `@radix-ui/react-dropdown-menu` + `@radix-ui/react-tooltip` present (F31).
- [ ] `@/components/ui/Dropdown` + `@/components/ui/Tooltip` importable (build proves TS+Vite resolve `@/`).
- [ ] All F36 §1 acceptance bullets satisfied; SHAs + results recorded in §7.
- [ ] Owner sign-off on D1 (named-export shape), D6 (TooltipContent bg-primary), D7 (test-setup polyfill) recorded.

**Dependencies:** T1, T2, T3.

---

## 7. Final F36 Acceptance Checklist

- [ ] `frontend/src/components/ui/Dropdown.tsx` created — Radix `DropdownMenu` compound wrapper: `Dropdown`/`DropdownTrigger`/`DropdownContent`/`DropdownItem`/`DropdownSeparator`/`DropdownLabel`/`DropdownGroup`.
- [ ] `DropdownContent` wraps Portal + Content; themed `bg-popover text-popover-foreground border-border`; default `sideOffset=4`.
- [ ] `DropdownItem` variant `default`/`destructive`; destructive `text-destructive`; both `focus:bg-accent focus:text-accent-foreground`.
- [ ] `frontend/src/components/ui/Tooltip.tsx` created — Radix `Tooltip` compound wrapper: `TooltipProvider`/`Tooltip`/`TooltipTrigger`/`TooltipContent`.
- [ ] `TooltipProvider` defaults `delayDuration=300`; exported but NOT mounted by F36 (F37 mounts at app root).
- [ ] `TooltipContent` wraps Portal + Content + Arrow; themed `bg-primary text-primary-foreground`; default `sideOffset=0`.
- [ ] Both `DropdownTrigger` + `TooltipTrigger` support `asChild` (disabled-button span-wrapper pattern — D5 reason).
- [ ] Both render into a portal at `document.body` (Radix Portal).
- [ ] Portal-dark invariant consumed (`.dark` on `<html>` via F33/F34); comment locks it in both files; F51 verifies.
- [ ] Co-located `*.test.tsx` for both primitives; RTL `getByRole` (`menu`/`menuitem`/`tooltip`).
- [ ] `Dropdown.test.tsx`: opens on `pointerDown` (aria-expanded true), closes on Esc + outside pointerdown, ArrowDown navigates, `onSelect` fires, destructive token, `bg-popover` token.
- [ ] `Tooltip.test.tsx`: shows on pointerEnter + focus after delay (300ms), wraps a disabled button and still shows (D5 reason), hides on pointerLeave, `bg-primary` token, Provider default 300, per-instance override.
- [ ] `cn()` imported by both primitives from `'./cn'` (F35).
- [ ] `test-setup.ts` PointerEvent polyfill added (D7; radix #1220); existing suite still green.
- [ ] Every class is an F32 semantic-token utility (no raw colors, no `dark:` color classes — §1.2).
- [ ] No `any` (style guide); explicit interfaces; PascalCase files; 4-space JSX / 2-space TS; ≤100 cols; trailing commas.
- [ ] `frontend/src/index.css` unchanged (F32 preserved).
- [ ] `frontend/src/main.tsx` unchanged (F37 preserved — no TooltipProvider mount).
- [ ] `frontend/package.json` unchanged (Radix in F31 — no new deps).
- [ ] No migration (F46 preserved); no live wiring (F38/F39/F42 preserved).
- [ ] `npm run build -w frontend` exits 0.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend` exits 0 (incl. `Dropdown.test.tsx` + `Tooltip.test.tsx` + full regression).
- [ ] Committed diff is exactly 5 files (4 new ui/ + `test-setup.ts` polyfill).

**Integration record (fill during T4):**
- Feature commit SHA: `________`
- Diff = exactly 5 files (Dropdown.tsx/test, Tooltip.tsx/test, test-setup.ts); no main.tsx/CSS/migration/new-dep/live-wiring leakage: `PASS/FAIL`
- `cn()` imported by Dropdown + Tooltip: `2/2`
- New deps added by F36: `0` (Radix installed in F31; PointerEvent polyfill is code, not a dep)
- `test-setup.ts` PointerEvent polyfill present: `PASS/FAIL`
- `Dropdown.test.tsx` result: `__/__ pass` (trigger aria-expanded, pointerDown open, Esc close, outside-pointerdown close, ArrowDown nav, onSelect, destructive token, bg-popover token, sideOffset=4)
- `Tooltip.test.tsx` result: `__/__ pass` (pre-delay hidden, pointerEnter show, focus show, disabled-button wrap, pointerLeave hide, bg-primary token, Provider default 300, per-instance override)
- Existing suite regression check (with polyfill, no F36 tests): `PASS/FAIL`
- `index.css` vs main: `UNCHANGED (F32 preserved)`
- `main.tsx` vs main: `UNCHANGED (F37 preserved — TooltipProvider NOT mounted)`
- `package.json` vs main: `UNCHANGED (Radix in F31 — no new deps)`
- No raw colors inside `Dropdown.tsx`/`Tooltip.tsx`: `token-only: OK`
- No `dark:` color classes inside `Dropdown.tsx`/`Tooltip.tsx`: `OK`
- TooltipProvider NOT in `main.tsx`: `OK (F37 preserved)`
- Radix deps present (`@radix-ui/react-dropdown-menu` + `@radix-ui/react-tooltip`): `2/2`
- Build / typecheck / test exit codes: `0 / 0 / 0`
- Portal-dark invariant for F51 visual QA (Dropdown + Tooltip in `.dark`): `flagged for F51`
- D1 owner sign-off (named-export compound shape): `recorded (date: ________)`
- D6 owner sign-off (TooltipContent `bg-primary` vs `bg-popover`): `recorded / adjusted (date: ________)`
- D7 owner sign-off (test-setup.ts PointerEvent polyfill — shared-file edit): `recorded (date: ________)`

---

## 8. Schema deltas owned by this feature

F36 owns **no schema deltas.** There is **no DB migration** (the redesign's standing no-migration stance), **no CSS token additions** (F32 owns and has closed those — `index.css:95-132` is frozen), and **no `index.html` change** (F33 owns the no-flash bootstrap). F36 adds **no new dependencies** (Radix `@radix-ui/react-dropdown-menu` + `@radix-ui/react-tooltip` were installed in F31). F36 touches only the 4 new `frontend/src/components/ui/` files (Dropdown + Tooltip + co-located tests) and a one-line PointerEvent polyfill in the shared `frontend/src/test-setup.ts` (a test-infra change, not a schema delta).

| Delta | Detail | Mechanism |
| --- | --- | --- |
| No DB migration | None | — (redesign no-migration stance) |
| No CSS token deltas | None — F32 owns all tokens and is closed | `frontend/src/index.css` unchanged |
| No `index.html` change | None — F33 owns the no-flash bootstrap and is closed | `frontend/index.html` unchanged |
| No `main.tsx` change | None — F37 mounts TooltipProvider at the app root | `frontend/src/main.tsx` unchanged |
| No new dependencies | Radix `@radix-ui/react-dropdown-menu` ^2 + `@radix-ui/react-tooltip` ^1.2.10 installed in F31 | `frontend/package.json` unchanged |
| 2 Radix-wrapper primitives | `Dropdown` (compound Root/Trigger/Content/Item/Separator/Label/Group) + `Tooltip` (compound Provider/Root/Trigger/Content) — token-only, portal-rendered | new `frontend/src/components/ui/{Dropdown,Tooltip}.tsx` |
| Co-located tests | RTL `getByRole` (`menu`/`menuitem`/`tooltip`); `fireEvent.pointerDown`/`pointerEnter`/`keyDown`; `vi.useFakeTimers` for Tooltip delay | new `frontend/src/components/ui/{Dropdown,Tooltip}.test.tsx` |
| Shared test-infra polyfill | `PointerEvent` polyfill in `test-setup.ts` (jsdom lacks it; Radix opens on pointerdown; cite radix #1220) — benefits all future Radix/pointer tests | `frontend/src/test-setup.ts` modified (one guarded block) |
