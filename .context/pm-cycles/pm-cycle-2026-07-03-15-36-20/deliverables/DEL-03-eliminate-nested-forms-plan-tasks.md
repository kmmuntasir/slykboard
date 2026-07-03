# Task Breakdown — DEL-03
**Plan:** `.context/pm-cycles/pm-cycle-2026-07-03-15-36-20/deliverables/DEL-03-eliminate-nested-forms-plan.md`
**Generated:** 2026-07-03

---

## Deliverable Context

- **Deliverable:** DEL-03 — De-nest `CommentForm` and `ManualEntryForm` from the outer React-Hook-Form edit form (eliminate the React 19 invalid nested-`<form>` DOM warning).
- **Repo:** `/home/munna/speedo/localhost/slykboard` (React 19 + TypeScript + React-Hook-Form + TanStack Query + Vitest/jsdom monorepo).
- **Branch:** Work on `main` ONLY. **DO NOT** create a branch.
- **Package manager:** npm ONLY (npm-workspaces; frontend workspace = `frontend/`). Run tests via `npm test -w frontend` (script = `vitest run`). Co-located `*.test.tsx` next to source. Vitest `globals:true`, jsdom, setup at `frontend/src/test-setup.ts` (already provides `@testing-library/jest-dom`, `PointerEvent` + `ResizeObserver` stubs, env stubs).
- **Commits:** Single-line, prefix `DEL-03:` (e.g. `DEL-03: De-nest CommentForm into a labeled group container`). One commit per task.
- **Baseline:** ~1028 frontend tests passing (post-DEL-02). Recommend confirming baseline green before starting.

---

## Global Correctness Constraints (C1–C6 — apply across ALL tasks)

> **Read these first.** Every task references them. Violating any of C1–C5 causes a silent regression or a compile failure.

- **C1. OUTER-FORM-SUBMIT REGRESSION:** Every inner button that was `type="submit"` MUST become `type="button"` + `onClick={handleSubmit}`. A bare `type="submit"` button (or Enter in a single-line input) with no inner `<form>` ancestor would submit the OUTER RHF ticket-edit form and close the modal.
- **C2. A11Y LABEL COLLISION:** Each de-nested container gets `role="group"` + an `aria-label` that MUST differ from the textarea/input `aria-label`s. Otherwise `getByLabelText(...)` matches 2 elements and throws — this would break `CommentForm.test.tsx` (which asserts exactly one element). **Fix the LABEL, never the test.**
- **C3. ENTER BEHAVIOR:** Do NOT add any keydown/Enter handler to `CommentForm`'s `<Textarea>` (Enter = newline, default). DO add Enter-to-submit `onKeyDown` (`e.preventDefault()` then `handleSubmit(e)`) to BOTH of `ManualEntryForm`'s single-line `<TextInput>`s.
- **C4. TYPESCRIPT:** Handlers must be retyped or wiring won't compile.
  - `CommentForm`: `FormEvent` → `MouseEvent<HTMLButtonElement>` (and swap the import `type FormEvent` → `type MouseEvent`).
  - `ManualEntryForm`: `React.FormEvent` → `React.SyntheticEvent` (common base of `MouseEvent` + `KeyboardEvent`; **NO import change** — the `React` namespace resolves via the global `@types/react`, same as the existing `React.FormEvent`).
- **C5.** `CommentForm`'s edit-mode **Cancel** button is ALREADY `type="button"` + `onClick={handleCancel}` — leave it unchanged.
- **C6.** `CommentForm.test.tsx` MUST pass UNCHANGED. If anything there fails, the cause is an a11y-label collision — **fix the label, not the test.**

---

## Corrections to the Plan

These supersede the plan document where they differ:

1. **CommentForm has ONE shared submit button (not two).** The single `<Button>` at `CommentForm.tsx:78-80` is used in BOTH create and edit modes; its label is `label` ('Comment' create / 'Save' edit). There is no separate edit-mode submit button to convert.
2. **ManualEntryForm's `React.SyntheticEvent` needs NO import change.** The file imports only `useState` from `react` (`ManualEntryForm.tsx:1`) and uses the `React.` namespace via the global `@types/react` — exactly as the existing `React.FormEvent` already does. Only the param type changes, not the imports.

---

## Parallelization Strategy

Tasks are grouped into batches by dependency order. Run batches sequentially; within a batch, conflict-free tasks run in parallel.

### Batch / Dependency Diagram
```
T1 (CommentForm.tsx) ──────────────────────────────────────┐
                                                            │
T2 (ManualEntryForm.tsx) ──► T3 (ManualEntryForm.test.tsx) ─┴──► V — Final Verification: npm test -w frontend (full suite green)
```

### Merge-order rules
- **T1 and T2** touch disjoint files (`CommentForm.tsx` vs `ManualEntryForm.tsx`) — land in any order, **zero merge conflict**.
- **T3 MUST land AFTER T2** (it asserts T2's de-nested structure + Enter-to-submit behavior; it would fail against pre-T2 code).
- **V (final verification)** runs AFTER all three are committed.

### Summary
| # | Batch | Target File | Dependencies | Can Parallel With |
|---|-------|-------------|--------------|-------------------|
| T1 | A | `frontend/src/components/CommentForm.tsx` (MODIFY) | None | T2 |
| T2 | A | `frontend/src/components/ManualEntryForm.tsx` (MODIFY) | None | T1 |
| T3 | B | `frontend/src/components/ManualEntryForm.test.tsx` (CREATE) | T2 | — (Batch B; T1 already done) |
| V | — | (no file; full-suite run) | T1, T2, T3 | — |

### Suggested developer tracks
- **Track A — CommentForm:** T1 only.
- **Track B — ManualEntryForm:** T2 → T3.
- **T1 and T2 START concurrently (Batch A).** T3 follows T2 in Batch B. Then final verification.

---

## Tasks

---

### T1 — De-nest CommentForm's inner form into a labeled group container
**Batch:** A · **Target file (MODIFY only):** `frontend/src/components/CommentForm.tsx`
**Commit:** `DEL-03: De-nest CommentForm into a labeled group container`

**Description:**
Replace the inner `<form>` in `CommentForm` with a `<div role="group">` container so it no longer nests inside the outer React-Hook-Form ticket-edit `<form>` (the source of the React 19 `validateDOMNesting` warning). The single shared submit button converts from `type="submit"` to `type="button"` + `onClick={handleSubmit}`, and `handleSubmit` is retyped so the click wiring compiles. The textarea keeps default Enter = newline behavior (no keydown added). The edit-mode Cancel button is already correct and stays untouched.

Verified source refs (`path:line`):
- Import — `CommentForm.tsx:1` → `import { useState, type FormEvent } from 'react';`
- `handleSubmit` — `CommentForm.tsx:41-47` → `const handleSubmit = (event: FormEvent) => { event.preventDefault(); if (isDisabled) return; onSubmit(trimmed); if (mode === 'create') setBody(''); };`
- `<form>` open — `CommentForm.tsx:57` → `<form onSubmit={handleSubmit} className="flex flex-col gap-2">`
- `</form>` close — `CommentForm.tsx:82`
- Submit button — `CommentForm.tsx:78-80` (ONE shared button, used in create+edit; `label` = 'Comment' create / 'Save' edit): `<Button type="submit" variant="primary" size="sm" disabled={isDisabled}>{label}</Button>`
- Cancel button — `CommentForm.tsx:68-77`: already `type="button"` + `onClick={handleCancel}` (guarded by `mode === 'edit'`) — **UNCHANGED**.
- `<Textarea>` — `CommentForm.tsx:58-66`: `aria-label={textareaLabel}` (textareaLabel at `:54` = 'Edit comment' / 'Write a comment'), NO onKeyDown — leave as-is.
- Single prod consumer: `CommentsSection.tsx` (import `:23`, render create `:78` + edit `:97`).

**Subtasks:**
1. Swap the event-type import on `CommentForm.tsx:1`: `type FormEvent` → `type MouseEvent` (keep `useState`).
2. Retype `handleSubmit` param `FormEvent` → `MouseEvent<HTMLButtonElement>`; keep body unchanged (`preventDefault` is a harmless no-op on a `type="button"` click; keep the `isDisabled` guard, `onSubmit(trimmed)`, create-mode `setBody('')`).
3. De-nest container (`CommentForm.tsx:57`): `<form onSubmit={handleSubmit} className="flex flex-col gap-2">` → `<div role="group" aria-label={mode === 'edit' ? 'Comment editor' : 'Comment composer'} className="flex flex-col gap-2">`. Change the matching `</form>` (`:82`) → `</div>`.
4. Submit button (`CommentForm.tsx:78`): `type="submit"` → `type="button"` and add `onClick={handleSubmit}`.
5. Leave Cancel button (`:68-77`) and Textarea (`:58-66`) untouched.

**Acceptance Criteria:**
- [ ] No `<form>` element remains in `CommentForm.tsx` (grep confirms none).
- [ ] Container is `<div role="group">` with accessible name 'Comment composer' (create) / 'Comment editor' (edit) — distinct from textarea labels ('Write a comment' / 'Edit comment').
- [ ] Submit is wired via `onClick`; Cancel button unchanged; textarea Enter still inserts a newline (no keydown added).
- [ ] `frontend/src/components/CommentForm.test.tsx` passes UNCHANGED — run `npm test -w frontend -- CommentForm`.
- [ ] TypeScript compiles (no type errors from the retyped handler).

**Dependencies:** None.
**Can parallel with:** T2.
**Critical constraints:** C1, C2, C4, C5, C6.

---

### T2 — De-nest ManualEntryForm and add Enter-to-submit on its inputs
**Batch:** A · **Target file (MODIFY only):** `frontend/src/components/ManualEntryForm.tsx` (85 lines)
**Commit:** `DEL-03: De-nest ManualEntryForm and add Enter-to-submit on inputs`

**Description:**
Replace the inner `<form>` in `ManualEntryForm` with a `<div role="group" aria-label="Manual time entry">` container. The submit button converts to `type="button"` + `onClick`, and both single-line `<TextInput>`s get an Enter-to-submit `onKeyDown`. `handleSubmit` is retyped to `React.SyntheticEvent` (the common base of `MouseEvent` + `KeyboardEvent`) so the same handler works from both the button click and the Enter keydown — **with no import change** (the `React` namespace resolves via `@types/react`). All validation/bounds/trim logic is preserved.

Verified source refs (`path:line`):
- `handleSubmit` — `ManualEntryForm.tsx:39-51` → `const handleSubmit = (event: React.FormEvent) => { event.preventDefault(); const minutes = parseDuration(duration); if (minutes === null || minutes < MIN_MINUTES || minutes > MAX_MINUTES) { setValidationError('Enter a duration between 1m and 1440m (24h)'); return; } setValidationError(null); void mutation.mutate({ minutes, description: description.trim() || undefined }); };`
- Constants — `ManualEntryForm.tsx:18` `MIN_MINUTES = 1`, `:19` `MAX_MINUTES = 1440`, `:20` `MAX_DESCRIPTION = 500`.
- `<form>` open — `ManualEntryForm.tsx:59` → `<form onSubmit={handleSubmit} className="mt-3 border-t border-border pt-3">`; `</form>` close — `:83`.
- React import — `ManualEntryForm.tsx:1` → `import { useState } from 'react';` (named only; `React` namespace used via global at `:39` — NO default/namespace import).
- Duration `<TextInput>` — `ManualEntryForm.tsx:61-67`: type text, `value=duration`, `onChange setDuration`, placeholder '2h 30m, 90m, or 90', `aria-label 'Duration'`, `className 'flex-1 text-sm'`; NO maxLength; NO onKeyDown.
- Description `<TextInput>` — `ManualEntryForm.tsx:69-77`: type text, `value=description`, `onChange setDescription`, placeholder 'Description (optional)', `maxLength={MAX_DESCRIPTION}`, `aria-label 'Description'`, `className 'flex-1 text-sm'`; NO onKeyDown.
- Submit `<Button>` — `ManualEntryForm.tsx:78-80` → `<Button type="submit" variant="primary" size="sm" disabled={mutation.isPending}>{mutation.isPending ? 'Logging…' : 'Log Time'}</Button>`
- `mutation` — `ManualEntryForm.tsx:28-37` (`useMutation`; `mutationFn` `addManualEntry(ticketId, vars)`; `onSuccess` invalidates `timerKeys.entries(ticketId)` + clears fields). `addManualEntry` import `:6`; `parseDuration` import `:8`.
- `errorMessage` — `ManualEntryForm.tsx:55-56`; rendered `<p>` at `:82`.
- Single prod consumer: `TicketDetailModal.tsx` (import `:29`, render `:534` inside the INLINE `TimerTrackingPanel` declared at `:509`; there is NO `TimerTrackingPanel.tsx` file).

**Subtasks:**
1. Retype `handleSubmit` param `React.FormEvent` → `React.SyntheticEvent` (common base of `MouseEvent` + `KeyboardEvent` so the same handler works from `onClick` and `onKeyDown`). Keep `preventDefault` + ALL existing logic (`parseDuration`, 1–1440 bounds, `setValidationError`, trim-or-undefined mutation). **NO import change.**
2. De-nest container (`ManualEntryForm.tsx:59`): `<form onSubmit={handleSubmit} className="mt-3 border-t border-border pt-3">` → `<div role="group" aria-label="Manual time entry" className="mt-3 border-t border-border pt-3">`. Change matching `</form>` (`:83`) → `</div>`.
3. Submit button (`ManualEntryForm.tsx:78`): `type="submit"` → `type="button"` and add `onClick={handleSubmit}` (keep `disabled={mutation.isPending}` and the 'Logging…'/'Log Time' label swap).
4. Duration input (`ManualEntryForm.tsx:61-67`): ADD `onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit(e); } }}` (all other props unchanged; `preventDefault` blocks the Enter key from bubbling to the outer form).
5. Description input (`ManualEntryForm.tsx:69-77`): ADD the SAME `onKeyDown` Enter handler (all other props unchanged).
6. Leave mutation (`:28-37`), `addManualEntry` import (`:6`), `parseDuration` import (`:8`), constants (`:18-20`), and `errorMessage` `<p>` (`:82`) unchanged.

**Acceptance Criteria:**
- [ ] No `<form>` element remains in `ManualEntryForm.tsx`.
- [ ] Container is `<div role="group">` with accessible name 'Manual time entry' (distinct from Duration / Description / Log Time / Logging…).
- [ ] Button-click submit AND Enter on BOTH single-line inputs all invoke `handleSubmit` → mutation; Enter does NOT bubble to submit the outer form.
- [ ] Duration bounds (1–1440 via `parseDuration`) and description trim (whitespace → undefined) preserved.
- [ ] The indirect smoke test in `TicketDetailModal.test.tsx:564-569` (expands Collapsible, asserts 'Log Time' button + 'Duration' label present) stays green — it does not query the group, only the button and the Duration label.
- [ ] TypeScript compiles (handler accepts both `MouseEvent` and `KeyboardEvent` via `SyntheticEvent`).

**Dependencies:** None.
**Can parallel with:** T1.
**Critical constraints:** C1, C2, C3, C4.

---

### T3 — Create co-located ManualEntryForm.test.tsx
**Batch:** B · **Target file (CREATE):** `frontend/src/components/ManualEntryForm.test.tsx`
**Dependencies:** T2 (the test asserts T2's new structure: `container.querySelector('form')` is null, `getByRole('group', { name: 'Manual time entry' })`, Enter-to-submit on inputs).
**Commit:** `DEL-03: Add co-located tests for ManualEntryForm`

**Description:**
Create a co-located test file covering the de-nested structure, duration-bounds validation, description trimming, submit-on-click, field-clearing on success, Enter-to-submit on both inputs, the pending/disabled state, and the in-group validation message. It follows the established patterns from `TimerHeroCard.test.tsx` (simplest QueryClient provider, no router needed) and `CommentForm.test.tsx` (table-driven `it.each`). T3 asserts T2's de-nested structure and Enter-to-submit behavior, so it would fail against pre-T2 code.

**Conventions / verified source refs:**
- Component needs `QueryClientProvider` (uses `useMutation`/`useQueryClient`). Use the `TimerHeroCard.test.tsx` shape (simplest provider, no router needed) + `CommentForm.test.tsx` table-driven `it.each` style.
- Imports:
  ```ts
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
  import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { ManualEntryForm } from './ManualEntryForm';
  import { addManualEntry } from '@/api/timer';
  ```
- `vi.mock` all 5 timer exports (per `TicketDetailModal.test.tsx:90-102`): `startTimer`, `stopTimer`, `fetchActiveTimer`, `fetchTimeEntries`, and `addManualEntry: vi.fn().mockResolvedValue({ id: 'e1' })`.
- QueryClient factory: `new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })` (`TimerHeroCard.test.tsx:25-27`).
- Render wrapped in `<QueryClientProvider client={client}>`; pass `ticketId="t1"`. `beforeEach(() => vi.clearAllMocks())` + `afterEach(() => cleanup())`.
- `addManualEntry` signature (`frontend/src/api/timer.ts:37-45`): `(ticketId: string, body: { minutes: number; description?: string }) => Promise<...>`. Assert via `expect(vi.mocked(addManualEntry)).toHaveBeenCalledWith('t1', { minutes, description })` and `.not.toHaveBeenCalled()` for the invalid cases.
- Field labels in `ManualEntryForm`: Duration input `aria-label` 'Duration'; Description input `aria-label` 'Description'; submit button 'Log Time' (or 'Logging…' when pending); group accessible name 'Manual time entry'; validation error text 'Enter a duration between 1m and 1440m (24h)'.
- `test-setup.ts` already provides jest-dom matchers, `PointerEvent` + `ResizeObserver` stubs, env stubs. No need to repeat.

**Test cases (plan §7.2 — implement all):**
1. **Renders as a group with accessible name 'Manual time entry' AND contains no nested `<form>`:** `screen.getByRole('group', { name: 'Manual time entry' })` exists; `container.querySelector('form')` is `null`.
2. **Duration bounds (table-driven `it.each`):** valid — `'1m'`→1, `'90'`→90, `'2h 30m'`→180, `'24h'`/`'1440m'`→1440: clicking 'Log Time' calls `addManualEntry('t1', { minutes: <n>, description: undefined })`; invalid — `''`, `'abc'`, `'0m'`→0, `'1441m'`, `'25h'`: renders error 'Enter a duration between 1m and 1440m (24h)' and does NOT call `addManualEntry`. Use `vi.mocked(addManualEntry).toHaveBeenCalledWith(...)` / `.not.toHaveBeenCalled()`.
3. **Description trimming:** whitespace-only description → payload `description: undefined`; non-empty `'  Meeting  '` → payload `description: 'Meeting'`.
4. **Button-click submit** fires the mutation with the correct `{ minutes, description }` payload.
5. **Clears both fields on success:** after a successful submit, `getByLabelText('Duration')` and `getByLabelText('Description')` have value `''`.
6. **Enter-to-submit on the Duration input:** `fireEvent.keyDown(durationInput, { key: 'Enter' })` triggers submit (assert `addManualEntry` called).
7. **Enter-to-submit on the Description input:** same keyDown assertion on the description input.
8. **Pending/disabled state:** with a controlled pending promise (or by asserting the label contract), the submit button reads 'Logging…' and is disabled while pending.
9. **Validation error element** renders inside the group as a visible/accessible message when bounds fail.

**Acceptance Criteria:**
- [ ] All 9 cases pass — run `npm test -w frontend -- ManualEntryForm` (green).
- [ ] Uses the established QueryClient + `vi.mock` patterns; co-located next to `ManualEntryForm.tsx`.
- [ ] No flakiness: wrap async mutation assertions in `waitFor(...)`.
- [ ] TypeScript compiles.

**Dependencies:** T2.
**Can parallel with:** none in Batch B (T1 already landed in Batch A).
**Critical constraints:** C2 (test #1 itself enforces the distinct group label). **Coordinate** the exact label string 'Manual time entry' with T2's group `aria-label`.

**Optional sub-task** (plan §7.3 — do NOT make it required, must not add flakiness): a regression assertion that the full modal renders zero nested `<form>` elements (or a `console.error` spy asserting no `validateDOMNesting` form-nested warning). **Mark clearly OPTIONAL.**

---

## Final Verification Gate (no code change; no commit)

### V — Run the full frontend suite
**Batch:** — · **Target:** (no file; full-suite run)
**Dependencies:** T1 + T2 + T3.

**Steps:**
- (Recommended pre-step) confirm baseline ~1028 green BEFORE starting any task.
- After T1 + T2 + T3 land: run `npm test -w frontend` and confirm the ENTIRE suite is green — existing `CommentForm.test.tsx` (unchanged), the new `ManualEntryForm.test.tsx`, the `TicketDetailModal.test.tsx` indirect smoke test, and everything else.
- (Optional) confirm no React 19 nested-form `validateDOMNesting` console warning when the modal renders.
