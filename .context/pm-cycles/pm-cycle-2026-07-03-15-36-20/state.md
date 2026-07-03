# PM Cycle State
- Project: SLYK (slykboard)
- Started: 2026-07-03T15:36:20Z
- Phase: done
- Batch: 1 (of cap 4) — answered
- Source issues: 3 product-owner issues (card-detail modal)
  - ISSUE 1: Modal footer scrolls with content (want fixed/pinned footer)
  - ISSUE 2: Rich text editor toolbar "mostly broken" + buy-vs-build (free WYSIWYG)
  - ISSUE 3: Nested <form> hydration/console error (CommentForm inside TicketDetailModal form)
- Output location: Final deliverables + index -> ./docs/ (project convention, AGENTS.md).
  state.md + questions stay in this cycle folder.

- Locked decisions (from owner-answered clarification batch 01):
  - ISSUE 1 footer buttons = Save Changes + Cancel + Delete Ticket (ALL THREE) — answered (Q02)
  - ISSUE 2 editor = REPLACE TipTap with CKEditor (self-hosted free/GPL build; project is GPL) — answered (Q01)
  - ISSUE 3 approach = developer-recommended Approach (a): de-nest the two inner widgets (CommentForm + ManualEntryForm); fix ALL nested-form warnings; preserve all behavior — assumed
  - 7 prior assumptions confirmed as-written by owner silence (reframed vs CKEditor in DEL-02)

- Codebase facts (from investigation, locked):
  - Editor = TipTap v3; commands actually work/test-covered; visible breakage = styling + image-resize (typography not enabled; Tailwind reset strips defaults; sanitizer strips img width/height, figure/figcaption, h5/h6). Component: frontend/src/components/RichTextEditor.tsx.
  - Description = plain HTML string persisted as UpdateTicketDto.description?: string; single integration site frontend/src/components/ticket-fields/DescriptionField.tsx (form-state setValue) -> editor swap needs NO data migration.
  - CKEditor free/self-hosted build shows a NON-removable "Powered by CKEditor" logo (commercial license needed to remove). Custom GPL build required (stock build-classic lacks underline/strikethrough/code; ImageResize must be enabled). Official React wrapper v9+ works on React 19 (change:data -> setValue + ref-mount fallback).
  - ISSUE 3: outer RHF form TicketDetailModal.tsx:230 wraps entire body incl footer; TWO inner forms inside it (CommentForm.tsx:57, ManualEntryForm.tsx:59). Inner handlers preventDefault -> warning only, no break. RHF registers via FormProvider context (not DOM <form> ancestry) -> isDirty/discard-if-dirty independent of nesting. Blast radius = CommentForm + ManualEntryForm + tests only. CommentForm Textarea Enter=newline (no enter-to-submit); ManualEntryForm single-line Enter=submit (preserve).

- Question history:
  - Batch 1: questions/01-card-detail-modal-issues.md — answered

- Deliverables (FINAL, all under ./docs/):
  - DEL-01 pinned modal footer (Save/Cancel/Delete) — docs/DEL-01-pinned-modal-footer.md
  - DEL-02 replace editor with CKEditor (self-hosted GPL build), widen sanitizer, enable image resize, preserve integration, handle attribution flag — docs/DEL-02-ckeditor-rich-text-editor.md
  - DEL-03 eliminate nested-<form> warnings (comment + manual time-entry) preserving all behavior — docs/DEL-03-eliminate-nested-forms.md
  - Index: docs/deliverables.md

- Flagged assumptions outstanding (owner confirm/override at handoff):
  - [DEL-02, KEY] "Powered by CKEditor" attribution accepted given GPL stance; if rejected -> commercial license required (scope/decision change). Only open owner decision.
  - [DEL-02] custom GPL build; native CKEditor link/image UI; sanitizer widening (figure/figcaption, img width/style/class, h1-h6).
  - [DEL-01] Cancel = discard-and-close w/ confirm-if-dirty; Delete keeps current confirmation.
  - [DEL-03] Approach (a); de-nested containers keep group role + aria-label; Enter-to-submit preserved on manual-entry single-line inputs.
