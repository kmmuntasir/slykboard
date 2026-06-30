# Task Breakdown — SLYK-07

**Ticket:** `docs/deliverables/SLYK-07.md`
**Plan:** `docs/deliverables/SLYK-07-plan.md`
**Type:** Bug — Dropdown Item Icon/Text Spacing
**Generated:** 2026-06-30

---

## Scope Decision (read first)

The plan's **Proposed Implementation §2** ("Consumers require no changes") and
**Out of Scope** explicitly exclude changes to `TopNav.tsx` and
`ProjectPicker.tsx`. Therefore this breakdown does **not** create a
"ProjectPicker redundant-`gap-2` cleanup" code task, even though the codebase
analysis found `ProjectPicker.tsx:152` already passes `className="gap-2"`
locally (making it a harmless, twMerge-deduped duplicate once the primitive
gains `gap-2`).

Removing that local class is a legitimate DRY follow-up, but it is a scope
addition the plan does not authorize. It is recorded below only as an
**Out-of-Scope Follow-up** for future consideration. The task set stays
faithful to the plan: one primitive edit + its test, then a verification gate.

The analysis also corrected a framing nuance in the plan: because
`ProjectPicker` rows already carry `gap-2` locally, they are a
**consistency/unification** beneficiary, not a visual-change beneficiary. The
only items that **visually** change are the TopNav profile-menu items
(Theme Light/System/Dark, Settings, Account Settings, Sign Out).

---

## Parallelization Strategy

This is a tiny, one-primitive bugfix. The work is smaller than the ceremony
parallelization would add, so the model is:

1. **Batch 1 — Build:** one task. The production edit (`Dropdown.tsx`) and its
   Vitest proof (`Dropdown.test.tsx`) ship together as a single task, single
   branch, single commit. They are one decision (assert `gap-2` ↔ insert
   `gap-2`) mechanically split across two files; splitting them across
   branches/PRs would create a phantom cross-branch contract with no
   merge-conflict benefit (the two files are disjoint). One developer.
2. **Batch 2 — Verify:** one read-only gate task. Depends on Batch 1. Confirms
   the automated gates (Vitest, Prettier) and the manual visual check across
   all dropdown consumers (jsDOM cannot compute layout, so the class assertion
   in Batch 1 proves presence, not rendered spacing).

**Merge-order rules:**
- Batch 1 merges **before** Batch 2 runs. Batch 2 has no value in isolation.
- No parallelization across batches. Within Batch 1 there is only one task.
- Repo policy: **Rebase and Merge** only; single commit on a single branch.

### Visual Dependency Diagram

```
                    SLYK-07  (one-token primitive fix + test)
                    │
                    ▼
        ╔════════════════════════╗
        ║  BATCH 1 · BUILD       ║   (1 task, 1 dev, 1 commit)
        ║  code + test           ║
        ╚════════════════════════╝
                    │
        ┌───────────┴────────────┐
        ▼                        ▼
  Dropdown.tsx :75        Dropdown.test.tsx
   + gap-2                 gap-2 table-driven assertion
   (only prod change)      (asserts the class [1] inserts)
        │                        │
        └───────────┬────────────┘
                    ▼
        ╔════════════════════════╗
        ║  BATCH 2 · VERIFY      ║   (read-only gate)
        ╚════════════════════════╝
                    │
        ┌───────────┼────────────┐
        ▼           ▼            ▼
   Vitest       Prettier     Manual QA
   green        clean        (Theme/Sign Out/
   (new +       (Dropdown.    ProjectPicker rows;
    regress)     tsx, .test)  trailing Check ml-auto)
                    ▼
                 PR · Rebase & Merge
```

### Summary Table

| # | Batch | Target File | Dependencies | Can Parallel With |
|---|-------|-------------|--------------|-------------------|
| 1 | 1 · Build | `frontend/src/components/ui/Dropdown.tsx` (`:75`) + `frontend/src/components/ui/Dropdown.test.tsx` | None — root-cause task. | — (sole task in batch) |
| 2 | 2 · Verify | (read-only) `npm run dev`, `npm test`, Prettier | Task 1 merged | — |

### Developer Assignment Tracks

**Recommendation: 1 developer, end to end.**

```
Track A (sole) ── Dev-1 ──┬─► Task 1  Dropdown.tsx + Dropdown.test.tsx   (~25 min)
                          └─► Task 2  Verify (Vitest + Prettier + QA)     (~15 min)
                          Total ≈ 40 min, 1 branch, 1 commit, 1 PR.
```

No second track. A second developer would spend more time syncing the
trivial one-line primitive than doing the work.

---

## Tasks

### Task 1 — Add `gap-2` to the shared `DropdownItem` primitive + extend test coverage

**Batch:** 1 · Build
**Dependencies:** None (root-cause task; downstream verification depends on this)

#### Description

Root-cause fix for the icon/text crowding reported in SLYK-07, plus the
unit-test proof. Both edits ship together so the task is green in isolation.

**Edit 1 — primitive** (`frontend/src/components/ui/Dropdown.tsx:75`).

The `DropdownItem` base class string declares `flex items-center` but **no
gap**, so adjacent flex children (a bare `<Icon className="h-4 w-4">` + a
`<span>` text label + optional trailing `<Check className="ml-auto h-4 w-4">`)
abut with zero space. Children pass through `{...rest}` verbatim — the
primitive injects no spacing. Add `gap-2` to the flex row:

```diff
             className={cn(
-                'relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5',
+                'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5',
                 'text-sm outline-none transition-colors',
                 'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                 ITEM_VARIANT_CLASSES[variant],
                 className,
             )}
```

Spacing-value rationale (confirmed by analysis):
- `gap-2` is the **dominant menu/list-row convention** in this codebase
  (`frontend/src/components/LabelMultiSelect.tsx:72` uses the exact
  `flex items-center gap-2` idiom; `gap-1.5` is reserved for tight
  label+control pairs, not menu rows).
- `cn` (`frontend/src/components/ui/cn.ts`) is `twMerge(clsx(...))`, so a
  caller-supplied `gap-*` cleanly overrides the base; no regression risk for
  any consumer.
- Trailing `Check` rows keep `ml-auto` (`TopNav.tsx:317,322,327`;
  `ProjectPicker.tsx:181`), so `gap-2` only affects the left cluster — the
  right-pinned indicator is unaffected.
- Text-only items (`ProjectPicker` empty-state / "Create project", existing
  test items) are a single flex child → `gap-2` is inert. No regression.
- The `destructive` variant (`variant="destructive"`, used by Sign Out) only
  adds color classes via `ITEM_VARIANT_CLASSES`; `gap-2` lives on the base
  string and applies equally.
- Tailwind v4: `gap-2` is part of the default scale generated by
  `@import 'tailwindcss';` (`frontend/src/index.css:1`); no config change
  (there is no `tailwind.config.*` file).

**Edit 2 — test coverage** (`frontend/src/components/ui/Dropdown.test.tsx`).

Add a table-driven `it(...)` inside the existing `describe('Dropdown', ...)`
block, asserting the rendered item's `className` always contains `gap-2`
across child compositions. jsDOM does not compute layout, so the class string
is the assertion target — matching the existing class-substring assertions
already used in this file (`text-destructive`, `bg-popover`).

```tsx
it('item base class carries gap-2 across child compositions (SLYK-07)', () => {
    const cases: Array<{ name: string; children: React.ReactNode; variant?: 'destructive' }> = [
        { name: 'icon + span', children: [<Sun key="i" className="h-4 w-4" />, <span key="t">Light</span>] },
        {
            name: 'icon + span + trailing Check',
            children: [
                <Monitor key="i" className="h-4 w-4" />,
                <span key="t">System</span>,
                <Check key="c" className="ml-auto h-4 w-4" />,
            ],
        },
        { name: 'span only', children: <span>Plain text</span> },
        {
            name: 'destructive icon + span',
            children: [<LogOut key="i" className="h-4 w-4" />, <span key="t">Sign out</span>],
            variant: 'destructive',
        },
    ];
    for (const { name, children, variant } of cases) {
        const { unmount } = render(
            <Dropdown>
                <DropdownTrigger>Open</DropdownTrigger>
                <DropdownContent>
                    <DropdownItem variant={variant}>{children}</DropdownItem>
                </DropdownContent>
            </Dropdown>,
        );
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Open' }), { button: 0 });
        const item = screen.getByRole('menuitem');
        expect(item.className, `case: ${name}`).toContain('gap-2');
        unmount();
    }
});
```

Add the icon imports alongside the existing `./Dropdown` import. Match the
repo's existing import style (exact-only imports preferred — trim to the icons
actually referenced: `Sun, Monitor, LogOut, Check`):

```diff
 import { describe, it, expect, vi } from 'vitest';
 import { render, screen, fireEvent } from '@testing-library/react';
+import { Sun, Monitor, LogOut, Check } from 'lucide-react';
 import {
```

> The test relies on the project's existing jsdom setup
> (`frontend/vite.config.ts`, `frontend/src/test-setup.ts` — polyfills
> `PointerEvent` and `ResizeObserver` for Radix) — no new setup required.
> Match the `screen.getByRole('menuitem', …).className` pattern already
> established in this file. Indent 4 spaces (`.tsx` per `.prettierrc.json`),
> `printWidth: 100`.

#### Acceptance Criteria

- [ ] `frontend/src/components/ui/Dropdown.tsx:75` base class string contains
      `gap-2` (single-token addition; no other class changes).
- [ ] `cn` import, `ITEM_VARIANT_CLASSES`, and the `variant` + `className`
      merge order are untouched.
- [ ] No consumer files are modified in this task (`TopNav.tsx`,
      `ProjectPicker.tsx` untouched).
- [ ] New table-driven `it(...)` added inside `describe('Dropdown', ...)`;
      all 4 cases render and assert `gap-2`.
- [ ] Existing `Dropdown.test.tsx` tests still pass (trigger render,
      pointerDown open, Escape close, onSelect fire, destructive variant,
      `bg-popover`, default sideOffset).
- [ ] `npm test -- frontend/src/components/ui/Dropdown.test.tsx` is green.
- [ ] `npx prettier --check frontend/src/components/ui/Dropdown.tsx
      frontend/src/components/ui/Dropdown.test.tsx` is clean.

#### Dependencies

None.

---

### Task 2 — Verify dropdown spacing fix (Vitest + Prettier + manual QA gate)

**Batch:** 2 · Verify
**Dependencies:** Task 1 (the `gap-2` primitive change + new assertions) must
be complete and committed before this task runs.

#### Description

Read-only verification gate — **no code changes**. Confirms the Batch 1 fix is
visually correct across all dropdown consumers and that the automated gates
are green.

Manual visual verification is genuinely required: jsDOM cannot compute
layout/spacing, so the Batch 1 class assertion only proves the class is
present, not that it renders correctly. A human/agent must eyeball the
rendered dropdown to satisfy the ticket's "show clear, consistent icon-to-text
spacing" criterion.

#### Acceptance Criteria

- [ ] **Vitest green.** Run `npm test` in `frontend/`; all tests pass,
      including the new `gap-2` assertion(s) added in Task 1 in
      `frontend/src/components/ui/Dropdown.test.tsx`. Run the
      `TopNav`/`ProjectPicker` test suites too to confirm no regressions.
- [ ] **Prettier clean.** `npx prettier --check` (or the project's
      format-check script) reports no unformatted files for the touched
      `frontend/src/components/ui/Dropdown.tsx` and `Dropdown.test.tsx`.
- [ ] **Manual visual — TopNav profile dropdown.** Run `npm run dev` in
      `frontend/`, open the profile dropdown, and confirm:
  - [ ] Theme rows (Light / System / Dark) show clear, comfortable
        icon-to-text spacing (icon no longer abuts the text).
  - [ ] Sign Out row (destructive) shows the same icon-to-text spacing.
  - [ ] Settings and Account Settings rows are consistently spaced with the
        rows above.
- [ ] **Manual visual — trailing indicators.** The active theme row's
      trailing `Check` remains pinned to the right edge (`ml-auto` intact);
      `gap-2` did not displace it.
- [ ] **Manual visual — ProjectPicker.** Open the ProjectPicker dropdown;
      confirm per-project rows (ColorDot + FolderKanban icon + `<span>` name
      + optional `Badge` + trailing `Check`) are consistently spaced and that
      trailing `Check`/`Badge` positioning is unchanged (these rows already
      had `gap-2` locally, so they should be byte-identical — this is the
      regression check).

#### Dependencies

Task 1.

---

## Out-of-Scope Follow-up (not a task in this breakdown)

- **ProjectPicker local `gap-2` dedup.** `frontend/src/components/ProjectPicker.tsx:152`
  passes `className="gap-2"` on its per-project `DropdownItem`. Once the
  primitive carries `gap-2` (Task 1), this local class becomes a redundant,
  twMerge-deduped duplicate. Removing it restores a strict single source of
  truth. It is **not** included as a task here because the plan's Out of Scope
  explicitly excludes consumer-component changes; file a separate enhancement
  ticket if desired.

---

## Notes for the Implementer

- **Branch:** `bugfix/SLYK-07-dropdown-item-spacing` (per AGENTS.md naming:
  `type/SLYK-TICKET-hyphenated-description`; ticket number omitted from the
  slug body since it already prefixes the branch type — adjust to your team's
  exact convention if it requires `bugfix/SLYK-07-dropdown-item-spacing`).
- **Commit:** single-line, `SLYK-07: Add gap-2 to DropdownItem primitive`.
- **Merge policy:** Rebase and Merge only — no merge commits, no squash.
- **Role:** both tasks are frontend → assign to `react-coder` (or implement
  inline). Backend is untouched (frontend-only bugfix).
