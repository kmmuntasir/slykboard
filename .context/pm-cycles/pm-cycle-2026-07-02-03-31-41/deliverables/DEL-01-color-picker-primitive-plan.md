# Implementation Plan — DEL-01

**Ticket:** `/.docs/ai-generated/pm-cycle-2026-07-02-03-31-41/deliverables/DEL-01-color-picker-primitive.md`
**Type:** Enhancement (frontend-only)
**Title:** `ColorPicker` UI primitive
**Generated:** 2026-07-02

---

## Summary

DEL-01 adds a single new, reusable, system-consistent **`ColorPicker`** UI
primitive under `frontend/src/components/ui/`. It is a **controlled** swatch
trigger that opens a Radix `Popover` containing the `react-colorful` square
picker plus a hex text field, both bound to the same `value`/`onChange`. It
collapses the ad-hoc inline `HexColorPicker` + static swatch currently living
inside `LabelManager.tsx` into one accessible, theme-consistent control that
every future color input can reuse.

This is **frontend-only** and **foundational** — it does **not** wire the
component into `LabelManager` (that is DEL-02) and touches **no** backend,
schema, or API. Both required dependencies — `react-colorful@^5.7.0` and
`@radix-ui/react-popover@^1.1.18` — are already installed (`frontend/package.json:25,20`),
so **no new npm dependency is added**. The component follows the exact
conventions of the existing `ui/` primitives: `forwardRef` + named function
expression, `cn()` className merging with the caller's `className` winning
last, named exports, semantic theme tokens, and a co-located `*.test.tsx`.

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| **New — primitive** | `frontend/src/components/ui/ColorPicker.tsx` | The new shared `ColorPicker` component (swatch trigger + popover content). |
| **New — tests** | `frontend/src/components/ui/ColorPicker.test.tsx` | Unit tests mirroring `DatePicker.test.tsx` conventions. |
| Reference | `frontend/src/components/ui/DatePicker.tsx` | Canonical Radix `Popover` wrapper to mirror (Portal+Content+Trigger). |
| Reference | `frontend/src/components/ui/Card.tsx`, `Tooltip.tsx`, `Button.tsx`, `Checkbox.tsx` | `forwardRef` + `cn()` conventions, token/focus-ring patterns. |
| Reference | `frontend/src/components/ui/cn.ts` | The `cn()` helper (named export) to import. |
| Reference | `frontend/src/components/LabelManager.tsx` | Existing inline `react-colorful` usage + static swatch pattern to supersede in DEL-02. |
| Reference | `frontend/src/index.css`, `main.tsx`, `test-setup.ts`, `vite.config.ts` | Theme tokens, app-root providers, and test harness (no edits). |

## Proposed Implementation

### Frontend Changes

#### 1. `frontend/src/components/ui/ColorPicker.tsx` (new file)

A single, self-contained, controlled component (not a multi-part compound like
`DatePicker`) — the ticket describes one cohesive control consumed as
`<ColorPicker value=… onChange=… />` in DEL-02.

**Imports (mirror `DatePicker.tsx:14-17`):**
```tsx
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { HexColorPicker, HexColorInput } from 'react-colorful';
import { cn } from './cn';
```

**Props shape — controlled only (ticket is explicit: "No internal default-color
state of its own"):**
```tsx
export interface ColorPickerProps
  extends Omit<ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>, 'defaultOpen' | 'open' | 'onOpenChange' | 'modal' | 'children'> {
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

Rationale: `value`/`onChange` (NOT `onValueChange`) is the API the ticket
specifies and exactly matches how `LabelManager` already drives
`react-colorful` (`LabelManager.tsx:91-96,118-128`). Open/close state is left
**internal to Radix `Popover.Root`** (uncontrolled `open`) — no `useState`
needed, and the ticket scopes out a default color.

**Component body:**
```tsx
const DEFAULT_SWATCH_LABEL = 'Color';

export const ColorPicker = forwardRef<ElementRef<typeof PopoverPrimitive.Trigger>, ColorPickerProps>(
  function ColorPicker(
    { value, onChange, 'aria-label': ariaLabel = DEFAULT_SWATCH_LABEL, id, prefixed = true, className, contentClassName },
    ref,
  ) {
    return (
      <PopoverPrimitive.Root>
        {/* The swatch IS the trigger: a real <button>, keyboard-activatable, filled with the raw value. */}
        <PopoverPrimitive.Trigger
          ref={ref}
          aria-label={ariaLabel}
          style={{ backgroundColor: value }}
          className={cn(SWATCH_BASE, className)}
        />
        {/* Portal to document.body so it renders above settings layout & inherits .dark from <html>. */}
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
  },
);
```

**Style constants (module-level strings, mirroring `Button.tsx:30-34` &
`DatePicker.tsx:92-111,131-134`):**

- `SWATCH_BASE` — a compact rounded square button using the **house focus ring**
  (the ticket's design note says *not* to invent a new `Button` size; `Button`
  has only `sm|md|lg` — `Button.tsx:8-17`). E.g.:
  ```ts
  const SWATCH_BASE =
    'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border ' +
    'cursor-pointer transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
  ```
  The `border-border` gives a visible edge around light/white fills; the fill
  itself is the raw `value` via `style` (intentionally **not** a token, since
  it is an arbitrary user color — per the ticket's Theme note).

- `CONTENT_BASE` — the **house popover chrome** tokens, copied from
  `DatePicker.tsx:131-134` / `Select.tsx:189-192`:
  ```ts
  const CONTENT_BASE =
    'z-50 flex w-auto flex-col gap-2 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md';
  ```

- `INPUT_BASE` — match the existing `HexColorInput` styling in
  `LabelManager.tsx:91-96` but tokenized, e.g.
  `'w-40 rounded border border-input bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'`.

**Conventions checklist (all enforced by the existing `ui/` primitives):**
- `forwardRef<…>` with a **named function expression** second arg — no
  `.displayName` assignment (none of the siblings set one; the named fn supplies
  the DevTools name). Evidence: `Tooltip.tsx:46-51`, `Checkbox.tsx:13-17`,
  `DatePicker.tsx:108-111`.
- **Named export only**, no default export. No barrel `index.ts` exists and
  none should be created — consumers import directly as
  `import { ColorPicker } from '@/components/ui/ColorPicker'`.
- `cn(BASE, …, className)` with the caller's `className` **last** so
  `tailwind-merge` lets it override (`cn.ts:7-9`, `Button.tsx:35-41`).
- File opens with a tagged header comment (e.g. `// DEL-01 — ColorPicker primitive. …`), as every sibling does (`Button.tsx:1-4`, `Card.tsx:1-4`).
- Tokens only for chrome (`bg-popover`, `text-popover-foreground`,
  `border-border`, `ring-ring`) so light/dark both work via the `.dark` cascade
  on `<html>` (`index.css:6`, `ThemeProvider.tsx:80-89`).

**Behavior the build gets for free (do not hand-roll):**
- **Escape closes** the popover (`@radix-ui/react-dismissable-layer`,
  proven by `DatePicker.test.tsx:186-192`).
- **Outside-pointerdown closes** (same dependency).
- **Focus moves into the popover** on open and **returns to the trigger** on
  close (`@radix-ui/react-focus-scope`; Popover auto-focuses content).
- **Enter / Space opens** — the Trigger renders a native `<button>` and Radix
  binds `onClick → onOpenToggle`, so native button activation opens it.
- **Portal to `document.body`** — default `Portal` target; combined with `.dark`
  on `<html>` the portal'd content resolves dark tokens (`Tooltip.tsx:9-12`
  documents this as a load-bearing invariant).
- **`onChange` is always `#`-prefixed** regardless of `prefixed` —
  `react-colorful` emits `"#"+value`; `prefixed` affects only the **display**
  of the hex field. No new normalization needed; this matches the contract
  `LabelManager` already relies on (`LabelManager.tsx:43-47,60-65`).

#### 2. `frontend/src/components/ui/ColorPicker.test.tsx` (new file)

Mirror `DatePicker.test.tsx` exactly: vitest globals (no `describe`/`it` import
needed — `vite.config.ts:16-26` sets `globals:true`), `@testing-library/react`
`render`/`screen`/`fireEvent` (**no `user-event`** anywhere in the repo), and
`@testing-library/jest-dom` matchers imported globally by
`test-setup.ts:2`. The PointerEvent + ResizeObserver polyfills are already
installed (`test-setup.ts:11-14,19-25`).

**Test cases (map 1:1 to the ticket's acceptance criteria):**

1. **Renders a swatch trigger button reflecting the value.**
   `render(<ColorPicker value="#6B7280" onChange={vi.fn()} aria-label="Pick color" />)`,
   `getByRole('button', { name: 'Pick color' })` exists, and its inline style
   `backgroundColor` includes `#6B7280`.
2. **Token/className conventions.** Trigger `className` includes a focus-ring
   class; after opening, content `className` includes `bg-popover` (assert via
   `toContain('bg-popover')`, the repo's jsdom-safe approach — `Select.test.tsx:127-145`).
3. **Opens on click** revealing the picker + hex field:
   `fireEvent.click(trigger)` (Popover opens on click, not pointerDown —
   `DatePicker.test.tsx:8-10,51-52`), then assert the `HexColorPicker` and the
   hex input (`getByLabelText('Hex color')`) are in the document.
4. **`onChange` fires from the hex field** with a `#`-prefixed value:
   open, `fireEvent.change(input, { target: { value: 'ff0000' } })`, then
   `expect(onChange).toHaveBeenCalledWith('#ff0000')`.
5. **Swatch is keyboard-focusable & openable** — assert the trigger has
   `tagName === 'BUTTON'` (guarantees tab-focus + Enter/Space activation). Per
   repo convention, Radix-managed native-button activation / Arrow-key cycles
   are documented as Radix guarantees rather than re-asserted in jsdom
   (`Dropdown.test.tsx:54-58`, `Select.test.tsx:7-11`).
6. **Closes on Escape** — open, then
   `fireEvent.keyDown(document.body, { key: 'Escape' })`, assert the content is
   gone (`DatePicker.test.tsx:186-192`).
7. **`forwardRef` works** — `const ref = createRef<HTMLButtonElement>();`
   `render(<ColorPicker ref={ref} …/>)`; `expect(ref.current).toBeInstanceOf(HTMLButtonElement)`
   (`Button.test.tsx:54-57`).
8. **className override wins** — render with a custom `className`, assert it is
   present (proves `cn`/tailwind-merge ordering — `Button.test.tsx:59-64`).

> No `matchMedia`/`IntersectionObserver`/`getBoundingClientRect` polyfill is
> needed — these tests never mount `ThemeProvider`, and assertions target
> roles/text/className, never computed position or color (jsdom can't compute
> either) — consistent with `DatePicker.test.tsx`.

### Backend Changes

None. This deliverable is frontend-only.

## Edge Cases & Risks

- **Empty / invalid `value` (e.g. `''`, `'#XYZ'`):** pass `value` straight
  through with **no normalization** (the ticket explicitly keeps the existing
  label-layer contract — there is none today; `grep normalizeHex|validHex` = 0).
  `react-colorful` tolerates invalid input and reverts the field display on
  blur to the escaped `color` prop; the swatch `backgroundColor` simply renders
  whatever CSS does with the value (empty → no fill). This already happens in
  `LabelManager`'s edit row (`LabelManager.tsx:55-58,118-128`).
- **Controlled-only API:** there is no internal fallback color. A caller that
  wants a default must seed `value` (e.g. `LabelManager`'s
  `DEFAULT_COLOR = '#6B7280'`, `LabelManager.tsx:17`). Do **not** add
  `defaultValue`/uncontrolled support — out of scope and the ticket forbids
  internal default-color state.
- **Swatch fill is an arbitrary user color** via inline `style`, **not** a theme
  token — this is intentional per the ticket. Light fills need a visible border,
  hence `border-border` on the swatch base.
- **Portal/dark-mode coupling:** correctness in dark mode depends on `.dark`
  staying on `<html>` (not a wrapper div) so the body portal inherits it
  (`Tooltip.tsx:9-12`, `ThemeProvider.tsx:80-89`). The component relies on this;
  do not reintroduce it per-instance.
- **Radix-managed interactions in jsdom:** Enter/Space-to-open, outside-click,
  roving focus, and focus return are delegated to Radix and (per repo
  convention) verified in manual/visual QA, not unit-asserted. Keep unit tests
  to the click-open + Escape-close + onChange contract to stay green and
  deterministic (`Dropdown.test.tsx:54-58`).
- **No new dependency:** confirm the implementation imports only from
  `react-colorful`, `@radix-ui/react-popover`, `react`, and `./cn`. A
  `package.json`/lockfile change would violate an acceptance criterion.
- **Regression surface:** none — this is an additive new file; no existing file
  is modified. DEL-02 will later swap `LabelManager`'s inline usage over to
  this component.

## Testing

- **Unit tests** (`ColorPicker.test.tsx`): the 8 cases above — render & value
  reflection, token classes, click-open, `onChange` contract, keyboard-focusable
  trigger, Escape-close, `forwardRef`, `className` override.
- **Manual verification:** run the dev app in **light and dark** mode, mount
  `<ColorPicker>` in a scratch page (or temporarily in `LabelManager` behind a
  feature flag, reverted before merge), confirm: swatch shows the current fill;
  click opens the popover above surrounding content; dragging the square and
  typing in the hex field both update the swatch live; Enter/Space open;
  Escape and outside-click close; focus enters the popover and returns to the
  swatch on close.
- **HTTP / integration tests:** N/A (frontend-only, no network).
- **Quality gates:** `npm test` (vitest run) + the project's typecheck/lint from
  the frontend directory must pass.

## Acceptance Criteria

- [ ] `ColorPicker` exists under `frontend/src/components/ui/` with a
  controlled `value: string` / `onChange: (hex: string) => void` API and the
  `forwardRef` + `cn()` convention used by the other `ui/` primitives.
- [ ] The trigger is a clickable swatch (`<button>`) filled (inline style) with
  the current `value`.
- [ ] Opening the swatch reveals a popover containing the `react-colorful`
  square picker **and** a `HexColorInput`, both editing the same `value`.
- [ ] Editing either the picker or the hex field updates the controlled value
  and the swatch fill; `onChange` always emits a `#`-prefixed hex.
- [ ] The swatch is keyboard-focusable; the popover opens on Enter/Space,
  closes on Escape and on outside-click, and the hex field is keyboard-editable.
- [ ] The popover portals to `document.body` and renders above the settings
  layout.
- [ ] Chrome uses theme tokens (`bg-popover`, `text-popover-foreground`,
  `border-border`, `ring-ring`) and works in light **and** dark mode.
- [ ] **No new npm dependency** is added (`react-colorful` and
  `@radix-ui/react-popover` are the only externals used).
- [ ] Ships with `ColorPicker.test.tsx` covering render, value reflection,
  `onChange`, open/close, and keyboard (Escape) — following existing
  `ui/*.test.tsx` conventions.

## Out of Scope

- **Wiring `ColorPicker` into `LabelManager`** (create-row + edit-row) — that is
  **DEL-02**.
- **Color presets / palette** — explicitly not chosen (clarification Q1=A:
  free-form picker + hex field only).
- Any **backend, Drizzle schema, migration, or API** change.
- A `defaultValue`/uncontrolled mode — the ticket mandates controlled-only with
  no internal default-color state.
- Adding a new `Button` `icon` size — the design note rules this out; the
  swatch is its own small square with explicit padding.
