# DEL-03 — Eliminate Nested-Form Warnings in the Card-Detail Modal

**Source issue(s):** Issue 3 — "Nested `<form>` validation/hydration error (a comment form nested inside the ticket-detail modal's edit form)."
**Status:** Ready for implementation
**Dependencies:** None

## Problem
The card-detail modal hosts an outer React-Hook-Form edit `<form>` that wraps the entire modal body. Two inner `<form>` elements are nested inside it: the **comment form** (used for both comment create and comment edit-save) and the **manual-time-entry form**. Nested `<form>` elements are invalid HTML and produce React 19 console/DOM warnings.

The app is client-side-rendered, so the "hydration" framing in the original issue is effectively a React nested-form DOM warning rather than a true server-hydration mismatch. Everything still functions today — the inner handlers call `preventDefault` — so this is a warning, not a functional break. But the warning must be eliminated. The owner confirmed two requirements: fix **all** nested-`<form>` warnings in this modal (both the comment form **and** the manual-time-entry form — same defect, same place), and preserve all current behavior.

## Solution
Eliminate the nested-`<form>` console/DOM warnings for **both** inner forms (comment + manual time-entry) that sit inside the modal's outer edit form, without changing the outer edit session or any current behavior. After this work there must be no `<form>` element nested inside another `<form>` anywhere in the card-detail modal, and no console/hydration errors when the modal opens or during interaction.

The de-nested inner containers must retain an appropriate group role plus an accessible label so that existing a11y landmarks are preserved. The exact approach to removing the nesting is an engineering detail and is not prescribed here.

### Behavior to preserve
- **Comment create (submit):** works exactly as before.
- **Comment edit-save:** works exactly as before.
- **Manual time-entry create:** works exactly as before, including Enter-to-submit on the single-line inputs.
- **Ticket edit-save (via the outer form):** works exactly as before.
- **Enter key semantics:** the comment textarea retains Enter-as-newline (it has no Enter-to-submit to preserve); the manual-entry single-line inputs keep Enter-to-submit.
- **Confirm-if-dirty discard flow:** dirty-state tracking and the discard-if-dirty blocker logic are unaffected.
- **Local validation:** comment trim is preserved; manual-entry duration bounds (1–1440) are preserved.

### Validation / constraints
- No `<form>` element may be nested inside another `<form>` in the card-detail modal.
- Form-state fields register via React-Hook-Form context (not DOM `<form>` ancestry), so de-nesting the inner widgets does not affect dirty-state or discard-if-dirty behavior.

## Acceptance criteria
- [ ] No `<form>` element is nested inside another `<form>` in the card-detail modal (both the comment form and the manual-time-entry form are de-nested).
- [ ] No React 19 nested-form console warning / hydration error appears when the modal opens or during any interaction.
- [ ] Comment create (submit) works exactly as before.
- [ ] Comment edit-save works exactly as before.
- [ ] Manual time-entry create works exactly as before, including Enter-to-submit on single-line inputs.
- [ ] Ticket edit-save (via the outer form) works exactly as before.
- [ ] The confirm-if-dirty discard flow is preserved (dirty-state tracking unaffected).
- [ ] Existing local validation is preserved (comment trim; manual-entry duration bounds 1–1440).
- [ ] a11y landmarks are preserved (de-nested containers keep an appropriate group role + accessible label).
- [ ] No regression to the comment-form or manual-entry-form tests.

## Dependencies
- None

## Non-Goals
- No change to the outer React-Hook-Form edit session (its form state, dirty tracking, or discard-if-dirty blocker logic).
- No restructuring of the modal layout beyond removing the nested forms from the two inner widgets.
- No change to validation rules (comment trim; manual-entry duration validation).

## Flagged Assumptions
*(Owner to confirm/override)*
- Proceed with the developer-recommended approach (de-nesting the two inner widgets).
- De-nested containers keep a group role + accessible label to preserve a11y landmarks.
- Enter-to-submit is preserved on the manual-entry single-line inputs; the comment textarea retains Enter-as-newline.

## Open Questions
None blocking.
