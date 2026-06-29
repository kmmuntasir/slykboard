# SLYK-12 · [Bugfix] · Timer Stale Update on Start/Stop

> **Source:** [`docs/deliverables.md`](../deliverables.md) (DEL-12)

## Problem (original issue #9c)

When a timer is running, the time-tracking list
shows "End: Running"; clicking **Stop** does not update that field until the modal
is closed and reopened. Likewise, clicking **Start** does not surface the new entry
in the history until reopen.

## Root cause (confirmed in code)

The start/stop mutation hooks invalidate only
the *active-timer* cache, **not** the *per-ticket time-entries* cache that the
history list reads from — so the list stays stale until the component remounts.

## Solution (end-to-end)

- On both **start** and **stop**, invalidate the affected ticket(s)' time-entries
  cache so the history list refreshes immediately. Account for the fact that
  starting a timer auto-stops a prior timer possibly on **another** ticket (both
  tickets' histories should refresh).
- Verify the active-timer display and the elapsed readout remain correct after the
  fix.

## Acceptance criteria

- After clicking **Stop**, the entry's End field shows the stop timestamp
  immediately (no reopen).
- After clicking **Start**, the new running entry appears in the history
  immediately.
- Starting a timer that auto-stops a timer on a different ticket updates both
  tickets' histories.

## Dependencies

None.
