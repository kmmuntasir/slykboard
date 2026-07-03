# Implementation Plan — DEL-02
**Ticket:** `.context/pm-cycles/pm-cycle-2026-07-03-15-36-20/deliverables/DEL-02-ckeditor-rich-text-editor-plan.md`
**Type:** Enhancement
**Title:** Replace TipTap with self-hosted free/GPL CKEditor 5 rich-text editor
**Generated:** 2026-07-03

---

## Summary
Replace TipTap end-to-end with a self-hosted, free/GPL CKEditor 5 build in the `frontend/` workspace of the npm-workspaces monorepo. There are no backend changes; the description stays a plain HTML string and the single integration site (`DescriptionField.tsx`) is preserved. A custom plugin set is curated from the single `ckeditor5` npm package plus `@ckeditor/ckeditor5-react` (v11.x, peer-dep `ckeditor5>=46.0.0`, React 19 compatible). Shared rich-text styling is delivered via a hand-written scoped `.rich-text` CSS layer applied to both the CKEditor editable and the read-only description div, fixing the root cause of unstyled typography — the current `prose` class (`RichTextEditor.tsx:236`) is a no-op because `@tailwindcss/typography` is not installed. Image resize is delivered via a time-boxed custom free/GPL drag-handle plugin with a documented `ImageStyle` width-preset fallback if a GO/NO-GO gate is tripped.

## Architecture Decisions
- **Custom build = curated plugin set, not a webpack build.** Import `ClassicEditor` and open-source plugins from the single `ckeditor5` npm package + `@ckeditor/ckeditor5-react`. Import `ckeditor5/ckeditor5.css` for the base chrome. Set `licenseKey: 'GPL'` in editor config (required v44+). The non-removable "Powered by CKEditor" attribution in the GPL build is **accepted** (spec locks this in) — do NOT strip it.
- **Single integration site preserved.** `RichTextEditor.tsx` keeps its named export `RichTextEditor` and prop signature `{ value: string; onChange: (html: string) => void; placeholder?: string }`. `DescriptionField.tsx` is unchanged in shape — it only renders `RichTextEditor` when editing and sanitizes HTML when read-only.
- **Shared rich-text styling** via a hand-written scoped `.rich-text` CSS layer applied to BOTH the CKEditor editable (`.ck-content`) and the read-only description div, so editing and read views look identical. This fixes the root cause of unstyled typography: the current `prose` class (`RichTextEditor.tsx:236`) is a no-op because `@tailwindcss/typography` is NOT installed.
- **Image resize decision boundary (HARD).** CKEditor 5 v44+ does NOT include drag-handle image resize in the free/GPL build — `ImageResize`/`ImageResizeHandles` are PREMIUM and require a commercial license. We do NOT use the commercial plugin and do NOT switch licenses.
  - **PRIMARY:** a custom self-authored resize plugin (our own free/GPL code) that renders drag handles on `<figure class="image">` and persists width so it round-trips. Time-boxed as a spike with an explicit GO/NO-GO gate.
  - **FALLBACK (documented deviation):** free/GPL `ImageStyle` width presets (e.g. Full/Large/Medium/Small = 100/75/50/25%) that round-trip natively, optionally plus a custom width dropdown. If the custom drag plugin is judged too high-risk at the NO-GO gate, adopt the fallback and document the deviation from the literal "drag handles" wording as a flagged owner decision.
- **Test boundary.** CKEditor 5 cannot initialize in jsdom (no layout/real-selection APIs). `RichTextEditor.test.tsx` is reworked to test the `RichTextEditor` wrapper contract with `@ckeditor/ckeditor5-react` mocked. The 5 consumer tests already mock `RichTextEditor` by its named export + `{value, onChange}` and keep passing unchanged.

## Affected Components
| Layer | File | Why |
|-------|------|-----|
| Frontend / Component | `frontend/src/components/RichTextEditor.tsx` | Full TipTap→CKEditor rewrite; preserve named export + props. |
| Frontend / Integration | `frontend/src/components/ticket-fields/DescriptionField.tsx` | Single integration site; add `.rich-text` class to read-only div. |
| Frontend / Util | `frontend/src/utils/sanitizeHtml.ts` | Widen allow-list for figure/figcaption/h5/h6 + scoped img width/style/class. |
| Frontend / Styles | `frontend/src/index.css` | Add scoped `.rich-text` layer + `.ck-*` chrome overrides. |
| Frontend / Custom plugin | `frontend/src/components/rich-text/CustomImageResize.ts` | Custom free/GPL image resize plugin (spike, GO/NO-GO gate). |
| Frontend / Test | `frontend/src/components/RichTextEditor.test.tsx` | Rework to wrapper-contract test with mocked `@ckeditor/ckeditor5-react`. |
| Frontend / Test | `frontend/src/utils/sanitizeHtml.test.ts` | Sanitizer round-trip + security unit tests. |
| Frontend / Manifest | `frontend/package.json` | Add `ckeditor5` + `@ckeditor/ckeditor5-react`; remove 6 `@tiptap/*` deps. |

## Proposed Implementation

### Frontend Changes

#### Phase 0 — Install + build spike (DECISION GATE, do first)
- **File:** `frontend/package.json`
- **What:** `npm install ckeditor5 @ckeditor/ckeditor5-react -w frontend` (runtime deps). Create a throwaway local usage of `<CKEditor>` with `ClassicEditor` + a minimal free plugin set and `licenseKey:'GPL'`; verify `npm run typecheck -w frontend`, `npm run build -w frontend`, and `npm run dev -w frontend` (or root dev) all compile and render without esbuild/minifier errors. Confirm `import 'ckeditor5/ckeditor5.css'` loads and the "Powered by CKEditor" attribution appears (expected/accepted).
- **Why:** Residual Vite/esbuild edge cases with the large ckeditor5 bundle are possible — verify empirically, do not assume. If blocked, stop and surface the blocker before proceeding.
- **Deliverable:** A short spike note in the plan/report confirming the install path works empirically.

#### Phase 1 — Widen sanitizer (independent; committable first to de-risk data layer)
- **File:** `frontend/src/utils/sanitizeHtml.ts`
- **What:** Add `figure`, `figcaption`, `h5`, `h6` to `ALLOWED_TAGS` (`:8-30`). Allow `width`, `style`, and `class` attributes but SCOPED to img/figure/figcaption only: extend the existing `uponSanitizeAttribute` hook (`:48-55`) so `style`/`width`/`class` are kept ONLY when the element is `img` (and `class` also on `figure`/`figcaption` for CKEditor's `image`/caption classes), and dropped otherwise. Keep the global `javascript:`/`data:` rejection (`:48-55`) and `ALLOWED_URI_REGEXP` (`:40-42`) intact. Do NOT add `style` to the global allow-list unscoped.
- **Why:** CKEditor emits `<figure class="image image-resized">` + `<figcaption>`; sanitizer must round-trip these while preserving security.
- **Code reference:** `frontend/src/utils/sanitizeHtml.ts:8-55`, `:60-69`
- **Tests:** Create/extend `frontend/src/utils/sanitizeHtml.test.ts` for: figure/figcaption round-trip; img with width + style + class preserved; `style`/`width` on a non-img tag (e.g. `<p style>`) stripped; `javascript:`/`data:` still rejected on img src and a href; h5/h6 allowed.
- **Acceptance:** Round-trip of CKEditor image output `<figure class="image image-resized"><img src="https://..." style="width:50%"><figcaption>cap</figcaption></figure>` survives sanitization.

#### Phase 2 — Shared rich-text CSS (styling parity)
- **File:** `frontend/src/index.css`
- **What:** Add a scoped rich-text stylesheet targeting a `.rich-text` container class (mirror the existing unlayered-override precedent for third-party CSS — react-day-picker overrides are intentionally UNLAYERED to beat Tailwind utilities; `.ck-content`/`.ck-*` overrides should follow the same precedent). Style: headings h1-h6 (size/weight/margin via rem), `p`, `ul`/`ol`/`li`, `blockquote` (left border accent, padding, muted-foreground), `pre` + `code` (code block background = muted, inline code chip), links (underline + accent/primary color + hover), `figure`/`img` (max-width:100%, rounded), `figcaption` (muted-foreground, small, centered). Reuse OKLCH tokens (`:10-55` `:root`, `:58-93` `.dark`) — available: `--primary`, `--accent`, `--border`, `--muted`, `--muted-foreground`, `--background`, `--foreground`, `--card`, `--ring`. Add `.dark` variants.
- **Why:** Same `.rich-text` class is applied to BOTH the CKEditor editable (Phase 3) and the read-only div (Phase 6) so edit and read views are identical.
- **Code reference:** `frontend/src/index.css:10-55`, `:58-93`, `:96-137`, `:140-154`

#### Phase 3 — RichTextEditor CKEditor rewrite (core)
- **File:** `frontend/src/components/RichTextEditor.tsx`
- **What:** Rewrite the component.
  - Keep named export `RichTextEditor` (`:204`, NO default export) and props `{ value: string; onChange: (html: string) => void; placeholder?: string }` (`:27-31`).
  - Imports: `{ CKEditor }` from `@ckeditor/ckeditor5-react`; from `ckeditor5`: `ClassicEditor, Essentials, Paragraph, Bold, Italic, Underline, Strikethrough, Code, CodeBlock, Heading, List, Link, BlockQuote, Image, ImageCaption, ImageStyle, ImageToolbar, Autoformat` (and any free helpers needed); `import 'ckeditor5/ckeditor5.css'`.
  - Editor config: `licenseKey:'GPL'`; `plugins:[...]`; `toolbar:{ items:[ ... ] }` covering bold/italic/underline/strikethrough/code, heading, bulleted/numbered list, blockquote, code block, link, image insert, undo; `heading:{ options: [...] }` for h1-h6; `link:{ addTargetToExternalLinks:true, defaultProtocol:'https://', decorators:{ openExternal:{ mode:'automatic', callback:()=>true, attributes:{ rel:'noopener noreferrer nofollow', target:'_blank' }}}}`; `image:{ toolbar:['imageStyle:alignLeft','imageStyle:alignRight','imageStyle:alignCenter','imageStyle:block','|','imageTextAlternative'], styles: [...] }`; `placeholder`.
  - Controlled value via CKEditor 5 React: wire `onChange={(event, editor)=> onChange(editor.getData())}` → form `setValue`. Use `onReady={(editor)=> editorRef.current = editor}` ref-mount fallback and a `useEffect` that calls `editorRef.current.setData(value)` when the external `value` prop changes, with a loop guard (ref flag while applying external data, and skip `setData` when normalized current data already equals incoming value). Honor React 19 strict-mode double-mount with the ref guard.
  - Remove the manual `<p>` placeholder hack (`:297-299`) — use CKEditor's built-in `placeholder` config.
  - Apply `.rich-text` to the editable so Phase 2 styles render in the editor.
  - Custom image-insert toolbar button using `window.prompt` that REUSES the existing URL allow-list (`HTTP_ONLY` + `REJECT_SCHEMES=/javascript:|data:/i`, `:54-56`) before calling the image insert command — preserves the current security posture (no base64, javascript:, data:). Keep `allowBase64:false` equivalent (do not enable base64). Replaces `handleImage` (`:196-202`) and `handleLink` (`:175-194`) posture.
  - Remove ALL TipTap imports (`:2-6`): `useEditor`, `useEditorState`, `EditorContent`, StarterKit, extension-underline/link/image. Remove `useEditor(...)` (`:205`), TipTap `onUpdate` (`:232-234`), `editorProps` prose class (`:235-236`), external sync `useEffect` (`:243-247`), `TOOLBAR_ACTIONS` array (`:58`), Radix `ToggleGroup` (`:276-294`).
- **Why:** Core replacement of the editor engine while preserving the public contract.
- **Code reference:** `frontend/src/components/RichTextEditor.tsx:27-31`, `:54-56`, `:58`, `:175-202`, `:204-247`, `:276-299`

#### Phase 4 — Custom image resize (SPIKE + GO/NO-GO gate)
- **File:** `frontend/src/components/rich-text/CustomImageResize.ts`
- **What:** Attempt a custom free/GPL resize plugin: extend the image schema with a `width` attribute; downcast model→view rendering `<figure class="image image-resized" style="width:...">` plus a drag-handle widget; upcast data→model reading width from `style`/`width`; pointer-event drag updates model width; ensure round-trip through `getData()`/`setData()` and the sanitizer (Phase 1).
  - **GO/NO-GO gate:** if a robust drag-resize plugin exceeds the agreed risk budget within the time box, adopt the FALLBACK and document the deviation.
  - **FALLBACK (free/GPL):** configure `ImageStyle` with width-based presets (Full/Large/Medium/Small = 100/75/50/25% via CSS classes in the `.rich-text` layer), which round-trip natively, optionally plus a custom width dropdown. Document in the report that literal "drag handles" were replaced by width presets due to the premium-plugin licensing constraint, as a flagged owner decision.
- **Why:** `ImageResize`/`ImageResizeHandles` are PREMIUM (commercial license); we stay free/GPL.
- **Code reference:** `frontend/src/components/rich-text/CustomImageResize.ts` (new)

#### Phase 5 — CKEditor toolbar/theme styling
- **File:** `frontend/src/index.css`
- **What:** Theme the CKEditor chrome via unlayered overrides: `.ck-toolbar`, `.ck-button` (rest/hover/active/focus), `.ck-dropdown`, `.ck-tooltip`, `.ck-balloon-panel`, borders/radius/colors using OKLCH tokens; add `.dark` variants so the toolbar matches the app in dark mode. Ensure focus-visible ring uses `--ring`.
- **Why:** Fully-styled toolbar per spec; dark-mode parity.
- **Code reference:** `frontend/src/index.css:10-55`, `:58-93`

#### Phase 6 — DescriptionField wiring (single integration site)
- **File:** `frontend/src/components/ticket-fields/DescriptionField.tsx`
- **What:** Add the `rich-text` class to the read-only div (`:88-93`) so it shares the Phase 2 stylesheet. Do NOT change the import (`:5`, `:9`) or the `{value, onChange}` wiring (`:70-75`). No signature changes. Verify `sanitizeDescription` still receives/strips correctly.
- **Why:** Edit and read-only views share identical styling.
- **Code reference:** `frontend/src/components/ticket-fields/DescriptionField.tsx:5`, `:9`, `:70-75`, `:88-93`

#### Phase 7 — Test rework
- **Files:** `frontend/src/components/RichTextEditor.test.tsx`, `frontend/src/utils/sanitizeHtml.test.ts`
- **What:** Rework `RichTextEditor.test.tsx` to test the wrapper contract without instantiating the real CKEditor engine: `vi.mock('@ckeditor/ckeditor5-react', ...)` so `CKEditor` renders a controlled element (e.g. a `div[contenteditable]` or textarea) that calls the `onChange`/`onReady` config props — then assert: toolbar buttons render with accessible names; wrapper classes (`.rich-text`, focus ring family) present; initial `value` passed through; `onChange` wiring fires on input; placeholder handling; URL allow-list rejection for javascript:/data: image insertion (unit-test the prompt helper in isolation). Remove all `.ProseMirror` selectors and jsdom Range polyfills (TipTap-specific). Verify the 5 consumer mocks still match the named `RichTextEditor` + `{value, onChange}` signature and pass unchanged: `TicketDetailModal.test.tsx:12-19`, `TicketAttributeForm.test.tsx:4-11`, `CreateTicketModal.test.tsx:4-11`, `NewTicketButton.test.tsx:4-11`, `DescriptionField.test.tsx:23-27`.
- **Why:** CKEditor cannot init in jsdom (confirmed: `frontend/src/test-setup.ts` lacks Range/Selection/matchMedia/getBoundingClientRect/IntersectionObserver).
- **Code reference:** `frontend/src/test-setup.ts`, consumer mock sites listed above.

#### Phase 8 — Cleanup & verification
- **File:** `frontend/package.json`
- **What:** Remove the 6 `@tiptap/*` deps (all `^3.0.0`): `@tiptap/extension-image`, `@tiptap/extension-link`, `@tiptap/extension-underline`, `@tiptap/pm`, `@tiptap/react`, `@tiptap/starter-kit` via `npm uninstall` (or edit + `npm install` to refresh lockfile) once nothing imports them. Final gates green: `npm run typecheck -w frontend`, `npm run test -w frontend`, `npm run build -w frontend`. "Powered by CKEditor" attribution present and intentionally retained.

## Edge Cases & Risks

### Edge Cases
- Controlled-value feedback loop (external `setValue` → `setData` → `onChange` → `setValue`): guard with a ref flag + normalized-equality check before `setData`.
- React 19 strict-mode double-mount: ref-mount fallback + idempotent `onReady`.
- jsdom cannot init CKEditor: enforce the test mock boundary; never instantiate the engine in unit tests.
- Sanitizer must scope `style`/`width`/`class` to img/figure/figcaption only (do NOT allow global inline styles).
- `figure`/`figcaption` must round-trip through BOTH `getData()`/`setData()` and the sanitizer.
- Heading parity: add h5/h6 to sanitizer AND heading config (current TipTap only exposed h1-h4).
- Dark-mode parity for both `.ck-*` chrome and `.rich-text` content.
- Large ckeditor5 bundle may stress default esbuild minification — confirmed in Phase 0 spike.

### Risks
| Risk | Mitigation |
|------|------------|
| Custom image-resize plugin complexity / potential rabbit hole | Time-boxed GO/NO-GO gate + free `ImageStyle` fallback. |
| Vite/esbuild build edge cases with large ckeditor5 bundle | Phase 0 empirical spike before committing. |
| Controlled-value feedback loop in React 19 | Ref flag + normalized-equality guard + `onReady` ref-mount fallback. |
| jsdom test boundary | Mock `@ckeditor/ckeditor5-react`; never init engine in unit tests. |
| Sanitizer `style` attribute widening could enlarge attack surface | Scope `style`/`width`/`class` to img/figure/figcaption only via the existing attribute hook. |
| Dark-mode parity gaps in `.ck-*` chrome | Explicit `.dark` overrides in Phase 5. |

## Testing
- **Sanitizer unit tests (Phase 1)** for round-trip + security (figure/figcaption round-trip; scoped style/width/class; javascript:/data: rejection; h5/h6).
- **RichTextEditor wrapper contract tests (Phase 7)** with mocked `@ckeditor/ckeditor5-react` (Vitest + Testing Library).
- **Consumer tests:** keep all 5 consumer tests green unchanged.
- **Manual verification:** edit → save → reopen read-only shows identical styling (`.rich-text` parity); image resize round-trips; dark mode toolbar + content parity.
- Co-locate `*.test.ts(x)` next to source. Query preference: `getByRole > getByLabelText > getByText > getByTestId`.

## Acceptance Criteria
- [ ] TipTap fully removed; CKEditor 5 self-hosted via `ckeditor5` + `@ckeditor/ckeditor5-react`; `licenseKey:'GPL'`; no commercial plugin/license.
- [ ] Toolbar fully styled, matches app tokens in light + dark.
- [ ] Editing view and read-only view styled identically (shared `.rich-text`).
- [ ] Sanitizer widened (figure, figcaption, h5, h6, scoped img width/style/class) with javascript:/data: rejection intact and round-trip verified.
- [ ] Image resize works and round-trips via EITHER the custom free/GPL drag plugin OR the documented ImageStyle width-preset fallback.
- [ ] Single integration site preserved; named export + `{value, onChange, placeholder?}` unchanged; 5 consumer tests green.
- [ ] No backend changes; description remains a plain HTML string.
- [ ] "Powered by CKEditor" attribution retained.
- [ ] typecheck/test/build all green; TipTap deps removed.

## Out of Scope
- Backend changes (description contract unchanged; `UpdateTicketDto.description?: string` untouched).
- Table support (spec toolbar does not include it).
- Image upload / drag-drop file upload (URL insertion only, preserving the URL allow-list).
- Any commercial CKEditor plugin or commercial license.
- Removing/hiding the "Powered by CKEditor" attribution.

## Open Questions
- If the custom drag-resize plugin is NO-GO, is the free `ImageStyle` width-preset fallback an acceptable documented deviation from the literal "drag handles" requirement? (Recommendation: yes.)
- Confirm table support is out of scope. (Recommendation: yes.)
