# SLYK-14 · [Bugfix] · Form Field Label Icon/Text Alignment

> **Source:** [`docs/deliverables.md`](../deliverables.md) (DEL-14)

## Problem (original issue #9f)

In the ticket modal form, every input field label
shows the text on one line and the icon on the line **below** it. The icon should
sit to the **left** of the text on the same line. (Also: the Labels field currently
renders the caption "Labels" twice.)

## Root cause (confirmed in code)

The shared field primitive renders the label as
a block-level span, and each form field places its icon in a **separate** span below
it. The Labels control additionally renders its own "Labels" caption in addition to
the primitive's.

## Solution (end-to-end)

- Refactor the shared field primitive so an optional icon renders **inline, to the
  left of the label text**, on the same line, consistently across all fields
  (Title, Description, Priority, Assignee, Labels, Checklist).
- Remove the duplicate "Labels" caption so each field has exactly one label.

## Acceptance criteria

- Every field label shows icon + text on the same line, icon on the left.
- No field renders a duplicate caption.
- Alignment is consistent across the form in both themes.

## Dependencies

None.
