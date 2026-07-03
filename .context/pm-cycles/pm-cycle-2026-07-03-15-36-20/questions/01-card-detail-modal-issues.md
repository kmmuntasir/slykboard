# Clarification Batch 01 — Card Detail Modal (Footer, Editor, Nested Forms)

**Project:** SLYK (frontend React 19 + Vite + Tailwind / backend Node + Express 5)
**Scope:** The "Ticket Detail" (card-detail) modal.

**How to answer:** write your reply under each `**Answer:**` (or reply inline / tell the PM your
picks). When done, re-run the product-manager workflow to continue.

> 2 decisions, plus assumptions we'll proceed on unless you object. Recommended options are
> marked *(recommended)*.

---

## Investigation Summary

Three findings reframed the reported issues — worth knowing before answering:

- **The editor isn't hand-rolled — it's TipTap v3, a mainstream free (MIT) React WYSIWYG editor.** Every toolbar command actually works (test-covered). The "broken" look is a **styling gap**, not broken buttons.
- **Why only Bold/Italic/Strike/Underline/Code *look* like they work:** rich-text typography styling isn't enabled, and Tailwind's reset strips default styling from headings, lists, blockquotes, code blocks, and links. Only inline marks keep their look. **Links are inserted correctly and open on click** — but have no color/underline, so they read as plain text. **Images render but can't be resized**, and the HTML sanitizer strips width/height on reload.
- **The modal has three nested `<form>` elements** (the comment form and a manual-time-entry form both sit inside the main form). It's a **console warning, not a functional break** — everything still works today. The description is stored as plain HTML, so any editor change needs **no data migration**.

---

## Theme: Rich-text editor (Issue 2)

### Q01. [Issue 2] Fix the editor you already have — or replace it? (the buy-vs-build decision)
- **Type:** decision (pick one)
- **Why this matters:** The report assumed a hand-rolled, broken editor. The codebase already runs **TipTap v3** (free, MIT). The real defects — styling + image-resize — must be solved **regardless** of which editor ships. Picking the wrong path wastes effort or leaves defects unfixed.
  - ⚠️ **Licensing reality:** the named alternatives are *not* cleaner. **TinyMCE 7+ is now GPL** (the free MIT core was old v6). **CKEditor 5's free tier is GPL-with-a-logo** or a cloud key capped at 1,000 loads/month. The genuinely free + permissive + React-native options are **TipTap (what you have)** and **Lexical (Meta)**. Switching to TinyMCE/CKEditor would be a licensing **downgrade** *and* still require the same styling + resize work.

Options:
- a) **FIX IN PLACE** *(recommended — lowest risk: no data migration, no new vendor/license; solve the actual styling + resize defects directly)* — keep TipTap; enable rich-text styling for headings/lists/blockquotes/code/links, make links visibly look like links, and add image resize.
- b) **REPLACE ANYWAY** — swap TipTap for another editor (mind the license caveats above; you'd still owe the same styling + resize work plus integration/migration effort).
- c) **HYBRID / DEFER** — fix styling + visible links now; defer image resize to a later cycle.

**Answer:** This project is already GPL, so going for CKEditor is not a problelm. Replace.

---

## Theme: Modal footer (Issue 1)

### Q02. [Issue 1] Which buttons belong in the always-visible (pinned) footer?
- **Type:** decision (pick one)
- **Why this matters:** The current footer is **"Save changes" + "Delete ticket"** — there is **no Cancel button** (the issue text said "Save/Cancel"). Discard/exit currently uses the X button / Esc / backdrop-click, with a confirm-if-dirty dialog. Because the footer will now be **permanently pinned** at the bottom and always visible, its composition is a real decision — and "Delete ticket" is **destructive**, so whether it stays one-click-always-visible is worth confirming.

Options:
- a) **SAVE CHANGES + CANCEL** *(recommended — matches your "Save/Cancel" phrasing and keeps the destructive action off the pinned bar)* — add Cancel; move "Delete ticket" out of the always-visible footer.
- b) Keep current — **SAVE CHANGES + DELETE TICKET**.
- c) **SAVE CHANGES + CANCEL + DELETE TICKET** — keep Delete one-click.
- d) **SAVE CHANGES** only.

**Answer:** It was my typo, I meant "Save Changes" and "Delete Ticket". But now that I think, during an edit session, "Cancel" button is also necessary. Keep all 3.

---

## Assumptions We'll Proceed On Unless You Object

We'll treat these as locked unless you override one. Speak up on any you disagree with.

**Issue 1 — footer**
- **"Fixed at the bottom of the modal"** means pinned *inside* the modal panel, with body content scrolling behind it on **all screen sizes (incl. mobile)** — not a browser-viewport-fixed bar. *(override if wrong)*

**Issue 2 — editor / styling**
- Both the **editing view AND the read-only description view** will be styled consistently. *(assumed)*
- **Links will look like links** — underline + accent color + hover state — in both edit and read views. *(assumed — you flagged invisible links specifically)*
- **Image resize** = drag handles with a sensible max-width cap. Enabling this requires widening the description HTML sanitizer to allow `width`/`height` (style attributes stay blocked for safety) — treated as a security-reviewed change. *(override if you want a different image UX)*
- **Keep the existing URL prompt** for inserting links/images for now (you flagged the *result*, not the entry UX). *(override if you want a nicer link/image input)*

**Issue 3 — nested `<form>` warnings**
- Fix **ALL** nested-`<form>` warnings in this modal — the comment form **and** the manual-time-entry form (same defect, same place), not just the one the console named. *(override if you want only the comment form addressed)*
- **Preserve all current behavior:** comment create + edit-save, manual time entry, the ticket edit-save, plus Enter-to-submit and the confirm-if-dirty discard flow. *(this is the requirement, not really optional)*

---

*To continue: answer inline (or tell the PM your picks), then re-run the workflow. After this we proceed to the deliverables.*
