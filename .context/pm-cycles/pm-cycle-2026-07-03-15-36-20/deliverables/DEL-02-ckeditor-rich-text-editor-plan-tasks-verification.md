# Implementation Verification Report — DEL-02

**Deliverable:** DEL-02 — Replace TipTap with a self-hosted free/GPL CKEditor 5 build
**Source (task file):** `.context/pm-cycles/pm-cycle-2026-07-03-15-36-20/deliverables/DEL-02-ckeditor-rich-text-editor-plan-tasks.md`
**Companion plan:** `.context/pm-cycles/pm-cycle-2026-07-03-15-36-20/deliverables/DEL-02-ckeditor-rich-text-editor-plan.md`
**Authoritative spec:** `.context/pm-cycles/pm-cycle-2026-07-03-15-36-20/deliverables/DEL-02-ckeditor-rich-text-editor.md`
**Verified:** 2026-07-03
**Total Tasks:** 7
**Implemented:** 7 (100%)
**Partial:** 0
**Missing:** 0
**Modified:** 0

---

## Scope & Methodology

**Scope.** DEL-02 replaces the TipTap rich-text editor end-to-end with a self-hosted free/GPL CKEditor 5 build in the `frontend/` workspace of this npm-workspaces monorepo. There are no backend changes; the description stays a plain HTML string; the single integration site (`DescriptionField.tsx`) and the `RichTextEditor` named export + props `{ value: string; onChange: (html: string) => void; placeholder?: string }` are preserved. The deliverable is 7 tasks (T1–T7), each a single commit on `main`.

**Methodology.** This report is produced from independent verification evidence: three read-only dev-analyst digests (install/build gate, sanitizer + shared styles, engine rewrite + chrome theming) cross-checked against the spec and the plan, plus verifier-run quality gates executed at the repo root (typecheck, test, build). Findings are classified as:

- **PASS** — implemented as specified, verified by evidence.
- **DEVIATION** — exists and differs from the literal spec, but the difference is **documented, pre-approved, and acceptable** (an owner-decision boundary).
- **GAP** — an undocumented defect or shortfall that should be addressed.
- **BLOCKER** — prevents acceptance.

Path:line citations are given throughout and refer to the post-implementation tree unless otherwise noted.

### Commit history (merge order)

| Task | Commit | Message (verbatim) |
|------|--------|--------------------|
| T1 | `9af7940` | `DEL-02: Add ckeditor5 and ckeditor5-react dependencies` |
| T2 | `82c2ea1` | `DEL-02: Widen sanitizeHtml allow-list for figure/figcaption/h5/h6` |
| T3 | `75e30ef` | `DEL-02: Add shared rich-text content styles and apply to description view` |
| T4 | `8150dfd` | `DEL-02: Rewrite RichTextEditor on CKEditor and rework its test` |
| T5 | `2a03c70` | `DEL-02: Theme CKEditor chrome and dark variants` |
| T6 | `c9e187a` | `DEL-02: Configure ImageStyle width presets as resize fallback` |
| T7 | `26b55ec` | `DEL-02: Remove unused TipTap dependencies` |

All seven single-line messages match the spec verbatim. The T6 message string ("...as resize fallback") is the **NO-GO/fallback** commit line defined in the spec, confirming a documented deviation (see §Deviations).

---

## Executive Summary

| Metric | Result |
|--------|--------|
| Tasks committed | **7 / 7** (all on `main`) |
| Task status | **7/7 Implemented** (100%); 0 Partial; 0 Missing; 0 Modified |
| Spec acceptance criteria | **12 total → 11 MET + 1 MET-WITH-DEVIATION + 0 unmet** |
| Typecheck | PASS (exit 0) |
| Test | PASS — 118 files / **1028 tests passed**, 0 failed (exit 0) |
| Build | PASS (exit 0) — Vite v7.3.5, 3939 modules, 9.44s |
| Deviations | 1 documented/acceptable (image-resize fallback) + 1 expected/accepted (attribution) |
| Gaps | 1 low-severity (in-code premium-feature rationale) |
| Blockers | **0** |
| **Overall verdict** | **DELIVERED** |

All seven tasks are implemented; all three gates are green. The single functional deviation — image resize delivered via free `ImageStyle` width presets instead of literal "drag handles" — is the **pre-approved, documented NO-GO fallback** triggered by the premium-licensing constraint (CKEditor 5 v44+ moved `ImageResize`/`ImageResizeHandles` to the commercial tier, and the spec forbids a commercial license). Image width **does round-trip** and is capped by `max-width:100%`; the deviation must be recorded as an open owner-decision. There is one low-severity, non-functional GAP (a missing in-code comment naming the premium feature being avoided) with a one-line suggested fix.

---

## Gate Results

| Gate | Command | Result | Notes |
|------|---------|--------|-------|
| Typecheck | `npm run typecheck -w frontend` | **PASS** (exit 0) | — |
| Test | `npm run test -w frontend` | **PASS** (exit 0) | 118 files / **1028 tests passed**, 0 failed. One pre-existing, unrelated stderr warning in `RequireAuth.test.tsx` (setState-during-render) — not a DEL-02 artifact. |
| Build | `npm run build -w frontend` | **PASS** (exit 0) | Vite v7.3.5, 3939 modules transformed, built in 9.44s. |

**Build artifacts**

| Artifact | Size | Gzip |
|----------|------|------|
| `dist/index.html` | 2.14 kB | 1.02 kB |
| `dist/assets/index-*.css` | 261.08 kB | 42.55 kB |
| `dist/assets/index-*.js` | 1,778.38 kB | 511.87 kB |

An advisory **chunk-size warning (>500 kB)** is present. This is **expected and advisory only** (CKEditor 5 is a heavy engine) and is **not a defect**. Code-splitting was not in scope.

**Targeted re-runs by analysts:** `sanitizeHtml.test.ts` → 40/40 pass; the 6-file consumer+editor suite → 87/87 pass.

---

## Task-by-Task Status

| Task | Title | Status | Classification | Files |
|------|-------|--------|----------------|-------|
| T1 | Install ckeditor5 + @ckeditor/ckeditor5-react (build gate) | Implemented | **PASS** | `frontend/package.json`, `package-lock.json` |
| T2 | Widen sanitizeHtml allow-list (figure/figcaption/h5/h6 + scoped img attrs) | Implemented | **PASS** | `frontend/src/utils/sanitizeHtml.ts`, `frontend/src/utils/sanitizeHtml.test.ts` |
| T3 | Shared `.rich-text` content styles + apply to description read-only view | Implemented | **PASS** | `frontend/src/index.css`, `frontend/src/components/ticket-fields/DescriptionField.tsx` |
| T4 | Rewrite RichTextEditor on CKEditor + rework its test | Implemented | **PASS** | `frontend/src/components/RichTextEditor.tsx`, `frontend/src/components/RichTextEditor.test.tsx` |
| T5 | Theme CKEditor chrome + dark variants | Implemented | **PASS** | `frontend/src/index.css` |
| T6 | Deliver image resize (custom drag plugin **OR** documented fallback) | Implemented via fallback | **DEVIATION** (documented, acceptable) | `frontend/src/components/RichTextEditor.tsx`, `frontend/src/index.css` |
| T7 | Remove unused TipTap deps + final verification | Implemented | **PASS** | `frontend/package.json`, `package-lock.json` |

### Summary counts

| Status | Count | Percentage |
|--------|-------|------------|
| Implemented (PASS) | 6 | 85.7% |
| Implemented via documented DEVIATION | 1 | 14.3% |
| Partial | 0 | 0% |
| Missing | 0 | 0% |
| Modified | 0 | 0% |

---

## Detailed Per-Task Evidence

### T1 — Install ckeditor5 + @ckeditor/ckeditor5-react and verify the Vite build (DECISION GATE) — **PASS**

- **Dependencies present and runtime-scoped.** `"@ckeditor/ckeditor5-react": "^11.2.0"` at `frontend/package.json:15` and `"ckeditor5": "^48.3.0"` at `frontend/package.json:27`, both in runtime `dependencies` (**not** devDependencies). Engine `^48.3.0` satisfies the wrapper's peer-dep `ckeditor5>=46.0.0`; the v11.x wrapper is React 19 compatible.
- **No bundler workaround introduced.** The devDependencies block (`frontend/package.json:47+`) contains only the pre-existing build/test tooling — **no webpack, no extra bundler config**. Commit `9af7940` touched **only** `frontend/package.json` (+2) and `package-lock.json` (+2866/−28).
- **No throwaway spike code.** Nothing spike-related remains in `frontend/src/**`.
- **Attribution shipped in the production bundle.** The bundle contains `ck-powered-by`, `ck-powered-by-balloon`, `ck-powered-by__label`, `poweredBy`, and `powered_by_ckeditor_logo` — the "Powered by CKEditor" module is shipped and **not** stripped/hidden in source.
- **Gate outcome:** GO (typecheck/build/dev green).

### T2 — Widen sanitizeHtml allow-list for figure/figcaption/h5/h6 and scoped img width/style/class — **PASS**

- **ALLOWED_TAGS widened.** `figure`, `figcaption`, `h5`, `h6` added at `frontend/src/utils/sanitizeHtml.ts:30-33`.
- **Global attribute list unchanged.** `ALLOWED_ATTR` remains `['href','src','alt','target','rel']` at `sanitizeHtml.ts:36` — `style`/`width`/`class` are **not** added globally.
- **Attributes scoped in the hook.** `uponSanitizeAttribute` scopes the new attributes at `sanitizeHtml.ts:83-93`: tag detected `:85`; `isImg` `:86`; `isFigureCaption` `:87`; `keep = isImg || (class && figure/figcaption)` `:89`; `forceKeepAttr=true` when kept `:90-91`, else `keepAttr=false` `:93`. Verified semantics: `<img style/width/class>` all kept; `<figure>`/`<figcaption>` keep `class` only; `<p style>` is dropped.
- **Existing security intact.** `javascript:`/`data:` src/href rejection at `sanitizeHtml.ts:73-80`; `ALLOWED_URI_REGEXP` at `:39-46` unchanged.
- **Correct symbol scope.** No references to `HTTP_ONLY`/`REJECT_SCHEMES`/`HTTP_OR_MAILTO` in the sanitizer (those live in `RichTextEditor.tsx`).
- **Tests added (originals kept).** New cases in `frontend/src/utils/sanitizeHtml.test.ts`: figure+figcaption round-trip (the exact CKEditor image block `<figure class="image image-resized"><img src=... style="width:50%"><figcaption>cap</figcaption></figure>`) `:146-157`; img width+style+class preserved `:159-168`; `<p style>` stripped `:169-173`; class on non-img/figure/figcaption stripped `:174-178`; `javascript:`/`data:` rejected on img src and a href `:179-198`; h5/h6 allowed `:199-203`; 2 T6 preset-class cases `:204-218`. **40/40 pass.** No `any` introduced.

### T3 — Add shared `.rich-text` content styles and apply them to the description read-only view — **PASS**

- **Scoped `.rich-text` content stylesheet added unlayered.** Top-level rules at `frontend/src/index.css:176-355` (after `@layer base` at `:136`, mirroring the react-day-picker override precedent at `:157-174`). Covers: h1–h6 `:199-227` (rem sizes, weight 600, margins); `p` `:230`; ul/ol/li `:235-252` (marker color `--muted-foreground`); blockquote `:255-266` (left border `--primary`, `--muted-foreground`, italic); `pre` `:269-278` (bg `--muted`); inline code chip `:289-294`; links `:305-313` (underline + `--primary` + hover `color-mix`); figure `:315-316`; img `:318-321` (`max-width:100%`, radius); figcaption `:323-330` (`--muted-foreground`, `0.75rem`, centered). `.dark` variants at `:347-355`.
- **DescriptionField read-only view carries the class.** `rich-text` added at `frontend/src/components/ticket-fields/DescriptionField.tsx:89` (`className="rich-text max-w-none rounded border border-border bg-muted p-2 text-sm"`).
- **Imports and wiring unchanged.** `RichTextEditor` import `:5`, `sanitizeDescription` import `:9`, and `{value, onChange}` wiring `:73-74` are unchanged.

### T4 — Rewrite RichTextEditor on CKEditor and rework its test — **PASS**

- **TipTap fully removed from the component.** Grep for `@tiptap|useEditor|EditorContent|StarterKit|@prosemirror|prosemirror-` across `frontend/src` → zero matches. Imports block at `frontend/src/components/RichTextEditor.tsx:6-30`: react `:6`; `{ CKEditor }` from `@ckeditor/ckeditor5-react` `:7`; free plugins from `'ckeditor5'` `:8-28` (Autoformat, BlockQuote, Bold, Code, CodeBlock, Essentials, Heading, Image, ImageCaption, ImageStyle, ImageToolbar, Italic, Link, List, ListProperties, Paragraph, Strikethrough, Underline, etc.); `import 'ckeditor5/ckeditor5.css'` `:30`.
- **Named export and props preserved exactly.** `function RichTextEditor(...)` at `RichTextEditor.tsx:122`; **no default export**. Props interface `:36-40` is exactly `value: string` `:37`, `onChange: (html: string) => void` `:38`, `placeholder?: string` `:39`.
- **GPL license, no premium plugins.** `licenseKey: 'GPL'` at `RichTextEditor.tsx:136`. Grep `ImageResize|ImageResizeHandles|Premium|premium` in file → only a "no premium" comment, **zero imports**. No `Base64UploadAdapter`/`ImageUpload`/`FileRepository`/`CKBox`/`EasyImage` (base64/upload not enabled).
- **Controlled value with dual loop guard + ref-mount fallback.** `editorRef` declared `:125`; `onReady` assigns `editorRef.current = editor` `:250-252`; initial value via `data={value}` `:249`. Controlled-value `useEffect` `:229-235` early-returns if no editor `:230`, applies **guard (b)** normalized-equality (`if (current === value.trim()) return;` `:231`) and **guard (a)** ref flag (`applyingExternalData.current = true` `:232` → `editor.setData(value)` `:233` → `applyingExternalData.current = false` `:234`). The flag is honored in `onChange` `:254-255` (`onChange={(_event, editor) => { if (applyingExternalData.current) return; onChange(editor.getData()); }}`). **Both guards are substantive, not stubs.**
- **`.rich-text` applied to editor wrapper.** At `RichTextEditor.tsx:245` (with the focus-ring family `focus-within:ring-2 focus-within:ring-ring focus-within:border-primary`). Because `.rich-text` rules are descendant selectors, the inner `.ck-content` editable inherits them — functionally equivalent (see §Deviations & Gaps — Informational).
- **Custom image-insert toolbar button, security preserved.** Three URL constants `HTTP_OR_MAILTO`/`HTTP_ONLY`/`REJECT_SCHEMES` at `:48-50`; pure validator `export function isValidImageUrl` `:61` (`HTTP_ONLY.test(url) && !REJECT_SCHEMES.test(url)`); `PromptImageInsert` plugin handler `:111-114` uses `window.prompt('Image URL')` `:111`, validates `:112`, executes `insertImage` `:113`. **Rejects `javascript:`/`data:`.**
- **Heading config exposes h1–h6.** Via `HEADING_OPTIONS` `:67-74` → `heading: { options: [...HEADING_OPTIONS] }`.
- **Test rework.** `frontend/src/components/RichTextEditor.test.tsx`: `vi.mock('@ckeditor/ckeditor5-react', ...)` `:22` renders a controlled stand-in (toolbar buttons per `config.toolbar.items` + a `contentEditable[data-testid="ck-editable"]`) that calls `onReady` on mount and `onChange` on input — the **real engine is not instantiated in jsdom**. No `.ProseMirror` selectors; no ProseMirror jsdom polyfills (Range/getClientRects/getBoundingClientRect); `test-setup.ts` **not touched**. Asserts: wrapper classes (`.rich-text` + focus-ring); toolbar buttons via accessible names (`getByRole('button', { name })`); initial-value passthrough (`getByTestId('ck-editable')`); `onChange` → `editor.getData()` propagation; placeholder config; external-value sync with no loop; isolated `isValidImageUrl` `it.each` rejecting `javascript:`/`data:`/`ftp:`/empty. **6 `it` + 1 `it.each` (6 cases) = 12 tests, all passing.**
- **5 consumer mocks unchanged + contract-compliant.** All mock the named export `RichTextEditor` with `{value, onChange}` → read-only textarea: `TicketDetailModal.test.tsx:13`, `TicketAttributeForm.test.tsx:4`, `CreateTicketModal.test.tsx:4`, `NewTicketButton.test.tsx:4`, `DescriptionField.test.tsx:23`. All import the named export.

### T5 — Theme the CKEditor chrome and dark variants — **PASS**

- **Unlayered `.ck-*` chrome overrides.** At `frontend/src/index.css:357-475` (after `@layer base`, same precedent). Approach: re-point CKEditor's `--ck-color-*` design tokens to app OKLCH tokens, scoped on `.ck` (`:374-446`). Covers toolbar (`--ck-color-toolbar-background: var(--card)`, border `--border`), button rest/hover/active/toggled/disabled, dropdown panels, tooltip, balloon panel.
- **Focus-visible uses app ring.** `--ck-color-focus-border: var(--ring)` + `--ck-color-focus-outer-shadow` color-mix, plus explicit `outline: 2px solid var(--ring)` on `:focus-visible` at `index.css:472-474`.
- **`.dark` variant intentionally minimal.** At `index.css:448-455` — only `--ck-color-shadow-drop` — because all other chrome cascades via theme-aware tokens (see §Deviations & Gaps — Informational).
- **Editable + disabled-button overrides** at `index.css:459-469`.
- **Attribution kept visible.** `--ck-powered-by-*` themed for legibility only; **never** `display:none`.

### T6 — Deliver image resize — **DEVIATION** (documented, acceptable; flagged owner-decision)

- **Delivered path = the NO-GO / FALLBACK.** Free `ImageStyle` width presets, **not** the custom drag plugin. `frontend/src/components/rich-text/CustomImageResize.ts` does **not** exist; the `rich-text/` directory was never created. The commit message `DEL-02: Configure ImageStyle width presets as resize fallback` confirms the explicit, documented choice.
- **Rationale (pre-approved boundary).** CKEditor 5 v44+ moved `ImageResize`/`ImageResizeHandles` (drag handles) to **premium/commercial**. The spec forbids a commercial license, so drag-handle resize is genuinely infeasible on the free/GPL build. The literal spec says "drag handles"; the delivered implementation provides width presets. This is an **acceptable documented deviation — not a defect — but must be surfaced** (see §Deviations).
- **Fallback configuration.** Editor image toolbar exposes 4 width presets — `resizeFull`=100% (default), `resizeLarge`=75%, `resizeMedium`=50%, `resizeSmall`=25% — via `imageStyle:resize*` items plus `image.styles.options` carrying a `className` per preset (`RichTextEditor.tsx:174-213`). Widths are applied by CSS classes on `<figure>` in the `.rich-text` layer: `index.css:333-341` (`.rich-text figure.image-resize-large img { width:75% }`, medium 50%, small 25%; Full relies on base `.rich-text img { max-width:100% }`).
- **Round-trip verified.** Width survives sanitize + reload. Tests at `sanitizeHtml.test.ts:204-218` assert the preset `class="image image-resize-medium/small"` + `<figure>` + `<img>` survive `sanitizeDescription(...)`. Also covered by T2 figure+img+style cases `:146-166`.
- **No commercial plugin.** Grep `ImageResize|ImageResizeHandles` in `frontend/src` → zero; `licenseKey` stays `'GPL'`.
- **In-code documentation (partial).** The fallback mechanism is documented at `index.css:330-332` (a comment describing the width-preset round-trip), and the general "no premium" stance is noted at `RichTextEditor.tsx:1-2`. **GAP (low severity):** no single code comment adjacent to the image config explicitly names `ImageResize`/`ImageResizeHandles` as the premium/commercial feature being avoided — that rationale currently lives only in the commit message and this report. **Suggested fix:** add a one-line comment above the `image:` config block at `RichTextEditor.tsx:174`, e.g. `// CKEditor 5 ImageResize drag-handles are premium/commercial; free ImageStyle width presets are the resize fallback (widths defined in index.css).`

### T7 — Remove unused TipTap deps + final verification — **PASS**

- **All 6 `@tiptap/*` deps removed.** Grep `tiptap frontend/package.json` → zero matches. Commit `26b55ec` removed exactly 6 deps (`-6` lines) + refreshed `package-lock.json` (−623 lines).
- **Nothing imports TipTap.** Grep `@tiptap`/`require` in `frontend/src` → zero imports. Only 3 historical PROSE comment mentions remain (acceptable): `RichTextEditor.tsx:2`, `RichTextEditor.tsx:42`, `DescriptionField.test.tsx:11`.
- **Commit scope tight.** Commit `26b55ec` touched **only** `frontend/package.json` + `package-lock.json`.
- **Attribution not stripped/hidden.** `index.css:368-369` states it is intentionally left **visible**; `index.css:436-439` themes it for legibility only; **no `display:none`/`opacity:0`** on `ck-powered-by`.
- **No backend changes across all of DEL-02.** `git diff --stat 98dad48..HEAD -- backend/` is empty; no backend commits. (The backend uses Zod schemas, not a literal `UpdateTicketDto` class; description validation at `projects.schema.ts:60` is untouched.) Description remains a plain HTML string.
- **Final gates green** (see §Gate Results).

---

## Stub Check

**None found.** Grep for `// TODO`, `throw new Error('not implemented')`, empty handlers, `return null`, and pass-through mocks in production code → **zero matches** across the touched files. `isValidImageUrl` (`RichTextEditor.tsx:61`) and `PromptImageInsert.init` (`:111-114`) are fully implemented; the loop-guard `useEffect` (`:229-235`) is substantive.

---

## Acceptance-Criteria Mapping

### Authoritative spec (12 criteria)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | TipTap removed; self-hosted free/GPL CKEditor renders the editor | **MET** | T7 (6 deps gone, no imports); T4 (`licenseKey: 'GPL'` `RichTextEditor.tsx:136`) |
| 2 | Toolbar exposes bold/italic/strikethrough/underline/code/headings h1–h6/lists/blockquote/link/image/code block, all styled + functional | **MET** | T4 (all free plugins imported `:8-28`; test asserts representative buttons by accessible name) |
| 3 | Custom free/GPL build used where needed (stock lacks underline/strikethrough/code; image resize enabled) | **MET** | T4 (free plugins from `'ckeditor5'`); T6 (image resize via free presets) |
| 4 | Images resize via drag handles with max-width cap; width round-trips | **MET-WITH-DEVIATION** | T6 — drag handles are premium; delivered `ImageStyle` width presets; width **does** round-trip; cap via `max-width:100%` (`index.css:318-321`) |
| 5 | Links visibly styled (underline + accent + hover) in both views | **MET** | T3 (`index.css:305-313`, shared `.rich-text`) |
| 6 | Sanitizer widened for figure/figcaption/img width-style-class/h1–h6; round-trips | **MET** | T2 (`sanitizeHtml.ts:30-33`, `:83-93`; `sanitizeHtml.test.ts:146-218`, 40/40 pass) |
| 7 | Edit and read views styled consistently (shared `.rich-text`) | **MET** | T3 + T4 (`DescriptionField.tsx:89`, `RichTextEditor.tsx:245`) |
| 8 | Works under React 19, no console/hydration errors; controlled-value + ref-mount fallback | **MET** | T4 (dual loop guard `:229-235` + `onReady` ref `:250-252`) |
| 9 | Description persists as plain HTML string; no migration; single integration site preserved | **MET** | T7 (no backend diff; `UpdateTicketDto`/`projects.schema.ts:60` untouched) |
| 10 | Comment + description flows behave as before | **MET** | T7 (no backend changes; 5 consumer tests green) |
| 11 | No regression to existing tests/flows | **MET** | Gate — 1028/1028 pass |
| 12 | "Powered by CKEditor" attribution visible and accepted | **MET** | T1 (attribution shipped in bundle); T5 (themed, never hidden); T7 (intentionally retained) |

**Result: 11/12 MET, 1/12 MET-WITH-DEVIATION, 0 unmet.**

### Plan acceptance criteria (9 items) & task verification checklist (10 items)

All **MET**, except the image-resize item which is **MET-WITH-DEVIATION** (as above).

---

## Deviations & Gaps

### DEVIATIONS (documented, acceptable / expected)

1. **[DEVIATION — documented, acceptable; flagged owner-decision] Image resize via free `ImageStyle` width presets instead of literal "drag handles."**
   The delivered resize mechanism is the free `ImageStyle` width presets (Full/Large/Medium/Small = 100/75/50/25%) rather than drag handles. **Reason:** CKEditor 5 v44+ drag-handle resize (`ImageResize`/`ImageResizeHandles`) is premium/commercial, and the spec forbids a commercial license. This is the **pre-approved NO-GO fallback** defined in the T6 spec (`CustomImageResize.ts` GO path vs. `ImageStyle` fallback NO-GO path). Width **does round-trip** (verified by tests at `sanitizeHtml.test.ts:204-218` and `:146-166`) and is capped by `max-width:100%` (`index.css:318-321`). The T6 commit message (`DEL-02: Configure ImageStyle width presets as resize fallback`) confirms the explicit documented choice. **Must be recorded as a flagged open owner-decision.** Evidence: `RichTextEditor.tsx:174-213`, `index.css:330-341`, `index.css:333-341`.

2. **[DEVIATION — expected/accepted] "Powered by CKEditor" attribution intentionally retained and visible.**
   Per the GPL build, the attribution module ships in the production bundle (`ck-powered-by`, `ck-powered-by__label`, `powered_by_ckeditor_logo`) and is **never** stripped or hidden. It is themed for legibility only via `--ck-powered-by-*` tokens (`index.css:436-439`). The spec's `[KEY]` assumption flagged this as the single open owner decision; the deliverable proceeds on the "assumed acceptable" stance. Verified.

### GAPS (undocumented defects to address)

3. **[GAP — low severity] No in-code comment adjacent to the image config names the premium feature being avoided.**
   The fallback *mechanism* is documented at `index.css:330-332` and the general "no premium" stance at `RichTextEditor.tsx:1-2`, but the specific rationale — that `ImageResize`/`ImageResizeHandles` are the premium/commercial features being avoided — currently lives only in the T6 commit message and this report. This does **not** affect function, security, or licensing. **Suggested one-line fix:** add a comment above the `image:` config block at `RichTextEditor.tsx:174`, e.g.:
   ```
   // CKEditor 5 ImageResize drag-handles are premium/commercial; free ImageStyle width presets are the resize fallback (widths defined in index.css).
   ```

### INFORMATIONAL (functionally neutral — **not** gaps)

- **`.rich-text` applied to the CKEditor wrapper div (`RichTextEditor.tsx:245`)** rather than the inner `.ck-content` node. Because `.rich-text` rules are descendant selectors, the inner `.ck-content` editable inherits them — functionally equivalent. The test asserts the class on the wrapper. Not a gap.
- **`.rich-text` is prepended** (not appended) in `DescriptionField.tsx`'s `className` string. Class order within a className string is semantically irrelevant. Not a gap.
- **T4's image toolbar uses the resize presets** (the T6 fallback vehicle) rather than the `alignLeft/alignRight/alignCenter/block` items the T4 description prose listed pre-decision. No T4 acceptance criterion constrains the image toolbar items; this is consistent with the chosen T6 fallback. No code change required.
- **T5's `.dark` block is intentionally minimal** (only `--ck-color-shadow-drop` at `index.css:448-455`). All other chrome cascades via theme-aware tokens. Not a gap.

---

## Verification Run

| Check | Result |
|-------|--------|
| Lint | not run (not a DEL-02 gate) |
| Typecheck | **PASS** (`npm run typecheck -w frontend`, exit 0) |
| Build | **PASS** (`npm run build -w frontend`, exit 0; Vite v7.3.5; 3939 modules; 9.44s; advisory chunk-size warning — expected) |
| Tests | **PASS** (`npm run test -w frontend`, exit 0; 118 files / **1028 tests passed**, 0 failed) |

---

## Recommendations

- **Record the image-resize deviation as a flagged open owner-decision** in the deliverable tracker: resize is delivered via free `ImageStyle` width presets (round-trips, max-width capped) because drag handles are premium/commercial and a commercial license is out of scope. No code action required; this is documentation/acknowledgement only.
- **Apply the one-line GAP fix** at `RichTextEditor.tsx:174` to name the premium feature being avoided, so the rationale is discoverable in-code rather than only in the commit message and this report. Severity: low; no functional impact.
- No other actions required. All gates are green; no blockers; no Partial/Missing/Modified tasks.

---

## Quick Reference: Task Status

- **T1:** Implemented — PASS (install + build gate)
- **T2:** Implemented — PASS (sanitizeHtml widened, scoped, 40/40 tests)
- **T3:** Implemented — PASS (`.rich-text` content styles + DescriptionField)
- **T4:** Implemented — PASS (CKEditor rewrite, dual loop guard, 12 tests)
- **T5:** Implemented — PASS (`.ck-*` chrome theming + `.dark`)
- **T6:** Implemented via documented DEVIATION (free `ImageStyle` width presets; drag handles are premium) — flagged owner-decision
- **T7:** Implemented — PASS (6 TipTap deps removed; attribution retained; no backend changes)

---

## Closing Verdict

**DELIVERED.** All 7 tasks are implemented (7/7); all three quality gates are green (typecheck PASS, test 1028/1028 PASS, build PASS); the task breakdown's parallelization and per-task staging rules were followed (each task a single commit on `main` with the verbatim spec message; only the specified files staged). The single functional deviation — image resize delivered as free `ImageStyle` width presets instead of literal drag handles — is the **pre-approved, documented NO-GO fallback** forced by the premium-licensing constraint, image width round-trips and is max-width capped, and it must be carried forward as a flagged open owner-decision. There is **1 low-severity GAP** (a missing in-code premium-feature rationale comment, with a one-line suggested fix), **0 Blockers**, and **0 Partial/Missing/Modified** tasks. Spec acceptance criteria: 11/12 MET + 1/12 MET-WITH-DEVIATION + 0 unmet.
