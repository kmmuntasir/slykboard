# F45 — Field/input consistency sweep: Plan + Task Breakdown

> **Feature:** F45 — Field/input consistency sweep (Phase 2 — Ticket Modal & Forms · Polish)
> **Feature index:** [`ui-redesign-features.md`](../../ui-redesign-features.md)
> **Slug:** `SLYK` · **Depends on:** F35 (done), F44 (done) · **PRD ref:** §5.3, §2.5 (drift table)
> **Sources:** [`prd-ui-redesign.md`](../../../prd-ui-redesign.md), the project rules discovered for this repo, plus dependency feature task docs: [F35](../F35-shared-ui-primitives/F35-shared-ui-primitives-tasks.md), [F44](../F44-two-column-ticket-form/F44-two-column-ticket-form-tasks.md)

---

## 1. F45 Recap

**Goal:** Make every field in the form (and confirm/ManualEntry dialogs) use the F35 primitives, killing the padding/border/focus-ring drift so all inputs share one `px-3 py-2` / `border-input` / uniform focus-ring vocabulary.

**Ships:** `RichTextEditor` outer border = `border-input` with a `focus-within` ring; `ChecklistEditor` item padding is a deliberately-chosen named "dense" variant (commented); all buttons in `ConfirmDiscardDialog`, `DeleteTicketConfirm`, and `ManualEntryForm` route through the F35 `Button` (one size vocabulary); `ManualEntryForm` inputs route through `TextInput`. No three-button-size drift remains in the form + dialogs surface.

**Acceptance (definition of done):**
- Every form field routes through `Field` + `TextInput`/`SelectInput`/`Textarea`: identical `px-3 py-2`, `border-input`, uniform focus ring. *(F44 already wrapped the form in `Field`; F45 completes the leaf-input swap where F45 owns the component — see Scope in §3.)*
- `RichTextEditor` `focus-within` ring added (outer wrapper).
- `ChecklistEditor` padding either matches the family or is a deliberately-chosen "dense" variant (commented).
- Confirm-dialog + ManualEntry buttons use `Button` `sm`/`md`.
- Visual: no three-button-size drift remains across the form + dialogs surface.

**Edge cases to resolve up front:**
- **Don't re-scope into a repo-wide sweep — that's F46** → **Decision:** F45 touches only `RichTextEditor`, `ChecklistEditor`, `ConfirmDiscardDialog`, `DeleteTicketConfirm`, `ManualEntryForm`. The raw-color → token migration of `PrioritySelect`/`UserSelect`/`LabelMultiSelect`/`TicketAttributeForm` leaf inputs (`gray-300`/`bg-gray-50`) is **F46**'s explicit job. F45 swaps the *primitive* (hand-rolled `<button>` → `Button`, hand-rolled `<input>` → `TextInput`) only where the spec names the component; it does not chase every `gray-*` token (that overlaps F46 and would cause merge churn).
- **Dense variant for checklist items must be a named variant, not a one-off className** → **Decision:** add a `dense?: boolean` prop (default `false`) to `ChecklistEditor`. When `true`, item inputs use `px-2 py-1 text-sm` (deliberately denser than the family's `px-3 py-2` — justified: the checklist is a repeating list row, not a primary form field; a comment documents the choice). When `false`, item inputs adopt the full `TextInput` family padding. The TicketAttributeForm passes `dense` (the right-column sidebar needs the compact rows).
- **`RichTextEditor` toolbar buttons** (`B`/`I`/`H3`/`List`/`Code`) are formatting toggles, not form/dialog action buttons → **Decision:** leave them as-is (small `px-2 py-1 hover:bg-secondary` toolbar buttons). F45's scope per the spec is the *outer border + focus-within ring*; the toolbar is an internal editor concern, not part of the "three-button-size drift" the spec targets. Swapping them to `Button variant="ghost" size="sm"` is optional polish a dev may do in-task if it doesn't balloon scope.
- **`ManualEntryForm` inputs** are bare `<input>` with `gray-200` borders and `focus:ring-1` (not `focus-visible:ring-2`) → **Decision:** swap both to `TextInput` (inherits `border-input` + `focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary`), closing the §2.5 a11y/focus-ring gap. The submit button → `Button variant="primary" size="sm"`.
- **Confirm dialogs use raw `red-600`/`gray-*`** → **Decision:** swap to `Button variant="destructive" size="sm"` (Delete/Discard) + `Button variant="outline" size="sm"` (Cancel). The destructive red comes from the `destructive` token (F32), not raw `red-600`. The body `<p>` text colors (`gray-600`) are raw-color → **deferred to F46** (F45 swaps buttons only; the `<p>` color is F46's token sweep).

---

## 2. Codebase Analysis Summary

- **State:** partial. F35 primitives (`Button`, `Field`, `TextInput`, `Textarea`, `SelectInput`) ship at `frontend/src/components/ui/` with the verbatim §3.4 focus-ring classes. F44 landed the two-column `TicketAttributeForm` + `Field` wrapping + `hideLabel` seams on `PrioritySelect`/`UserSelect`/`ChecklistEditor`, and adopted `Button` for the form footer. The remaining drift lives in the five components F45 owns.
- **Existing structure this feature builds on:**
    - `frontend/src/components/ui/Button.tsx` — `variant` (`primary`/`secondary`/`ghost`/`destructive`/`outline`) × `size` (`sm`/`md`/`lg`); `sm = px-3 py-1.5 text-sm`, `md = px-4 py-2 text-sm`. forwardRef + rest-spread (passes `type`/`disabled`/`onClick`).
    - `frontend/src/components/ui/TextInput.tsx` — `border border-input rounded-md px-3 py-2 bg-background text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary`.
    - `frontend/src/components/ui/Field.tsx` — `<label>` + `<span>` label + child + `<p role="alert">` error.
    - `frontend/src/components/ChecklistEditor.tsx` — already has F44's `hideLabel?: boolean`; item `<input>`s are bare (`border-gray-300 px-2 py-1 text-sm`); "Add" button is hand-rolled (`bg-primary …`).
    - `frontend/src/components/RichTextEditor.tsx` — outer `<div className="rounded border bg-card p-2">`; no `focus-within` ring; toolbar has 5 hand-rolled toggle buttons.
    - `frontend/src/components/ConfirmDiscardDialog.tsx` — Cancel (`gray-700 hover:bg-gray-100`) + Discard (`bg-red-600 hover:bg-red-700`) hand-rolled `<button>`s at `px-3 py-1.5 text-sm`.
    - `frontend/src/components/DeleteTicketConfirm.tsx` — Cancel + Delete hand-rolled `<button>`s, identical drift pattern (Delete is `bg-red-600`).
    - `frontend/src/components/ManualEntryForm.tsx` — duration + description bare `<input>`s (`border-gray-200 … focus:ring-1 focus:ring-primary`) + hand-rolled submit `<button>`.
- **Prior art / partial work:** F44 already adopted `Button` for the `TicketAttributeForm` footer and added the `hideLabel` seam F45's `ChecklistEditor` change builds on. F44's "Out of scope" note explicitly assigned the `RichTextEditor`/`ChecklistEditor`/`ManualEntryForm` primitive adoption to F45.
- **File paths the plan references that do NOT exist yet:** none. All targets exist; F45 modifies in place.
- **Project rules** this plan must satisfy:
    - [`js-style-guide.md`](../../../.claude/rules/js-style-guide.md) — functional components, explicit prop interfaces, Tailwind classes (no inline styles except the one legitimate `ChecklistEditor` progress-bar width), `cn()` for class composition.
    - [`js-testing-rules.md`](../../../.claude/rules/js-testing-rules.md) — co-located `*.test.tsx`, table-driven where sensible, Testing Library `getByRole`/`getByText` priority.
    - [`js-development-rules.md`](../../../.claude/rules/js-development-rules.md) — one component per file, forwardRef primitives, REST/JSX conventions.
    - [`git-guidelines.md`](../../../.claude/rules/git-guidelines.md) — `SLYK-F45:` commit prefix, rebase-and-merge only.
- **Hidden coupling to plan for:**
    - `Button`'s default `type="button"` — the `ManualEntryForm` submit button must pass `type="submit"` explicitly (the form relies on it).
    - `Button` spreads `{...rest}` onto the native `<button>` — existing `onClick`/`disabled` props pass through unchanged.
    - `TextInput` spreads `{...rest}` — `value`/`onChange`/`placeholder`/`aria-label`/`maxLength` all pass through.
    - The `ChecklistEditor` "Add" button uses `disabled={disabled || !draft.trim() || atCapacity}` — preserve that exact condition when swapping to `Button`.
    - `ConfirmDiscardDialog`/`DeleteTicketConfirm` tests assert on button **labels** (`getByText('Cancel')`/`getByText('Discard')`/`getByText('Delete')`), not class names — so the `Button` swap is test-safe as long as labels are byte-identical. (Verify in each `*.test.tsx`.)
    - `RichTextEditor`'s outer `<div>` currently uses `bg-card`; the focus-within ring must not break the `prose` inner content styling.
    - `ManualEntryForm` error `<p className="text-red-600">` is a raw color → F46 owns it; F45 leaves it (do not half-migrate).

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | `RichTextEditor` outer border + focus ring | **`border border-input bg-card rounded-md p-2 focus-within:ring-2 focus-within:ring-ring focus-within:border-primary`** on the wrapping `<div>` | PRD §5.3 + spec: "outer border = `border-input` with focus-within ring". `focus-within` (not `focus`) because the editable surface is the inner TipTap `EditorContent`, not the div itself — the ring must fire when the editor *or any toolbar button* gains focus. Mirrors the `TextInput` ring tokens (`ring-ring`/`border-primary`) so the editor reads as a family member. `bg-card` retained (editor surface is distinct from a plain input's `bg-background`). |
| D2 | `ChecklistEditor` item padding | **named `dense?: boolean` prop (default `false`); when `true`, item `<input>`s use `px-2 py-1 text-sm` via a commented constant** | Spec edge case: dense variant "must be a named variant, not a one-off className". A prop is the named variant. Density is justified: checklist rows are a repeating list, not primary form fields — full `px-3 py-2` would balloon the sidebar. A comment (`// D2: dense variant — repeating list rows, deliberately compact vs the px-3 py-2 field family`) documents the choice. `TicketAttributeForm` passes `dense`. |
| D3 | `ChecklistEditor` item input primitive | **swap bare `<input>` → `TextInput` with `dense ? 'px-2 py-1 text-sm' : undefined` className override** | `TextInput` supplies `border-input` + the family focus ring; the `dense` className overrides only padding/text-size (legitimate — `cn()` merges). The "Add" draft input and the per-item edit input both adopt `TextInput`. Closes the `gray-300` border + missing `focus-visible:ring-2` gap. (Note: the raw `gray-*` on the progress bar / count text is F46.) |
| D4 | `ChecklistEditor` "Add" button | **`<Button variant="primary" size="sm">` with the existing `disabled` condition preserved** | Kills the hand-rolled `bg-primary px-3 py-1` drift. `size="sm"` matches the dense row context. `disabled`/`onClick`/`type="button"` pass through `Button`'s rest-spread. |
| D5 | `ConfirmDiscardDialog` buttons | **Cancel → `<Button variant="outline" size="sm">`, Discard → `<Button variant="destructive" size="sm">`** | `sm` matches the existing `px-3 py-1.5 text-sm`. `destructive` token replaces raw `red-600`. Labels (`'Cancel'`, `'Discard'`) byte-identical → `ConfirmDiscardDialog.test.tsx` stays green. Body `<p className="text-gray-600">` left for F46. |
| D6 | `DeleteTicketConfirm` buttons | **Cancel → `<Button variant="outline" size="sm" disabled={isDeleting}>`, Delete → `<Button variant="destructive" size="sm" disabled={isDeleting}>`** | Same pattern as D5. `disabled={isDeleting}` preserved on both (the test may assert Cancel is disabled while deleting). `'Delete'`/`'Deleting…'` labels unchanged. |
| D7 | `ManualEntryForm` inputs | **both duration + description bare `<input>` → `<TextInput>`; drop hand-rolled `border-gray-200 … focus:ring-1` classes** | `TextInput` brings `border-input` + `focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary`, closing the §2.5 `focus:` → `focus-visible:` a11y gap. All pass-through attrs (`value`/`onChange`/`placeholder`/`aria-label`/`maxLength`) preserved. |
| D8 | `ManualEntryForm` submit button | **`<Button type="submit" variant="primary" size="sm" disabled={mutation.isPending}>`** | `type="submit"` is load-bearing (form submit). `size="sm"` matches the `px-3 py-1 text-sm` row. `'Log Time'`/`'Logging…'` labels unchanged. Error `<p className="text-red-600">` left for F46. |

> **Out of F45 scope (explicitly deferred):**
> - **F46** owns the repo-wide raw-color → semantic-token sweep. F45 does **not** migrate the `gray-300`/`gray-200`/`gray-50`/`bg-gray-50`/`red-600` colors in `PrioritySelect`, `UserSelect`, `LabelMultiSelect`, `TicketAttributeForm` leaf inputs, the `ChecklistEditor` progress bar/count text, the `ManualEntryForm`/dialog body `<p>` text colors, or `RichTextEditor`'s `bg-card` (already a token). F45 swaps the *primitive* (`<input>`→`TextInput`, `<button>`→`Button`) only where the spec names the component; tokens come along for free on the swapped primitives, and F46 finishes the rest.
> - **F45 does not touch** the `TicketAttributeForm` Title `<input>` (still bare `border-gray-300`) — that is a leaf form field F46 will tokenize; F45's `ChecklistEditor`/`ManualEntryForm`/dialog scope is per the spec's "form + confirm/ManualEntry dialogs" wording and the F44 "out of scope" handoff.
> - **Toolbar buttons** inside `RichTextEditor` (`B`/`I`/`H3`/`List`/`Code`) stay as-is (internal editor toggles, not part of the action-button drift the spec targets). Optional: a dev may convert them to `Button variant="ghost" size="sm"` in-task if trivial, but it is not required by acceptance.

> **Owner sign-off needed:** none irreversible. D2's `dense` default (`false`) is backward-compatible; whether `TicketAttributeForm` passes `dense` (recommended) or leaves the checklist at full family padding is a per-PR visual call — the plan recommends `dense` for the narrow right column, but the owner may prefer uniform padding.

---

## 4. Architecture Overview (Target Tree)

```
frontend/src/components/
├── RichTextEditor.tsx          # MODIFY — outer div: border-input + focus-within ring (D1)
├── RichTextEditor.test.tsx     # MODIFY — assert focus-within ring class on wrapper
├── ChecklistEditor.tsx         # MODIFY — dense prop (D2), TextInput for items (D3), Button for Add (D4)
├── ChecklistEditor.test.tsx    # MODIFY — add dense-variant test; keep existing green
├── ConfirmDiscardDialog.tsx    # MODIFY — Button outline/destructive sm (D5)
├── ConfirmDiscardDialog.test.tsx # verify green (labels unchanged)
├── DeleteTicketConfirm.tsx     # MODIFY — Button outline/destructive sm (D6)
├── DeleteTicketConfirm.test.tsx  # verify green (labels unchanged)
├── ManualEntryForm.tsx         # MODIFY — TextInput for both inputs (D7), Button submit sm (D8)
├── ManualEntryForm.test.tsx    # MODIFY/verify — focus-ring + submit button role
└── TicketAttributeForm.tsx     # MODIFY (1 line) — pass dense to <ChecklistEditor> (D2 consumer)
```

12 files change (5 components + their tests + 1-line consumer wiring); no new files, no new exports beyond the `dense?: boolean` prop on `ChecklistEditor`. No schema, migration, env, or API-shape change.

**Data flow is unchanged.** Every component keeps its props, handlers, and state model; F45 only swaps the underlying primitive elements and adds one opt-in `dense` flag. `react-hook-form`/Zod (F44 §10 freeze) is untouched.

---

## 5. Parallelization Strategy

Tasks are grouped into **3 batches**. The five target components are **mutually disjoint files** with no cross-imports among them (they are siblings consumed by `TicketAttributeForm`/`TicketDetailModal`), so T1–T4 can run in full parallel. T5 is the consumer wiring (1-line `dense` pass-down) and the integration/verification gate.

### Batch dependency diagram

```
Batch A (T1 ‖ T2 ‖ T3 ‖ T4 — disjoint component files)
  T1: RichTextEditor        (focus-within ring)
  T2: ChecklistEditor        (dense + TextInput + Button)  ← adds the dense prop
  T3: ConfirmDiscardDialog   (Button sm)
  T4: DeleteTicketConfirm    (Button sm)
        │
        │  T2 must land before T5 consumes <ChecklistEditor dense />
        ▼
Batch B (T5: ManualEntryForm + TicketAttributeForm dense wiring + verify)
```

- Batch A → Batch B: hard barrier only between **T2 and T5** — T5 passes `dense` to `ChecklistEditor`, so the prop must exist (T2). T1/T3/T4 are independent of T5.
- `ManualEntryForm` (originally listed as a T5 candidate) is itself a disjoint file with no `dense` dependency — it can be pulled into Batch A as **T6** for more parallelism (see summary table). The plan lists it under T5 only to keep the verification gate cohesive; a dev may split it out.

### Merge order rules

1. **Batch A merges first** — T1, T2, T3, T4 are independent file-disjoint edits. Any order; recommend T2 first (it adds the `dense` prop T5 needs). Each is backward-compatible (`dense` defaults to `false`; `Button`/`TextInput` swaps preserve labels/attrs).
2. **Batch B merges second** — T5 wires `dense` into `TicketAttributeForm` (requires T2 on `main`), swaps `ManualEntryForm`, and runs the full suite as the verification gate.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | A | `RichTextEditor.tsx`, `RichTextEditor.test.tsx` | F35, F44 | T2, T3, T4, T6 |
| **T2** | A | `ChecklistEditor.tsx`, `ChecklistEditor.test.tsx` | F35, F44 | T1, T3, T4, T6 |
| **T3** | A | `ConfirmDiscardDialog.tsx`, `ConfirmDiscardDialog.test.tsx` | F35 | T1, T2, T4, T6 |
| **T4** | A | `DeleteTicketConfirm.tsx`, `DeleteTicketConfirm.test.tsx` | F35 | T1, T2, T3, T6 |
| **T6** | A | `ManualEntryForm.tsx`, `ManualEntryForm.test.tsx` | F35 | T1, T2, T3, T4 |
| **T5** | B | `TicketAttributeForm.tsx` (1-line `dense`) + full-suite verify | T2 (and T1–T4, T6 merged) | — |

### Developer assignment tracks

- **Solo:** T1 → T2 → T3 → T4 → T6 → T5 (or any order; T2 before T5).
- **2 devs:** Dev-A: T1 → T3 → T4; Dev-B: T2 → T6 → (then) T5.
- **3 devs:** Dev-A T1+T3, Dev-B T2+T4, Dev-C T6; then T5.

---

## 6. Tasks

### T1 — RichTextEditor: outer border-input + focus-within ring

**Batch:** A · **Depends on:** F35, F44 (done) · **Parallel with:** T2, T3, T4, T6

**Description:** The `RichTextEditor` outer wrapper is `<div className="rounded border bg-card p-2">` — a bare `border` (no color token) and no focus ring, so the editor reads as drift next to the `TextInput`/`Textarea` family. Add the `border-input` color and a `focus-within` ring that fires when the inner TipTap surface or any toolbar button is focused. Use `focus-within` (not `focus`) because the editable region is a nested `EditorContent`, not the div itself.

Do **not** touch the inner `prose min-h-[120px]` editor class, the toolbar buttons, or the `bg-card` (already a token). Do **not** migrate toolbar button primitives (optional polish, not required by acceptance — leave as-is).

Create / Modify:
- `frontend/src/components/RichTextEditor.tsx` — change the outer `<div>` className:

```tsx
// D1: focus-within (not focus) — the editable surface is the inner EditorContent;
// the ring must fire when it OR a toolbar button is focused. border-input + the
// family ring tokens (ring-ring / border-primary) make the editor read as a
// TextInput/Textarea family member. bg-card retained (editor ≠ plain input).
return (
    <div className="rounded-md border border-input bg-card p-2 focus-within:ring-2 focus-within:ring-ring focus-within:border-primary">
        {/* toolbar + EditorContent unchanged */}
    </div>
);
```

- `frontend/src/components/RichTextEditor.test.tsx` — add one assertion: the wrapper `div` carries `focus-within:ring-2` (query by the editor's container and assert the class string contains `focus-within:ring-2`). Keep all existing tests green.

**Acceptance Criteria:**
- [ ] Outer wrapper class includes `border-input`, `focus-within:ring-2`, `focus-within:ring-ring`, `focus-within:border-primary`.
- [ ] Inner `prose` editor class, toolbar buttons, and `bg-card` unchanged.
- [ ] `RichTextEditor.test.tsx` passes (existing + new focus-within assertion).
- [ ] No raw color introduced (F46 boundary respected).

**Dependencies:** F35, F44.

---

### T2 — ChecklistEditor: `dense` variant + TextInput items + Button "Add"

**Batch:** A · **Depends on:** F35, F44 (done) · **Parallel with:** T1, T3, T4, T6

**Description:** `ChecklistEditor` item inputs are bare `<input className="… border-gray-300 px-2 py-1 text-sm">` with no `focus-visible:ring-2`, and the "Add" button is hand-rolled `bg-primary px-3 py-1 text-sm`. (1) Add a named `dense?: boolean` prop (default `false`) so the compact row padding is a deliberate, commented variant — not a one-off className (spec edge case). (2) Swap both the per-item edit input and the "Add" draft input to `TextInput`, overriding padding to `px-2 py-1 text-sm` when `dense` (justified for repeating list rows). (3) Swap the "Add" button to `Button variant="primary" size="sm"`, preserving the exact `disabled` condition.

Leave the progress bar (`bg-gray-200`/`bg-green-500`), the count text (`text-gray-500`), the capacity message, and the delete button as-is — those raw colors are F46; the delete affordance is a text link, not a size-drift button.

Create / Modify:
- `frontend/src/components/ChecklistEditor.tsx`:

```tsx
import { useState } from 'react';
import { TextInput } from './ui/TextInput';
import { Button } from './ui/Button';
import type { ChecklistItem } from '@/types/ticket';

// D2: dense variant — repeating list rows are deliberately compact (px-2 py-1)
// vs the px-3 py-2 primary-field family. A named prop, not a one-off className.
const DENSE_ITEM_CLASS = 'px-2 py-1 text-sm';

interface ChecklistEditorProps {
    value: ChecklistItem[];
    onChange: (items: ChecklistItem[]) => void;
    disabled?: boolean;
    hideLabel?: boolean;
    /** D2: when true, item inputs use compact px-2 py-1 (repeating-row variant). */
    dense?: boolean;
}

export function ChecklistEditor({ value, onChange, disabled, hideLabel = false, dense = false }: ChecklistEditorProps) {
    // ...handlers unchanged...

    const itemClassName = dense ? DENSE_ITEM_CLASS : undefined;

    // per-item edit input:
    <TextInput
        type="text"
        value={item.text}
        maxLength={CHECKLIST_MAX_TEXT}
        onChange={(e) => editText(item.id, e.target.value)}
        aria-label={`Edit checklist item "${item.text}"`}
        className={cn('flex-1 text-sm', itemClassName)}
        // Note: full-family padding (px-3 py-2) applies when dense=false via TextInput base.
    />

    // "Add" draft input:
    <TextInput
        type="text"
        value={draft}
        maxLength={CHECKLIST_MAX_TEXT}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } }}
        placeholder="Add an item"
        aria-label="New checklist item"
        className={cn('flex-1 text-sm', itemClassName)}
    />

    // "Add" button:
    <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={addItem}
        disabled={disabled || !draft.trim() || atCapacity}
    >
        Add
    </Button>
}
```

    Import `cn` from `./ui/cn` (already used elsewhere) to merge classes. When `dense` is `false`, `itemClassName` is `undefined` and `TextInput`'s base `px-3 py-2` applies (full family padding) — so the non-dense path matches the spec's "either matches the family" clause.

- `frontend/src/components/ChecklistEditor.test.tsx` — add a table-driven test: render with `dense={true}` and `dense={false}`; assert the item input has `px-2 py-1` only when dense. Keep all existing tests green (the "Add" button label `'Add'` is unchanged → `getByRole('button', { name: 'Add' })` still resolves).

**Acceptance Criteria:**
- [ ] `dense?: boolean` prop added (default `false`), documented with the D2 comment.
- [ ] Per-item edit input + "Add" draft input are `TextInput` (carry `border-input` + `focus-visible:ring-2`).
- [ ] "Add" button is `Button variant="primary" size="sm"` with the original `disabled` condition intact.
- [ ] When `dense={false}`, item inputs use the full `TextInput` family padding (`px-3 py-2`).
- [ ] Progress bar, count text, capacity message, and delete link unchanged (F46 boundary).
- [ ] `ChecklistEditor.test.tsx` passes (existing + new dense-variant case).

**Dependencies:** F35, F44.

---

### T3 — ConfirmDiscardDialog: Button outline/destructive sm

**Batch:** A · **Depends on:** F35 (done) · **Parallel with:** T1, T2, T4, T6

**Description:** The dialog's Cancel (`gray-700 hover:bg-gray-100`) + Discard (`bg-red-600 hover:bg-red-700`) hand-rolled buttons are the canonical "three-button-size drift" offender. Swap both to the F35 `Button` — Cancel → `variant="outline" size="sm"`, Discard → `variant="destructive" size="sm"`. `sm` matches the existing `px-3 py-1.5 text-sm`. Labels (`'Cancel'`, `'Discard'`) stay byte-identical so the test (`getByText`) stays green. Leave the body `<p className="text-gray-600">` for F46.

Create / Modify:
- `frontend/src/components/ConfirmDiscardDialog.tsx`:

```tsx
import { Modal } from './Modal';
import { Button } from './ui/Button';

// ...props unchanged...

export function ConfirmDiscardDialog({ isOpen, onDiscard, onCancel }: ConfirmDiscardDialogProps) {
    return (
        <Modal isOpen={isOpen} onClose={onCancel} titleId="discard-dialog-title" title="Discard changes?" blockBackdropClose>
            <p className="mb-4 text-sm text-gray-600">  {/* F46: raw gray-600 → token */}
                You have unsaved changes. Discard them and close?
            </p>
            <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                    Cancel
                </Button>
                <Button type="button" variant="destructive" size="sm" onClick={onDiscard}>
                    Discard
                </Button>
            </div>
        </Modal>
    );
}
```

- `frontend/src/components/ConfirmDiscardDialog.test.tsx` — verify existing assertions still pass (buttons still present by text `Cancel`/`Discard`; the `Modal` open/close behavior unchanged). Add no new test unless the existing one asserted on raw `bg-red-600` (if so, update it to assert on the `destructive` role/class instead).

**Acceptance Criteria:**
- [ ] Both buttons are `Button` (`outline`/`destructive`, `size="sm"`).
- [ ] No raw `red-600`/`gray-700`/`gray-100` in button classes (the body `<p>` gray-600 may remain — F46).
- [ ] Labels `'Cancel'`, `'Discard'` unchanged.
- [ ] `ConfirmDiscardDialog.test.tsx` passes.

**Dependencies:** F35.

---

### T4 — DeleteTicketConfirm: Button outline/destructive sm

**Batch:** A · **Depends on:** F35 (done) · **Parallel with:** T1, T2, T3, T6

**Description:** Identical drift pattern to T3. Cancel (`gray-700 hover:bg-gray-100 disabled:opacity-50`) + Delete (`bg-red-600 hover:bg-red-700 disabled:opacity-50`) hand-rolled buttons. Swap to `Button` — Cancel → `variant="outline" size="sm"`, Delete → `variant="destructive" size="sm"`. **Preserve `disabled={isDeleting}` on both** (the existing UI disables Cancel while a delete is in flight). Labels `'Delete'`/`'Deleting…'` unchanged. Body `<p className="text-gray-600">` → F46.

Create / Modify:
- `frontend/src/components/DeleteTicketConfirm.tsx`:

```tsx
import { Modal } from './Modal';
import { Button } from './ui/Button';

export function DeleteTicketConfirm({ isOpen, isDeleting = false, onConfirm, onCancel }: DeleteTicketConfirmProps) {
    return (
        <Modal isOpen={isOpen} onClose={onCancel} titleId="delete-ticket-dialog-title" title="Delete ticket?" blockBackdropClose>
            <p className="mb-4 text-sm text-gray-600">  {/* F46: raw gray-600 → token */}
                This removes the ticket from the board. ...
            </p>
            <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={isDeleting}>
                    Cancel
                </Button>
                <Button type="button" variant="destructive" size="sm" onClick={onConfirm} disabled={isDeleting}>
                    {isDeleting ? 'Deleting…' : 'Delete'}
                </Button>
            </div>
        </Modal>
    );
}
```

- `frontend/src/components/DeleteTicketConfirm.test.tsx` — verify existing assertions pass (buttons by text; `disabled` state while `isDeleting`). If any test asserted on `bg-red-600`, update to the destructive class.

**Acceptance Criteria:**
- [ ] Both buttons are `Button` (`outline`/`destructive`, `size="sm"`).
- [ ] `disabled={isDeleting}` preserved on both.
- [ ] Labels `'Delete'`/`'Deleting…'`/`'Cancel'` unchanged.
- [ ] `DeleteTicketConfirm.test.tsx` passes.

**Dependencies:** F35.

---

### T6 — ManualEntryForm: TextInput inputs + Button submit sm

**Batch:** A · **Depends on:** F35 (done) · **Parallel with:** T1, T2, T3, T4

**Description:** The duration + description inputs are bare `<input className="… border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary">` — `gray-200` (not `border-input`), `focus:` (not `focus-visible:ring-2`), the exact §2.5 a11y gap. Swap both to `TextInput` (inherits `border-input` + `focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary`). The submit button → `Button type="submit" variant="primary" size="sm"` (`type="submit"` is load-bearing — the form depends on it). Error `<p className="text-red-600">` → F46.

Create / Modify:
- `frontend/src/components/ManualEntryForm.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { addManualEntry } from '@/api/timer';
import { timerKeys } from '@/api/queryKeys';
import { parseDuration } from '@/utils/parseDuration';
import { TextInput } from './ui/TextInput';
import { Button } from './ui/Button';

// ...MIN/MAX constants, props, mutation, handleSubmit unchanged...

return (
    <form onSubmit={handleSubmit} className="mt-3 border-t border-gray-200 pt-3">  {/* F46: gray-200 → token */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <TextInput
                type="text"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="2h 30m, 90m, or 90"
                aria-label="Duration"
                className="flex-1 text-sm"
            />
            <TextInput
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description (optional)"
                maxLength={MAX_DESCRIPTION}
                aria-label="Description"
                className="flex-1 text-sm"
            />
            <Button type="submit" variant="primary" size="sm" disabled={mutation.isPending}>
                {mutation.isPending ? 'Logging…' : 'Log Time'}
            </Button>
        </div>
        {errorMessage && (
            <p className="mt-1 text-sm text-red-600">{errorMessage}</p>  {/* F46: red-600 → token */}
        )}
    </form>
);
```

    Note: `TextInput`'s base is `px-3 py-2`; passing `className="flex-1 text-sm"` keeps the `flex-1` layout and the `text-sm` size while the primitive's padding/focus-ring apply. If the owner wants the compact `px-2 py-1` (to match the pre-F45 look), add `px-2 py-1` to the className — but the family default `px-3 py-2` is the consistency target, so prefer leaving padding to the primitive.

- `frontend/src/components/ManualEntryForm.test.tsx` — verify: submit button still triggers the form (`getByRole('button', { name: 'Log Time' })`); inputs still accept typing (`getByLabelText('Duration')`). If a test asserted on `focus:ring-1`, update to assert the `focus-visible:ring-2` family class. Add a table-driven case for valid/invalid duration parsing if not already covered.

**Acceptance Criteria:**
- [ ] Both inputs are `TextInput` (carry `border-input` + `focus-visible:ring-2`).
- [ ] Submit button is `Button type="submit" variant="primary" size="sm"` with `disabled={mutation.isPending}`.
- [ ] `'Log Time'`/`'Logging…'` labels and `'Duration'`/`'Description'` aria-labels unchanged.
- [ ] Error `<p className="text-red-600">` and form `border-gray-200` left for F46.
- [ ] `ManualEntryForm.test.tsx` passes.

**Dependencies:** F35.

---

### T5 — Wire `dense` into TicketAttributeForm + integration verification

**Batch:** B (terminal) · **Depends on:** T2 (and T1, T3, T4, T6 merged) · **Parallel with:** —

**Description:** The consumer wiring + the final definition-of-done gate. (1) Pass `dense` to the `<ChecklistEditor>` in `TicketAttributeForm` so the narrow right-column sidebar gets the compact rows (D2 consumer). (2) Run the full frontend suite + lint + typecheck against the as-merged feature and fix any gaps. (3) Record proof.

Create / Modify:
- `frontend/src/components/TicketAttributeForm.tsx` — one-line change at the existing `<ChecklistEditor hideLabel … />` call:

```tsx
<ChecklistEditor
    hideLabel
    dense   // D2: compact rows for the narrow right-column sidebar
    value={watch('checklist')}
    onChange={(items: ChecklistItem[]) => setValue('checklist', items)}
/>
```

    If the owner prefers uniform family padding in the sidebar, omit `dense` — the editor then renders at `px-3 py-2` (still consistent, just taller). The plan recommends `dense`.

**Verification steps:**
1. `cd frontend && npm test -- --run` — full Vitest suite. Expect all green (F44's 17 TicketAttributeForm tests + the five touched components' tests).
2. `cd frontend && npm run lint` (or `rtk lint`) — zero new violations.
3. `cd frontend && npx tsc --noEmit` (or `rtk tsc`) — zero type errors.
4. Manual (optional): open the Create/Edit ticket modal — confirm the `RichTextEditor` shows a focus ring when the editor/toolbar is focused, the checklist rows are compact (dense), and the dialog/ManualEntry buttons are visually uniform (no three-size drift).
5. `rg "bg-red-600|hover:bg-red-700" frontend/src/components/ConfirmDiscardDialog.tsx frontend/src/components/DeleteTicketConfirm.tsx frontend/src/components/ManualEntryForm.tsx` — expect **zero hits** (the button reds are gone; only the deferred `<p>`/`border-gray-200` raw colors remain, owned by F46).

**Acceptance Criteria:**
- [ ] `<ChecklistEditor dense />` wired in `TicketAttributeForm` (or owner-approved omit).
- [ ] Full Vitest suite green.
- [ ] Lint + typecheck clean.
- [ ] No `bg-red-600`/`hover:bg-red-700` in the three button-bearing components.
- [ ] Every F45 acceptance bullet from §1 satisfied; record commit SHA + exit codes below.

**Dependencies:** T2 (for `dense` prop); T1, T3, T4, T6 merged for the verification gate to reflect the full feature.

---

## 7. Final F45 Acceptance Checklist

- [ ] Every form field the spec owns (`RichTextEditor`, `ChecklistEditor` items, `ManualEntryForm` inputs) routes through F35 primitives (`TextInput`/`Button`) with `border-input` + uniform `focus-visible:ring-2` (or `focus-within:ring-2` for the editor).
- [ ] `RichTextEditor` outer wrapper carries `border-input` + `focus-within:ring-2 focus-within:ring-ring focus-within:border-primary`.
- [ ] `ChecklistEditor` padding is the named `dense` variant (commented) — not a one-off className.
- [ ] `ConfirmDiscardDialog` + `DeleteTicketConfirm` buttons use `Button` (`outline`/`destructive`, `sm`).
- [ ] `ManualEntryForm` submit uses `Button` (`primary`, `sm`); inputs use `TextInput`.
- [ ] Visual: no three-button-size drift remains across the form + dialogs surface.
- [ ] Lint + format checks pass on an empty change.
- [ ] Typecheck + full test suite pass.

**Integration record (fill during the terminal task):**
- Feature commit SHA: `________`
- Vitest suite result (pass/fail count): `________`
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0`
- `rg bg-red-600` hits in the three button files: `0`

---

## 8. Schema deltas owned by this feature

None. F45 is a pure frontend primitive-adoption sweep — no database, migration, env, or API-shape change. The `react-hook-form`/Zod schema frozen by F44 (§10) remains untouched.
