# Task Breakdown — DEL-01
**Plan:** `.context/pm-cycles/pm-cycle-2026-07-03-15-36-20/implementation/DEL-01-pinned-modal-footer-plan.md` (authoritative)
**Spec:** `.context/pm-cycles/pm-cycle-2026-07-03-15-36-20/deliverables/DEL-01-pinned-modal-footer.md`
**Generated:** 2026-07-03

> **Note:** The plan linked above is authoritative — defer to it on any ambiguity. Git/commits are owned by the orchestrator: these tasks only `git add` and commit their **own** listed files. Never stage `.pi/settings.json`, never stage unrelated `.context/` files, never `git add -A` or `git add .`.

---

## Parallelization Strategy

This is a small 4-file change with a **mostly-serial** chain and **one independent prerequisite** (T1). Honest parallelism is limited: T1 is fully independent and lands first; within the feature work, T2's source file and T3's test file are disjoint, but T3 is behaviorally gated on T2, so they run serially. The chain is `T1 → T2 → T3 → (T4 gate)`. No two tasks run concurrently.

### Batch / Dependency Diagram
```
Batch 1: [T1] ──> Batch 2: [T2] ──> Batch 3: [T3] ──> Batch 4: [T4 gate]
```

### Merge-order rules
- Merge lower-numbered batches first: `T1 → T2 → T3 → (run T4 gate)`.
- T1 is committable on its own and is a no-op for all 7 other Modal consumers.
- T2 cannot typecheck before T1 (it passes the new `footer` prop).
- T3 cannot pass before T2 (it asserts the new footer/Cancel behavior).
- Within a batch, files are disjoint, so there is zero merge-conflict surface. (There is no within-batch parallelism here — every batch is a single task.)

### Summary
| # | Batch | Target File | Dependencies | Can Parallel With |
|---|-------|-------------|--------------|-------------------|
| T1 | 1 | `frontend/src/components/Modal.tsx`, `frontend/src/components/Modal.test.tsx` | None | — (prerequisite; lands first) |
| T2 | 2 | `frontend/src/components/TicketDetailModal.tsx` | T1 | — |
| T3 | 3 | `frontend/src/components/TicketDetailModal.test.tsx` | T2 | — |
| T4 | 4 | _(none — read-only gate)_ | T1, T2, T3 | — |

### Suggested developer tracks
- **Track A — Shared-UI:** T1 (Modal.tsx + Modal.test.tsx). Done after T1.
- **Track B — Feature:** T2 (TicketDetailModal.tsx) → T3 (TicketDetailModal.test.tsx). Starts after T1 lands.
- **Gate:** T4 (any engineer) after T3.

---

## Tasks

### T1 — Add backward-compatible optional footer prop to shared Modal + its tests
**Description:** Add an optional `footer?: ReactNode` to `ModalProps` in `frontend/src/components/Modal.tsx`, branching the panel layout so that **legacy mode (footer omitted) is byte-identical to today** and **footer mode** becomes a flex column with a pinned footer slot and a single internal scroll region. Add two tests to `Modal.test.tsx` without modifying any existing test.
- `frontend/src/components/Modal.tsx`:
  - Add `footer?: ReactNode;` to `ModalProps`; derive `const hasFooter = footer !== undefined;` (a `null` footer → legacy mode).
  - `MODAL_SIZE_CLASS` record (line 12) is unchanged; the `max-w-*` size class **stays on the panel div in both branches** (asserted by tests).
  - `useModalA11y({ isOpen, onClose, onEsc })` → `dialogRef` (line 48) **MUST remain on the panel `role="dialog"` div** (line 60) in **both** branches — focus trap / Esc / scroll-lock depend on it; footer buttons must stay panel descendants.
  - **Legacy branch** (`hasFooter === false`, DEFAULT — lines 66-67 region): panel className byte-identical to today — `'max-h-[90vh] w-full overflow-y-auto rounded-lg border border-border bg-background p-6 text-foreground shadow-xl outline-none'` + `MODAL_SIZE_CLASS[size]`; header keeps `'mb-4 flex items-center justify-between'`; children render directly. **Zero change from current code.**
  - **Footer branch** (`hasFooter === true`): panel becomes `'max-h-[90vh] w-full flex flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-xl outline-none'` + `MODAL_SIZE_CLASS[size]` (drop `overflow-y-auto` + `p-6`; add `flex flex-col overflow-hidden`; **keep** `max-h-[90vh]` and the `max-w-*` size class). Header wrapper: `'shrink-0 px-6 pt-6 pb-4 flex items-center justify-between'` (drop `mb-4`). Body wrapper (sole scroll region): `<div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>`. Pinned footer slot (panel child, NOT `position:fixed`): `<div className="shrink-0 border-t border-border bg-background px-6 py-4">{footer}</div>`.
- `frontend/src/components/Modal.test.tsx` (ADD only; existing tests untouched):
  - **ADD** `it('renders the footer slot inside the dialog when footer is provided')` — render `<Modal … footer={<button>OK</button>}>`; assert the OK button is present and `within(dialog)` (footer inside the panel, not fixed); assert `dialog` panel has classes `flex` and `overflow-hidden`; assert a descendant body wrapper has class `overflow-y-auto`; assert a descendant footer slot has class `border-t`.
  - **ADD** `it('keeps legacy panel classes (overflow-y-auto, p-6) when footer is omitted')` — render `<Modal …>` with no footer; assert `dialog` has classes `overflow-y-auto` and `p-6`; assert NO pinned footer slot (no `border-t` region) is rendered.
  - The existing table-driven size tests (lines 107-137) and "defaults to max-w-lg" (line 128) stay green unchanged because the `max-w-*` class remains on the panel in both branches.

**Acceptance criteria:**
- [ ] Omitting `footer` produces byte-identical panel classes incl. `overflow-y-auto p-6` (regression-guard test passes).
- [ ] Passing `footer` yields a `flex flex-col overflow-hidden` panel, a `min-h-0 flex-1 overflow-y-auto` body region, and a `shrink-0 border-t …` pinned footer slot — all inside the dialog panel.
- [ ] `dialogRef` remains on the panel div in both branches.
- [ ] All existing `Modal.test.tsx` tests still pass; the 7 other Modal consumers are visually/behaviorally unchanged.

**Dependencies:** None (prerequisite for T2).
**Subtasks:**
- (a) Add `footer?: ReactNode` prop + `hasFooter` derivation.
- (b) Implement the two-branch panel layout (legacy byte-identical; footer-mode flex column) keeping `dialogRef` on the panel.
- (c) Add the two new `Modal.test.tsx` tests; keep existing tests untouched.

**Git:**
- Stage exactly: `git add frontend/src/components/Modal.tsx frontend/src/components/Modal.test.tsx`
- Commit message: `DEL-01: add backward-compatible optional footer prop to Modal`

---

### T2 — Pin TicketDetailModal footer (Save / Cancel / Delete) and remove the in-grid footer
**Description:** Move the TicketDetailModal footer buttons into a `modalFooter` node passed to `<Modal footer={…}>`, extract a shared valid-submit handler, add a Cancel button that reuses the existing `requestClose`, delete the old in-grid footer row, and relax the right sidebar's nested scroll. All work is in `frontend/src/components/TicketDetailModal.tsx`.
- Extract a shared `handleValidSubmit` at component scope reusing the **exact** inline logic currently on `<form onSubmit>` (line 230): `await handleSubmit(values); setIsDirty(false); onClose();`.
- Wire it to **both** submit entry points:
  - `<form onSubmit={methods.handleSubmit(handleValidSubmit)}>` (native submit; Enter key).
  - Footer Save button: `onClick={() => methods.handleSubmit(handleValidSubmit)()}` (RHF programmatic submit; jsdom-safe). The footer renders **outside** the `<form>` (Modal owns the footer slot), so the Save button must be `type="button"` + `onClick` — **never** `type="submit"`, and **do NOT use the HTML5 `form` attribute** (jsdom-fragile).
- Declare `let modalFooter: React.ReactNode = null;` alongside `let modalBody` (line 198). In the **resolved (`else`) branch only** (line 228 region), set `modalFooter` to a `<div className="flex items-center justify-end gap-2">` with children, left→right:
  - **Delete** — preserve exactly: `{canDelete && !ticket.deletedAt && (<Button type="button" variant="destructive-outline" onClick={() => setDeleteConfirmOpen(true)}>Delete ticket</Button>)}`. (`canDelete` from line 87; `setDeleteConfirmOpen` from line 72; existing `onClick` from line 391.)
  - **Cancel** — `<Button type="button" variant="secondary" onClick={requestClose}>Cancel</Button>` (reuses existing confirm-if-dirty `requestClose` at line 164; do NOT touch `requestClose`/`useBlocker`/`blockBackdropClose`/`handleDiscard`/`handleCancelConfirm`).
  - **Save** — `{!ticket.deletedAt && (<Button type="button" variant="primary" disabled={methods.formState.isSubmitting} onClick={() => methods.handleSubmit(handleValidSubmit)()}>{methods.formState.isSubmitting ? 'Saving…' : 'Save changes'}</Button>)}`. Disable Save **only** while submitting (do NOT add disable-when-clean — out of scope).
- **DELETE** the old in-grid footer row (line 378: `<div className="col-span-full mt-2 flex items-center justify-end gap-2 border-t border-border pt-4"> … </div>`) from inside the `<form>`.
- **Loading / error / not-found branches** (lines 200, 202) leave `modalFooter = null` → Modal renders legacy mode (no footer slot), matching current behavior.
- Pass the footer at the render site (lines 407-414): add `footer={modalFooter}` to `<Modal>` (alongside the existing `onClose={requestClose}`, `onEsc={requestClose}`, `title={modalTitle}`).
- **Relax the double scroll region:** remove `lg:max-h-[80vh] lg:overflow-y-auto` from the right sidebar wrapper (line 302) so left + right columns scroll together inside the Modal body while the footer stays pinned. (The `forceMount+hidden` RHF-state-preservation behavior depends on mount, not scroll — unaffected.)

**Acceptance criteria:**
- [ ] Footer shows Save Changes (primary), Cancel (secondary), Delete ticket (destructive-outline) in the pinned slot for a resolved, non-deleted, deletable ticket.
- [ ] Save hidden when `ticket.deletedAt`; Delete gated on `canDelete && !ticket.deletedAt`; Save disabled only while submitting.
- [ ] Cancel calls `requestClose` (clean→`onClose`; dirty→confirm). Existing discard/blocker flow untouched.
- [ ] Old in-grid footer row removed; the form still submits via Enter (native) and via the footer Save (`onClick`→`methods.handleSubmit`).
- [ ] No nested scrollbar on desktop (sidebar independent scroll removed). No `form` attribute used.

**Dependencies:** T1 (needs the `footer` prop to typecheck).
**Subtasks:**
- (a) Extract `handleValidSubmit` and rewire `<form onSubmit>` to use it.
- (b) Build `modalFooter` (Delete·Cancel·Save) in the resolved branch with exact gating; `null` in other branches.
- (c) Pass `footer={modalFooter}` to `<Modal>`; delete the old in-grid footer row.
- (d) Relax the right-sidebar `lg:max-h-[80vh] lg:overflow-y-auto`.

**Git:**
- Stage exactly: `git add frontend/src/components/TicketDetailModal.tsx`
- Commit message: `DEL-01: pin TicketDetailModal footer with Save, Cancel, and Delete`

---

### T3 — Update + extend TicketDetailModal tests for the pinned footer and Cancel
**Description:** Update the existing footer assertion test and add Cancel-behavior + footer-inside-panel tests in `frontend/src/components/TicketDetailModal.test.tsx`, keeping the existing submit and dirty-guard tests untouched.
- **UPDATE** the test at line 858 (`'footer: renders Save changes (no Cancel button)'`) → rename e.g. `'footer: renders Save changes, Cancel, and Delete ticket'`. Change the Cancel assertion from `not.toBeInTheDocument()` → `toBeInTheDocument()` (Cancel now exists). Keep the Save + Delete assertions. *(In this clean-state test the footer Cancel is the only `Cancel` button in the document, so an unscoped `getByRole('button', { name: 'Cancel' })` is unambiguous.)*
- **ADD** `it('footer Cancel: closes when clean; opens discard confirm when dirty')` — two sub-cases:
  - **Clean:** render resolved ticket, click footer `Cancel` → assert `onClose` called AND ConfirmDiscardDialog NOT in the document.
  - **Dirty:** render resolved ticket, edit a field to make `isDirty` true, click the footer `Cancel` while the confirm is still closed (it is the only Cancel at click time) → assert ConfirmDiscardDialog IS now in the document. Reuse the same confirm-node lookup the existing dirty-guard test at line 431 uses, then scope any further Cancel query via `within(confirm)` to disambiguate from the footer Cancel.
- **(Optional but recommended) ADD** `it('footer buttons render inside the dialog panel (not browser-fixed)')` — assert Save/Cancel/Delete are all `within(dialog)`.
- **Keep untouched:** the existing submit test (line 366, which clicks Save) — Save now submits via `onClick`→`methods.handleSubmit(handleValidSubmit)` instead of native form submit, but the observable outcome (onSubmit called, modal closes) is identical. The existing dirty-guard test (line 431) already scopes the confirm's Cancel with `within(confirm)` — unaffected by the new footer Cancel. Do NOT modify these two tests.

**Acceptance criteria:**
- [ ] Updated line-858 test passes and now expects Cancel to be in the document.
- [ ] New clean/dirty Cancel test passes (clean→`onClose` + no confirm; dirty→ConfirmDiscardDialog opens).
- [ ] (If added) footer-inside-panel assertion passes.
- [ ] Existing submit test (line 366) and dirty-guard test (line 431) still pass unchanged.

**Dependencies:** T2 (asserts the new footer/Cancel behavior).
**Subtasks:** _(none — single test file; follow the UPDATE/ADD items above.)_

**Git:**
- Stage exactly: `git add frontend/src/components/TicketDetailModal.test.tsx`
- Commit message: `DEL-01: update TicketDetailModal tests for pinned footer and Cancel`

---

### T4 — Verification gate: lint, typecheck, full test suite, regression check (read-only; no commit)
**Description:** A read-only gate run **after** T3. Do NOT stage or commit anything — confirm the whole change is green and regression-free.
- Run `npm run lint -w frontend` — must be clean.
- Run `npm run typecheck` / `tsc --noEmit` for the frontend workspace — must be clean (especially confirms T2's `footer` prop usage against T1's `ModalProps`).
- Run `npm test -w frontend` (Vitest) — full suite green. Specifically confirm:
  - `frontend/src/components/Modal.test.tsx` — all existing tests + the 2 new footer tests green.
  - `frontend/src/components/TicketDetailModal.test.tsx` — updated line-858 test + new Cancel tests + existing submit/dirty-guard tests green.
  - The 7 other Modal consumers' tests green (no regression): AddMemberModal, TicketNotFound, ConfirmDialog, ConfirmDiscardDialog, CreateTicketModal, DeleteTicketConfirm, etc.
- Spot-check there is no nested scrollbar / double-scroll and the footer is inside the panel (covered by T1/T3 assertions).

**Acceptance criteria:**
- [ ] Lint clean; typecheck clean; full Vitest suite green; no other-modal-consumer regression.

**Dependencies:** T1, T2, T3.
**Subtasks:** _(none — gate, not a code change.)_

**Git:**
- Stage: **N/A** (read-only; no files staged, no commit). If a commit is truly required, a `chore`-style empty commit is acceptable, but prefer no commit. The orchestrator may simply note the gate passed.

---

*Closing note:* This is a 4-file, ~4-task change with a serial `T1 → T2 → T3 → (T4 gate)` shape and one independent prerequisite (T1). Files are disjoint per task, so there is zero merge-conflict surface within any batch.
