# SLYK-05 · [Bugfix] · Prevent Self-Deactivation & Self-Removal

> **Source:** [`docs/deliverables.md`](../deliverables.md) (DEL-05)

## Problem (original issue #1)

A user can currently deactivate themselves. Under
the new model this generalizes: a user must not be able to globally deactivate
themselves, remove themselves from a project, or change their own role in a way that
locks them out.

## Solution (end-to-end)

- **Global self-deactivation is blocked**: the UI disables the deactivate control on
  the current user's own row, and the API rejects any request targeting the acting
  user's own id.
- **Self-removal from a project is blocked** in Member Management (UI disable +
  API reject).
- **Self role-change that would remove the user's last access is blocked.**
- Enforce a **last-Platform-Admin guard**: the last Platform Admin cannot be
  deactivated or demoted (analogous to today's last-admin demote guard).
- Errors are surfaced clearly at the point of attempt.

## Acceptance criteria

- A user cannot deactivate themselves via any path (control disabled + API 403).
- A user cannot remove themselves from a project or strand themselves without any
  project.
- The last Platform Admin cannot be deactivated/demoted; the action is blocked with
  a clear message.
- All guards exist on **both** the UI (disabled control) and the API (authoritative
  reject).

## Dependencies

DEL-01, DEL-02.
