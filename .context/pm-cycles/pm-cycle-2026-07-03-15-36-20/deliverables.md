# SLYK (slykboard) — Card-Detail Modal Fixes: Deliverables Index

**Project:** SLYK (slykboard) — frontend React 19 + Vite + Tailwind / backend Node + Express 5
**Milestone:** Card-Detail Modal Fixes
**Generated:** 2026-07-03
**Source issues:** Three product-owner-raised card-detail-modal issues (modal footer, rich-text editor, nested-form warnings). Each deliverable cites its own source issue.

## Table of Contents
1. Purpose
2. Context & Locked Decisions
3. Glossary
4. Deliverables
5. Consolidated Flagged Assumptions
6. Key Technical Facts
7. Dependency Graph & Suggested Phasing
8. Cross-Cutting Concerns
9. Next Step

---

## 1. Purpose

This index rolls up the three deliverables produced for the **Card-Detail Modal Fixes** milestone. Each deliverable addresses one product-owner-raised issue concerning the card-detail modal — its footer layout, its rich-text editor, and its nested-form warnings. All three deliverables are behavior-centric, end-to-end (data + integration + UI together), and carry **no technical recommendations**. Owner-locked product constraints (CKEditor, TipTap, React-Hook-Form) are named where they are product facts, never as advice.

---

## 2. Context & Locked Decisions

Built from the answered clarification batch — every clarified answer lives here.

- **Modal footer button composition → Save Changes + Cancel + Delete Ticket (all three)** — answered (`.context/pm-cycles/pm-cycle-2026-07-03-15-36-20/questions/01-card-detail-modal-issues.md`). Owner: *"It was my typo, I meant 'Save Changes' and 'Delete Ticket'. But now that I think, during an edit session, 'Cancel' button is also necessary. Keep all 3."*
- **Rich-text editor → REPLACE TipTap with CKEditor (not fix in place)** — answered. Owner: *"This project is already GPL, so going for CKEditor is not a problem. Replace."* The project is GPL, so CKEditor's GPL terms are acceptable.
- **Nested-form fix → proceed with the developer-recommended approach** (de-nest the two inner widgets: comment form + manual time-entry form) — answered. Owner confirmed: fix **all** nested-form warnings and **preserve all current behavior**.
- **7 previously-flagged assumptions confirmed as-written** by the owner's silence. Assumptions about image resize and link/image UI are reframed against CKEditor in DEL-02.

---

## 3. Glossary

- **Card-detail modal:** The shared modal surface used to view/edit a ticket; it is consumed by multiple screens, so layout/a11y changes must not regress other consumers.
- **Nested-form warning:** Browser/validation warning raised when a `<form>` element is placed inside another `<form>`. In this modal, the comment form and the manual time-entry form are the two inner nested forms.
- **React-Hook-Form:** The owner-locked form-state library; fields register via its context, so dirty-state / discard-if-dirty behavior is independent of DOM `<form>` ancestry.
- **Sanitizer:** The allow-list-based HTML sanitizer (`frontend/src/utils/sanitizeHtml.ts`) that strips elements/attributes outside the permitted list before persisted HTML is rendered.
- **"Powered by CKEditor" attribution:** The logo shown by the free / self-hosted CKEditor build. Not removable without a commercial license.

---

## 4. Deliverables

| ID | Title | Status | Dependencies | File |
|----|-------|--------|--------------|------|
| DEL-01 | Pinned Card-Detail Modal Footer (Save Changes / Cancel / Delete) | Ready for implementation | None | [DEL-01-pinned-modal-footer.md](DEL-01-pinned-modal-footer.md) |
| DEL-02 | Replace Rich-Text Editor with CKEditor (Self-Hosted GPL Build) | Ready for implementation — pending owner confirm on "Powered by CKEditor" attribution | None | [DEL-02-ckeditor-rich-text-editor.md](DEL-02-ckeditor-rich-text-editor.md) |
| DEL-03 | Eliminate Nested-Form Warnings in the Card-Detail Modal | Ready for implementation | None | [DEL-03-eliminate-nested-forms.md](DEL-03-eliminate-nested-forms.md) |

**One-liners:**

- **DEL-01** — Pin the modal footer so Save Changes / Cancel / Delete Ticket stay visible while the body scrolls; safe for the shared modal's other consumers.
- **DEL-02** — Swap the editor for a self-hosted free/GPL CKEditor build with a fully-styled toolbar (incl. image resize), widen the sanitizer for CKEditor's HTML output, and preserve the form-state integration — no data migration.
- **DEL-03** — Remove the nested `<form>` warnings (comment form + manual time-entry form) while preserving all current behavior and a11y landmarks.

### Clarifications

| Batch | File |
|-------|------|
| 01 | Owner-answered clarification batch (3 issues / 2 decisions + 7 confirmed assumptions) that produced these deliverables — [.context/pm-cycles/pm-cycle-2026-07-03-15-36-20/questions/01-card-detail-modal-issues.md](../.context/pm-cycles/pm-cycle-2026-07-03-15-36-20/questions/01-card-detail-modal-issues.md) |

---

## 5. Consolidated Flagged Assumptions

Owner-confirm / override items surfaced across the deliverables.

- **[DEL-02, KEY — OUTSTANDING] CKEditor attribution:** The "Powered by CKEditor" logo shown by the free / self-hosted build is **not removable** without a commercial license. Assumed acceptable given the project's GPL stance. **IF REJECTED → a commercial license is required (scope/decision change).** This is the one outstanding owner decision.
- **[DEL-02]** Custom free/GPL build acceptable — the stock `build-classic` lacks underline / strikethrough / code, and image resize must be enabled.
- **[DEL-02]** Use CKEditor's native Link/Image UI (drop the prior hand-rolled URL prompt).
- **[DEL-02]** Sanitizer widened to allow `<figure>` / `<figcaption>`, `<img>` width/style/class, and `h1–h6`.
- **[DEL-01]** Cancel = discard-and-close with confirm-if-dirty; Delete keeps its current confirmation step.
- **[DEL-03]** Proceed with the developer-recommended approach; de-nested containers keep a group role + accessible label; Enter-to-submit preserved on manual-entry single-line inputs.

---

## 6. Key Technical Facts

Facts about the current system (not scope or recommendations):

- The ticket description is a plain HTML string persisted as `UpdateTicketDto.description?: string`; **no data migration is needed** for the editor swap.
- The editor has a **single integration site:** `frontend/src/components/ticket-fields/DescriptionField.tsx` (form-state `setValue`).
- Form-state fields register via **React-Hook-Form context** (not DOM `<form>` ancestry), so dirty-state / discard-if-dirty are **independent** of the inner `<form>` elements.
- The sanitizer (`frontend/src/utils/sanitizeHtml.ts`) is **allow-list-based** and currently strips `<figure>` / `<figcaption>`, image width/height/style/class, and `h5` / `h6`.
- The card-detail modal is **shared by multiple consumers**; footer-pinning must not regress them.

---

## 7. Dependency Graph & Suggested Phasing

The three deliverables touch **distinct components** — footer/layout (DEL-01); editor + sanitizer + integration (DEL-02); the two inner forms (DEL-03) — and are **independent**. They can **proceed in parallel**:

```
DEL-01  (footer / layout)        ──┐
DEL-02  (editor + sanitizer)     ──┼──  all parallel, no inter-deliverable dependencies
DEL-03  (de-nest inner forms)    ──┘
```

**DEL-02 is the largest** and carries the **one outstanding owner decision** (CKEditor attribution). **Resolve it early** to keep DEL-02 unblocked.

---

## 8. Cross-Cutting Concerns

- **Shared modal consumers:** Any footer/layout change (DEL-01) must not regress the other consumers of the card-detail modal.
- **Accessibility landmarks:** Both DEL-03 and DEL-01 must preserve existing a11y landmarks and keyboard behavior.
- **Sanitizer / persisted HTML:** DEL-02's wider HTML output and the shared allow-list sanitizer must move together.

---

## 9. Next Step

1. Review each deliverable (DEL-01, DEL-02, DEL-03).
2. Resolve the DEL-02 "Powered by CKEditor" attribution assumption (commercial-license fallback if rejected).
3. Hand a deliverable to the implementation workflow.
