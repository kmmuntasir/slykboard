# DEL-02 — Replace Rich-Text Editor with CKEditor (Self-Hosted GPL Build)

**Source issue(s):** Issue 2 — "Rich text editor toolbar mostly broken" + owner buy-vs-build decision (owner wants a free WYSIWYG).
**Status:** Ready for implementation — pending owner confirm on "Powered by CKEditor" attribution.
**Dependencies:** None

## Problem

Issue 2 reported the rich-text editor toolbar as "mostly broken." Investigation found the underlying TipTap commands actually work and are test-covered; the visible breakage is product-visible styling and functionality gaps:

- (a) **Headings, lists, blockquotes, code, and links have NO styling** — rich-text typography is not enabled, and the Tailwind reset strips default element styles. Only inline marks (bold, italic, underline, inline code) look styled.
- (b) **Links insert and open correctly but have zero CSS**, so they read as plain text.
- (c) **Images render but cannot be resized**, and the HTML sanitizer strips image `width`/`height` on read-back.

The owner decided to **replace** the current TipTap editor with CKEditor, noting the project is already GPL so CKEditor's GPL terms are acceptable.

**Owner decision (quote):** *"This project is already GPL, so going for CKEditor is not a problem. Replace."*

Direction: **Replace** the current editor with a **self-hosted, free/GPL CKEditor build** (NOT the cloud/key tier).

## Solution

The description editor is replaced end-to-end with a self-hosted, free/GPL CKEditor build. The toolbar is fully styled and working, the editing view and the read-only description view are styled consistently, and the HTML sanitizer is widened so CKEditor's rich output round-trips cleanly. The description continues to persist and read back as a plain HTML string — no data migration — and the single integration point is preserved.

### Toolbar set

A fully-styled, working toolbar exposing:

- **Inline marks:** bold, italic, strikethrough, underline, inline code
- **Headings:** h1–h6
- **Lists:** bullet (unordered) and ordered
- **Blocks:** blockquote, code block
- **Embedded objects:** links, images

All of the above must be **visibly styled and functional** in the editing view.

### Images

- Images can be resized via **drag handles** with a **sensible max-width cap**.
- The resized width must **round-trip**: insert → save → reload renders at the saved width (not silently reverted).

### Links

- Links visibly look like links: **underline + accent color + hover state**, in BOTH the editing view and the read-only description view.

### Editing view vs. read-only description view

- The editing view (editor) and the read-only description view (saved description rendered to a reader) are **styled consistently**, so a saved description renders with proper, consistent styling (headings, lists, images, captions, code).

### HTML sanitizer widening

The allow-list-based sanitizer is widened in lockstep with CKEditor's output so rich content round-trips identically:

- Allow `<figure>` / `<figcaption>`
- Allow `<img>` `width`/`style`/`class`
- Allow `h1`–`h6`

Rich content round-trips identically: insert → save → reload.

### Preserved integration & behavior

- The description persists and reads back as a **plain HTML string** (`UpdateTicketDto.description?: string`), unchanged.
- The **single integration site** (the description form-state field) is unchanged.
- Comment create/edit and description edit flows **behave exactly as before**.
- **No data migration** is performed (description is already a plain HTML string).

### Attribution

The free/self-hosted CKEditor build displays a small **"Powered by CKEditor"** logo that is **not removable without a commercial license**. This is presented to the owner as the single open decision (see Assumptions).

## Acceptance criteria

- [ ] TipTap is removed and a **self-hosted free/GPL CKEditor build** renders the description editor.
- [ ] Toolbar exposes bold, italic, strikethrough, underline, inline code, headings h1–h6, bullet/ordered lists, blockquote, link, image, and code block — all visibly styled and functional.
- [ ] A **custom free/GPL build** is used where needed (the stock build lacks underline/strikethrough/code, and image resize must be explicitly enabled); all required features are present and working.
- [ ] Images can be resized via drag handles with a sensible max-width cap; the resized width round-trips (insert → save → reload renders at the saved width).
- [ ] Links are visibly styled (underline + accent color + hover state) in both the editing view and the read-only description view.
- [ ] The HTML sanitizer is widened to allow `<figure>`/`<figcaption>`, `<img>` width/style/class, and h1–h6; rich content round-trips identically (insert → save → reload).
- [ ] The editing view and the read-only description view are styled consistently.
- [ ] The editor works under React 19 with no console/hydration errors from the editor; controlled-value and ref-mount fallback both work.
- [ ] The description persists and reads back as a plain HTML string (`UpdateTicketDto.description`) unchanged; no data migration is performed; the single integration site is preserved.
- [ ] Comment create/edit and description edit flows behave exactly as before.
- [ ] No regression to existing tests or flows that consume the description.
- [ ] The **"Powered by CKEditor" attribution is visible and accepted** (see flagged assumption).

## Constraints / Dependencies

- **React 19 compatibility:** The official CKEditor React wrapper works under React 19; controlled value uses the change-event → form-state wiring pattern, with a ref-mount fallback.
- **Custom free/GPL build required:** The stock build-classic lacks underline/strikethrough/code, and image resize must be explicitly enabled.
- **Sanitizer must widen in lockstep:** The allow-list-based sanitizer (`frontend/src/utils/sanitizeHtml.ts`) currently strips `<figure>`/`<figcaption>`, image `width`/`height`/`style`/`class`, and `h5`/`h6`; it must be widened in lockstep with CKEditor's output.
- **Single integration site:** `frontend/src/components/ticket-fields/DescriptionField.tsx` (form-state setValue).
- **Persistence unchanged:** Description is a plain HTML string persisted as `UpdateTicketDto.description?: string` — no migration needed.

## Assumptions

> The following are **assumed** pending owner confirmation. The **[KEY]** item is the single open owner decision.

- **[KEY] "Powered by CKEditor" attribution.** The free/self-hosted CKEditor build displays a small "Powered by CKEditor" logo that is **NOT removable without a commercial license**. **Assumed acceptable** given the project's GPL stance.
  - **IF REJECTED** → a commercial CKEditor license becomes required, which is a **scope/decision change**. This is the one open owner decision and is flagged decisively.
- Custom free/GPL build is acceptable (stock build-classic lacks underline/strikethrough/code; image resize needs enabling).
- Use CKEditor's native Link/Image UI instead of the prior hand-rolled URL prompt.
- Sanitizer widening (figure/figcaption, img width/style/class, h1–h6) is a **security-reviewed** change; `style` attributes are allowed on `<img>` only (for image resize).
- Image resize = drag handles with a sensible max-width cap.
- Both the editing view and the read-only description view are styled consistently.

## Open questions

None blocking. The only outstanding decision is the **"Powered by CKEditor" attribution** flag above.

## Out of scope

- No new link/image entry UX beyond CKEditor's native Link/Image UI (the prior hand-rolled URL prompt is dropped).
- No change to where/how the description HTML is persisted.
- No commercial CKEditor license (proceed on the free/GPL self-hosted build) — unless the attribution flag is rejected.
- No other editor features beyond the listed toolbar set.
