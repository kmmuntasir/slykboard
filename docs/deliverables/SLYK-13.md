# SLYK-13 · [Feature] · Ticket Comments

> **Source:** [`docs/deliverables.md`](../deliverables.md) (DEL-13)

## Problem (original issue #9e)

There is no comment system. A Comments section is
needed below the ticket content (in the Details tab).

## Solution (end-to-end)

- A new per-ticket **Comments** capability: any project member can post a comment.
- Author can **edit** their own comment; author or any admin can **delete**.
- Edits and deletes are recorded in the activity log as a **summary** entry
  (e.g. "User X edited a comment", "User X deleted a comment") — **never** the
  comment content.
- Rendering: comments appear below the ticket content in the Details tab, newest
  last (or clearly ordered), with author avatar/name and timestamp; edited comments
  are marked as edited.
- No realtime; **refetch-on-open** (and after each post/edit/delete) is sufficient.

## Acceptance criteria

- A member can add a comment and see it appear.
- The author can edit their comment; admins cannot edit others' comments but can
  delete any; the author can delete their own.
- Each edit and delete produces a summary-only activity entry (no content leak).
- Comments persist and reload correctly on reopen.

## Dependencies

DEL-01 (membership gating: only project members comment).
