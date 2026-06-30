# Implementation Plan — SLYK-07

**Ticket:** `docs/deliverables/SLYK-07.md`
**Type:** Bug
**Title:** Dropdown Item Icon/Text Spacing
**Generated:** 2026-06-30

---

## Summary

In the profile dropdown (TopNav), the Theme options (Light / System / Dark) and
the Sign Out row render a leading `lucide-react` icon immediately followed by a
`<span>` text label, but the icon and text sit too close together. This is
because the **shared** `DropdownItem` primitive lays out its children with
flexbox (`flex items-center`) but defines **no gap**, so adjacent children touch.

The fix is global: add a `gap-*` utility to the shared `DropdownItem` primitive
so **every** dropdown item (Theme options, Settings, Account Settings, Sign Out,
ProjectPicker rows, and any future items) gets consistent, comfortable
icon-to-text spacing. No consumer code changes are required.

## Root Cause

The shared dropdown item primitive is `DropdownItem` at
`frontend/src/components/ui/Dropdown.tsx:67-84`. It renders a Radix
`DropdownMenuPrimitive.Item` and applies a flex row layout:

```tsx
// frontend/src/components/ui/Dropdown.tsx:74-80
className={cn(
    'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5',
    'text-sm outline-none transition-colors',
    'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
    ITEM_VARIANT_CLASSES[variant],
    className,
)}
```

- `flex items-center` is present → children laid out as a centered flex row.
- **No `gap-*` utility** anywhere in the base or variant classes. Spacing is
  therefore left to callers, but consumers do not supply any (icons are passed
  bare with `className="h-4 w-4"` and text in a `<span>` with no margin), so the
  icon and text abut.

The icon+text convention is established entirely at the consumer level — the
primitive just renders `{...rest}` children verbatim. Affected production
consumers:

- `frontend/src/components/TopNav.tsx:314-347` — Theme Light/System/Dark,
  Settings, Account Settings, Sign Out (the items named in the ticket).
- `frontend/src/components/ProjectPicker.tsx:139-187` — per-project rows
  (`ColorDot` + `FolderKanban` icon + `<span>` name + `Badge` + trailing
  `Check`) also suffer the same crowding.
- `frontend/src/components/ui/Dropdown.test.tsx:22-27` — text-only children;
  unaffected visually but exercise the primitive.

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| UI primitive | `frontend/src/components/ui/Dropdown.tsx` | The single shared `DropdownItem` primitive where the missing `gap-*` lives (`:67-84`, class string at `:75`). Fix target. |
| Consumer | `frontend/src/components/TopNav.tsx` | Profile menu: Theme options + Sign Out reported in the ticket (`:314-347`). Beneficiary, no change needed. |
| Consumer | `frontend/src/components/ProjectPicker.tsx` | Project rows reuse the same primitive (`:139-187`). Beneficiary, no change needed. |
| Test | `frontend/src/components/ui/Dropdown.test.tsx` | Existing test coverage for the primitive (`:22-27`); extend to assert spacing. |

## Proposed Implementation

### Frontend Changes

#### 1. Add `gap-2` to the shared `DropdownItem` primitive

- **File:** `frontend/src/components/ui/Dropdown.tsx`
- **What:** Add `gap-2` to the base item class string at line `:75`:
  ```diff
  - 'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5',
  + 'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5',
  ```
- **Why:** This is the root-cause fix. Adding `gap-2` to the flex row gives
  every multi-child item (icon + `<span>` + optional trailing `Check`) a
  consistent `0.5rem` gap, matching the project's dominant flex-row spacing
  convention. It applies globally to all `DropdownItem` usages, satisfying the
  ticket's "all dropdown items" acceptance criterion.
- **Code reference:** Builds on the existing `flex items-center` layout at
  `Dropdown.tsx:75`. Mirrors peer menu components:
  `frontend/src/components/ProjectPicker.tsx:152-176` and
  `frontend/src/components/ui/...` (`LabelMultiSelect.tsx:72`) which use
  `gap-2` for leading-icon menu rows.
- **Spacing choice rationale:** Tailwind v4 default spacing scale (no custom
  spacing defined in `frontend/src/index.css`). `gap-2` is the dominant
  generic-row value across the codebase; `gap-1.5` is reserved for tight
  label+control pairs. Menu items with a leading icon + text are closer to the
  generic-row case, so `gap-2` is the convention-correct pick. No arbitrary
  values (`gap-[x]`) are used anywhere in the project.

#### 2. (No-op confirmation) Consumers require no changes

- **Files:** `frontend/src/components/TopNav.tsx`,
  `frontend/src/components/ProjectPicker.tsx`
- **What:** None. The icon (`<Sun/Monitor/Moon/LogOut/... className="h-4 w-4">`)
  and `<span>` text are passed as direct children; the primitive now spaces them.
- **Why:** Keeps the fix in one place (the shared primitive) per DRY / single
  source of truth, and guarantees any future dropdown item inherits the spacing
  automatically.

## Edge Cases & Risks

- **Items with a trailing `Check` / `Badge` / `ColorDot`**: adding `gap-2`
  inserts spacing between *all* flex children, including between the text and a
  trailing indicator. The existing `ml-auto` on the trailing `Check`
  (`TopNav.tsx:317,322,327`) pushes it to the far right regardless, so `gap-2`
  only affects the left-cluster spacing — no visual regression expected. The
  `Badge` in `ProjectPicker.tsx` is positioned next to the project name and will
  gain a small consistent gap, which is desirable. Verify visually.
- **Text-only items** (`ProjectPicker` empty-state / "Create project",
  test items in `Dropdown.test.tsx`): a single text node is one flex child, so
  `gap-2` has no effect — no regression.
- **Destructive variant** (`variant="destructive"`, used by Sign Out): the
  variant only adds color classes via `ITEM_VARIANT_CLASSES`; `gap-2` is on the
  base string and applies equally. No regression.
- **No layout shift / width change**: `gap-2` is internal to the item and does
  not affect `DropdownContent` width or `px-2 py-1.5` padding. Low risk.
- **Tailwind v4**: `gap-2` is part of the default scale and is generated by
  `@import 'tailwindcss';` (`frontend/src/index.css:1`) — no config change
  needed (there is no `tailwind.config.*` file).

## Testing

*Follow project conventions — Vitest + Testing Library for frontend; co-locate
`*.test.tsx` next to source; one behavior per test.*

- **Unit test (visual/structural):** Extend
  `frontend/src/components/ui/Dropdown.test.tsx` to render a `DropdownItem` with
  an icon child + text child and assert both children are present and rendered
  in order. (jsDOM does not compute layout, so the `gap-2` class itself is the
  assertion target — assert the rendered element's `className` contains
  `gap-2`.)
- **Regression table (table-driven):** Render `DropdownItem` with several
  child compositions — `[icon, span]`, `[icon, span, trailingCheck]`,
  `[span only]`, `[destructive icon, span]` — and assert the base element
  always carries `gap-2`.
- **Manual verification:** Run the app (`npm run dev` in `frontend/`), open the
  TopNav profile dropdown, and confirm:
  - Theme rows (Light / System / Dark) and the Sign Out row show clear,
    consistent icon-to-text spacing.
  - ProjectPicker rows, Settings, and Account Settings rows are consistently
    spaced too.
  - Active theme row's trailing `Check` stays pinned to the right edge
    (`ml-auto` intact).

## Acceptance Criteria

- [ ] `DropdownItem` primitive at `frontend/src/components/ui/Dropdown.tsx`
      includes a `gap-2` utility in its base class string.
- [ ] Theme option rows (Light / System / Dark) and the Sign Out row in the
      TopNav profile dropdown show clear, consistent icon-to-text spacing.
- [ ] The fix applies globally — Settings, Account Settings, ProjectPicker
      rows, and any future `DropdownItem` usage all inherit the spacing.
- [ ] Trailing indicators (`Check`) and `Badge`s still position correctly
      (`ml-auto` intact); no layout regressions.
- [ ] Existing `Dropdown.test.tsx` tests still pass; new spacing assertion(s)
      added.

## Open Questions

None. The fix is unambiguous and the spacing value follows an established
codebase convention.

## Out of Scope

- Restructuring the primitive to model an explicit icon/label/trailing schema
  (e.g., `<DropdownItem icon={...} label={...} />`). The current "render bare
  children" design is preserved; only spacing is added.
- Changes to consumer components (`TopNav.tsx`, `ProjectPicker.tsx`) — they
  inherit the fix from the shared primitive.
- Any backend changes (frontend-only bugfix; this branch is based on the
  SLYK-06 branch).
- Accessibility / keyboard behavior changes (unaffected — only visual spacing).
