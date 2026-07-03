# Implementation Plan — DEL-01
**Ticket:** `.context/pm-cycles/pm-cycle-2026-07-03-15-36-20/deliverables/DEL-01-pinned-modal-footer.md`
**Type:** Bug (usability regression)
**Title:** Pin card-detail modal footer; surface Save Changes + Cancel + Delete Ticket
**Generated:** 2026-07-03

---

## Summary

The ticket-detail modal footer (Save / Delete) lives inside `Modal.tsx`'s single scroll container (`max-h-[90vh] overflow-y-auto p-6`), so on long tickets the commit actions scroll out of view. The fix adds a **backward-compatible optional `footer?: ReactNode` prop** to the shared `Modal.tsx`. When omitted (the other seven consumers), behavior and classes are byte-identical to today. When passed by `TicketDetailModal`, the panel becomes a flex column with a pinned `shrink-0` footer slot and an internal `overflow-y-auto` body region, so the body scrolls while the footer stays visible.

`TicketDetailModal` extracts a shared valid-submit handler, moves its footer buttons into a `modalFooter` node passed to `<Modal footer={…}>`, and adds a **Cancel** button that reuses the existing confirm-if-dirty `requestClose` flow (no new discard flow).

## Root Cause

`frontend/src/components/Modal.tsx` renders one dialog panel with `max-h-[90vh] overflow-y-auto p-6`. The whole panel — header, body, and footer — is one scroll container. `TicketDetailModal` renders its Save/Delete footer as the last grid row inside that panel (the `<div className="col-span-full mt-2 … border-t border-border pt-4">` block in `frontend/src/components/TicketDetailModal.tsx`), so it scrolls away with long content. There is no pinned/sticky region and no Cancel affordance.

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| Shared UI | `frontend/src/components/Modal.tsx` | Add optional `footer?: ReactNode` prop + a footer-mode layout branch. Legacy (no-footer) branch must keep the panel `className` **exactly** as today so the 15 existing `Modal.test.tsx` assertions and all 7 other consumers are unaffected. |
| Feature | `frontend/src/components/TicketDetailModal.tsx` | Extract `handleValidSubmit`; build a `modalFooter` node (Save + Cancel + Delete) in the resolved branch; pass `footer={modalFooter}`; pass no footer for loading/error/not-found; remove the old in-grid footer row; relax the right sidebar's independent scroll. |
| Test | `frontend/src/components/Modal.test.tsx` | **ADD** tests for the footer prop (footer slot renders inside the dialog and is pinned; omitted footer keeps legacy panel classes incl. `overflow-y-auto`). No existing test changes. |
| Test | `frontend/src/components/TicketDetailModal.test.tsx` | **UPDATE** the `'footer: renders Save changes (no Cancel button)'` test (Cancel now exists); **ADD** a Cancel-behavior test (clean→closes; dirty→opens ConfirmDiscardDialog); **ADD/confirm** a footer-inside-panel assertion. |

No backend, no API, no type changes. `Button.tsx` is unchanged (it already spreads `...rest` and defaults `type='button'`).

## Proposed Implementation

### Change 1 — `Modal.tsx`: optional pinned footer prop (backward-compatible)

- Add to `ModalProps`: `footer?: ReactNode;`
- Derive `const hasFooter = footer !== undefined;` (a `null` footer is treated as "no footer" → legacy mode).
- Use the existing `cn(...)` helper to branch the panel classes:
  - **Legacy branch** (`hasFooter === false` — DEFAULT, all other consumers): panel className **exactly** `max-h-[90vh] w-full overflow-y-auto rounded-lg border border-border bg-background p-6 text-foreground shadow-xl outline-none` + `MODAL_SIZE_CLASS[size]`. Header stays `mb-4 flex items-center justify-between`. Children render directly after the header. **Zero change from current code.**
  - **Footer branch** (`hasFooter === true`):
    - Panel className: `max-h-[90vh] w-full flex flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-xl outline-none` + `MODAL_SIZE_CLASS[size]`. (Drop `overflow-y-auto` + `p-6`; add `flex flex-col overflow-hidden`. Keep `max-h-[90vh]` so the panel is the bounded viewport and the inner body scrolls. **Keep the size `max-w-*` class on the panel div** — this is asserted by tests.)
    - Header wrapper becomes `shrink-0` with top + horizontal padding (e.g. `shrink-0 px-6 pt-6 pb-4 flex items-center justify-between`; remove the old `mb-4`).
    - Render children inside a Modal-owned body wrapper — the single scroll region:
      `<div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>`
    - Render the footer in a pinned slot:
      `<div className="shrink-0 border-t border-border bg-background px-6 py-4">{footer}</div>`. This slot is a child of the panel (`role="dialog"`), **not** `position: fixed`, so it stays inside the dialog panel and participates in the focus trap.
- The `useModalA11y` `dialogRef` **MUST remain on the panel div** (`role="dialog"`) in **both** branches — do not move the ref to the body wrapper. The focus trap, Esc, and scroll-lock all key off the panel ref; the footer buttons are descendants of the panel, so they remain in the tab cycle.

*Sketch (footer branch structure only — not final code):*
```tsx
<div ref={dialogRef} role="dialog" … className={cn('max-h-[90vh] w-full flex flex-col overflow-hidden rounded-lg border …', MODAL_SIZE_CLASS[size])}>
  <div className="shrink-0 px-6 pt-6 pb-4 flex items-center justify-between">
    {/* title + X close (unchanged) */}
  </div>
  <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
  <div className="shrink-0 border-t border-border bg-background px-6 py-4">{footer}</div>
</div>
```

### Change 2 — `TicketDetailModal.tsx`: build + pass the footer; wire Save without the `form` attribute

- Extract a single valid-submit handler at component scope (reuse the exact inline logic currently on the `<form onSubmit>`):
  ```tsx
  const handleValidSubmit = async (values: TicketFormValues) => {
      await handleSubmit(values);
      setIsDirty(false);
      onClose();
  };
  ```
- Wire it to **both** submit entry points:
  - `<form onSubmit={methods.handleSubmit(handleValidSubmit)}>` (native submit; Enter key works).
  - Footer Save button `onClick={() => methods.handleSubmit(handleValidSubmit)()}` (RHF programmatic submit; jsdom-safe). **Do NOT use the HTML5 `form` attribute on the Save button** — it is unreliable in jsdom. Because the footer now renders **outside** the `<form>` (Modal owns the footer slot), the button cannot be a `type="submit"` child of the form; route it through `onClick` + `methods.handleSubmit(...)`.
- **Delete** the old in-grid footer row (`<div className="col-span-full mt-2 flex items-center justify-end gap-2 border-t border-border pt-4"> … </div>`) from inside the `<form>`.
- Declare `let modalFooter: React.ReactNode = null;` alongside `let modalBody`. In the resolved (`else`) branch **only**, set:
  ```tsx
  modalFooter = (
      <div className="flex items-center justify-end gap-2">
          {canDelete && !ticket.deletedAt && (
              <Button type="button" variant="destructive-outline" onClick={() => setDeleteConfirmOpen(true)}>
                  Delete ticket
              </Button>
          )}
          <Button type="button" variant="secondary" onClick={requestClose}>
              Cancel
          </Button>
          {!ticket.deletedAt && (
              <Button
                  type="button"
                  variant="primary"
                  disabled={methods.formState.isSubmitting}
                  onClick={() => methods.handleSubmit(handleValidSubmit)()}
              >
                  {methods.formState.isSubmitting ? 'Saving…' : 'Save changes'}
              </Button>
          )}
      </div>
  );
  ```
  - **Layout intent:** `justify-end`, children left→right = Delete (conditional), Cancel (always in resolved branch), Save (conditional, rightmost/primary). Placing Cancel between Delete and Save separates the destructive action from the affirmative commit (good UX) and keeps a single `justify-end` row (no `justify-between` single-child edge case).
  - **Preserve existing gating exactly:** Save hidden when `ticket.deletedAt`; Delete gated on `canDelete && !ticket.deletedAt`; Save disabled **only** while `methods.formState.isSubmitting` (do **not** add disable-when-clean — out of scope, would change behavior/tests).
  - **Cancel calls the existing `requestClose`** (clean → `onClose()`; dirty → `setConfirmOpen(true)` → ConfirmDiscardDialog). Do **not** touch `requestClose`, `useBlocker`, `blockBackdropClose`, `handleDiscard`, or `handleCancelConfirm`.
- At the bottom render site, pass the footer through:
  ```tsx
  <Modal
      isOpen
      onClose={requestClose}
      onEsc={requestClose}
      titleId="ticket-detail-title"
      title={modalTitle}
      blockBackdropClose={isDirty}
      size="full"
      footer={modalFooter}
  >
      {modalBody}
  </Modal>
  ```
  Loading / error / not-found branches leave `modalFooter = null`, so Modal renders in legacy mode for those (no footer slot) — matches current behavior where those branches have no commit footer.
- **Single scroll region:** the right sidebar currently has `lg:max-h-[80vh] lg:overflow-y-auto` (its own scroll). Now that the Modal body owns the scroll, a nested scroll region would produce two scrollbars. **Remove `lg:max-h-[80vh] lg:overflow-y-auto`** from the right sidebar wrapper so the left + right columns scroll together inside the Modal body while the footer stays pinned. *(Verify on desktop that the tabbed sidebar no longer needs its own scroll; the `forceMount+hidden` RHF-state-preservation behavior is unaffected — that depends on mount, not scroll.)*

### Change 3 — Tests

**`frontend/src/components/Modal.test.tsx`** (ADD; do not modify existing):
- `it('renders the footer slot inside the dialog when footer is provided')` — render `<Modal … footer={<button>OK</button>}>`. Assert: the OK button is present AND `within(dialog)` (footer is inside the panel, not fixed); the dialog panel has class `flex` and `overflow-hidden`; a descendant body wrapper has class `overflow-y-auto`; a descendant footer slot has class `border-t`.
- `it('keeps legacy panel classes (overflow-y-auto, p-6) when footer is omitted')` — render `<Modal …>` with no footer (regression guard). Assert `dialog` has classes `overflow-y-auto` and `p-6`, and that **no** footer slot (e.g. a `border-t` pinned region) is rendered. This explicitly protects the legacy layout the other 7 consumers depend on.
- Existing table-driven size test and the "defaults to max-w-lg" test stay green unchanged: they only assert `dialog.className` CONTAINS the `max-w-*` size class, which remains on the panel in both branches.

**`frontend/src/components/TicketDetailModal.test.tsx`** (UPDATE + ADD):
- **UPDATE** `it('footer: renders Save changes (no Cancel button)')` → rename to e.g. `'footer: renders Save changes, Cancel, and Delete ticket'`. Change the Cancel assertion from `not.toBeInTheDocument()` to `toBeInTheDocument()` (Cancel now exists). Keep the Save + Delete assertions. *(When a ConfirmDiscardDialog is NOT open, the footer Cancel is the only `Cancel` button in the document, so an unscoped `getByRole('button', { name: 'Cancel' })` is unambiguous in this clean-state test.)*
- **ADD** `it('footer Cancel: closes when clean; opens discard confirm when dirty')` — two sub-cases:
  - **Clean:** render resolved ticket, click footer `Cancel` → assert `onClose` called and ConfirmDiscardDialog NOT in the document.
  - **Dirty:** render resolved ticket, edit a field to make `isDirty` true, click footer `Cancel` while the confirm is still closed (it is the only Cancel at click time) → assert ConfirmDiscardDialog IS now in the document (use the same confirm-node lookup the existing dirty-guard test uses, then scope any further Cancel query via `within(confirm)` to disambiguate from the footer Cancel).
- The existing submit test (`'submit: editing the title + Save …'`, which clicks Save) stays green unchanged: Save now submits via `onClick` → `methods.handleSubmit(handleValidSubmit)` instead of native form submit, but the observable outcome (onSubmit called, modal closes) is identical.
- The existing dirty-guard test (`'dirty guard: Cancel dismisses the confirm…'`) already scopes the confirm's Cancel with `within(confirm)` — it is **unaffected** by the new footer Cancel. Note this coexistence explicitly in the implementation notes.
- **Optionally ADD** `it('footer buttons render inside the dialog panel (not browser-fixed)')` — assert Save/Cancel/Delete are all `within(dialog)`. (Mirrors the Modal.test.tsx assertion from the consumer side.)

## Edge Cases & Risks

- **Backward compatibility is the prime directive.** The 7 other Modal consumers (AddMemberModal, TicketNotFound, ConfirmDialog, ConfirmDiscardDialog, CreateTicketModal, DeleteTicketConfirm, etc.) pass no `footer`, so they MUST hit the legacy branch with byte-identical panel classes. The regression-guard test codifies this.
- **Save submit wiring.** Footer renders outside `<form>`; using the `form` attribute is jsdom-fragile. Solution: shared `handleValidSubmit` called from BOTH `<form onSubmit>` (Enter) and Save `onClick` (`methods.handleSubmit(handleValidSubmit)()`). Never `type="submit"` on the footer Save.
- **Focus trap + a11y.** `dialogRef` stays on the panel; footer buttons are panel descendants → tab cycle and Esc still work; footer is inside the panel, not `position:fixed`.
- **Double scroll region.** Right sidebar's `lg:max-h-[80vh] lg:overflow-y-auto` must be relaxed to avoid nested scrollbars now that the Modal body scrolls. Verify on desktop.
- **Two `Cancel` buttons when discard confirm is open** (footer Cancel + confirm Cancel). Avoided in tests by clicking the footer Cancel BEFORE the confirm opens, and by scoping confirm interactions with `within(confirm)` (existing pattern). Production is unaffected because they belong to different dialogs.
- **Deleted-ticket footer.** In the resolved branch, a soft-deleted ticket shows Save hidden + Delete hidden, leaving only Cancel (which closes). This is intentional and consistent with the pinned-footer contract; do not special-case it away.
- **`hasFooter` detection.** Use `footer !== undefined` (a `null` footer should still be treated as "no footer" → legacy mode). Confirm the chosen comparison so an accidental `footer={null}` doesn't enable footer-mode layout.

## Testing

- **Run:** `npm test -w frontend` (Vitest). Specifically target `Modal.test.tsx` and `TicketDetailModal.test.tsx`.
- **Manual verify (browser):** open a ticket whose description/comments exceed the viewport; confirm the footer (Save/Cancel/Delete) stays pinned at the bottom of the panel while the body scrolls; confirm Esc, backdrop click (when clean), and the X close still work; confirm Cancel on a dirty form opens ConfirmDiscardDialog; confirm Save still commits and closes; confirm Delete still opens its confirm; confirm the layout holds at mobile, tablet, desktop with no footer overlap.
- Confirm no other modal (create ticket, add member, confirms) changed appearance or scroll behavior.
- Co-locate `*.test.tsx` next to source.

## Acceptance Criteria → Definition of Done

| Acceptance Criterion | Definition of Done |
|----------------------|--------------------|
| Footer remains fixed/visible at bottom of panel while body scrolls | Modal footer-mode renders `flex flex-col` panel + `shrink-0` footer slot + `min-h-0 flex-1 overflow-y-auto` body; manual scroll test confirms pinning; `Modal.test.tsx` footer-render test passes. |
| Body scrolls in its own region; footer does not scroll | Body wrapper is the sole `overflow-y-auto` region; right-sidebar nested scroll removed; single scrollbar observed. |
| Save enabled when dirty; commits PATCH and closes | Save `onClick` calls `methods.handleSubmit(handleValidSubmit)` → `onSubmit(dto)` + `onClose`; existing submit test passes; Save disabled only while submitting. |
| Cancel closes; dirty triggers existing confirm-if-dirty/blocker | Cancel calls `requestClose`; new clean/dirty Cancel test passes; existing ConfirmDiscardDialog/blocker tests pass. |
| Delete destructive-styled; preserves confirmation flow | Delete button unchanged (`variant="destructive-outline"`, opens `DeleteTicketConfirm`); gating `canDelete && !ticket.deletedAt` unchanged. |
| Mobile/tablet/desktop, no overlap, footer inside panel not browser-fixed | Footer is a panel child (not `position:fixed`); responsive grid unchanged; manual check passes; `within(dialog)` test passes. |
| No regression to other consumers | Legacy branch classes identical; regression-guard test passes; full `Modal.test.tsx` + all consumer modal tests green. |

## Out of Scope

- Redesigning the modal beyond pinning + the 3-button footer.
- Any new delete or discard flow (reuse existing `requestClose` / ConfirmDiscardDialog / DeleteTicketConfirm).
- Disabling Save when the form is clean (current always-enabled-except-submitting behavior preserved).
- Changing `Button.tsx`, backend, API, or types.
- Branch creation / commits (handled by the parent orchestrator, not this plan).

## Open Questions *(none blocking)*

- Recommended footer button order is **Delete · Cancel · Save** (Save rightmost). If the owner prefers Save · Cancel with Delete separated to the far left via `justify-between`, that is a minor layout swap at implement time (note the `justify-between` single-child caveat when Delete is absent).
