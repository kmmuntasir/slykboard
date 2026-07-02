# Task Breakdown — DEL-02
**Plan:** `.context/pm-cycles/pm-cycle-2026-07-03-00-00-00/deliverables/DEL-02-read-first-edit-on-demand-plan.md`
**Generated:** 2026-07-03

---

## Parallelization Strategy

Tasks are grouped into batches by dependency order. Run batches sequentially;
within a batch, conflict-free tasks run in parallel.

### Batch / Dependency Diagram
```
Batch 1: [T1] ──> Batch 2: [T2] ──┬──> Batch 3: [T3]
                                  └──> Batch 3: [T4]
```

### Merge-order rules
- Merge lower-numbered batches first.
- Within a batch, merge in stable task-number order.
- Task 1 must merge before Task 2.
- Task 2 must merge before Task 3 and Task 4.
- Task 3 and Task 4 have no ordering between them (either order; ideally together as the test-closing batch).
- Final gate: `cd frontend && npm test` fully green.

### Summary
| # | Batch | Target File | Dependencies | Can Parallel With |
|---|-------|-------------|--------------|-------------------|
| T1 | 1 | `frontend/src/components/ui/Field.tsx`, `frontend/src/components/ui/Field.test.tsx` | None | — |
| T2 | 2 | `frontend/src/components/ticket-fields/DescriptionField.tsx` | T1 | — |
| T3 | 3 | `frontend/src/components/ticket-fields/DescriptionField.test.tsx` (new) | T2 | T4 |
| T4 | 3 | `frontend/src/components/TicketDetailModal.test.tsx` | T2 | T3 |

### Suggested developer tracks
- **Track A (primitive → consumer):** T1 → T2
- **Track B (tests):** T3 + T4 in parallel after Track A completes

> Suggested: 1 developer given the small, concentrated scope. The track split above shows the logical sequencing if parallelized.

---

## Tasks

### T1 — Add optional `action` slot to Field primitive + test
**Commit:** `DEL-02: add optional action slot to Field primitive`

**Description:**
Extend `FieldProps` (`frontend/src/components/ui/Field.tsx:8-22`) with `action?: ReactNode`. Render it right-aligned in the label row.

CRITICAL a11y constraint: the wrapper is currently a `<label htmlFor={htmlFor}>` (`Field.tsx:24`) and children render inside it (`Field.tsx:38`). Nesting an interactive Button inside `<label>` would bind it to the field via implicit label association and break the label-input association. Restructure so the `action` renders as a flex sibling (e.g. `ml-auto`) that is **not** nested inside the `<label>` association — choose the simplest approach that keeps backward compatibility and preserves the existing `htmlFor` association; document the chosen approach in the commit message / a code comment. For example: render the label row as a flex container where the `<label>` wraps only the icon+text, and the action renders as a sibling with `ml-auto`.

When `action` is undefined, behavior is byte-identical to today (no impact on Title/Status/Priority/Labels/DueDate/Checklist/Assignee field consumers). Add `ReactNode` to the React import.

Add a test in `frontend/src/components/ui/Field.test.tsx` (no `FormProvider` needed — Field is standalone, bare vitest + @testing-library/react render/screen): (a) passing an `action` node renders it right-aligned in the label row; (b) by default (no `action`) nothing extra renders and existing layout is unchanged.

**Acceptance criteria:**
- [ ] `FieldProps` has an optional `action?: ReactNode`; rendered right-aligned in the label row.
- [ ] No interactive control is nested inside the `<label>` element (a11y-safe).
- [ ] All other Field consumers are unaffected (existing `Field.test.tsx` tests stay green).
- [ ] New action-slot test passes; absent-by-default case passes.

**Dependencies:** None
**Can parallel with:** — (only batch-1 task; batch-2 depends on it)

---

### T2 — DescriptionField read-first with edit-on-demand
**Commit:** `DEL-02: render description read-first with edit-on-demand`

**Description:**
In `frontend/src/components/ticket-fields/DescriptionField.tsx`:

- Add imports: `import { useState, useEffect } from 'react'`, `import { Pencil } from 'lucide-react'`, and the existing `Button` from `@/components/ui/Button`. (Pencil icon convention per `frontend/src/components/LabelManager.tsx:7`; ghost/sm Button per `frontend/src/components/ui/Button.tsx:16,32,21,39`.)
- Add local state `const [isEditing, setIsEditing] = useState(false)` (default `false` = read-first).
- Extend the existing `useFormContext<TicketFormValues>()` destructure (`DescriptionField.tsx:21-25`) to also read `formState: { isSubmitSuccessful }` alongside the existing `errors`. Add `useEffect(() => { if (isSubmitSuccessful) setIsEditing(false); }, [isSubmitSuccessful])` to revert to read-only after a successful global save (host-agnostic robust mechanism; RHF flips `isSubmitSuccessful` true on success and false at the start of the next submit).
- Change the render gate (`DescriptionField.tsx:36`): show the sanitized-HTML read branch when `!isEditing || readOnly`, and the `<RichTextEditor>` branch only when `isEditing && !readOnly`. `readOnly` always wins (no editor, no Edit button).
- Pass the Edit button through Field's `action` slot: render it only when `!readOnly && !isEditing`. The button:
  ```tsx
  <Button type="button" variant="ghost" size="sm"
          onClick={() => setIsEditing(true)}
          aria-label="Edit description">
    <Pencil className="h-4 w-4" aria-hidden="true" />
    <span className="ml-1">Edit</span>
  </Button>
  ```
  `type="button"` is critical (do not trigger the form submit). Hide the Edit button while editing (exit only via global Save).
- No per-field Save/Cancel, no auto-save. No changes to the dirty-guard/close-confirm flow.

**Acceptance criteria:**
- [ ] For an editable (non-deleted) ticket the description renders as read-only sanitized HTML by default (no `RichTextEditor` mounted).
- [ ] A low-emphasis "Edit" button (ghost/sm + Pencil) renders right-aligned in the Description label row for editable tickets, only when not editing.
- [ ] Clicking Edit reveals `<RichTextEditor>`; the Edit button is hidden while editing.
- [ ] After a successful global Save (`isSubmitSuccessful`), `isEditing` resets to `false` and the field reverts to read-only.
- [ ] For soft-deleted / `readOnly` tickets: no Edit button, always read-only sanitized HTML.
- [ ] `type="button"` on the Edit button so it never submits the form.

**Dependencies:** T1 (uses Field's new `action` slot)
**Can parallel with:** — (depends on T1; T3 & T4 depend on it)

**Subtasks:**
1. Add imports + `isEditing` state + `isSubmitSuccessful` destructure + revert `useEffect`.
2. Change render gate to `isEditing && !readOnly`.
3. Build the Edit button and pass via Field `action` slot.
4. Run `cd frontend && npm test` and confirm no NEW breakage in DescriptionField itself (the broken modal assertion is fixed in T4).

---

### T3 — Create DescriptionField.test.tsx
**Commit:** `DEL-02: add DescriptionField read-first/edit-on-demand tests`

**Description:**
Create `frontend/src/components/ticket-fields/DescriptionField.test.tsx` (new file). The component calls `useFormContext`, so each test needs a `useForm()` + `<FormProvider>` wrapper (follow the wrapper pattern used elsewhere, e.g. `TicketDetailModal.test.tsx` providers; a lightweight `FormProvider` wrapper is sufficient since DescriptionField only uses `watch`/`setValue`/`formState`). Mock `RichTextEditor` as `<textarea aria-label="Description">` (same mock shape as `TicketDetailModal.test.tsx:13-19`) so the editor-branch assertions are deterministic.

Cover:
- (a) defaults to read-only rendered HTML (no RichTextEditor/toolbar textarea) for an editable ticket;
- (b) clicking the "Edit description" button reveals the RichTextEditor (mocked textarea);
- (c) the Edit button is absent when `readOnly` is true (soft-deleted ticket);
- (d) after a successful form submit (simulate `isSubmitSuccessful` becoming true — e.g. via the wrapper's form submit or by manipulating `formState`) the component reverts to the read-only view;
- (e) the Edit button has `type="button"` (`toHaveAttribute('type','button')`) and does not submit the form.

**Acceptance criteria:**
- [ ] All five behaviors (a–e) covered and passing.
- [ ] Test uses a proper `FormProvider` wrapper.
- [ ] `cd frontend && npm test` green for this file.

**Dependencies:** T2
**Can parallel with:** T4 (different file, no conflict)

---

### T4 — Fix TicketDetailModal.test.tsx description edit-flow assertion
**Commit:** `DEL-02: update TicketDetailModal test for read-first description`

**Description:**
The assertion at `frontend/src/components/TicketDetailModal.test.tsx:618-629` does `fireEvent.change(screen.getByLabelText('Description'), ...)` expecting the mocked editor textarea (`RichTextEditor` mocked at `:13-19`) to be mounted by default for an editable ticket. Under read-first this textarea is not mounted until "Edit" is clicked.

Update this test to first click the "Edit description" button (`getByRole('button', { name: /edit description/i })`), assert the editor appears, THEN perform the description change/expect-value flow. Do **not** change the soft-deleted assertion at `:773-778` (`getByText('steps')`) — it stays green. Confirm the full `TicketDetailModal.test.tsx` suite passes.

**Acceptance criteria:**
- [ ] `TicketDetailModal.test.tsx:618-629` updated to click Edit before editing the description; assertion passes.
- [ ] Soft-deleted ticket assertion (`:773-778`) unchanged and green.
- [ ] Full `TicketDetailModal.test.tsx` suite green via `cd frontend && npm test`.

**Dependencies:** T2
**Can parallel with:** T3 (different file, no conflict)
