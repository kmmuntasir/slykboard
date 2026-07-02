# Implementation Plan — DEL-01
**Ticket:** `DEL-01 — Robust rich text editor (enhancement)`
**Type:** Enhancement
**Title:** Robust rich text editor
**Generated:** 2026-07-03

---

## Summary
Expand the ticket-description rich text editor (Tiptap v3, consumed via `DescriptionField` on both create and edit paths) so it exposes a wider formatting set with clean single-glyph lucide icons, visible active/toggle state, and HTML sanitization parity on frontend + backend create + edit paths so saved descriptions round-trip exactly. NO image upload pipeline (URL-only is a permanent non-goal). No changes to the comments editor or other fields.

## Root Cause *(enhancement — N/A)*
Not a bug. Three sanitization parity gaps surfaced during investigation and are addressed as part of the enhancement (see Changes 6 & 7).

## Affected Components
| Layer | File | Why |
|-------|------|-----|
| Frontend | `frontend/src/components/RichTextEditor.tsx` | Editor component; toolbar rewrite + new extensions |
| Frontend | `frontend/src/components/RichTextEditor.test.tsx` | Extend button/active-state/onChange assertions |
| Frontend | `frontend/src/components/ticket-fields/DescriptionField.tsx` | Wire render-path sanitization |
| Frontend | `frontend/src/utils/sanitizeHtml.ts` | Widen allow-list for parity |
| Frontend | `frontend/src/utils/sanitizeHtml.test.ts` | Table rows for new tags/attrs |
| Frontend | `frontend/package.json` | Add 3 Tiptap extension deps |
| Backend | `backend/src/services/ticketService.ts` | Create-path sanitization (`:231`) |
| Backend | `backend/src/services/ticketService.test.ts` | Create sanitization case |
| Backend | `backend/src/utils/sanitizeHtml.ts` | Widen allow-list (`:3-19`) |
| Backend | `backend/src/utils/sanitizeHtml.test.ts` | Table rows for new tags/attrs |

## Proposed Implementation

### Frontend Changes

#### Change 1 — Add Tiptap extension deps (Underline, Link, Image)
- **File:** `frontend/package.json`
- **What:** Add (if not already top-level deps): `@tiptap/extension-underline`, `@tiptap/extension-link`, `@tiptap/extension-image` (match the StarterKit v3.27.x line already pinned in `pnpm-lock.yaml`). Run install; verify versions resolve.
- **Why:** StarterKit lacks these three; Link and Image are required by the ticket (Links URL+text; Image-by-URL); Underline is required.
- **Code reference:** `frontend/package.json:31` (lucide-react); `pnpm-lock.yaml` (transitive presence of the three extensions).

#### Change 2 — Register extensions in the editor
- **File:** `frontend/src/components/RichTextEditor.tsx`
- **What:** At the `useEditor` `extensions` array (currently `[StarterKit]` at `:15`), append `Underline`, `Link.configure({ openInNewWindow: true, autolink: false, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } })`, and `Image.configure({ inline: false, allowBase64: false })` (URL-only; no base64/data-uri → reinforces no-upload policy). Add imports from the three new packages.
- **Why:** StarterKit (Tiptap v3) already bundles Bold, Italic, Strike, Code (inline), Heading (1–6), BulletList, OrderedList, ListItem, Blockquote, CodeBlock, HardBreak; Underline/Link/Image are not bundled.
- **Code reference:** `frontend/src/components/RichTextEditor.tsx:15`

#### Change 3 — Rewrite the toolbar: array-driven config + single lucide glyphs
- **File:** `frontend/src/components/RichTextEditor.tsx`
- **What:** Replaces the 5 hand-written `ToggleGroupItem` blocks at `:54-95`. Introduce a `TOOLBAR_ACTIONS` config array (per AGENTS.md reusability rule). Each entry: `{ id, label, Icon (lucide component), isActive: (editor)=>boolean, run: (editor)=>void }`.
  - Active set (keep existing): Bold (`Bold` icon, `toggleBold`), Italic (`Italic`, `toggleItalic`), H3 (`Heading3`, `toggleHeading({level:3})`), Bullet list (`List`, `toggleBulletList`), Inline code (`Code`, `toggleCode`).
  - New actions: Strikethrough (`Strikethrough`, `toggleStrike`), Underline (`Underline`, `toggleUnderline`), H1 (`Heading1`, `toggleHeading({level:1})`), H2 (`Heading2`, level 2), H4 (`Heading4`, level 4), Numbered list (`ListOrdered`, `toggleOrderedList`), Blockquote (`Quote`, `toggleBlockquote`), Code block (`Code2`/`SquareCode`, `toggleCodeBlock`), Link (`Link`, custom handler — see Change 4), Image-by-URL (`Image`, custom handler — see Change 5).
  - Render: map over the array; each `<ToggleGroupItem value={id} aria-label={label} onClick={...}>` wraps `<Icon size={14} />` ONLY (no text). Buttons size to content (`ToggleGroupItem` already `h-7 w-7`); wrap the `ToggleGroup` root in a container that allows wrapping (ensure root has `flex flex-wrap gap-0.5` — `ToggleGroup.tsx:35` currently `flex items-center gap-0.5`; add `flex-wrap`). Group actions logically (text marks / headings / lists / blocks / insert) with a thin separator if desired.
  - `activeMarks` derivation (`:38-52`) must consume each action's `isActive(editor)` so pressed state reflects ALL toggles (strike, underline, heading levels, ordered list, blockquote, codeBlock, link). Link/Image are not toggles in the Radix sense (they're insert/transform commands) — render them as plain buttons or as toggles whose `isActive` reflects `editor.isActive('link')`; keep `aria-label` correct.
  - Keep `aria-label` (no Tooltip) so `getByRole('button',{name})` tests keep working.
- **Why:** Current icons are broken multi-char text labels: `<span className="font-semibold">B</span>` (`:65`), `<span className="italic">I</span>` (`:72`), bare `H3` (`:79`), bare `• List` (`:86`), `{'</>'}` (`:93`). `lucide-react` is the app-wide icon standard (used at `DescriptionField.tsx:30` `<AlignLeft size={14} />`). Active/toggle state already works via `useEditorState` + Radix `data-[state=on]:bg-accent` — only icons and the formatting set need fixing.
- **Code reference:** `frontend/src/components/RichTextEditor.tsx:54-95`, `:38-52`, `:65`, `:72`, `:79`, `:86`, `:93`; `frontend/src/components/ui/ToggleGroup.tsx:35`, `:45-46`.

#### Change 4 — Link handler (URL + display text)
- **File:** `frontend/src/components/RichTextEditor.tsx`
- **What:** `run`: if `editor.isActive('link')` → `editor.chain().focus().extendMarkRange('link').unsetLink().run()` (toggle off). Else: `const url = window.prompt('Link URL')`; if non-empty and valid (basic scheme check `^https?://` or `mailto:`), if there is a text selection use it as display text via `editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()`; if no selection, prompt for display text and `editor.chain().focus().insertContent(`<a href="${url}">${displayText}</a>`).run()`. Guard against `javascript:` (the sanitizer + Link config rel strip it, but reject client-side too). Prompt-based is acceptable for this scope (no modal primitive work).
- **Why:** Link insertion is required by the ticket (URL + display text).
- **Code reference:** `frontend/src/components/RichTextEditor.tsx` (new handler in rewritten toolbar).

#### Change 5 — Image-by-URL handler (URL-only)
- **File:** `frontend/src/components/RichTextEditor.tsx`
- **What:** `run`: `const url = window.prompt('Image URL')`; if non-empty and `^https?://`, `editor.chain().focus().setImage({ src: url, alt: '' }).run()`. No upload UI, no file input — enforces permanent non-goal.
- **Why:** Image-by-URL is required; no upload pipeline is a permanent non-goal.
- **Code reference:** `frontend/src/components/RichTextEditor.tsx` (new handler in rewritten toolbar).

#### Change 6 — Widen BACKEND sanitizer allow-list + fix CREATE path parity
- **File:** `backend/src/utils/sanitizeHtml.ts`
- **What:** At `:3-19`, `ALLOWED_TAGS` becomes: add `b`, `i`, `s`, `del`, `strike`, `u`, `h1`, `h2`, `img` (keep existing `p, br, strong, em, ul, ol, li, code, pre, blockquote, a, h3, h4`). `ALLOWED_ATTR` becomes: add `src`, `alt`, `target`, `rel` (keep `href`). Keep `FORBID_TAGS`/`FORBID_ATTR` as-is. Optionally add `ALLOWED_URI_REGEXP` to reject `javascript:`/`data:` URIs on `src`/`href` (defense-in-depth).
- **Why:** Allow-lists outdated on backend; missing new formatting tags and image/link attrs.
- **Code reference:** `backend/src/utils/sanitizeHtml.ts:1` (isomorphic-dompurify), `:3-19`.
- **File:** `backend/src/services/ticketService.ts`
- **What:** At `:231` (create insert), mirror edit-path handling: `description: input.description === undefined ? undefined : sanitizeDescription(input.description)`. (Create input `description` is `string | undefined`.) This closes the create/edit parity gap. `null`-clear semantics on edit (`:429`) stay untouched.
- **Why:** Backend create path writes `description` RAW — no `sanitizeDescription` call — while edit path DOES sanitize (`:428-430`).
- **Code reference:** `backend/src/services/ticketService.ts:231`, `:428-430`.

#### Change 7 — Widen FRONTEND sanitizer allow-list + wire render sanitization
- **File:** `frontend/src/utils/sanitizeHtml.ts`
- **What:** Make `ALLOWED_TAGS`/`ALLOWED_ATTR` byte-for-byte identical to the backend list from Change 6 (parity).
- **Why:** Allow-lists outdated on frontend; missing new tags/attrs; must match backend for round-trip.
- **Code reference:** `frontend/src/utils/sanitizeHtml.ts:1` (dompurify), `:27-40` (helper).
- **File:** `frontend/src/components/ticket-fields/DescriptionField.tsx`
- **What:** At `:34-38`, replace `descriptionValue` in `dangerouslySetInnerHTML` with `sanitizeDescription(descriptionValue)`. Import the helper. This makes the existing dead helper live and closes the render-path XSS gap (the comment at `:34` already claims it is sanitized).
- **Why:** Frontend render path is RAW; a `sanitizeDescription` helper exists (`frontend/src/utils/sanitizeHtml.ts:27-40`) but has ZERO call sites (dead code).
- **Code reference:** `frontend/src/components/ticket-fields/DescriptionField.tsx:34-38`.

### Testing Changes

#### Change 8 — Tests
- **File:** `frontend/src/utils/sanitizeHtml.test.ts`
  - **What:** Add table rows — keeps `<s>`, `<u>`, `<h1>`, `<h2>`, `<img src="https://...">` (src survives), keeps `alt`, keeps link `target`/`rel`; strips `<script>`, strips `onerror`/`onload`, strips `javascript:` href AND `javascript:` img src, strips `data:` img src, strips `<iframe>`.
- **File:** `frontend/src/components/RichTextEditor.test.tsx`
  - **What:** Extend the accessible-name assertions (`:48-57`) to every new button (Strikethrough, Underline, Heading 1/2/4, Numbered list, Blockquote, Code block, Link, Image). Extend the active-state block (`:133-167`) to cover at least Strikethrough, Underline, H1, Ordered list, Blockquote, Code block toggles (assert `data-state=on`/`aria-pressed=true`/`bg-accent`). Add a case that toggling Bold emits `<strong>` and toggling Strikethrough emits `<s>` in the `onChange` HTML (mirrors `:93-123`). Add a Link case: with a selection, clicking Link + prompt returns the url → `onChange` contains `<a href=... target="_blank" rel=...>`. Add an Image case: prompt url → `onChange` contains `<img src=...>`. (Prompt-based tests use `vi.spyOn(window,'prompt')`.) Preserve the existing `beforeAll` jsdom Range/getClientRects polyfill (`:12-43`).
  - No change required to the `vi.mock('./RichTextEditor', ...)` stubs in CreateTicketModal/TicketAttributeForm/NewTicketButton tests — the toolbar expansion is internal; leave mocks as-is.
- **File:** `backend/src/utils/sanitizeHtml.test.ts`
  - **What:** Mirror the frontend table rows (keeps new tags/attrs; strips script/onerror/javascript:/data:).
- **File:** `backend/src/services/ticketService.test.ts`
  - **What:** Add a create-path case asserting `sanitizeDescription` is invoked exactly once with `input.description` on create (mirror `:724-735`). Keep the existing edit cases green.

## Edge Cases & Risks
- Empty/`undefined` description on create → must not throw (the `undefined` guard in Change 6).
- `null` description on edit → existing short-circuit preserved (no sanitizer call).
- Link with no selection → must insert display text, not empty `<a>`.
- Image `data:`/`javascript:` URI → stripped by sanitizer; also rejected client-side.
- Pasting rich content → DOMPurify still strips disallowed tags (allow-list is the source of truth, not the editor).
- Large description (5000-char cap) → unchanged (`useTicketForm.ts:18`, `tickets.schema.ts:31`); sanitizer output may differ in length from input.
- Tiptap v3 extension API drift → verify `setLink`/`setImage`/`toggleUnderline` command names against the resolved extension versions before finalizing.
- Toolbar wrapping on narrow modals → `flex-wrap` on the ToggleGroup root.

## Testing
- **Frontend:** Vitest + Testing Library; co-located `*.test.tsx`; `getByRole('button',{name})` for button presence; `data-state`/`aria-pressed`/`bg-accent` for active state; `onChange` HTML assertions; prompt-based Link/Image cases use `vi.spyOn(window,'prompt')`.
- **Backend:** Vitest; table-driven sanitizer tests; service logic unit-tested with mocked data-access; create-path sanitization case mirrors existing edit cases.
- **Co-locate** `*.test.ts(x)` next to source.
- **Manual QA:** Create a ticket using every toolbar action; reopen it (read-only) and confirm each format renders exactly; edit and re-save; confirm round-trip parity. Verify a `<script>` payload pasted into the editor is stripped on save. Verify an image-by-URL renders. Verify `javascript:` link/img are neutralized.

## Acceptance Criteria
- [ ] **AC1 — Expanded formatting set:** Toolbar exposes Strikethrough, Underline, H1/H2/H4, Numbered list, Blockquote, Code block, Link, Image; keeps Bold/Italic/H3/Bullet/Inline code. (Changes 2–5)
- [ ] **AC2 — Clean single-glyph icons, buttons size to content, toolbar wraps:** lucide icons only; `flex-wrap` on ToggleGroup root. (Change 3)
- [ ] **AC3 — Active/toggle state visually indicated:** `isActive` wiring covers all toggles; Radix `data-[state=on]:bg-accent` now reflects every toggle. (Change 3)
- [ ] **AC4 — Sanitization parity, saved description renders back exactly:** Backend create sanitization + widened BE allow-list; FE render sanitization + widened FE allow-list; links keep href/target/rel, images keep src. (Changes 6 & 7)
- [ ] **Non-goal honored — No image upload pipeline:** URL-only, `allowBase64:false`; no file input. (Change 5)

## Out of Scope
- Image upload pipeline (permanent non-goal).
- Comments editor or any field other than ticket description.
- Tooltip hover labels (keep `aria-label`-only for test simplicity).
- Rich link-insertion modal (prompt-based is sufficient).
- Changes to the 5000-char length cap.
- DB schema changes.

## Open Questions *(optional)*
- Should links force `target="_blank" rel="noopener noreferrer nofollow"` (proposed) or allow same-tab? (Recommend forcing — safer; documented in Change 6.)
- Confirm exact resolved versions of `@tiptap/extension-underline/link/image` match StarterKit 3.27.x before pinning (they are in the lockfile transitively — verify at install).
- Is a `javascript:`/`data:` URI regexp on the sanitizer desired as defense-in-depth beyond DOMPurify defaults? (Recommend yes, low cost.)
