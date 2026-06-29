# SLYK-08 · [Bugfix] · Labels Field Empty in Ticket Modal

> **Source:** [`docs/deliverables.md`](../deliverables.md) (DEL-08)

## Problem

In the ticket modal, the Labels field appears empty and shows "No
labels defined"; no label can be added.

## Solution (end-to-end)

- Reproduce and **diagnose the root cause** at runtime: determine whether the
  project genuinely has no labels, whether the label fetch is failing or returning
  the wrong project's labels, or whether a query/cache regression is at fault.
- Fix whichever layer is responsible so the field lists the **current project's
  labels** and allows selecting/deselecting them.
- Ensure labels created in Project Settings → Labels appear in the ticket modal for
  the same project without a reload.

## Acceptance criteria

- For a project that has labels, the ticket modal Labels field lists all of them and
  allows add/remove.
- For a project with no labels, the empty state is accurate and guides the user
  (e.g. to create labels in Project Settings).
- Switching projects shows that project's labels in the modal.

## Dependencies

None. *(Note: the separate "duplicate Labels caption" rendering
bug is handled by DEL-14, which owns the form-field label primitive.)*
