# Task Breakdown — DEL-01 (`ColorPicker` UI primitive)

**Source plan:** `./DEL-01-color-picker-primitive-plan.md`
**Scope:** Frontend-only, purely additive — two new files, **zero existing files modified**, **no new npm dependency**.
**Generated:** 2026-07-02

---

## Codebase Analysis Summary (Phase 1)

Three read-only probes verified the plan against the live tree. Key facts a developer must know:

- **All reference files exist** (`DatePicker.tsx`, `Button.tsx`, `Tooltip.tsx`, `Checkbox.tsx`, `Card.tsx`, `Select.tsx`, `Dropdown.tsx`, `cn.ts` and their `*.test.tsx` siblings; `LabelManager.tsx`; `index.css`, `main.tsx`, `test-setup.ts`, `vite.config.ts`, `package.json`). **Both target files (`ColorPicker.tsx`, `ColorPicker.test.tsx`) do NOT exist yet** — purely additive, no clobber risk.
- **Deps already installed** — `react-colorful ^5.7.0` at `frontend/package.json:34` and `@radix-ui/react-popover ^1.1.18` at `frontend/package.json:20`. (Plan cited `package.json:25` for react-colorful — **correct line is 34**; cosmetic.)
- **No barrel `index.ts`** under `frontend/src/components/ui/` — consumers import the file directly (`import { ColorPicker } from '@/components/ui/ColorPicker'`).
- **Conventions confirmed:** `forwardRef` + **named function expression** 2nd arg; **no `.displayName`** anywhere in `ui/`; `cn(BASE, …, className)` with caller class **last** (tailwind-merge wins); module-level style-string constants; tagged file-header comment; named export only, no default export; tokens-only for chrome; **4-space indent** in `.tsx`.
- **Test harness:** `vitest` `globals:true` (`vite.config.ts`), but **siblings import explicitly** (`import { describe, it, expect, vi } from 'vitest'`); `@testing-library/react` `render`/`screen`/`fireEvent` only (**no `user-event` anywhere**); jest-dom matchers loaded **globally** by `test-setup.ts:2`; `PointerEvent` + `ResizeObserver` polyfills already in `test-setup.ts`. Radix **Popover opens on `click`** (not `pointerDown`); Escape-close via `fireEvent.keyDown(document.body, { key: 'Escape' })`; token assertions via `className.toContain(...)`.
- **Hidden coupling:** `.dark` lives on `<html>` (documentElement) and is **load-bearing** for body-portal'd content — do **not** re-scope it per-instance (`Tooltip.tsx:7-10` documents this invariant). `verbatimModuleSyntax: true` → `import type` mandatory for type-only imports (the plan's code already complies). `noUncheckedIndexedAccess: true` → use `!` when indexing `mock.calls[i]`.
- **Quality gates (corrected — there is NO `npm run lint` script):** from `frontend/` run `npm test` (vitest run) + `npm run typecheck` (`tsc --noEmit`); ESLint is configured at **repo root** (`eslint.config.js`, applies to `frontend/src/**`) and run via `npx eslint` (no frontend-local lint script).
- **Prior art:** `LabelManager.tsx` is the **only** runtime usage of `react-colorful` (`HexColorPicker`/`HexColorInput` + a static swatch span). No standalone `ColorPicker`, no `normalizeHex`/`validHex` helpers exist today. This deliverable formalizes that ad-hoc pattern; **wiring it in is DEL-02 (out of scope).**

---

## Parallelization Strategy

### Batch model

This is a small, **tightly coupled** 2-file deliverable. The two files share an
**import dependency** (`ColorPicker.test.tsx` imports the named `ColorPicker`
export from `ColorPicker.tsx`), so they must be authored and merged **strictly
sequentially** — T1 first, then T2. They touch **disjoint files**, so there is no
merge-conflict surface; the ordering exists purely because T2 cannot compile/run
green until T1's module exists and exports the agreed API.

> ⚠️ Delegate rule applied: *"one task's output being another's input → run
> sequentially."* T1's output (the `ColorPicker` named export + props shape) is
> T2's input.

### Visual batch diagram

```
                 ┌──────────────────────────┐
   Batch 1      │  T1 — ColorPicker.tsx     │   (single file, no deps)
                 └────────────┬─────────────┘
                              │  merges first (T2 needs the module)
                              ▼
                 ┌──────────────────────────┐
   Batch 2      │  T2 — ColorPicker.test.tsx│   depends on T1
                 └────────────┬─────────────┘
                              │  merges; then run full suite
                              ▼
                 ┌──────────────────────────┐
   Final gate    │  Integration QA          │   npm test + typecheck + eslint
                 │  (light & dark manual)   │   not a dev task — merge rule
                 └──────────────────────────┘
```

### Merge-order rules

1. **Batch 1 (T1) must merge before Batch 2 (T2) starts.** T2 imports
   `./ColorPicker`; without T1's file the test cannot compile. The API contract
   between the two (props, `aria-label` defaults `'Color'` / `'Hex color'`, class
   tokens `SWATCH_BASE`/`CONTENT_BASE`/`INPUT_BASE`, named export `ColorPicker`)
   is fully pinned in both task specs below, so once T1 lands the T2 author needs
   no further coordination.
2. **Batch 2 (T2) merges only when its 8 tests pass green** against the merged T1.
3. **Final gate (not a separate task):** after both merge, run the full
   `frontend/` suite + typecheck + root eslint, and do the manual light/dark QA
   (swatch fill, open-on-click, live hex update, Enter/Space open, Escape +
   outside-click close, focus enter/return). No PR ships until this passes.
4. Each task is committed **per task** (conventional message referencing DEL-01);
   no push/merge/rebase except by the human.

### Summary table

| # | Batch | Target File | Dependencies | Can Parallel With |
|---|-------|-------------|--------------|-------------------|
| T1 | 1 | `frontend/src/components/ui/ColorPicker.tsx` (new) | None | — (sole task in Batch 1) |
| T2 | 2 | `frontend/src/components/ui/ColorPicker.test.tsx` (new) | T1 | — (sole task in Batch 2) |

> Note: because the two files form a compile-time dependency chain, there is no
> true intra-batch parallelism here. "Parallelism" is realized instead as **prep
> overlap** — see the developer tracks below.

### Developer assignment tracks

- **Track A — Author (owns the build path):** T1 → T2 → final QA. Best for a
  single React/TS developer who knows the `ui/` conventions. This is the
  recommended path given the tight coupling.
- **Track B — Reviewer/prep (parallel to T1):** while Track A writes T1, a second
  developer reads `DatePicker.test.tsx` / `Select.test.tsx` / `Button.test.tsx`,
  stubs the 8 test cases against the pinned API, and **waits** for T1 to merge
  before finalizing/wiring T2. This front-loads the test design without touching
  the shared import until it exists.
- **Track C — QA (parallel from Batch 2):** once T1 lands, prepares the manual
  light/dark scratch-render checklist and runs it against the merged component.

Because T1 and T2 are two files with a hard import dependency, in practice this
deliverable is a **single linear track (A)**; tracks B/C are optional accelerants.

---

## Task T1 — Create `ColorPicker` primitive component

**Batch:** 1 · **Layer:** Frontend (UI primitive) · **Dependencies:** None

### Description

Create **one new file**: `frontend/src/components/ui/ColorPicker.tsx`. It is a
single, self-contained, **controlled** UI primitive: a swatch `<button>` (filled
with the current hex value) that opens a Radix `Popover` containing the
`react-colorful` square picker plus a hex text field, both bound to the same
`value`/`onChange`. It collapses the ad-hoc `HexColorPicker` + static swatch in
`LabelManager.tsx` into one reusable, theme-consistent control.

This is foundational and **not wired into `LabelManager`** (that is DEL-02) and
touches **no** backend, schema, or API.

**Reference conventions to mirror (read before writing):**
- `frontend/src/components/ui/DatePicker.tsx` — canonical Radix `Popover`
  wrapper; mirror the `PopoverPrimitive.Portal` → `PopoverPrimitive.Content`
  block, `sideOffset`/`align`, and the popover-chrome token string. Use
  **uncontrolled** `open` (no `useState`), unlike DatePicker's controlled view
  state.
- `frontend/src/components/ui/Button.tsx` — the module-level `BASE_CLASSES`
  string pattern, the house focus ring
  (`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`),
  and the `cn(BASE, …, className)` last-wins ordering. Sizes are `sm|md|lg` only
  — **do not** add a Button `icon` size.
- `frontend/src/components/ui/cn.ts` — `cn(...inputs)` = `twMerge(clsx(inputs))`.
- `frontend/src/components/ui/Tooltip.tsx:7-10` — the **portal-dark invariant**
  (`.dark` on `<html>` makes body-portal'd content resolve tokens).
- `frontend/src/components/LabelManager.tsx` (lines 5, 17, 91-96, 118-128) — the
  exact `react-colorful` contract to reproduce: `<HexColorPicker color={value} onChange={onChange} />`
  and `<HexColorInput color={value} onChange={onChange} prefixed=… />`, both
  sharing `value`/`onChange`; `onChange` already emits a `#`-prefixed hex.

**Exact imports (only these four sources — anything else violates "no new dep"):**
```tsx
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { HexColorPicker, HexColorInput } from 'react-colorful';
import { cn } from './cn';
```
(`verbatimModuleSyntax` is on → keep `ComponentPropsWithoutRef`/`ElementRef` as
`type`-qualified. Relative `'./cn'` import matches siblings, not the `@/` alias.)

**Props interface — controlled only (no internal default-color state):**
```tsx
export interface ColorPickerProps
    extends Omit<
        ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>,
        'defaultOpen' | 'open' | 'onOpenChange' | 'modal' | 'children'
    > {
    /** Controlled color value, a #RRGGBB hex string. */
    value: string;
    /** Emitted with the new #RRGGBB hex whenever the picker or input changes it. */
    onChange: (hex: string) => void;
    /** Accessible name for the swatch trigger button. */
    'aria-label'?: string;
    /** Optional id forwarded onto the hex <input> for external label association. */
    id?: string;
    /** Show the leading '#' in the hex field (display only). Default: true. */
    prefixed?: boolean;
    /** Classes applied to the swatch trigger (merged after defaults so caller wins). */
    className?: string;
    /** Classes applied to the popover content panel (merged after defaults). */
    contentClassName?: string;
}
```

**Module-level style constants (token-only chrome; raw inline style for the fill):**
```tsx
const SWATCH_BASE =
    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border ' +
    'cursor-pointer transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

const CONTENT_BASE =
    'z-50 flex w-auto flex-col gap-2 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md';

const INPUT_BASE =
    'w-40 rounded border border-input bg-background px-2 py-1 text-sm text-foreground ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const DEFAULT_SWATCH_LABEL = 'Color';
```
(`border-border` gives a visible edge around light/white fills; the fill itself
is the raw `value` via inline `style` — intentionally **not** a token, since it
is an arbitrary user color.)

**Component body (named export, `forwardRef` + named fn expression, no
`.displayName`, ref → the Trigger `<button>`):**
```tsx
export const ColorPicker = forwardRef<
    ElementRef<typeof PopoverPrimitive.Trigger>,
    ColorPickerProps
>(function ColorPicker(
    {
        value,
        onChange,
        'aria-label': ariaLabel = DEFAULT_SWATCH_LABEL,
        id,
        prefixed = true,
        className,
        contentClassName,
    },
    ref,
) {
    return (
        <PopoverPrimitive.Root>
            {/* The swatch IS the trigger: a real <button>, keyboard-activatable,
                filled with the raw value via inline style (not a token). */}
            <PopoverPrimitive.Trigger
                ref={ref}
                aria-label={ariaLabel}
                style={{ backgroundColor: value }}
                className={cn(SWATCH_BASE, className)}
            />
            {/* Portal to document.body so it renders above the settings layout and
                inherits .dark from <html>. */}
            <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content
                    sideOffset={4}
                    align="start"
                    className={cn(CONTENT_BASE, contentClassName)}
                >
                    <HexColorPicker color={value} onChange={onChange} className="size-44" />
                    <HexColorInput
                        id={id}
                        color={value}
                        onChange={onChange}
                        prefixed={prefixed}
                        aria-label="Hex color"
                        spellCheck={false}
                        className={cn(INPUT_BASE)}
                    />
                </PopoverPrimitive.Content>
            </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
    );
});
```

**Non-negotiable implementation rules:**
1. **Controlled only.** `value` + `onChange` are required. No `defaultValue`, no
   internal default color, no `useState`. (A caller wanting a default must seed
   `value` — e.g. `LabelManager`'s `DEFAULT_COLOR = '#6B7280'`.)
2. **Uncontrolled open state.** Do **not** pass `open`/`onOpenChange` — Radix
   manages open/close (Escape + outside-click come free from its dismissable
   layer).
3. **`onChange` is always `#`-prefixed** regardless of `prefixed` (that's how
   `react-colorful` emits). `prefixed` affects only the **display** of the hex
   field. Do not add normalization; do not rename `onChange`.
4. **Do not** add a `.displayName` (no sibling does) and do **not** create a
   barrel `index.ts`.
5. Open the file with a tagged header comment, e.g.
   `// DEL-01 — ColorPicker primitive.` (every sibling has one).
6. **4-space indent** in the `.tsx`.

### Acceptance Criteria

- [ ] New file `frontend/src/components/ui/ColorPicker.tsx` exists with a `DEL-01` header comment.
- [ ] **Controlled API:** named export `ColorPicker` with `value: string` + `onChange: (hex: string) => void`; **no `useState`**, no `defaultValue`, no internal default color.
- [ ] **Swatch is a `<button>` filled with `value`:** the Radix Trigger renders a native `<button>` whose `style={{ backgroundColor: value }}` reflects the current value.
- [ ] **Popover contains both** the `react-colorful` square picker and the hex field (`aria-label="Hex color"`), both bound to `color={value}` / `onChange={onChange}`.
- [ ] **`onChange` emits a `#`-prefixed hex** from the hex field regardless of `prefixed` (e.g. typing `ff0000` → callback receives `'#ff0000'`).
- [ ] **Keyboard-focusable trigger:** the Trigger renders `tagName === 'BUTTON'` (native tab-focus + Enter/Space activation, Radix-managed).
- [ ] **Portals to `document.body`:** `<PopoverPrimitive.Portal>` wraps `<Content>` (default Portal target) so content renders above the settings layout.
- [ ] **Theme tokens for chrome only:** `CONTENT_BASE`/`INPUT_BASE`/`SWATCH_BASE` use `bg-popover`, `text-popover-foreground`, `border-border`/`border-input`, `bg-background`, `text-foreground`, `ring-ring`; no raw hex in class strings; light **and** dark resolve via `.dark` on `<html>`.
- [ ] **`forwardRef` + `cn()` convention:** `forwardRef` with named function expression; `cn(SWATCH_BASE, className)` and `cn(CONTENT_BASE, contentClassName)` with caller class last; no `.displayName`; no default export; no barrel `index.ts`.
- [ ] **No new npm dependency:** imports limited to `@radix-ui/react-popover`, `react`, `react-colorful`, `./cn`; no `package.json`/lockfile change.
- [ ] **Quality gates pass from `frontend/`:** `npm run typecheck` (`tsc --noEmit`) is clean; `npx eslint` (repo root, `frontend/src`) is clean.

### Dependencies

None (Batch 1, first task).

---

## Task T2 — Create `ColorPicker` unit tests

**Batch:** 2 · **Layer:** Frontend (test) · **Dependencies:** T1

### Description

Create **one new file**: `frontend/src/components/ui/ColorPicker.test.tsx` — a
vitest + React Testing Library suite of exactly **8** test cases mirroring the
conventions of `DatePicker.test.tsx`, `Select.test.tsx`, and `Button.test.tsx`.
The suite must pass green under `npm test` (vitest run) from `frontend/` with
**no** new test infrastructure, polyfills, deps, or config changes.

**Nothing else is touched** — no edits to `test-setup.ts`, `vite.config.ts`,
`package.json`, `tsconfig`, or any sibling test.

**Test-harness conventions to mirror exactly (verified against `vite.config.ts`,
`test-setup.ts`, and the sibling suites):**
- Imports, top of file:
  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen, fireEvent } from '@testing-library/react';
  import { createRef } from 'react';
  import { ColorPicker } from './ColorPicker';
  ```
  - Explicit `vitest` import even though `globals:true` (siblings import
    explicitly — match them).
  - **No `@testing-library/user-event`** anywhere in the repo — use `fireEvent`
    only.
- jest-dom matchers are loaded **globally** by `test-setup.ts:2` — do **not**
  re-import them.
- Polyfills already present — do **not** re-add: `PointerEvent`
  (`test-setup.ts`), `ResizeObserver` (`test-setup.ts`). No
  `matchMedia`/`IntersectionObserver`/`getBoundingClientRect` polyfill needed.
- **Open the Radix Popover with `fireEvent.click(trigger)`** — NOT `pointerDown`
  (Popover binds `onClick → onOpenToggle`; `DatePicker.test.tsx:8-10,51-52`
  documents this exact distinction).
- **Close with `fireEvent.keyDown(document.body, { key: 'Escape' })`** (Radix
  `DismissableLayer` listens on `document.body`).
- **Token assertions via `expect(el.className).toContain('bg-popover')`** etc.
  (jsdom cannot compute CSS — assert class names, never computed styles;
  `Select.test.tsx:127-145`).
- **`noUncheckedIndexedAccess` is on** → apply `!` when indexing `mock.calls`
  (e.g. `onChange.mock.calls[0]![0]`).
- Open with a tagged header comment + section comments mirroring the siblings
  (e.g. `Select.test.tsx:1-9`). Note in the header that Radix-managed
  interactions are delegated, not asserted.

**Shared helpers (mirror `DatePicker.test.tsx`'s `render…`/`openPicker` pair):**
```tsx
function renderPicker(overrides?: {
    value?: string;
    onChange?: (hex: string) => void;
    'aria-label'?: string;
    className?: string;
}) {
    const onChange = overrides?.onChange ?? vi.fn();
    render(
        <ColorPicker
            value={overrides?.value ?? '#6b7280'}
            onChange={onChange}
            aria-label={overrides?.['aria-label'] ?? 'Pick color'}
            className={overrides?.className}
        />,
    );
    return { onChange };
}
function getTrigger(name = 'Pick color') {
    return screen.getByRole('button', { name });
}
function openPicker(name = 'Pick color') {
    const trigger = getTrigger(name);
    fireEvent.click(trigger); // Popover opens on CLICK, not pointerDown.
    return trigger;
}
```

**The 8 test cases (one `it` each, inside `describe('ColorPicker', …)`):**

1. **Renders a swatch button reflecting `value`.** `renderPicker({ value: '#6B7280', 'aria-label': 'Pick color' })`;
   `screen.getByRole('button', { name: 'Pick color' })` is in the document and its
   inline `style.backgroundColor` (lower-cased) contains the hex. (The accessible
   name is the `aria-label` since the swatch has no text.)
2. **Token / className conventions.** `renderPicker()`; the trigger's `className`
   contains a focus-ring class (`focus-visible:ring`); after `openPicker()`, the
   content panel (walk up from the hex input via `closest('[class*="bg-popover"]')`
   or `document.querySelector`) has `className` containing `bg-popover` and
   `text-popover-foreground`.
3. **Opens on click** revealing the hex field: `openPicker()` then
   `screen.getByLabelText('Hex color')` is in the document.
4. **`onChange` fires `#`-prefixed from the hex field:** `renderPicker({ value: '#000000', onChange })`,
   `openPicker()`, `fireEvent.change(input, { target: { value: 'ff0000' } })`,
   `expect(onChange).toHaveBeenCalledWith('#ff0000')`.
5. **Swatch is keyboard-focusable:** `getTrigger().tagName === 'BUTTON'`.
6. **Closes on Escape:** `openPicker()`, assert hex input present, then
   `fireEvent.keyDown(document.body, { key: 'Escape' })`, then
   `expect(screen.queryByLabelText('Hex color')).toBeNull()`.
7. **`forwardRef` works:** `const ref = createRef<HTMLButtonElement>();`
   `render(<ColorPicker ref={ref} value="#6b7280" onChange={vi.fn()} aria-label="Pick color" />)`;
   `expect(ref.current).toBeInstanceOf(HTMLButtonElement)`.
8. **`className` override wins:** `renderPicker({ className: 'h-12 w-12' })`;
   `getTrigger().className` contains both `h-12` and `w-12` (proves `cn` /
   tailwind-merge ordering).

**Explicitly OUT of scope (do NOT unit-assert — Radix-managed, flaky in jsdom):**
Enter/Space-to-open, outside-pointerdown/outside-click close, roving focus / focus
trap, focus return to trigger, Tab order, and any computed color or popover
positioning. These belong in manual/visual QA per the plan.

### Acceptance Criteria

- [ ] New file `frontend/src/components/ui/ColorPicker.test.tsx` exists; **no other file modified** (no edits to `test-setup.ts`, `vite.config.ts`, `package.json`, `tsconfig`, or any sibling).
- [ ] **All 8 cases** present as distinct `it(...)` blocks inside one `describe('ColorPicker', …)`, matching the list above.
- [ ] **Conventions mirrored exactly:** explicit `vitest` import; `fireEvent` from `@testing-library/react` (no `user-event`); jest-dom via global setup (not re-imported); Popover opened with `fireEvent.click` (not `pointerDown`); closed with `fireEvent.keyDown(document.body, { key: 'Escape' })`; token assertions via `className.toContain(...)`; `mock.calls[i]![j]` non-null assertions where indexing.
- [ ] **No new test infra:** no new polyfills/deps/config (PointerEvent + ResizeObserver already present).
- [ ] **No Radix-managed behavior** (Enter/Space-open, outside-click, roving focus, focus return) is unit-asserted.
- [ ] **Green run:** `npm test` (vitest run) from `frontend/` passes all 8 cases **after** T1 (`ColorPicker.tsx`) exists and exports the controlled `ColorPicker`. (A missing component is an import-time failure, not a test bug — coordinate with T1 before reporting green.)

### Dependencies

**T1** (`ColorPicker.tsx`). The test imports `./ColorPicker`; it cannot compile
or run green until T1's module exists and exports the controlled `ColorPicker`
with the props/`forwardRef` shape pinned in T1.

---

## Final Integration Gate (merge rule, not a dev task)

After T1 and T2 both merge:
1. Run the full `frontend/` suite: `npm test`.
2. Run `npm run typecheck` (`tsc --noEmit`) from `frontend/`.
3. Run `npx eslint` from the **repo root** (covers `frontend/src/**`).
4. Manual QA in **light and dark** mode (scratch-render the component): swatch
   shows the current fill; click opens the popover above surrounding content;
   dragging the square and typing in the hex field both update the swatch live;
   Enter/Space open; Escape and outside-click close; focus enters the popover and
   returns to the swatch on close.
5. Confirm **no** `package.json`/lockfile change (no new dependency added).

No PR ships until all of the above pass.
