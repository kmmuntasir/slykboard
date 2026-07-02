# DEL-02 — Read-First Description with Edit-on-Demand

**Source issue(s):** "When a ticket modal is opened, the default content view should be rendered as read-only HTML (NOT an editor). The 'Description' label is currently left-aligned; we need a small 'Edit' button right-aligned in the same row. Only on click should the editor become available."
**Status:** Draft
**Dependencies:** DEL-01 (the rich text editor that "Edit" reveals)

## Problem
Today, opening a ticket modal drops the user straight into an editable rich text editor for the description — even when they only want to read it. This is heavy and error-prone: stray clicks/keystrokes mark the ticket dirty, trigger close-confirm prompts, and distract from reading. There is no clear separation between reading a ticket's description and editing it. The brief requires the description to open as clean, read-only rendered HTML by default, with editing available only on explicit request via an "Edit" button.

## Solution
End-to-end desired behavior:

### Default state — read-only rendered HTML
- When the ticket modal opens, the description is shown as **read-only rendered HTML** (formatted content the user can read and scroll, not an editable field, no caret, no toolbar).
- The existing read-only rendering path (sanitized HTML shown to the reader) is the default for every openable ticket.

### The Description label row — label left, Edit right
- The "Description" row is a single horizontal row: the "Description" label is **left-aligned** and a small **"Edit" button** is **right-aligned** in the same row.
- The "Edit" button is small and unobtrusive (secondary/low-emphasis styling), clearly an action affordance rather than a primary button.
- This row replaces the current "label-on-top" block layout for the description.

### Edit-on-demand
- Clicking "Edit" reveals the rich text editor (DEL-01) in place of the read-only view, populated with the current description content, ready to edit.
- The user can now format and change the description using the full toolbar (per DEL-01).
- The single global **"Save changes"** button remains the way the description is committed — together with all other ticket fields — and the existing dirty-guard / close-confirm behavior is unchanged (locked decision). There is no per-field Save/Cancel and no auto-save.
- After a successful save, the description returns to the **read-only rendered HTML** view (the editor is no longer shown) — i.e. the field exits edit mode and reverts to the read-first default once changes are persisted.

### Cancelling / discarding
- If the user has unsaved description edits and closes the modal (or otherwise leaves), the existing dirty-guard / close-confirm behavior applies, unchanged.
- (Any explicit "cancel/discard edit" affordance beyond the existing dirty-guard is optional and out of scope — see Out of scope. Reverting to read-only without saving is governed by the existing unsaved-changes guard.)

### When editing is not available
- For tickets where editing is already disabled today (e.g. a soft-deleted ticket), the "Edit" button must not be offered / must be disabled, and the description stays read-only. The read-first default must not bypass existing edit-permission rules.

## Acceptance criteria
- [ ] Opening a ticket modal shows the description as read-only rendered HTML (no caret, no toolbar, not editable) by default.
- [ ] The "Description" label is left-aligned and a small "Edit" button is right-aligned in the same single row.
- [ ] The "Edit" button uses low-emphasis/secondary styling.
- [ ] Clicking "Edit" reveals the rich text editor (DEL-01) populated with the current description; the read-only view is replaced by the editor.
- [ ] Editing the description marks the ticket dirty and the single global "Save changes" button persists the description with all other fields, as today.
- [ ] Existing dirty-guard / close-confirm on unsaved edits is preserved unchanged.
- [ ] After a successful save, the description returns to the read-only rendered HTML view (edit mode exits).
- [ ] For tickets where editing is already disabled today (e.g. soft-deleted), no "Edit" affordance is available and the description stays read-only.
- [ ] No per-field Save/Cancel and no auto-save are introduced.

## Dependencies
- DEL-01: the "Edit" action reveals DEL-01's robust rich text editor.

## Out of scope
- No change to save behaviour (single global "Save changes" retained; locked decision).
- No auto-save.
- No per-field Save/Cancel controls under the editor (optional cancel/discard is not required).
- No change to which users can edit beyond existing edit-permission rules.
- No change to the comments editor or other fields.
- The expanded formatting toolbar itself is specified in DEL-01, not here.
