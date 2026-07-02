# PM Cycle State
- Project: SLYK (slykboard)
- Started: 2026-07-03T00:00:00Z
- Phase: done
- Batch: 1
- Source issues: (product-owner brief, two parts)
  1. Rich text editor in ticket modal is very limited; action icons (Bold/Italic/List/Code) sometimes break layouts. Need a more robust editor.
  2. Ticket modal default content view should NOT be an editor. Default = rendered HTML (read-only). Add a small right-aligned "Edit" button in the same row as the "Description" label; editor appears only after clicking Edit.

- Locked decisions:
  - Description default = read-only rendered HTML; explicit right-aligned "Edit" button in Description row reveals the editor — mandated by issue (part 2) | answered (Q-implicit brief)
  - Toolbar layout fix is in scope — explicit in issue (part 1)
  - Expanded formatting set: Strikethrough, Underline, Numbered (ordered) list, Block quote, Code block, Links, Image-by-URL (pasted third-party URL only), H1/H2/H4 headings (in addition to existing Bold/Italic/H3/bullet-list/inline-code) — answered (Q1)
  - NO image upload pipeline / attachments storage / new backend upload endpoints — non-goal — answered (Q1)
  - Save behaviour = keep single global "Save changes" button; description saves with all other fields; existing dirty-guard / close-confirm stays — answered (Q2)
  - Unified description length limit = 10,000 characters for both create and edit — answered (Q3)
  - Comments editor unchanged (uses plain Textarea, not this editor) — codebase fact, out of scope

- Codebase facts (pm-analyst findings, path:line cited):
  - Editor = TipTap (@tiptap/react + @tiptap/starter-kit), outputs HTML via editor.getHTML() — frontend/src/components/RichTextEditor.tsx:13-18
  - Current toolbar = 5 actions only: Bold (B), Italic (I), Heading 3 (H3), Bullet list ("• List"), Inline code ("</>") — RichTextEditor.tsx:60-100
  - Toolbar buttons are fixed h-7 w-7 squares (28px) holding multi-char text labels -> overflow/clip; ToggleGroup has no flex-wrap -> non-wrapping row (root cause of "icons break layout") — RichTextEditor.tsx:58-100, ui/ToggleGroup.tsx:22,37
  - DB storage: tickets.description is a plain `text` column (HTML), nullable — backend/src/db/schema.ts:165
  - Sanitization on UPDATE via DOMPurify (allowed tags: p,br,strong,em,ul,ol,li,code,pre,blockquote,a,h3,h4; href only) — services/ticketService.ts:428-430, utils/sanitizeHtml.ts:3-20
  - Asymmetry: CREATE path stores description RAW (unsanitized) and caps at 500 chars; UPDATE caps at 5000 — routes/tickets.schema.ts:31,68; ticketService.ts:231
  - Read returns description raw (re-rendered via dangerouslySetInnerHTML) — DescriptionField.tsx:32-36; ticketService.ts:322-340
  - "Description" row today = label-on-top (block layout); editor always visible (readOnly only when ticket soft-deleted) — TicketDetailModal.tsx:291-293, DescriptionField.tsx:27-37, ui/Field.tsx:35-41
  - Save UX = single "Save changes" footer button submits ALL fields (one PATCH) via shared react-hook-form; dirty-guard + close-confirm; no auto-save — TicketDetailModal.tsx:113-125,150-203,374-381
  - RichTextEditor has ONE consumer: DescriptionField. Comments use plain <Textarea> + plain-text render. Blast radius contained to ticket description — CommentForm.tsx:3,42-49, CommentItem.tsx:79-81

- Question history:
  - Batch 1: questions/01-editor-scope-and-save.md — answered

- Deliverables (written under .context/pm-cycles/pm-cycle-2026-07-03-00-00-00/):
  - DEL-01 robust-rich-text-editor — deliverables/DEL-01-robust-rich-text-editor.md
  - DEL-02 read-first-edit-on-demand — deliverables/DEL-02-read-first-edit-on-demand.md
  - DEL-03 unified-description-limit — deliverables/DEL-03-unified-description-limit.md
  - Index: deliverables.md
