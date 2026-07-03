# Implementation Plan — DEL-03
**Ticket:** `DEL-03 — De-nest the CommentForm and ManualEntryForm from the outer React-Hook-Form edit form`
**Type:** Bug fix
**Title:** De-nest the CommentForm and ManualEntryForm from the outer React-Hook-Form edit form (eliminate React 19 invalid nested-`<form>` DOM warning)
**Generated:** 2026-07-03

> **Workflow note:** Work directly on branch `main`. DO NOT create a branch. Commit prefix: `DEL-03:` (single-line commits). Package manager: **npm ONLY** (npm-workspaces; run tests with `npm test -w frontend`).

---

## Summary
The card-detail modal (`TicketDetailModal.tsx`) hosts ONE outer React-Hook-Form `<form onSubmit={methods.handleSubmit(handleValidSubmit)}>` (line ~245) wrapped in `<FormProvider {...methods}>` (line ~244). Two inner `<form>` elements are nested inside it:

- `CommentForm.tsx` (~line 57): `<form onSubmit={handleSubmit} className="flex flex-col gap-2">`.
- `ManualEntryForm.tsx` (~line 59): `<form onSubmit={handleSubmit} className="mt-3 border-t border-border pt-3">`.

Nested `<form>` elements are invalid HTML; React 19 emits a `validateDOMNesting` console/DOM warning. Fix: replace each inner `<form>` with a non-form container that retains a11y semantics (`role="group"` + `aria-label`), change each inner submit button from `type="submit"` to `type="button"` + `onClick`, and — for ManualEntryForm only — add an explicit Enter-to-submit `onKeyDown` handler to the two single-line inputs (CommentForm's textarea keeps default Enter=newline). The outer RHF edit form, its dirty-state/discard flow, and all validation rules are unchanged.

## Root Cause
Invalid DOM nesting: two `<form>` elements are descendants of the outer edit `<form>`. React 19 warns on this. The forms still function today (RHF fields register via `FormProvider` context, not DOM ancestry), so this is a warning-elimination task with strict behavior-preservation constraints.

Critically, simply removing the inner `<form>` wrappers WITHOUT changing the inner buttons to `type="button"` would cause a behavior regression: a `<button type="submit">` with no inner `<form>` ancestor submits its nearest ancestor `<form>` (the outer ticket-edit form), which would commit the ticket edit and close the modal. Likewise, Enter in ManualEntryForm's single-line inputs (still descendants of the outer form) would submit the outer form once the inner form is gone — so an explicit keydown intercept is required.

## Affected Components (exact)

| Layer | File | Why |
|-------|------|-----|
| Frontend | `frontend/src/components/CommentForm.tsx` | MODIFY — de-nest container, button type, handler signature. |
| Frontend | `frontend/src/components/ManualEntryForm.tsx` | MODIFY — de-nest container, button type, add Enter-to-submit keydown, handler signature. |
| Test | `frontend/src/components/ManualEntryForm.test.tsx` | CREATE — new co-located test file. |
| Test | `frontend/src/components/CommentForm.test.tsx` | NO CHANGES — all tests are click-based via `fireEvent.click(getByRole('button', {name}))` + `getByLabelText`; none query a `<form>` element. Must keep passing unchanged. |

**NOT MODIFIED (out of scope):** `TicketDetailModal.tsx` (outer form stays), `CommentsSection.tsx`, `useTicketForm.ts`, all ticket-field components, validation utilities.

**Consumer facts (verified):** CommentForm has exactly ONE prod consumer — `CommentsSection.tsx` (create-mode ~line 78, edit-mode ~line 97), both rendered inside the outer form. ManualEntryForm has exactly ONE prod consumer — `TicketDetailModal.tsx:534` via the inline `TimerTrackingPanel` component defined in the same file at ~line 509 (**NOTE:** there is NO `TimerTrackingPanel.tsx` file), rendered inside the outer form within a `<Collapsible>`. Whole-repo grep confirms no other consumers of either component.

## Proposed Implementation

### 4.1 CommentForm.tsx

#### (a) Handler type change
Currently `handleSubmit` is typed for a native submit event and is referenced as `onSubmit` of the inner `<form>`:

```tsx
const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (isDisabled) return;
    onSubmit(trimmed);
    if (mode === 'create') setBody('');
};
```

Change the event type so it is a valid `onClick` handler (keep `preventDefault` — it is a harmless no-op on a `type="button"` click, retained per spec guidance; the real guards are `isDisabled` and the create/edit clear logic). Update the import: replace the `FormEvent` type import with `MouseEvent` from `react`:

```tsx
// import line change:
import { useState, type MouseEvent } from 'react';   // was: type FormEvent

const handleSubmit = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (isDisabled) return;
    onSubmit(trimmed);
    if (mode === 'create') setBody('');
};
```

#### (b) Container de-nest
Replace the inner `<form>` with a `<div role="group">` that has an accessible label. KEEP the className. The accessible label **MUST** differ from the textarea's existing `aria-label` values (`'Write a comment'` for create, `'Edit comment'` for edit) — see §6 edge case / a11y.

```tsx
// BEFORE (~line 57):
<form onSubmit={handleSubmit} className="flex flex-col gap-2">

// AFTER:
<div role="group" aria-label={mode === 'edit' ? 'Comment editor' : 'Comment composer'} className="flex flex-col gap-2">
```

Close tag: change the matching `</form>` to `</div>`.

#### (c) Submit button
Change `type="submit"` → `type="button"` and add `onClick={handleSubmit}`. Do this for BOTH the create-mode button and the edit-mode button. The edit-mode Cancel button is **ALREADY** `type="button"` with `onClick={handleCancel}` — leave it unchanged.

```tsx
// BEFORE (create-mode submit):
<Button type="submit" variant="primary" size="sm" disabled={isDisabled}>{label}</Button>

// AFTER (create-mode submit):
<Button type="button" variant="primary" size="sm" disabled={isDisabled} onClick={handleSubmit}>{label}</Button>
```

```tsx
// BEFORE (edit-mode submit, inside <div className="flex gap-2">):
<Button type="submit" variant="primary" size="sm" disabled={isDisabled}>{label}</Button>

// AFTER (edit-mode submit):
<Button type="button" variant="primary" size="sm" disabled={isDisabled} onClick={handleSubmit}>{label}</Button>
```

#### (d) Textarea — UNCHANGED
Do **NOT** add a `onKeyDown` handler. Enter must remain a newline (default textarea behavior). The textarea keeps `aria-label={textareaLabel}` (`'Write a comment'`/`'Edit comment'`), `maxLength`, `rows`, `className`.

### 4.2 ManualEntryForm.tsx

#### (a) Handler type change
`handleSubmit` is currently `React.FormEvent` and referenced as the inner form `onSubmit`. It will now be called from BOTH the button `onClick` (MouseEvent) and the inputs' `onKeyDown` (KeyboardEvent). Type it as `React.SyntheticEvent` (common base of both; has `preventDefault`). Keep `preventDefault` and all existing logic/bounds/trim/mutation.

```tsx
// BEFORE:
const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const minutes = parseDuration(duration);
    if (minutes === null || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
        setValidationError('Enter a duration between 1m and 1440m (24h)');
        return;
    }
    setValidationError(null);
    void mutation.mutate({ minutes, description: description.trim() || undefined });
};

// AFTER (only the type changes; body identical):
const handleSubmit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    const minutes = parseDuration(duration);
    if (minutes === null || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
        setValidationError('Enter a duration between 1m and 1440m (24h)');
        return;
    }
    setValidationError(null);
    void mutation.mutate({ minutes, description: description.trim() || undefined });
};
```

> **Note:** `React.SyntheticEvent` uses the React namespace, which is already in use in this file via `React.FormEvent` — no new import needed. Constants `MIN_MINUTES = 1`, `MAX_MINUTES = 1440`, `MAX_DESCRIPTION = 500` are unchanged.

#### (b) Container de-nest
Replace the inner `<form>` with a `<div role="group">` + accessible label. KEEP the className. Label must differ from `'Duration'`, `'Description'`, `'Log Time'`, `'Logging…'`.

```tsx
// BEFORE (~line 59):
<form onSubmit={handleSubmit} className="mt-3 border-t border-border pt-3">

// AFTER:
<div role="group" aria-label="Manual time entry" className="mt-3 border-t border-border pt-3">
```

Close tag: change matching `</form>` to `</div>`.

#### (c) Submit button
`type="submit"` → `type="button"`, add `onClick={handleSubmit}`. Keep `disabled={mutation.isPending}` and the `'Logging…'`/`'Log Time'` label swap.

```tsx
// BEFORE:
<Button type="submit" variant="primary" size="sm" disabled={mutation.isPending}>
    {mutation.isPending ? 'Logging…' : 'Log Time'}
</Button>

// AFTER:
<Button type="button" variant="primary" size="sm" disabled={mutation.isPending} onClick={handleSubmit}>
    {mutation.isPending ? 'Logging…' : 'Log Time'}
</Button>
```

#### (d) Enter-to-submit on BOTH single-line inputs (HARD REQUIREMENT)
Add an `onKeyDown` handler to each `<TextInput>` that intercepts Enter: call `e.preventDefault()` (this blocks the regression — without it, Enter would bubble and submit the OUTER ticket-edit form), then call `handleSubmit(e)`. Leave `type`, `value`, `onChange`, `placeholder`, `aria-label`, `maxLength`, `className` unchanged.

```tsx
// Duration input — ADD onKeyDown (other props unchanged):
<TextInput
    type="text"
    value={duration}
    onChange={(e) => setDuration(e.target.value)}
    placeholder="2h 30m, 90m, or 90"
    aria-label="Duration"
    className="flex-1 text-sm"
    onKeyDown={(e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSubmit(e);
        }
    }}
/>
```

```tsx
// Description input — ADD onKeyDown (other props unchanged):
<TextInput
    type="text"
    value={description}
    onChange={(e) => setDescription(e.target.value)}
    placeholder="Description (optional)"
    maxLength={MAX_DESCRIPTION}
    aria-label="Description"
    className="flex-1 text-sm"
    onKeyDown={(e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSubmit(e);
        }
    }}
/>
```

## Why This Is Safe for the Outer RHF Form / Dirty-State
Both inner components own LOCAL React state (CommentForm: `body`; ManualEntryForm: `duration`, `description`, `validationError`) — they are NOT registered with React-Hook-Form and do NOT participate in the outer `methods`/`FormProvider` state. The modal's `isDirty` is driven solely by the ticket-edit fields (Title/Description/Priority/Assignee/DueDate/Labels/Checklist) via `useTicketForm`'s `onDirtyChange: setIsDirty`. Therefore de-nesting the inner DOM containers has ZERO effect on dirty-state tracking or the confirm-if-dirty discard flow. No change is made to `TicketDetailModal.tsx`, `useTicketForm.ts`, or any ticket-field component.

## Edge Cases & Risks
- **a11y label collision (CRITICAL, would break CommentForm.test.tsx).** The existing tests call `screen.getByLabelText('Write a comment')` (create) and `screen.getByLabelText('Edit comment')` (edit) and expect EXACTLY ONE element (the textarea). `getByLabelText` matches ANY element bearing `aria-label` (default selector `*`), including a `<div role="group">`. If the group `aria-label` duplicated the textarea's label, the query would match 2 elements and throw. That is why the group labels are `'Comment composer'` (create) and `'Comment editor'` (edit) — distinct from the textarea labels. Do NOT set the group `aria-label` to `'Write a comment'` or `'Edit comment'`.
- **Outer-form submit regression.** If the inner submit button remained `type="submit"` after de-nesting, clicking it (or pressing Enter in a single-line input) would submit the OUTER ticket-edit form and close the modal. Mitigated by: button → `type="button"` + `onClick`; ManualEntryForm inputs → `onKeyDown` Enter with `preventDefault`.
- **CommentForm textarea Enter.** Must remain newline. Do NOT add a keydown/Enter-submit handler to the textarea.
- **ManualEntryForm Enter-to-submit must survive de-nesting.** Without the explicit `onKeyDown`, Enter would either do nothing (no inner form) OR, worse, submit the outer form (inputs are still outer-form descendants). The keydown handler restores Enter-to-submit for the manual entry and blocks the outer-form submit.
- **TypeScript event types.** Both handlers MUST be retyped (`FormEvent` → `MouseEvent<HTMLButtonElement>` for CommentForm; `React.FormEvent` → `React.SyntheticEvent` for ManualEntryForm) or the `onClick`/`onKeyDown` wiring will not compile.
- **Edit-mode CommentForm Cancel button** is already `type="button"` + `onClick` — leave unchanged.
- **ManualEntryForm validation precedence** (`validationError ?? mutation.error`) and bounds (1–1440 via `parseDuration`) are unchanged.

## Testing

**Run command:** `npm test -w frontend` (npm only; Vitest + jsdom; co-located `*.test.tsx`; setup at `frontend/src/test-setup.ts` already provides `@testing-library/jest-dom`, PointerEvent + ResizeObserver stubs, and env vars). Baseline ≈ 1028 passing (post-DEL-02).

**Backend:** N/A — frontend-only bug fix.
**Frontend:** Vitest + Testing Library. Co-locate `*.test.tsx` next to source.

### 7.1 `CommentForm.test.tsx` — DO NOT EDIT
All 6 cases drive submit via `fireEvent.click(getByRole('button', {name}))` and assert via `getByLabelText`/button names; none query a `<form>`. They must remain green UNCHANGED after the de-nest (the click path is identical whether the button submits a form or fires `onClick`). If any test unexpectedly fails, the likely cause is an a11y-label collision (see §6) — fix the label, not the test.

### 7.2 CREATE `frontend/src/components/ManualEntryForm.test.tsx`
Mirror established patterns (see `CommentForm.test.tsx` and `TicketDetailModal.test.tsx`):

- Canonical imports: `import { describe, it, expect, vi } from 'vitest'; import { render, screen, fireEvent } from '@testing-library/react'; import { QueryClient, QueryClientProvider } from '@tanstack/react-query'; import { ManualEntryForm } from './ManualEntryForm';` plus `import { addManualEntry } from '@/api/timer';`.
- Mock the timer API: `vi.mock('@/api/timer', () => ({ addManualEntry: vi.fn().mockResolvedValue({ id: 'e1' }), }));` (export anything else the module needs as `vi.fn()` if the import errors).
- Each test wraps render in a fresh `new QueryClient({ defaultOptions: { queries: { retry: false } } })` inside `QueryClientProvider`. Use ticketId `'t1'`.
- Use table-driven cases where the repo convention favors it (e.g. duration bounds).

**Test cases to cover:**

1. Renders as a group with accessible name `Manual time entry` AND contains no nested `<form>`: `screen.getByRole('group', { name: 'Manual time entry' })` exists; `container.querySelector('form')` is `null`.
2. Duration bounds validation (table-driven): valid inputs (`'1m'`→1, `'90'`→90, `'2h 30m'`→180, `'24h'`/`'1440m'`→1440) — clicking `'Log Time'` calls `addManualEntry('t1', { minutes: <n>, description: undefined })`; invalid inputs (`''`, `'abc'`, `'0m'`→0, `'1441m'`/`'25h'`) — renders the error `'Enter a duration between 1m and 1440m (24h)'` and does NOT call `addManualEntry`. Assert via `vi.mocked(addManualEntry).toHaveBeenCalledWith(...)` and `expect(addManualEntry).not.toHaveBeenCalled()`.
3. Description trimming: whitespace-only description → payload `description: undefined`; non-empty `'  Meeting  '` → payload `description: 'Meeting'`.
4. Button-click submit fires the mutation with the correct payload `{ minutes, description }`.
5. Clears both fields on success: after a successful submit, `getByLabelText('Duration')` and `getByLabelText('Description')` have value `''`.
6. Enter-to-submit on the Duration input: `fireEvent.keyDown(durationInput, { key: 'Enter' })` triggers submit (assert `addManualEntry` called).
7. Enter-to-submit on the Description input: same as above on the description input.
8. Pending/disabled state: with a controlled pending promise (or by asserting the label contract), the submit button reads `'Logging…'` and is `disabled` while pending.
9. Validation error element renders inside the group as an accessible/visible message when bounds fail.

### 7.3 (Optional) Verify React 19 nested-form warning is gone
Optionally render the full modal in `TicketDetailModal.test.tsx` (or a scratch test) and assert `console.error` is not called with a `validateDOMNesting`/`form` nested message. This is optional and must not make the suite flaky — keep it scoped.

### 7.4 Final
Run the full suite `npm test -w frontend` and confirm everything is green (existing + new).

## Acceptance Criteria
- [ ] No `<form>` element nested inside another `<form>` anywhere in the card-detail modal (both inner forms de-nested to `<div role="group">`).
- [ ] No React 19 nested-form console/DOM warning when the modal opens or during interaction.
- [ ] Comment create works exactly as before (button click → trimmed body submitted; field cleared in create mode).
- [ ] Comment edit-save works exactly as before (button click → trimmed body submitted; field NOT cleared; Cancel unchanged).
- [ ] Comment textarea Enter = newline (no Enter-to-submit).
- [ ] Manual time-entry create works exactly as before via button click, including duration bounds (1–1440) and description trim.
- [ ] Manual time-entry Enter-to-submit on BOTH single-line inputs is preserved (and does NOT submit the outer form).
- [ ] Ticket edit-save (outer form) works exactly as before.
- [ ] Confirm-if-dirty discard flow preserved (dirty-state tracking unaffected) — de-nesting touches only local component state.
- [ ] a11y landmarks preserved: de-nested containers carry `role="group"` + a distinct accessible label.
- [ ] `CommentForm.test.tsx` passes UNCHANGED; new `ManualEntryForm.test.tsx` passes; full `npm test -w frontend` suite is green.
- [ ] TypeScript compiles with the retyped handlers.

## Out of Scope
- No change to the outer RHF edit session (`TicketDetailModal.tsx` outer `<form>`/`FormProvider`, `useTicketForm`, ticket fields).
- No change to validation rules (`parseDuration`, bounds, maxLength).
- No modal layout restructuring beyond swapping the two inner `<form>` containers.
- No `CommentForm.test.tsx` edits (unless an a11y-label collision forces a label fix, in which case fix the label, not the test).
- No branch creation — work on `main`.

## Open Questions
- Accessible label wording: the proposed group labels (`'Comment composer'`/`'Comment editor'`, `'Manual time entry'`) are sensible defaults; confirm with the a11y/spec owner if a specific naming convention is preferred (only constraint: must stay distinct from the textarea/input aria-labels to avoid `getByLabelText` collisions).
- Whether to add a regression test asserting the full modal renders zero nested `<form>` elements (recommended but optional — see §7.3).

## Suggested Build Order
1. Edit `CommentForm.tsx`: handler type → `MouseEvent<HTMLButtonElement>` (+ import update), `<form>` → `<div role="group" aria-label=...>`, submit buttons → `type="button"` + `onClick={handleSubmit}` (create + edit).
2. Edit `ManualEntryForm.tsx`: handler type → `React.SyntheticEvent`, `<form>` → `<div role="group" aria-label="Manual time entry">`, button → `type="button"` + `onClick={handleSubmit}`, add Enter `onKeyDown` to both `<TextInput>`s.
3. Run `CommentForm.test.tsx` → confirm still green UNCHANGED.
4. Create `ManualEntryForm.test.tsx` (cases §7.2).
5. Run full suite `npm test -w frontend` → all green.
6. (Optional) verify no nested-form warning (§7.3).
7. Commit on `main`, single-line, prefix `DEL-03:`.
