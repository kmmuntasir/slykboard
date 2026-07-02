# Clarification Batch 01

**How to answer:** write your reply under each `**Answer:**` below. You may answer
in this file, or reply inline in the thread. When done, re-run the product-manager
workflow to continue.

> 3 questions, grouped by theme. Recommended options are marked *(recommended)*.

---

## Already decided (locked — no need to re-litigate)

- **Read-first default:** The ticket description shows as read-only rendered HTML by default.
- **Edit button:** A small, right-aligned "Edit" button appears in the "Description" label row; clicking it reveals the rich text editor.
- **Toolbar layout fix:** Fixing the broken action-icon toolbar layout (labels stuffed into 28px squares, non-wrapping row) is in scope.

---

## Theme: Editor Formatting

### Q1. Which additional formatting actions should the description editor support?
- **Type:** multiple-choice (multi-select)
- **Why this matters:** Today only Bold, Italic, Heading 3, Bullet list, and Inline code are available. The brief asks for a "more robust" editor. Knowing which formats users actually need sets the scope. Note: image/attachment support would imply a new upload/storage capability that does not exist today — a heavier option.

Options (select all that apply):
- a) Strikethrough
- b) Underline
- c) Numbered (ordered) list
- d) Block quote
- e) Code block
- f) Links
- g) Images *(heavier — needs upload pipeline)*
- h) More heading levels (H1 / H2 / H4)
- i) Keep current set (no additions)
- j) Other: _(write-in)_

**Recommended default:** add **Strikethrough**, **Numbered list**, and **Links** (common, lightweight); defer **Images**.

**Answer:** Everything except images. Images can also be there, if the user pastes a third party image link, but not upload.

---

## Theme: Save Behaviour

### Q2. How should the description be saved?
- **Type:** multiple-choice (single-select)
- **Why this matters:** Today there is one "Save changes" button that commits all ticket fields (title, description, priority, assignee, labels, checklist, due date) at once, with a close-confirm if you have unsaved edits. With a read-first / Edit-toggle, we need to decide whether the description still saves as part of that single global save, or saves on its own.

Options:
- a) Keep single global "Save changes" — all fields save together *(recommended — lowest risk, matches existing dirty-guard behaviour)*
- b) Auto-save the description on its own when you leave the editor
- c) Add a dedicated per-field Save / Cancel right under the editor

**Answer:** A

---

## Theme: Length Limit

### Q3. Should the description length limit be consistent?
- **Type:** multiple-choice (single-select)
- **Why this matters:** A freshly created ticket allows only ~500 characters of description today, but editing an existing ticket allows ~5000. This is an arbitrary inconsistency. We need to decide the policy.

Options:
- a) Unify at ~5000 characters *(recommended — removes the arbitrary cap; matches the existing edit limit)*
- b) Unify at ~500 characters
- c) Keep them different (create = ~500, edit = ~5000)

**Answer:** Unify, but let's make the limit higher, because tickets can be big. Let's make it 10,000 chars.

---

*Answer inline, then re-run the workflow to generate the requirements deliverables.*
