# SLYK (slykboard) — Ticket Description Editor Overhaul Deliverables Index

**Project:** SLYK (slykboard)
**Milestone:** Ticket Description Editor Overhaul (Robust Editor + Read-First/Edit-on-Demand + Unified Limit)
**Generated:** 2026-07-03
**Source issues:** Product-owner brief, two parts — (1) the ticket-modal rich text editor is too limited and its action icons break layouts; (2) the ticket modal should open with the description as read-only rendered HTML, with a right-aligned "Edit" button in the Description label row that reveals the editor on demand.

## Table of Contents
1. Context & Locked Decisions
2. Glossary
3. Deliverables
4. Dependency Graph & Suggested Phasing
5. Cross-Cutting Concerns

## Context & Locked Decisions
(Built from the cycle's locked decisions — every clarification answer is captured here.)
- Description default = read-only rendered HTML; a small right-aligned "Edit" button in the Description label row reveals the editor on demand — answered (issue brief, part 2)
- Toolbar layout fix is in scope (today's multi-character text labels clip/overflow in fixed 28px squares and the toolbar row does not wrap) — answered (issue brief, part 1)
- Expanded formatting set for the description editor: add Strikethrough, Underline, Numbered (ordered) list, Block quote, Code block, Links, Image-by-URL, and Heading 1 / Heading 2 / Heading 4 (on top of existing Bold, Italic, Heading 3, Bullet list, Inline code) — answered (questions/01-editor-scope-and-save.md, Q1)
- Images are supported ONLY by inserting a third-party image URL (link/URL-based `<img>`); NO image upload pipeline, NO attachment storage, NO new backend upload endpoints — explicit non-goal — answered (questions/01-editor-scope-and-save.md, Q1)
- Save behaviour: keep the single global "Save changes" button; the description saves together with all other ticket fields; existing dirty-guard / close-confirm behaviour is unchanged — answered (questions/01-editor-scope-and-save.md, Q2)
- Description length limit unified at 10,000 characters for both create and edit (replaces the prior ~500 create / ~5000 edit asymmetry) — answered (questions/01-editor-scope-and-save.md, Q3)
- Comments editor is unchanged (uses a plain text area, not this rich text editor) — codebase fact, out of scope

## Glossary
- **Ticket description:** The free-form HTML text field on a ticket, edited via the rich text editor; the only field that uses this editor.
- **Read-first default:** The description opens as read-only rendered HTML; editing is opt-in via an "Edit" button.
- **Edit-on-demand:** The rich text editor is revealed only after the user clicks "Edit."
- **Image-by-URL:** Inserting an inline image by pasting a third-party image URL — no file upload involved.
- **Dirty-guard / close-confirm:** Existing behavior that warns the user about unsaved edits when leaving the modal.
- **Global "Save changes":** The single footer button that commits all ticket fields (including description) in one save.

## Deliverables
| ID | Title | Status | Dependencies | File |
|----|-------|--------|--------------|------|
| DEL-01 | Robust Rich Text Editor (Ticket Description) | Draft | None | [deliverables/DEL-01-robust-rich-text-editor.md](deliverables/DEL-01-robust-rich-text-editor.md) |
| DEL-02 | Read-First Description with Edit-on-Demand | Draft | DEL-01 | [deliverables/DEL-02-read-first-edit-on-demand.md](deliverables/DEL-02-read-first-edit-on-demand.md) |
| DEL-03 | Unified 10,000-Character Description Limit | Draft | None | [deliverables/DEL-03-unified-description-limit.md](deliverables/DEL-03-unified-description-limit.md) |

### Clarifications
| Batch | File |
|-------|------|
| 01 | [../.context/pm-cycles/pm-cycle-2026-07-03-00-00-00/questions/01-editor-scope-and-save.md](../.context/pm-cycles/pm-cycle-2026-07-03-00-00-00/questions/01-editor-scope-and-save.md) |

## Dependency Graph & Suggested Phasing
- **Phase 1 (foundation, parallelizable):** DEL-01 (robust editor + toolbar layout fix + wider sanitization) and DEL-03 (unified 10,000-char limit) have no dependency on each other and can proceed in parallel.
- **Phase 2 (depends on Phase 1):** DEL-02 (read-first / Edit-on-demand) depends on DEL-01, since "Edit" reveals the robust editor. DEL-02 should follow DEL-01; DEL-03 may land in either phase.
- Suggested order: ship DEL-01 + DEL-03 together, then DEL-02. All three are independently shippable if needed, but DEL-02 only delivers its full value once DEL-01 is in.

## Cross-Cutting Concerns
- **Sanitization consistency:** DEL-01 widens the description HTML allow-list to cover the new formatting; the widened sanitization must apply on BOTH create and edit save paths. DEL-03's larger character budget must coexist with this richer content. These two must be validated together so saved descriptions round-trip exactly.
- **Single global save model:** Both DEL-01 and DEL-02 preserve the existing single "Save changes" button and dirty-guard / close-confirm behavior. No deliverable introduces per-field save or auto-save.
- **Edit-permission rules:** DEL-02's read-first default must not bypass existing edit-permission gating (e.g. soft-deleted tickets remain non-editable; no "Edit" button shown).
- **Scope containment:** Only the ticket description is affected. The comments editor, card titles, time-entry notes, and all other fields are explicitly unchanged across every deliverable.
- **Explicit non-goal (cross-cutting):** No image upload pipeline, no attachment/blob storage, and no new backend upload endpoints anywhere in this milestone. Image insertion is URL-only.
