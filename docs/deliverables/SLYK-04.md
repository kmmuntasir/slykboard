# SLYK-04 · [Feature] · Project Deactivation

> **Source:** [`docs/deliverables.md`](../deliverables.md) (DEL-04)

## Problem

There is no way to retire a project without deleting it, and hard
delete is too destructive for now. We need a reversible **deactivate** that hides a
project from its users while preserving all data.

## Solution (end-to-end)

- Add a **Deactivate project** action in Project Settings → General, available to
  **Platform Admins only**.
- On deactivation:
  - **Stop every running timer in the project immediately.**
  - Hide the project from the project picker for Project Admins and Members.
  - Preserve all tickets, labels, members, and time data (soft-hide only).
  - Make any `…/projects/:slug/…` deep link return a **non-revealing** forbidden
    response for non-Platform-Admins.
- Platform Admins still see deactivated projects (with a **"Deactivated"** badge)
  and can **Reactivate** them.
- A user who is a member of **other** projects is unaffected and continues using
  them normally.
- A user whose **only** project is deactivated lands on an **empty state** page:
  **"You have no Projects. Contact Admin"**, and can still open their **profile
  menu** (and **Account Settings**).

## Acceptance criteria

- Deactivating a project stops its running timers at that moment.
- The project disappears from the picker for its project users but remains visible
  (badged) to Platform Admins.
- All data is intact after deactivation and after reactivation.
- A member of only that project sees the "You have no Projects" empty state and can
  still reach the profile menu / Account Settings.
- A member of other projects is not affected.
- Deep links to the deactivated project are denied (non-revealing) to project users.
- Reactivation restores full access for project users.

## Dependencies

DEL-01 (membership/visibility, deactivation column).
