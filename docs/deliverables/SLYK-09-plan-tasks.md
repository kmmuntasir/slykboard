# Task Breakdown — SLYK-09

**Ticket:** `docs/deliverables/SLYK-09.md`
**Plan:** `docs/deliverables/SLYK-09.md` → `docs/deliverables/SLYK-09-plan.md`
**Type:** Enhancement — *Ticket Details Modal Full Width*
**Scope:** Frontend-only. No backend / DB / new dependencies.
**Generated:** 2026-06-30

---

## Goal

Make the ticket details modal (`TicketDetailModal`) span almost the full viewport on large screens — capped at `~min(95vw, 1400px)` — while preserving the existing `max-h-[90vh]` cap, vertical scroll, and close/Esc/backdrop behavior. Delivered by adding a new `'full'` width preset to the shared `Modal` and switching one prop on `TicketDetailModal`.

## Codebase Analysis (Phase 1 — verified via `analyst` delegations)

Plan references re-anchored to **actual** line numbers (the plan's line numbers were 2–7 too low):

| Plan claim | Reality | Notes |
|---|---|---|
| `ModalSize` union, "lines 10-16" | **`Modal.tsx:8`** — `type ModalSize = 'sm' \| 'md' \| 'lg' \| 'xl';` | Off by ~2 |
| `MODAL_SIZE_CLASS` Record, "10-16" | **`Modal.tsx:12-18`** (`xl` entry at line 16) | Off by ~2 |
| Panel base classes (`max-h-[90vh] w-full overflow-y-auto …`) | **`Modal.tsx:65`** (single literal inside `cn(...)`) | Off by ~7 |
| Backdrop `p-4` | **`Modal.tsx:52`** | Off by 4 |
| `size="xl"` in TicketDetailModal | **`TicketDetailModal.tsx:217`** | ✅ exact |
| `grid-cols-1 … lg:grid-cols-3` | **`TicketAttributeForm.tsx:92`** | ✅ exact |
| `lg:col-span-2` (left col) | **`TicketAttributeForm.tsx:95`** | Off by 2 |

**Critical coupling the plan understated:**
- `TicketAttributeForm` is shared by **two** consumers — `TicketDetailModal.tsx:222` **and** `CreateTicketModal.tsx:38`. The plan's step 4 says "other consumers of `TicketAttributeForm` (if any)" — **there is one** (`CreateTicketModal`). Any optional width constraint must therefore live in the Modal shell or a `TicketDetailModal`-scoped wrapper, **never** inside `TicketAttributeForm.tsx`.

**Prior art / patterns confirmed:**
- `cn()` utility at `frontend/src/components/ui/cn.ts` (clsx + tailwind-merge); used by `Modal.tsx:65`.
- `Record<ModalSize, string>` is **exhaustive** — adding a union member without a Record entry is a TS error (both edits are mandatory together).
- Arbitrary `max-w-[...]` precedent: `ProjectPicker.tsx:44` → `max-w-[10rem]`. Tailwind v4 via `@tailwindcss/vite` (`frontend/package.json`).
- `@theme inline` in `frontend/src/index.css:97-141` contains **only `--color-*` tokens** — no `--container-*` / `--breakpoint-*`. Default Tailwind v4 breakpoints + `max-w-*` scale are in effect.
- `Modal.test.tsx` **already** has a table-driven `describe('Modal size prop', …)` block (`~lines 107-138`) over a `sizeCases` array (`:108-113`) covering sm/md/lg/xl + default. **Extend it, don't duplicate it.**
- `TicketDetailModal.test.tsx` (~20 `it` blocks, `:169-396`) has **no** assertion about the rendered Modal's size — a genuine gap.
- Other `<Modal size=…>` call sites: `CreateTicketModal.tsx:36` (`xl`), `AddMemberModal.tsx:236` (`md`), `ConfirmDialog`/`ChecklistEditor`/`DeleteTicketConfirm`/`ConfirmDiscardDialog` use the default (`md`). All unaffected.

---

## Parallelization Strategy

### Batches (dependency order)

```
                            SLYK-09 — full-width details modal
┌──────────────────────────────────────────────────────────────────────────┐
│   BATCH 1  (Modal width primitive)                                       │
│   ┌─────────────────────────────┐                                        │
│   │ T1  Add 'full' preset        │                                        │
│   │     Modal.tsx:8 + :12-18     │                                        │
│   └──────────────┬──────────────┘                                        │
│                  │ enables                                               │
│                  ▼                                                       │
│   ┌─────────────────────────────┐                                        │
│   │ T2  Modal.test.tsx          │  ◀── depends on T1                     │
│   │     extend size table       │                                        │
│   └──────────────┬──────────────┘                                        │
└──────────────────┼───────────────────────────────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│   BATCH 2  (Wire the detail modal to the new width)                      │
│   ┌─────────────────────────────┐                                        │
│   │ T3  TicketDetailModal.tsx   │  ◀── depends on T1                     │
│   │     size="xl" → size="full" │                                        │
│   └──────────────┬──────────────┘                                        │
│                  ▼                                                       │
│   ┌─────────────────────────────┐                                        │
│   │ T4  TicketDetailModal.test  │  ◀── depends on T1 + T3                │
│   └──────────────┬──────────────┘                                        │
└──────────────────┼───────────────────────────────────────────────────────┘
                   │  VISUAL GATE (manual, ≥1400px + <1400px)
        ┌──────────▼──────────┐
        │ Is the form balanced?│
        └────┬──────────┬─────┘
             │YES       │NO (sprawls)
             ▼          ▼
        ┌──────────┐  ┌────────────────────────────────────────────┐
        │ SKIP T5  │  │ BATCH 3  (conditional balance guard)        │
        │ + T6;    │  │ T5  Guard — detail shell ONLY (never the    │
        │ record   │  │     shared TicketAttributeForm)             │
        │ decision │  │ T6  Extend Modal.test.tsx (only if T5 done) │
        └──────────┘  └─────────────────────────────────────────────┘
```

### Merge-order rules
1. **T1 must merge before T3** — hard: `size="full"` will not compile/type-check until the `'full'` union member + Record entry exist.
2. T2 can merge alongside T3 (disjoint files), but **after T1** (it asserts the new class string).
3. T4 merges after T1 **and** T3.
4. T5/T6 (Batch 3) are **conditional** on the manual visual gate. Skip and record the decision if the layout is balanced — do **not** implement speculatively.

### Summary table

| # | Batch | Target File | Dependencies | Can Parallel With |
|---|-------|-------------|--------------|-------------------|
| T1 | 1 | `frontend/src/components/Modal.tsx` | None | — (first) |
| T2 | 1 | `frontend/src/components/Modal.test.tsx` | T1 | T3 (different file) |
| T3 | 2 | `frontend/src/components/TicketDetailModal.tsx` | T1 | T2 |
| T4 | 2 | `frontend/src/components/TicketDetailModal.test.tsx` | T1, T3 | T5-prep |
| T5 | 3 | `Modal.tsx` (Strategy A) **or** `TicketDetailModal.tsx` (Strategy B) | T3 + visual gate; **skip if balanced** | T4 |
| T6 | 3 | `frontend/src/components/Modal.test.tsx` | T5; **skip if T5 skipped** | — |

> `TicketAttributeForm.tsx` is the **target file in NO task** — read-only verify only (hard invariant).

### Developer assignment tracks
- **Track A — Modal/shell owner** (width primitive + guard): **T1 → T2 → (visual gate) → T5 → T6**. Owns `Modal.tsx` + its test; avoids conflicts on the size-map / test table.
- **Track B — Detail-modal owner** (consume the width): **(after T1) T3 → T4**. Owns `TicketDetailModal.tsx` + its test. Fully parallel with Track A's T2 (disjoint files). If T5 uses Strategy B, Track B also lands the local wrapper.

---

# Tasks

## T1 — Add the `'full'` ModalSize width preset

**File:** `frontend/src/components/Modal.tsx`
**Batch:** 1
**Dependencies:** None (foundational).

### Description
Add a new `'full'` preset resolving to `max-w-[min(95vw,1400px)]` — a responsive cap: 95% of viewport width, never exceeding 1400px. Arbitrary-value Tailwind v4 syntax is already supported (no config change). The existing `max-h-[90vh] w-full overflow-y-auto` base classes (`Modal.tsx:65`) are untouched, so the panel still scrolls and stays fluid up to the cap. **Both edits are mandatory together** — `Record<ModalSize, string>` is exhaustive; adding the union member without the Record entry is a TS error.

**Edit 1 — union (`Modal.tsx:8`):**
```ts
type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';
```

**Edit 2 — Record (`Modal.tsx:12-18`), append entry after `xl`:**
```ts
const MODAL_SIZE_CLASS: Record<ModalSize, string> = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-[min(95vw,1400px)]',
};
```

Inert until T3 wires a consumer; no existing call site passes `'full'` today.

### Acceptance Criteria
- [ ] `Modal.tsx:8` union includes `'full'` as the last member.
- [ ] `MODAL_SIZE_CLASS` Record has `full: 'max-w-[min(95vw,1400px)]'`.
- [ ] `rtk tsc` / frontend build passes — exhaustive `Record` satisfied.
- [ ] Default `size='md'` behavior and all other consumers unchanged.
- [ ] No new imports, no config edits.

---

## T2 — Extend `Modal.test.tsx` size table with the `full` case

**File:** `frontend/src/components/Modal.test.tsx`
**Batch:** 1
**Dependencies:** T1 (asserts the new class string the `'full'` preset emits).

### Description
The existing table-driven `describe('Modal size prop', …)` block (`~Modal.test.tsx:107-138`) iterates a `sizeCases` array (`:108-113`) and asserts each size maps to its expected `max-w-*` class on the dialog. **Extend that array** with one row — do **not** add a separate test block (avoid duplication).

**Edit — `sizeCases` array (`Modal.test.tsx:108-113`), append after the `xl` row:**
```ts
        const sizeCases = [
            { size: 'sm', expected: 'max-w-md' },
            { size: 'md', expected: 'max-w-lg' },
            { size: 'lg', expected: 'max-w-2xl' },
            { size: 'xl', expected: 'max-w-4xl' },
            { size: 'full', expected: 'max-w-[min(95vw,1400px)]' },
        ] as const;
```

The existing `forEach` + per-case `it` (`~:115-122`) need **no changes** — they auto-generate `applies max-w-[min(95vw,1400px)] for size='full'` and assert `dialog.className` `toContain(expected)`. The bracketed class is emitted verbatim by `cn()`, so a literal substring match works.

### Acceptance Criteria
- [ ] `sizeCases` contains `{ size: 'full', expected: 'max-w-[min(95vw,1400px)]' }` as the last row.
- [ ] `as const` still valid; no edits to `forEach` / `it` template / the `defaults to max-w-lg` case.
- [ ] `npm test -- frontend/src/components/Modal.test.tsx` is green — new `applies max-w-[min(95vw,1400px)] for size='full'` case passes.
- [ ] All other existing Modal tests still pass (regression-free).

---

## T3 — Switch `TicketDetailModal` from `size="xl"` to `size="full"`

**File:** `frontend/src/components/TicketDetailModal.tsx`
**Batch:** 2
**Dependencies:** T1 (the `'full'` preset must exist or `size="full"` won't type-check).

### Description
The **core delivery** of the ticket. `TicketDetailModal` currently passes `size="xl"` at **`TicketDetailModal.tsx:217`** (single confirmed occurrence — grep finds exactly one `size=` in the file). Change that one prop value. Leave every other prop and the surrounding JSX untouched.

**Current (`TicketDetailModal.tsx:208-220`):**
```tsx
            <Modal
                isOpen
                onClose={requestClose}
                onEsc={requestClose}
                titleId="ticket-detail-title"
                title={modalTitle}
                blockBackdropClose={isDirty}
                size="xl"
            >
                {modalBody}
            </Modal>
```

**Change (line 217 only):**
```tsx
                size="full"
```

All other modals (`CreateTicketModal`, `AddMemberModal`, confirm dialogs) keep their current sizes — additive change.

### Acceptance Criteria
- [ ] `TicketDetailModal.tsx:217` reads `size="full"` (was `size="xl"`).
- [ ] No other prop on that `<Modal>` is modified (`isOpen`, `onClose`, `onEsc`, `titleId`, `title`, `blockBackdropClose`).
- [ ] Exactly one `size=` occurrence changed (grep confirms one match).
- [ ] No other file modified in this task.
- [ ] No other modal in the app is affected.

---

## T4 — Assert `TicketDetailModal` renders the `'full'` width preset

**File:** `frontend/src/components/TicketDetailModal.test.tsx`
**Batch:** 2
**Dependencies:** T1 (provides the preset + class string), T3 (makes `TicketDetailModal` pass `size="full"`).

### Description
`TicketDetailModal.test.tsx` (~20 `it` blocks, `:169-396`) has **no** size/width assertion. Add one `it` block that renders the modal via the existing `renderModal()` helper and asserts the rendered `[role="dialog"]` carries the `'full'` preset class. The file's established query is `screen.findByRole('dialog', { name: 'SLYK-101' })` (see `:171`); `Modal` merges the preset class into the dialog's `className` (`Modal.tsx:64-68`).

**New test (append within the existing `describe`, after the title test ~`:173`):**
```tsx
    it('renders the dialog at the full width preset (SLYK-09)', async () => {
        renderModal();
        const dialog = await screen.findByRole('dialog', { name: 'SLYK-101' });
        // 'full' preset from Modal.tsx → max-w-[min(95vw,1400px)] on the [role="dialog"] panel.
        expect(dialog).toHaveClass('max-w-[min(95vw,1400px)]');
        // Guard: the old 'xl' preset class must be gone.
        expect(dialog).not.toHaveClass('max-w-4xl');
    });
```

`toHaveClass` matches a single class token regardless of `cn()` ordering. The negative assertion locks in that the `xl → full` switch actually took effect. No new imports/mocks — `renderModal`, `screen`, and `expect.toHaveClass` (jest-dom) are already in scope.

### Acceptance Criteria
- [ ] A new `it(...)` asserts the `[role="dialog"]` from `findByRole('dialog', { name: 'SLYK-101' })` `toHaveClass('max-w-[min(95vw,1400px)]')`.
- [ ] The test also negatively asserts `not.toHaveClass('max-w-4xl')`.
- [ ] Test passes after T3; fails if `TicketDetailModal` reverts to `size="xl"`.
- [ ] Reuses `renderModal()` and the existing query pattern — no new imports/mocks.
- [ ] No other test in the file modified or removed.
- [ ] `npm test -- frontend/src/components/TicketDetailModal.test.tsx` is green.

---

## T5 — (CONDITIONAL) Visual-balance guard — detail-modal shell ONLY

**Batch:** 3
**Dependencies:** T3 **and** a manual visual gate at ≥1400px and <1400px. **Do not implement if the layout is already balanced** — default to skipping.

### Description
> ⚠️ **Conditional task.** Only implement if, post-T3, the `TicketAttributeForm` grid visibly *sprawls* at ~1400px (description textarea / metadata column uncomfortably wide). The 3-column grid already engages at `lg`=1024px, so widening mostly *enlarges* columns rather than reshaping — the **likely** outcome is "balanced." **Bias toward skipping.**

**Hard invariant:** `TicketAttributeForm.tsx` is shared by `TicketDetailModal.tsx:222` **and** `CreateTicketModal.tsx:38`. Any width constraint must live in the **Modal shell** or a **wrapper scoped to `TicketDetailModal` only** — **never** inside `TicketAttributeForm.tsx`. Verify `git diff -- frontend/src/components/TicketAttributeForm.tsx` is empty.

**Pick ONE strategy:**

| Strategy | File | Mechanism | Blast radius |
|---|---|---|---|
| **A — Modal opt-in prop (preferred)** | `Modal.tsx` | Add optional `balancedWidth?: boolean` (default `false`); when true wrap `{children}` in `<div className="mx-auto w-full max-w-5xl">`. Only `TicketDetailModal` passes it. | Additive; all other consumers default to current behavior. |
| **B — Local wrapper** | `TicketDetailModal.tsx` | Wrap the `<TicketAttributeForm>` render (`:222`) in `<div className="mx-auto w-full max-w-5xl">`. | Touches only the detail path; form file untouched. |

`max-w-5xl` (1024px) keeps the form body near the `lg` breakpoint where columns are proportionate, while the modal chrome (timer/time-log/activity feed) breathes at full width. Tunable — note the chosen value in the PR description.

### Manual visual verification checklist
**≥1400px (e.g. 1440 / 1920):**
1. Panel spans ~1400px, centered, gutter from backdrop `p-4` (`Modal.tsx:52`).
2. Form grid visibly capped — left col ~2/3 of the capped width, **not** of the full 1400px.
3. Right metadata column proportions match the 896px baseline; checklist scroll region (`lg:max-h-[70vh]`) still scrolls independently.
4. Timer / TimeLog / ActivityFeed remain full modal width (NOT capped) — confirms guard is form-scoped.
5. Sticky footer still spans modal; Cancel/Save clickable.

**<1400px (e.g. 1280 / 1024):**
6. Modal drops to ~95vw, no horizontal scrollbar.
7. Capped wrapper is a no-op (content already narrower than cap).
8. `lg:grid-cols-3` still engages at 1024px; below `lg` collapses to `grid-cols-1`.

**Functional regression (both widths):**
9. Esc / backdrop / close button work; `blockBackdropClose` (dirty form) still blocks backdrop close.
10. Whole-panel vertical scroll at 90vh intact.

### Acceptance Criteria
- [ ] `git diff -- frontend/src/components/TicketAttributeForm.tsx` is **empty**.
- [ ] `CreateTicketModal` and all other `Modal` consumers render identically to pre-T5 (Strategy A: default-`false`; Strategy B: no shared-file change).
- [ ] At ≥1400px the description textarea and metadata column no longer sprawl; columns read as they do today at 896px.
- [ ] `max-h-[90vh]` scroll + right-column `lg:overflow-y-auto` still work.
- [ ] If balanced without a guard → **close as "not needed"** and record the decision in the PR/commit body (e.g. `SLYK-09: skip T5, layout balanced at 1400px`).

---

## T6 — (CONDITIONAL) Tests for T5 — only if T5 is implemented

**File:** `frontend/src/components/Modal.test.tsx` (extend the T2 table-driven suite)
**Batch:** 3
**Dependencies:** T5. **Skip if T5 is skipped** (do not add dead tests).

### Description
If T5 chose **Strategy A** (`balancedWidth` prop), extend the T2 suite:
- Add a row: `balancedWidth={true}` → children wrapper class present (`mx-auto max-w-5xl`), base classes still applied.
- Add a row: `balancedWidth` omitted → no wrapper class (backward-compat lock).

If T5 chose **Strategy B** (local wrapper in `TicketDetailModal.tsx`), add the assertion to `TicketDetailModal.test.tsx` instead (the wrapper `div` is observable on the detail-modal path only).

### Acceptance Criteria
- [ ] New tests assert the chosen strategy's wrapper class is present when enabled and absent when disabled/omitted.
- [ ] Base panel classes (`max-h-[90vh]`, `w-full`, `overflow-y-auto`) still asserted present.
- [ ] Tests green; no other tests modified.

---

## Definition of Done (whole ticket)

- [ ] T1, T2, T3, T4 merged (core delivery + tests).
- [ ] Manual visual gate run at ≥1400px and <1400px; decision (T5/T6 implemented, **or** recorded "skipped — balanced") documented in the PR body.
- [ ] `CreateTicketModal`, `AddMemberModal`, and confirm dialogs visually unchanged.
- [ ] `TicketAttributeForm.tsx` untouched (hard invariant verified via `git diff`).
- [ ] Plan acceptance criteria all satisfied (see `SLYK-09-plan.md` → Acceptance Criteria).
