# SLYK-11 · [Enhancement] · Ticket Details Modal Tabbed Layout

> **Source:** [`docs/deliverables.md`](../deliverables.md) (DEL-11)

## Problem (original issues #9b and #9d)

The modal mixes card details, time
tracking, and activity in one long scroll. Time tracking and activity should be
moved into their own tabs.

## Solution (end-to-end)

- Restructure the ticket details modal body into **three tabs**:
  1. **Details** — the metadata header (DEL-10), the ticket attribute form, and the
     Comments section (DEL-13).
  2. **Time Tracking** — timer controls, the time log, and manual entry (with the
     live-update fix from DEL-12).
  3. **Activity** — the activity feed.
- Tabs are keyboard-accessible and remember the active tab for the modal session.
- The footer/save behavior continues to work within the Details tab.

## Acceptance criteria

- The modal presents three clearly labeled tabs with the correct content in each.
- Time tracking lives entirely in tab 2; activity entirely in tab 3.
- Comments appear in tab 1 below the form.
- Tab navigation is accessible (keyboard + correct ARIA), and the active tab
  persists while the modal is open.

## Dependencies

DEL-12 (timer fix, lives in tab 2), DEL-13 (comments, live in
tab 1). DEL-10 composes in tab 1.
