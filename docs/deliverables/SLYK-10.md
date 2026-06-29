# SLYK-10 · [Enhancement] · Compact Ticket Metadata Header

> **Source:** [`docs/deliverables.md`](../deliverables.md) (DEL-10)

## Problem (original issue #9, metadata)

Created By / Created At / Updated At waste
vertical space across multiple rows.

## Solution (end-to-end)

- Collapse the metadata into a **single row**: creator avatar + name, a clock icon +
  created-at datetime, and a clock icon + updated-at datetime — all inline.
- Use clear iconography and consistent datetime formatting; keep it readable in both
  themes.

## Acceptance criteria

- The creator and both timestamps render on one row with icons.
- Vertical space is reclaimed vs. the current multi-row layout.
- The information remains legible in light and dark mode.

## Dependencies

None.
