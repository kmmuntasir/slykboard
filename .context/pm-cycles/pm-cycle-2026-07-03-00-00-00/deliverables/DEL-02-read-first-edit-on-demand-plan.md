# Implementation Plan — DEL-02
**Ticket:** `.context/pm-cycles/pm-cycle-2026-07-03-00-00-00/tickets/DEL-02-read-first-edit-on-demand.md`
**Type:** Feature
**Title:** Read-first edit-on-demand for ticket description
**Generated:** 2026-07-03

---

## Summary
Make the ticket description render as read-only sanitized HTML by default (read-first), with a small low-emphasis right-aligned "Edit" button in the Description label row that reveals DEL-01's `<RichTextEditor>` on demand. After a successful save the field reverts to the read-only rendered view (exits edit mode). Existing edit-permission rules are respected: the Edit button is hidden when `readOnly` is true (soft-deleted tickets / non-editable hosts). No per-field Save/Cancel and no auto-save are introduced; the single global "Save changes" button persists the description together with all other fields. The existing dirty-guard / close-confirm behavior is preserved unchanged.

The change is encapsulated entirely within `DescriptionField.tsx` plus a small backward-compatible extension to the shared `Field` primitive (an optional `action` slot). No consumer call sites need to change.

## Root Cause *(feature motivation)*
Currently `DescriptionField` is stateless: it renders the `<RichTextEditor>` (caret + toolbar) whenever `readOnly` is false, and sanitized HTML only when `readOnly` is true. For live/editable tickets this means the heavy editor with caret and toolbar is always mounted, which is noisy and unnecessary for read consumption. DEL-02 changes the default to read-first and makes the editor opt-in via an Edit button, while keeping the global Save flow and dirty-guard intact.

## Affected Components
| Layer | File | Why |
|-------|------|-----|
| Frontend | `frontend/src/components/ui/Field.tsx` | Add an optional `action?: ReactNode` slot rendered right-aligned in the label row (backward compatible; only `DescriptionField` uses it initially). |
| Frontend | `frontend/src/components/ticket-fields/DescriptionField.tsx` | Introduce local `isEditing` state (default `false`), gate the read-only vs editor branch on `isEditing`, render an Edit button via `Field`'s new `action` slot, and reset `isEditing` to `false` after a successful submit. |
| Tests | `frontend/src/components/ticket-fields/DescriptionField.test.tsx` | Extend tests for read-first default, edit-on-demand, `readOnly` hiding, submit-revert, and button-type safety. |
| Tests | `frontend/src/components/ui/Field.test.tsx` | If present, add a case for the `action` slot rendering right-aligned and absent by default. |
| Tests | `frontend/src/components/TicketDetailModal.test.tsx` | Existing consumer tests should continue to pass; update assertions if any rely on the editor being mounted by default. |

No changes are required to `TicketDetailModal.tsx` or `TicketAttributeForm.tsx` — both already forward `readOnly` and the new behavior is internal to `DescriptionField`.

## Proposed Implementation
### Frontend Changes
#### Change 1 — `Field.tsx`: add an optional `action` slot in the label row
- **File:** `frontend/src/components/ui/Field.tsx`
- **What:** Extend `FieldProps` with `action?: ReactNode` (`:10-20`). In the label-row JSX (`:28-37`), render the action right-aligned. Concretely: make the label `<span>` a flex row that contains the icon + label text, and render `{action}` with a right-alignment utility (`ml-auto`) so it sits at the right edge of the label row on the same horizontal line as the label. When `action` is undefined, behavior is identical to today (zero impact on all other field consumers). Do not change label/error/children rendering.
- **Why:** Provides the slot for the DescriptionField Edit button without affecting other consumers.
- **Code reference:** `frontend/src/components/ui/Field.tsx:10-20`, `:28-37`
- **Accessibility:** The action is an interactive control (Button), so it must not be nested inside the `<label>` element in a way that binds it to the field — verify the `<label>` wrapping still makes sense; if nesting an interactive Button inside `<label>` is problematic, render the label row as a non-`<label>` element OR keep the existing `<label>` structure but ensure the Button has its own accessible name and does not submit/toggle the label's htmlFor target. Prefer the simplest change that does not regress the label-for-input association; note the chosen approach in the implementation.

#### Change 2 — `DescriptionField.tsx`: read-first with edit-on-demand
- **File:** `frontend/src/components/ticket-fields/DescriptionField.tsx`
- **What:**
  - Add `import { useState, useEffect } from 'react'` and `import { Pencil } from 'lucide-react'` (icon convention per `LabelManager.tsx:7`), plus the existing `Button` from `@/components/ui/Button`.
  - Add local state: `const [isEditing, setIsEditing] = useState(false)` — default `false` means read-first.
  - Read submit-success from the form context to revert to read-only after a successful save: `const { isSubmitSuccessful } = useFormContext<TicketFormValues>().formState` (extend the existing `useFormContext` destructure at `:17-23`). Add a `useEffect(() => { if (isSubmitSuccessful) setIsEditing(false); }, [isSubmitSuccessful])`. Rationale: react-hook-form flips `isSubmitSuccessful` to `true` on a successful submit and back to `false` at the start of the next submit, so this fires correctly on each save. (In the current `TicketDetailModal` host the modal also unmounts on save, so local state dies either way — this effect is the robust, host-agnostic mechanism that guarantees "revert to read-only after save" even if a future host keeps the modal open.)
  - Rendering branch (currently gated on `readOnly` at `:30-37`): change the gate to `isEditing && !readOnly`.
    - Read branch (`!isEditing || readOnly`): render the existing sanitized-HTML `<div dangerouslySetInnerHTML={{ __html: sanitizeDescription(descriptionValue) }} />` unchanged.
    - Edit branch (`isEditing && !readOnly`): render the existing `<RichTextEditor value={descriptionValue} onChange={(html) => setValue('description', html)} />` unchanged.
    - `readOnly` always wins: when `readOnly` is true the field is always read-only and never enters edit mode (no Edit button shown, no editor).
  - Pass the Edit button through `Field`'s new `action` slot:
    - `<Field label="Description" error={errors.description?.message} icon={<AlignLeft size={14} />} action={!readOnly && !isEditing ? editButton : undefined}>`
    - The Edit button: `<Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(true)} aria-label="Edit description"><Pencil className="h-4 w-4" aria-hidden="true" /><span className="ml-1">Edit</span></Button>`. Use `variant="ghost" size="sm"` (the established low-emphasis convention — `Button.tsx:17-30`, `LabelManager.tsx:137-156`). `type="button"` is critical so it does not trigger the form's submit.
    - Hide the Edit button while editing (`!isEditing`) and when `readOnly` — so once the user enters edit mode there is no per-field toggle; they exit edit mode only via the global Save (which reverts via the `isSubmitSuccessful` effect). This matches the "no per-field Save/Cancel" constraint.
- **Why:** Changes the default to read-first and makes the editor opt-in via an Edit button, while keeping the global Save flow and dirty-guard intact.
- **Code reference:** `frontend/src/components/ticket-fields/DescriptionField.tsx:14-16` (props), `:17-23` (useFormContext), `:25-37` (render branches)

#### Change 3 — Tests
- **File:** `frontend/src/components/ticket-fields/DescriptionField.test.tsx`, `frontend/src/components/ui/Field.test.tsx`, `frontend/src/components/TicketDetailModal.test.tsx`
- **What:**
  - `DescriptionField.test.tsx`: add/extend tests covering: (a) defaults to read-only rendered HTML (no RichTextEditor/toolbar in the DOM) for an editable ticket; (b) clicking the Edit button reveals the RichTextEditor; (c) the Edit button is absent when `readOnly` is true (soft-deleted ticket); (d) after a successful form submit (`isSubmitSuccessful` becomes true) the component reverts to the read-only view; (e) the Edit button has `type="button"` and does not submit the form.
  - `Field.test.tsx` (if present): add a test that an `action` node renders right-aligned in the label row and is absent by default.
  - Re-run existing `TicketDetailModal.test.tsx` and any `TicketAttributeForm` tests; adjust assertions that assumed the editor is mounted by default for editable tickets.
- **Why:** Verify the new read-first/edit-on-demand behavior and backward compatibility.
- **Code reference:** `frontend/src/components/ticket-fields/DescriptionField.test.tsx`, `frontend/src/components/ui/Field.test.tsx`, `frontend/src/components/TicketDetailModal.test.tsx`

## Edge Cases & Risks
- **Soft-deleted tickets:** `readOnly === true` → no Edit button, always read-only rendered HTML. No behavior change from today for these.
- **Empty/blank description (including create mode):** read-first still applies — the read-only view renders empty and the Edit button is available. (The primary target is the edit modal; create mode inherits the same component behavior. If create-mode UX should start directly in the editor, that is a follow-up decision — flagged in Open questions.)
- **Discard-without-saving:** because there is no per-field Cancel, once the user clicks Edit the editor stays until the global Save. The existing dirty-guard / close-confirm still protects unsaved edits on close/navigation. If the user edits then closes without saving, the existing ConfirmDiscardDialog flow applies unchanged.
- **Repeated edits:** `isSubmitSuccessful` toggles per submit, so reverting works across multiple edit→save cycles within the same modal session (should a host keep the modal open).
- **Keyboard/accessibility:** the Edit button must be keyboard-reachable and announce its purpose; `aria-label="Edit description"` plus the visible "Edit" text. Ensure placing a `<button>` inside `Field`'s label row does not break the label-input association.
- **RichTextEditor value sync:** mounting the editor on Edit re-initializes it from the current `descriptionValue` (RichTextEditor `:237-242` syncs external value), so no stale content on re-entry.

## Testing
- Frontend: Vitest + Testing Library (existing stack) as described in Change 3; co-locate `*.test.tsx` next to source.
- Manual verification: open a live ticket → description shows as read-only HTML (no caret/toolbar); click Edit → editor appears with toolbar; edit + click global "Save changes" → on success the description reverts to read-only rendered view and the modal closes (current host) / reverts (if kept open); open a soft-deleted ticket → no Edit button, read-only HTML; verify the dirty-guard/close-confirm still fires for unsaved description edits.
- Run the full existing frontend test suite to confirm no regressions in `Field` consumers and modal/form tests.

## Acceptance Criteria
- [ ] For an editable (non-deleted) ticket, the description renders as read-only sanitized HTML by default (no RichTextEditor mounted).
- [ ] A small low-emphasis "Edit" button (ghost/sm + pencil icon) appears right-aligned in the Description label row for editable tickets.
- [ ] Clicking Edit reveals DEL-01's `<RichTextEditor>`; the Edit button is hidden while editing.
- [ ] After a successful global Save, the description reverts to the read-only rendered view (`isEditing` resets via `isSubmitSuccessful`).
- [ ] For soft-deleted / `readOnly` tickets, no Edit button is shown and the field stays read-only rendered HTML.
- [ ] The single global "Save changes" persists the description together with all other fields (no per-field Save/Cancel, no auto-save).
- [ ] The existing dirty-guard and close-confirm behavior is unchanged.
- [ ] `Field` change is backward compatible — no other field's layout or behavior changes.
- [ ] New and updated tests pass; full frontend suite is green.

## Out of Scope
- No per-field Save or Cancel buttons inside the description area.
- No auto-save.
- No new permission/canEdit model — `readOnly` continues to be derived solely from `ticket.deletedAt` / the host's `readOnly` prop (no new role/permission signal is introduced).
- No changes to the global Save flow, the dirty-guard, the close-confirm dialog, or backend persistence.
- No changes to `RichTextEditor` itself (DEL-01 is merged and reused as-is).
- Create-mode-specific UX tuning (starting directly in the editor) is deferred.

## Open Questions *(optional)*
1. **Create mode:** Should `TicketAttributeForm` in `mode='create'` start directly in the editor (since there is nothing to read), or keep the read-first default for consistency? Recommendation: keep read-first for a single component behavior; revisit if create-mode UX feedback requests otherwise.
2. **Label semantics:** Is nesting the Edit `<button>` inside `Field`'s `<label>` element acceptable, or should the label row be restructured to a non-`<label>` wrapper with an explicit `htmlFor`/`aria-labelledby`? The implementer should pick the option that preserves the existing label-for-input association and passes accessibility checks; flag the chosen approach.
3. **Discard-from-edit affordance:** With no per-field Cancel, is it acceptable that the only way to exit edit mode is the global Save (with the existing close-confirm protecting unsaved edits on close)? Assumed yes per the "no per-field Save/Cancel" constraint; confirm if a future "collapse editor" affordance is desired.

## Evidence *(key path:line citations for implementer)*
- `frontend/src/components/ticket-fields/DescriptionField.tsx:14-16` (props), `:17-23` (useFormContext), `:25-37` (render branches).
- `frontend/src/components/ui/Field.tsx:10-20` (FieldProps), `:28-37` (label-row JSX).
- `frontend/src/components/ui/Button.tsx:17-30` (variant/size classes — use `ghost`/`sm`).
- `frontend/src/components/LabelManager.tsx:7,137-156` (established low-emphasis Edit button + `Pencil` icon convention).
- `frontend/src/components/RichTextEditor.tsx:44-48` (props), `:237-242` (external value sync on mount).
- `frontend/src/components/TicketDetailModal.tsx:292` (consumer: `readOnly={!!ticket.deletedAt}`), `:241-245` (success path clears dirty + closes modal).
- `frontend/src/components/TicketAttributeForm.tsx:79` (consumer: `readOnly={readOnly}`), `:73` (fieldset disabled), `:97-108` (global Save button).
- `frontend/src/hooks/useTicketForm.ts:31-33,51-57` (RHF setup + dirty hoist).
- `frontend/src/utils/sanitizeHtml.ts:43-69` (`sanitizeDescription`, reused unchanged).
