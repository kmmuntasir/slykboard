# DEL-01 — Robust Rich Text Editor (Ticket Description)

**Source issue(s):** "The rich text editor in the ticket modal is very limited; the action icons (Bold, Italic, List, Code, etc.) sometimes break layouts. We need a more robust rich text editor."
**Status:** Draft
**Dependencies:** None (this is the foundational editor deliverable; DEL-02 and DEL-03 build on or run alongside it)

## Problem
The ticket description editor offers only five formatting actions (Bold, Italic, Heading 3, Bullet list, Inline code), which is too limited for documenting real work in tickets. On top of that, the toolbar itself is visually broken: action buttons are fixed small squares that hold multi-character text labels like "• List" and `</>`, and the toolbar row does not wrap, so labels clip, overflow, and break the modal layout. Users cannot reliably select formatting and cannot express content the way a robust ticket description needs.

## Solution
End-to-end desired behavior:

### Expanded formatting set
The description editor toolbar must support a robust set of formatting actions. Keep the existing actions and ADD the following, all reachable from the toolbar:
- **Existing (keep):** Bold, Italic, Heading 3, Bullet (unordered) list, Inline code.
- **New headings:** Heading 1, Heading 2, Heading 4 (so the editor offers H1, H2, H3, H4).
- **New inline styles:** Strikethrough, Underline.
- **New blocks:** Numbered (ordered) list, Block quote, Code block.
- **Links:** ability to add/edit a hyperlink on selected text (URL + display text).
- **Image by URL:** ability to insert an inline image by pasting a third-party image URL (an `<img>` referencing an external URL). This is link/URL-based ONLY.

### Image rule (critical product constraint)
Images are supported **only** by inserting a third-party image URL. There is NO file-upload capability, NO drag-and-drop file upload, NO attachment storage, and NO new backend upload endpoints. The product must never imply to the user that they can upload image files from their device — the image control accepts a URL string only. (Treat the absence of an upload pipeline as an explicit, permanent non-goal for this deliverable — see Out of scope.)

### Toolbar layout fix (fixes "icons break layout")
- Each action must render as a clean, single-glyph icon button — NOT a multi-character text label like "• List" or `</>`. Use proper iconography/glyphs (e.g. the conventional bold/italic/list/quote/code/link-image marks), one symbol per button.
- Buttons must size to their icon content (no fixed undersized squares that clip glyphs).
- The toolbar row must wrap gracefully to a second line on small widths rather than overflow or break the modal layout. It must remain usable at the modal's minimum supported width.

### Behavior
- Formatting toggles apply to the current selection or cursor position as users expect from a rich text editor; active states are visually indicated (e.g. a Bold button looks pressed/active when the cursor is inside bold text).
- Pasted rich content from other sources is accepted and normalized into the editor's supported formatting set.
- The editor continues to output clean HTML for storage, unchanged in spirit from today (HTML text on the ticket description).

### Sanitization parity
The description is stored as sanitized HTML. Because new formatting is now allowed (strikethrough, underline, ordered lists, blockquote, code block, additional headings, links, images-by-URL), the sanitization allow-list for the description must be widened to permit the corresponding HTML tags/attributes so that user-authored formatting survives the round-trip and is not stripped on save. This applies to BOTH the create and edit save paths (see DEL-03 for the matching length-limit unification). Links keep their `href`; images keep their `src`. (Describe as a product behavior: "saved description must render back exactly as the user formatted it," not as a sanitization library choice.)

## Acceptance criteria
- [ ] The toolbar offers Bold, Italic, Strikethrough, Underline, Heading 1, Heading 2, Heading 3, Heading 4, Bullet list, Numbered list, Block quote, Inline code, Code block, Link, and Image-by-URL.
- [ ] Each toolbar action renders as a single clean icon glyph — no multi-character text labels like "• List" or `</>`.
- [ ] No toolbar button clips, overflows, or breaks the modal layout at any supported modal width; the toolbar wraps to additional lines when needed.
- [ ] Strikethrough, underline, ordered lists, block quotes, code blocks, H1/H2/H4, links, and inline images-by-URL can each be applied and produce the expected formatting.
- [ ] A user can insert an image by pasting a third-party image URL; the image renders inline in the description.
- [ ] There is NO user-facing image file-upload affordance anywhere in the editor (no file picker, no drag-drop target, no "upload" button).
- [ ] Links can be added and edited (URL + display text) and render as clickable anchors in the read view.
- [ ] Active/toggle state of a formatting button is visually indicated when the cursor is inside matching formatting.
- [ ] After saving, a description authored with any supported formatting renders back exactly as formatted (no supported tag/attribute is stripped on the round-trip) on both create and edit.
- [ ] Sanitization is widened consistently on both create and edit save paths.
- [ ] The comments editor and all other fields are unchanged.

## Dependencies
- None. (DEL-02's Edit-on-demand reveals this editor; DEL-03 unifies the length limit that this editor's content must respect.)

## Out of scope
- **Image upload pipeline — explicitly out of scope and a non-goal:** no file uploads, no drag-and-drop file upload, no attachment/blob storage, no new backend upload endpoints. Image insertion is URL-only, permanently.
- No change to the comments editor (it uses a plain text area and is unaffected).
- No change to read-first/Edit-on-demand behavior — that is DEL-02.
- No change to save/dirty-guard behaviour — single global "Save changes" is retained (locked decision).
- No new auto-save, version history, collaborative editing, or templates.
- No change to which fields use the editor (description only).
