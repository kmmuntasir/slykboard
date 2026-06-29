# SLYK-15 · [Bugfix] · Ticket Modal Sticky Footer Gap

> **Source:** [`docs/deliverables.md`](../deliverables.md) (DEL-15)

## Problem (original issue #9g)

The modal footer is sticky, but when scrolling
back up past the sticky threshold, a small gap appears below the footer through
which scrolling content is visible behind it. The footer should sit flush at the
very bottom, or not be sticky at all.

## Solution (end-to-end)

- Fix the sticky footer so it either seats flush against the very bottom of the
  modal (no gap, fully opaque, covering the full content width) or is rendered
  non-sticky — whichever yields a clean result with no background bleed-through.
- Ensure the fix holds across the scroll lifecycle (scroll down, then back up past
  the sticky threshold) and in both themes.

## Acceptance criteria

- No scrolling content is ever visible behind or below the footer.
- The footer reads as flush with the modal bottom whenever it is sticky.

## Dependencies

None.
