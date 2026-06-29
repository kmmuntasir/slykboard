# SLYK-09 · [Enhancement] · Ticket Details Modal Full Width

> **Source:** [`docs/deliverables.md`](../deliverables.md) (DEL-09)

## Problem (original issue #8)

The ticket details modal is too narrow and should
be almost full width.

## Solution (end-to-end)

- Add a new modal width preset ("full") sized at roughly `min(95vw, 1400px)` and
  apply it to the ticket details modal.
- Preserve the existing max-height and scrolling behavior; ensure the wider layout
  remains balanced on large screens (no awkward stretching of form fields).

## Acceptance criteria

- The ticket details modal spans almost the full viewport width on large screens,
  capped at ~1400px.
- Content remains readable and well-proportioned; existing close/scroll behavior is
  intact.

## Dependencies

None.
