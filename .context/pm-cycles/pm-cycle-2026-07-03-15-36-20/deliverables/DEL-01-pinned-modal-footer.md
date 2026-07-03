# DEL-01 — Pinned Card-Detail Modal Footer (Save Changes / Cancel / Delete Ticket)

**Status:** Ready for implementation
**Source issue:** Issue 1 — "Modal footer scrolls with content; want a fixed/pinned footer."

---

## Source Issue

Issue 1 — *"Modal footer scrolls with content; want a fixed/pinned footer."*

The ticket-detail modal (`TicketDetailModal.tsx`) hosts an outer React-Hook-Form edit session whose footer holds the commit actions. Today that footer sits **inside the modal's single scroll container** (the shared `Modal.tsx` dialog panel) and scrolls away with the rest of the content.

## Owner Decision (Button Composition)

> "It was my typo, I meant 'Save Changes' and 'Delete Ticket'. But now that I think, during an edit session, 'Cancel' button is also necessary. Keep all 3."

The pinned footer therefore exposes **three** actions: **Save Changes**, **Cancel**, and **Delete Ticket**. Delete remains a one-click action in the pinned bar (destructive-styled), exactly as the owner affirmed.

## Problem

On long tickets — a long description, or many comments — the footer commit actions scroll out of view inside the single scroll container. Users must scroll to the very bottom of the modal body to Save, Cancel, or Delete, losing persistent access to those actions.

This is a usability regression on the most common ticket shapes. The footer must be **pinned** while the body scrolls, carrying the owner-chosen three-button composition. The fix must **not regress the other seven modal consumers** that share `Modal.tsx`.

## Goals

- **Pinned footer.** The footer is pinned/sticky inside the modal panel and stays visible while the body content scrolls independently — across all viewport sizes, including mobile.
- **Three visible actions.** The footer exposes:
  - **Save Changes** — primary, commits the ticket edit.
  - **Cancel** — secondary, exits the edit session (discard / close).
  - **Delete Ticket** — destructive, one-click in the pinned bar (per owner decision).
- **Consistent styling.** The edit view and read-only view are styled consistently; the pinned footer does not overlap content or break layout.

## Non-Goals

- Redesigning the modal beyond the pinning and the three-button composition.
- Changing the shared `Modal.tsx` layout in a way that regresses the other seven consumers.
- Introducing a new delete flow, or any new visual redesign beyond pinning + the 3-button composition.

## User Stories

- As a user editing a long ticket, I want Save / Cancel / Delete always visible so I don't have to scroll to commit or discard.
- As a user, I want **Cancel** to exit the edit session (abandoning my changes).
- As a user, I want **Delete** to remain one-click (destructive-styled) in the pinned bar.

## Acceptance Criteria

- [ ] Given the modal is open with content taller than the viewport, when the user scrolls the body, the footer (Save Changes / Cancel / Delete Ticket) **remains fixed and visible at the bottom of the modal panel**.
- [ ] The body content scrolls in its own scroll region; the footer does not scroll.
- [ ] **Save Changes** is enabled when the form is dirty; it commits the ticket edit (`PATCH /tickets/:id` with `UpdateTicketDto`) and closes the modal.
- [ ] **Cancel** closes the modal; if there are unsaved (dirty) changes, the existing confirm-if-dirty / blocker behavior triggers before discard (current behavior preserved).
- [ ] **Delete Ticket** is destructive-styled and preserves the current delete-confirmation flow (no silent delete).
- [ ] Layout holds at mobile / tablet / desktop — no footer overlap, no content cut off; the footer stays **inside the modal panel** (not browser-fixed).
- [ ] No regression to the other seven modal consumers.

## Constraints / Dependencies

- The footer currently lives **inside the shared scroll container** (`Modal.tsx` dialog panel). Pinning must be contained to the ticket-detail modal footer, or done backward-compatibly across the eight consumers.
- `isDirty` / discard-if-dirty comes from the RHF `formState` (independent of `<form>` DOM ancestry, per prior developer analysis) and is **unaffected** by the footer changes.

## Assumptions (Flag — Owner to Override if Wrong)

- **"Cancel" = discard-and-close with confirm-if-dirty** (not reset-and-stay).
- **Delete keeps its current confirmation step** (not a new flow).

## Open Questions

None blocking.
