# Task Breakdown — DEL-02: Replace TipTap with self-hosted CKEditor 5

**Plan:** `.context/pm-cycles/pm-cycle-2026-07-03-15-36-20/deliverables/DEL-02-ckeditor-rich-text-editor-plan.md`
**Generated:** 2026-07-03

This breakdown implements the plan at `.context/pm-cycles/pm-cycle-2026-07-03-15-36-20/deliverables/DEL-02-ckeditor-rich-text-editor-plan.md`. It replaces TipTap end-to-end with a self-hosted free/GPL CKEditor 5 build in the `frontend/` workspace of this npm-workspaces monorepo. No backend changes; the description stays a plain HTML string; the single integration site (`DescriptionField.tsx`) and the `RichTextEditor` named export + props `{ value: string; onChange: (html: string) => void; placeholder?: string }` are preserved. Monorepo conventions: npm-only; single-line commits; no `any` (use `unknown`); co-located Vitest tests; Rebase-and-Merge policy.

---

## HARD GIT RULES (apply to EVERY task — read first)

- Work directly on branch `main`. NEVER create a branch. Before each task's first git operation, verify `git branch --show-current` outputs `main`. NEVER run `git checkout -b`, `git switch -c`, `git branch <name>`, or `git merge`.
- Commit per task, directly to `main`, with the single-line message given in that task's `Commit:` line, prefixed `DEL-02: <imperative>`. Example shape: `DEL-02: Widen sanitizeHtml allow-list for figure/figcaption/h5/h6`.
- NEVER run `git add -A` or `git add .`. Stage ONLY the specific files that task changes (listed under each task's "Stage exactly these files"). There is a PRE-EXISTING unrelated modification to `.pi/settings.json` and an untracked `.context/` tree — DO NOT stage or commit those in any task commit.
- npm only: install with `npm install <pkg> -w frontend` (runtime) or `-D` (devDeps). The frontend workspace `package.json` name is `@slykboard/frontend` but `-w frontend` resolves correctly via the workspaces array `["frontend","backend"]`. Never run `pnpm`/`yarn`/`bun`. Never stage `pnpm-lock.yaml` or `pnpm-workspace.yaml` (gitignored strays).
- Repo uses Rebase-and-Merge policy: NO merge commits, NO `--squash`, NO `git merge`. Each task is one commit.
- After committing each task, confirm the tree is green where the task says (typecheck/test/build). If a gate task says STOP and report a blocker, do exactly that — do not improvise around it.

---

## Corrected codebase facts (verified; use these line numbers, not the plan's)

- `RichTextEditor.tsx` (301 lines): TipTap imports `:2-6`; props interface `:27-30`; named export `RichTextEditor` at `:204` (NO default export anywhere); URL constants at `:54-56` are THREE: `HTTP_OR_MAILTO` `:54`, `HTTP_ONLY` `:55`, `REJECT_SCHEMES` `:56`; `TOOLBAR_ACTIONS` `:58-173`; `handleLink` `:175`, `handleImage` `:196`; `useEditor` `:205`; extensions config `:212-230`; `content: value` `:231`; TipTap `onUpdate` `:232-234`; `editorProps` prose class `:235-236`; external-sync `useEffect` `:242-245`; `useEditorState` `:260-268`; Radix `<ToggleGroup>` render `:276-293`; `<EditorContent>` `:295`; manual `<p>` placeholder hack `:296-298`; `./ui/ToggleGroup` import `:25` (only Radix dependency).
- `RichTextEditor.test.tsx` (299 lines): does NOT mock TipTap — runs the real engine. ProseMirror-specific jsdom polyfills in `beforeAll` `:26-42` (Range/Element getClientRects/getBoundingClientRect). `.ProseMirror` selectors at `:49,:96,:102,:105,:117`. `selectEditorContent` helper `:46-60`. 11 `it` + 1 `it.each`.
- `sanitizeHtml.ts` (70 lines): module `DOMPurify` instance `:6`; `ALLOWED_TAGS` `:8-31` (members: p, br, strong, em, ul, ol, li, code, pre, blockquote, a, h3, h4, b, i, s, del, strike, u, h1, h2, img — NO figure/figcaption/h5/h6); `ALLOWED_ATTR` `:32` = `['href','src','alt','target','rel']` (NO style/width/class); `ALLOWED_URI_REGEXP` `:40-41`; `uponSanitizeAttribute` hook `:48-56` (acts on src/href, rejects `javascript:`/`data:`); exported function `sanitizeDescription(input)` `:60-70`. NOTE: the constants `HTTP_ONLY`/`REJECT_SCHEMES`/`HTTP_OR_MAILTO` do NOT exist here — they live in `RichTextEditor.tsx:54-56`. Do not reference them in sanitizer code.
- `sanitizeHtml.test.ts` (~135 lines): EXISTS, table-driven `cases` array `:11-128` executed via `forEach` `:130-140` (30 cases). No coverage yet for figure/figcaption/h5/h6/width/style/class.
- `DescriptionField.tsx` (97 lines): `import { RichTextEditor }` `:5`; `import { sanitizeDescription }` `:9`; editor wiring `{value, onChange}` `:72-75`; read-only div `:88-93` currently `className="max-w-none rounded border border-border bg-muted p-2 text-sm"`, `dangerouslySetInnerHTML` uses `sanitizeDescription(descriptionValue)` `:91`. Sanitizer applied on READ path only.
- `DescriptionField.test.tsx`: `vi.mock('@/components/RichTextEditor', ...)` at `:24-29` (named export + `{value, onChange}` → read-only textarea).
- The 4 sibling consumer mocks (all at `frontend/src/components/` root, mock `'./RichTextEditor'`, named export + `{value, onChange}` → read-only textarea): `TicketDetailModal.test.tsx:13-21`, `TicketAttributeForm.test.tsx:4-12`, `CreateTicketModal.test.tsx:4-12`, `NewTicketButton.test.tsx:4-12`. These must keep passing UNCHANGED.
- `frontend/src/test-setup.ts` (25 lines): provides only `PointerEvent` and `ResizeObserver`. NO `matchMedia`, `IntersectionObserver`, `getBoundingClientRect`, `Range`, or `Selection`.
- `frontend/src/index.css` (174 lines): `@import 'tailwindcss';` `:1`; `@custom-variant dark` `:6`; `:root` tokens `:9-50` (includes `--primary` `:19`, `--accent` `:28`, `--muted` `:25`, `--muted-foreground` `:26`, `--border` `:34`, `--ring` `:36`, `--background` `:10`, `--foreground` `:11`, `--card` `:13`); `.dark` `:53-91`; `@theme inline` `:95-132`; `@layer base` `:136-153`; react-day-picker overrides `:157-174` — these are **UNLAYERED** (top-level rules after `@layer base`) and that is the explicit precedent for `.ck-*`/`.rich-text` overrides (unlayered beats Tailwind utilities). No `.rich-text`/`.prose`/`.ck-content` exists yet.
- `frontend/package.json`: name `@slykboard/frontend`; 6 `@tiptap/*` deps `:26-31` all `^3.0.0` (extension-image, extension-link, extension-underline, pm, react, starter-kit); `ckeditor5`/`@ckeditor/ckeditor5-react` NOT present; scripts: `dev` `vite`, `build` `tsc -b && vite build`, `typecheck` `tsc --noEmit`, `test` `vitest run`, `test:watch` `vitest`; React `^19.0.0`.
- Root `package.json`: `workspaces` `["frontend","backend"]`; root `typecheck`/`test`/`build` scripts fan out to both workspaces; `engines.node ">=24.0.0"`.
- `frontend/src/components/rich-text/` directory DOES NOT EXIST — must be created in the image-resize task.

---

## Parallelization Strategy

Tasks are grouped into batches by dependency order. Run batches sequentially; within a batch, conflict-free tasks run in parallel.

### Batch / Dependency Diagram
```
Batch A (gate): [T1] ──────────────────────────────────────────────┐
                                                                    │
Batch B (parallel, disjoint files): [T2] ──┐                        │
                                          ├──> Batch C (core): [T4] ─┤
                                     [T3] ─┘                          │
                                                                      │
Batch D (sequential, shared index.css): [T5] ──> [T6] ───────────────┤
                                                                      │
Batch E (final): [T7] <──────────────────────────────────────────────┘
```

### Merge-order rules
- Task 1 merges FIRST (gate). If Task 1 is NO-GO, STOP the entire deliverable and report — do not merge 2–7.
- Task 2 and Task 3 are conflict-free (disjoint files) and may be committed in either order, both after Task 1.
- Task 4 merges after 1, 2, 3 (needs deps installed, sanitizer widened, and `.rich-text` CSS present).
- Task 5 merges after 4 (editor must render `.ck-*` to theme).
- Task 6 merges after 4 and 2, and after 5 (both may edit `index.css`; sequence to avoid conflict).
- Task 7 merges LAST (after TipTap is fully unused).

### Summary
| # | Batch | Target File(s) | Dependencies | Can Parallel With |
|---|-------|----------------|--------------|-------------------|
| T1 | A (gate) | `frontend/package.json`, `package-lock.json` | None | Nothing (gate) |
| T2 | B | `frontend/src/utils/sanitizeHtml.ts`, `frontend/src/utils/sanitizeHtml.test.ts` | None | T3 |
| T3 | B | `frontend/src/index.css`, `frontend/src/components/ticket-fields/DescriptionField.tsx` | None | T2 |
| T4 | C | `frontend/src/components/RichTextEditor.tsx`, `frontend/src/components/RichTextEditor.test.tsx` (+ `frontend/src/test-setup.ts` if needed) | T1, T2, T3 | Nothing (core) |
| T5 | D | `frontend/src/index.css` | T4 | Nothing (shared file) |
| T6 | D | `frontend/src/components/rich-text/CustomImageResize.ts` (GO) + `frontend/src/components/RichTextEditor.tsx` (+ `frontend/src/index.css` if fallback) (+ co-located test) | T4, T2, T5 | Nothing (depends on core + styles) |
| T7 | E | `frontend/package.json`, `package-lock.json` | T4, T5, T6 | Nothing (final) |

### Suggested developer tracks
- **Track 1 — Data:** T2 → (feeds) T6 round-trip.
- **Track 2 — Styles:** T3 → T5.
- **Track 3 — Engine:** T1 → T4 → T6 → T7.

---

## Tasks

### T1 — Install ckeditor5 + @ckeditor/ckeditor5-react and verify the Vite build (DECISION GATE)
**Phase:** 0 — Install + build spike (DECISION GATE; do FIRST and alone)
**Stage exactly these files:** `frontend/package.json`, `package-lock.json` (root lockfile updated by npm)
**Dependencies:** None (first task; gate for the whole deliverable)
**Can parallel with:** Nothing (gate)

**Description:**
- Verify `git branch --show-current` == `main`. Do NOT create any branch.
- Install runtime deps: `npm install ckeditor5 @ckeditor/ckeditor5-react -w frontend`. (Expect `@ckeditor/ckeditor5-react` v11.x with peer-dep `ckeditor5>=46.0.0`, React 19 compatible.)
- Create a THROWAWAY local usage to exercise the install: a temporary React component (or temporary edit) that renders `<CKEditor>` from `@ckeditor/ckeditor5-react` with `editor={ClassicEditor}` imported from `ckeditor5`, a minimal FREE plugin set, `licenseKey: 'GPL'`, and `import 'ckeditor5/ckeditor5.css'`. Render it once via `npm run dev -w frontend`.
- GO/NO-GO GATE (HARD): run `npm run typecheck -w frontend`, `npm run build -w frontend`, and `npm run dev -w frontend`. ALL must compile/run with NO esbuild/minifier errors, and the "Powered by CKEditor" attribution must appear (expected and ACCEPTED — do not strip it). If the large ckeditor5 bundle fails to compile under Vite/esbuild, STOP and report a blocker. Do NOT improvise (e.g., do not switch to a preset build, do not introduce webpack, do not change license). Surface the blocker and await direction.
- If GO: DELETE the throwaway spike code so it is not part of the commit. Stage ONLY `frontend/package.json` and `package-lock.json`. Write a one-line spike confirmation note in the commit body is NOT allowed (single-line commit), so record the spike outcome mentally / in the task report instead.

**Tests:** No automated test added (spike). The verification IS running typecheck/build/dev green.

**Acceptance Criteria:**
- [ ] `ckeditor5` and `@ckeditor/ckeditor5-react` present in `frontend/package.json` dependencies.
- [ ] `npm run typecheck -w frontend`, `npm run build -w frontend`, `npm run dev -w frontend` all succeed.
- [ ] "Powered by CKEditor" attribution observed during the spike.
- [ ] Throwaway spike code is NOT in the commit; only the two manifest files are staged.
- [ ] If NO-GO: no commit; report the blocker.

**Commit:** `DEL-02: Add ckeditor5 and ckeditor5-react dependencies`

---

### T2 — Widen sanitizeHtml allow-list for figure/figcaption/h5/h6 and scoped img width/style/class
**Phase:** 1 — Widen sanitizer (independent; de-risks the data layer first)
**Stage exactly these files:** `frontend/src/utils/sanitizeHtml.ts`, `frontend/src/utils/sanitizeHtml.test.ts`
**Dependencies:** None (independent; conceptually after Task 1 gate but touches no ckeditor code)
**Can parallel with:** Task 3 (disjoint files)

**Description:**
- In `ALLOWED_TAGS` (`sanitizeHtml.ts:8-31`) add `figure`, `figcaption`, `h5`, `h6`.
- Do NOT add `style`/`width`/`class` to the global `ALLOWED_ATTR` (`:32`) unscoped. Instead extend the existing `uponSanitizeAttribute` hook (`:48-56`) to SCOPE these attributes: keep `width`, `style`, AND `class` ONLY when the current element is `img`; keep `class` ALSO when the element is `figure` or `figcaption` (so CKEditor's `image`/caption classes round-trip). For any other element, drop `style`/`width`/`class` (set `keepAttr = false`).
- PRESERVE the existing global security: the src/href `javascript:`/`data:` rejection in the hook (`:48-56`) and `ALLOWED_URI_REGEXP` (`:40-41`) must remain intact. Do NOT reference `HTTP_ONLY`/`REJECT_SCHEMES` here — those live in `RichTextEditor.tsx`, not this file.
- Extend the table-driven `cases` array in `sanitizeHtml.test.ts` (`:11-128`) with new cases (do not remove existing 30): (a) `figure`+`figcaption` round-trip; (b) `<img>` with `width`, `style`, and `class` attributes all preserved; (c) `<p style="...">` has `style` stripped; (d) `class` on a non-img/figure/figcaption tag stripped; (e) `javascript:` and `data:` still rejected on both an `img src` and an `a href`; (f) `h5` and `h6` allowed.

**Tests:** `npm run test -w frontend -- src/utils/sanitizeHtml.test.ts` then full `npm run test -w frontend`.

**Acceptance Criteria:**
- [ ] The CKEditor image block `<figure class="image image-resized"><img src="https://example.com/a.png" style="width:50%"><figcaption>cap</figcaption></figure>` survives `sanitizeDescription(...)` round-trip intact.
- [ ] `<p style="color:red">x</p>` → style stripped (text kept).
- [ ] `javascript:`/`data:` still rejected on img src and a href.
- [ ] All previously-passing cases still pass; no `any` used.

**Commit:** `DEL-02: Widen sanitizeHtml allow-list for figure/figcaption/h5/h6`

---

### T3 — Add shared .rich-text content styles and apply them to the description read-only view
**Phase:** 2 + 6 — Shared `.rich-text` content CSS + apply to the DescriptionField read-only view (styling parity)
**Stage exactly these files:** `frontend/src/index.css`, `frontend/src/components/ticket-fields/DescriptionField.tsx`
**Dependencies:** None (independent; conceptually after Task 1 gate)
**Can parallel with:** Task 2 (disjoint files)

**Description:**
- In `frontend/src/index.css`, add a scoped `.rich-text` content stylesheet as UNLAYERED top-level rules (place after the `@layer base` block, mirroring the react-day-picker override precedent at `:157-174` — unlayered rules beat Tailwind utilities). Style: headings h1–h6 (rem sizes, weight, margins), `p`, `ul`/`ol`/`li`, `blockquote` (left border using `--accent`/`--primary`, padding, `--muted-foreground` text), `pre` + `code` (code-block background `--muted`, inline code chip), links (underline + `--accent`/`--primary` color + hover), `figure`/`img` (`max-width:100%`, rounded), `figcaption` (`--muted-foreground`, small, centered). Reuse the OKLCH tokens from `:root` (`:9-50`) and add `.dark` variants (`.dark :53-91`). No `any` (CSS, N/A).
- In `DescriptionField.tsx` (`:88-93`), add the `rich-text` class to the read-only div (append to the existing `max-w-none rounded border border-border bg-muted p-2 text-sm`). Do NOT change the `RichTextEditor` import (`:5`), the `sanitizeDescription` import (`:9`), or the `{value, onChange}` wiring (`:72-75`). No signature changes.

**Tests:** Run `npm run test -w frontend -- src/components/ticket-fields/DescriptionField.test.tsx`. If any test asserts the read-only div's exact class list, update that assertion to include `rich-text`. Run full `npm run test -w frontend` and `npm run typecheck -w frontend`.

**Acceptance Criteria:**
- [ ] `.rich-text` content layer present in index.css with light + `.dark` variants, unlayered.
- [ ] DescriptionField read-only div carries `rich-text`; edit (wired in Task 4) and read views will share the class.
- [ ] DescriptionField.test.tsx and full test suite green; typecheck green.

**Commit:** `DEL-02: Add shared rich-text content styles and apply to description view`

---

### T4 — Rewrite RichTextEditor on CKEditor and rework its test harness
**Phase:** 3 + 7 (RichTextEditor part) — Core engine swap + its test rework (tightly coupled; one commit to keep tree green)
**Stage exactly these files:** `frontend/src/components/RichTextEditor.tsx`, `frontend/src/components/RichTextEditor.test.tsx`, and `frontend/src/test-setup.ts` ONLY IF a needed polyfill is discovered (see below)
**Dependencies:** Task 1 (deps installed), Task 2 (sanitizer widened so image output round-trips), Task 3 (`.rich-text` CSS present so the editor is styled)
**Can parallel with:** Nothing (core)

**Description:** Full TipTap→CKEditor rewrite of the component AND a matching test rework in the SAME commit (splitting would leave a red test tree between commits, which is forbidden).

**Subtasks:**
- **4a — Rewrite `RichTextEditor.tsx`:**
  - KEEP the named export `function RichTextEditor(...)` (`:204`) and the props interface `{ value: string; onChange: (html: string) => void; placeholder?: string }` (`:27-30`). NO default export.
  - KEEP the THREE URL constants `HTTP_OR_MAILTO` (`:54`), `HTTP_ONLY` (`:55`), `REJECT_SCHEMES` (`:56`) and reuse them in the custom image-insert toolbar button (security posture preserved: reject `javascript:`/`data:`, HTTP-only for images, no base64).
  - New imports: `{ CKEditor }` from `@ckeditor/ckeditor5-react`; from `ckeditor5`: `ClassicEditor`, `Essentials`, `Paragraph`, `Bold`, `Italic`, `Underline`, `Strikethrough`, `Code`, `CodeBlock`, `Heading`, `List` (+ `ListProperties` if free), `Link`, `BlockQuote`, `Image`, `ImageCaption`, `ImageStyle`, `ImageToolbar`, `Autoformat` (and any other free helpers needed); add `import 'ckeditor5/ckeditor5.css'`.
  - Editor config: `licenseKey: 'GPL'`; `plugins: [...]` (free set above); `toolbar: { items: [...] }` covering bold, italic, underline, strikethrough, code, heading, bulleted/numbered list, blockquote, code block, link, image insert, undo; `heading: { options: [...] }` exposing h1–h6 (parity with the widened sanitizer); `link: { addTargetToExternalLinks: true, defaultProtocol: 'https://', decorators: { openExternal: { mode: 'automatic', callback: () => true, attributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } } } }`; `image: { toolbar: ['imageStyle:alignLeft','imageStyle:alignRight','imageStyle:alignCenter','imageStyle:block','|','imageTextAlternative'], styles: [...] }`; `placeholder` from the prop.
  - Controlled value: wire `onChange={ (event, editor) => onChange(editor.getData()) }` → form `setValue`. Use `onReady={ (editor) => { editorRef.current = editor } }` ref-mount fallback, and a `useEffect` that calls `editorRef.current.setData(value)` when the external `value` prop changes, guarded by (i) a ref flag set while applying external data, and (ii) a normalized-equality check that skips `setData` when the editor's current data already equals the incoming value (prevents the external `setValue` → `setData` → `onChange` → `setValue` feedback loop). Honor React 19 strict-mode double-mount via the ref guard.
  - Apply the `rich-text` class to the CKEditor editable so the Task 3 content styles render.
  - Implement the custom image-insert toolbar button via `window.prompt('Image URL')`, validating the input against `HTTP_ONLY` + `REJECT_SCHEMES` before invoking the image-insert command (replaces `handleImage` `:196-202` and the link posture from `handleLink` `:175-194`). Do NOT enable base64.
  - REMOVE all TipTap surface: imports `:2-6`; `useEditor` `:205`; extensions config `:212-230`; `content`/`onUpdate` `:231-234`; `editorProps` prose `:235-236`; external-sync `useEffect` `:242-245`; `useEditorState` `:260-268`; `TOOLBAR_ACTIONS` `:58-173`; the Radix `<ToggleGroup>` render `:276-293`; the `./ui/ToggleGroup` import `:25`; the manual `<p>` placeholder hack `:296-298` (use CKEditor's built-in `placeholder` config instead).
- **4b — Rework `RichTextEditor.test.tsx`:**
  - Add `vi.mock('@ckeditor/ckeditor5-react', ...)` so `CKEditor` renders a controlled stand-in (e.g. a `div[contenteditable]` or `<textarea>`) that invokes the `onChange`/`onReady` config props on input/mount. NEVER instantiate the real CKEditor engine in jsdom (it cannot init there).
  - Assert: toolbar buttons render with accessible names (query priority `getByRole` > `getByLabelText` > `getByText` > `getByTestId`); wrapper classes present (`.rich-text` + the focus-ring family); the initial `value` prop passes through to the editor; `onChange` fires on input and propagates `editor.getData()`; placeholder handling; and the image-insert URL allow-list REJECTS `javascript:`/`data:` inputs (unit-test the prompt-validation helper in isolation, separate from the rendered component).
  - REMOVE all `.ProseMirror` selectors (`:49,:96,:102,:105,:117`), the `selectEditorContent` helper (`:46-60`), and the ProseMirror-specific jsdom polyfills in `beforeAll` (`:26-42`).
  - Watch-item: if `import 'ckeditor5/ckeditor5.css'` or any ckeditor5 module import breaks vitest, resolve via vite/vitest CSS handling or by mocking the css import — discover by running the test. Only if a polyfill is genuinely needed, add it MINIMALLY to `frontend/src/test-setup.ts` and stage that file too; otherwise leave test-setup.ts untouched.
- **4c — Verify the 5 consumer mocks are UNCHANGED and green:** `TicketDetailModal.test.tsx:13-21`, `TicketAttributeForm.test.tsx:4-12`, `CreateTicketModal.test.tsx:4-12`, `NewTicketButton.test.tsx:4-12`, `DescriptionField.test.tsx:24-29`. They mock `RichTextEditor` by named export + `{value, onChange}` and must pass without edits.

**Tests:** `npm run test -w frontend` (full suite) and `npm run typecheck -w frontend` and `npm run build -w frontend`.

**Acceptance Criteria:**
- [ ] `RichTextEditor.tsx` has NO TipTap imports; named export + props unchanged; `licenseKey: 'GPL'`; `.rich-text` applied to the editable; controlled-value loop guarded.
- [ ] `RichTextEditor.test.tsx` mocks `@ckeditor/ckeditor5-react`; no `.ProseMirror`/ProseMirror polyfills remain; wrapper contract + URL-allow-list asserted.
- [ ] All 5 consumer mocks pass unchanged; full `typecheck`/`test`/`build` green; no `any`.

**Commit:** `DEL-02: Rewrite RichTextEditor on CKEditor and rework its test`

---

### T5 — Theme the CKEditor chrome and add dark variants
**Phase:** 5 — CKEditor chrome theming + dark variants (one task, per guidance)
**Stage exactly these files:** `frontend/src/index.css`
**Dependencies:** Task 4 (the editor must render `.ck-*` elements to style)
**Can parallel with:** Nothing in this batch (shared file with Task 6 downstream)

**Description:**
- Add UNLAYERED `.ck-*` chrome overrides to `index.css` (same precedent as the react-day-picker overrides `:157-174` — top-level rules after `@layer base`). Theme: `.ck-toolbar`, `.ck-button` (rest/hover/active/focus states), `.ck-dropdown`, `.ck-tooltip`, `.ck-balloon-panel`; set borders/radius/colors using the OKLCH tokens from `:root` (`:9-50`) and `--ring` (`:36`) for focus-visible. Add `.dark` variants (`.dark :53-91`) so the toolbar matches the app in dark mode. No JS changes.

**Tests:** `npm run build -w frontend` and `npm run typecheck -w frontend` (CSS theming is verified visually/manually, not by unit test). Optionally re-run `npm run test -w frontend` to confirm nothing regressed.

**Acceptance Criteria:**
- [ ] CKEditor toolbar/chrome fully styled in light mode and dark mode using app tokens; focus-visible ring uses `--ring`.
- [ ] build + typecheck green.

**Commit:** `DEL-02: Theme CKEditor chrome and dark variants`

---

### T6 — Deliver image resize (custom free/GPL drag plugin OR documented ImageStyle fallback)
**Phase:** 4 — Custom image-resize plugin (SPIKE + GO/NO-GO gate) with a documented free/GPL fallback
**Stage exactly these files (depends on gate outcome):** ALWAYS `frontend/src/components/rich-text/CustomImageResize.ts` (create the `rich-text/` dir) if GO, plus `frontend/src/components/RichTextEditor.tsx` (wire chosen approach). If NO-GO/fallback, ALSO `frontend/src/index.css` (ImageStyle width-preset classes). If GO and a test is added, also the co-located test file.
**Dependencies:** Task 4 (component + config exist), Task 2 (sanitizer round-trips figure/img width/style/class), Task 5 (chrome themed; also avoids index.css conflict if fallback adds classes)
**Can parallel with:** Nothing (depends on core + styles)

**Description:** This task carries a DECISION BRANCH. CKEditor 5 v44+ does NOT include drag-handle image resize in the free/GPL build (`ImageResize`/`ImageResizeHandles` are PREMIUM / commercial). We do NOT use commercial plugins and do NOT switch licenses. Attempt the custom plugin first; fall back only at the gate.

**Subtasks:**
- **6a — PRIMARY (GO path):** Create `frontend/src/components/rich-text/CustomImageResize.ts` (create the directory). Author a free/GPL resize plugin that: extends the image schema with a `width` attribute; downcasts model→view as `<figure class="image image-resized" style="width:...">` with a drag-handle widget; upcasts data→model reading width from `style`/`width`; updates the model `width` on pointer-event drag; round-trips through `getData()`/`setData()` AND the Task 2 sanitizer. Wire it into the `RichTextEditor.tsx` editor `plugins` array. Add a co-located unit test (`CustomImageResize.test.ts`) for the width round-trip logic (data→model→data) in isolation.
- **6b — GO/NO-GO GATE (HARD):** judge whether a robust custom drag-resize plugin is achievable within the risk budget. The fallback below is an ACCEPTABLE, DOCUMENTED outcome — adopting it is NOT an improvisation and is NOT a failure.
- **6c — FALLBACK (NO-GO path):** keep the free `ImageStyle` width presets already configured in Task 4's image toolbar; define the preset widths (Full/Large/Medium/Small = 100/75/50/25%) via CSS classes in the `.rich-text` layer in `index.css` so they round-trip natively. Add a test asserting the preset classes survive `sanitizeDescription(...)` round-trip. RECORD the deviation in the task report: literal "drag handles" were replaced by `ImageStyle` width presets due to the premium-plugin licensing constraint, as a flagged owner decision.

**Tests:** GO → `CustomImageResize.test.ts`; NO-GO → preset-class sanitize round-trip test. Run full `npm run test -w frontend`, `npm run typecheck -w frontend`, `npm run build -w frontend`.

**Acceptance Criteria:**
- [ ] Image resize WORKS and ROUND-TRIPS via EITHER the custom free/GPL drag plugin OR the documented `ImageStyle` width-preset fallback.
- [ ] No commercial plugin used; no license switch; `licenseKey` stays `'GPL'`.
- [ ] If fallback: the deviation from literal "drag handles" is documented; gates green; no `any`.

**Commit (GO):** `DEL-02: Add custom free image-resize plugin`
**Commit (NO-GO/fallback):** `DEL-02: Configure ImageStyle width presets as resize fallback`
(Use the one matching the gate outcome.)

---

### T7 — Remove the unused TipTap dependencies and run final verification
**Phase:** 8 — Cleanup + final verification (LAST)
**Stage exactly these files:** `frontend/package.json`, `package-lock.json` (root lockfile)
**Dependencies:** Task 4 (TipTap no longer imported), Task 5, Task 6
**Can parallel with:** Nothing (final)

**Description:**
- Confirm nothing imports `@tiptap/*` anywhere in `frontend/src` (grep). If any import remains, STOP and report (do not remove deps while imported).
- Remove the 6 deps: `npm uninstall @tiptap/extension-image @tiptap/extension-link @tiptap/extension-underline @tiptap/pm @tiptap/react @tiptap/starter-kit -w frontend` (all `^3.0.0`, `frontend/package.json:26-31`).
- Run the final gates: `npm run typecheck -w frontend`, `npm run test -w frontend`, `npm run build -w frontend`. ALL must be green.
- Confirm the "Powered by CKEditor" attribution is present and intentionally retained (do NOT strip or hide it — spec locks this in).
- Confirm no backend changes were made (description remains a plain HTML string; `UpdateTicketDto.description?: string` untouched).
- Do NOT stage `.pi/settings.json` or the untracked `.context/` tree (pre-existing strays); stage only the two manifest files.

**Tests:** the three final gates above.

**Acceptance Criteria:**
- [ ] All 6 `@tiptap/*` deps removed from `frontend/package.json`; no `@tiptap` import remains.
- [ ] `npm run typecheck -w frontend`, `npm run test -w frontend`, `npm run build -w frontend` all green.
- [ ] "Powered by CKEditor" attribution present and retained.
- [ ] Only `frontend/package.json` + `package-lock.json` staged.

**Commit:** `DEL-02: Remove unused TipTap dependencies`

---

## Verification checklist (matches plan Acceptance Criteria)

- [ ] TipTap removed (all 6 `@tiptap/*` deps gone; no `@tiptap` import remains).
- [ ] CKEditor self-hosted free/GPL (`ckeditor5` + `@ckeditor/ckeditor5-react` in `frontend/package.json`; `licenseKey: 'GPL'`).
- [ ] Toolbar styled in light mode + dark mode (`.ck-*` chrome overrides using OKLCH tokens + `--ring`).
- [ ] Edit and read views identical via the shared `.rich-text` content class (applied to CKEditor editable and to DescriptionField read-only div).
- [ ] Sanitizer widened (figure/figcaption/h5/h6 + scoped img width/style/class) with `javascript:`/`data:` rejection intact.
- [ ] Image resize round-trips via the custom free/GPL drag plugin OR the documented `ImageStyle` width-preset fallback.
- [ ] Single integration site preserved; `RichTextEditor` named export + props `{ value: string; onChange: (html: string) => void; placeholder?: string }` unchanged; all 5 consumer tests (`TicketDetailModal`, `TicketAttributeForm`, `CreateTicketModal`, `NewTicketButton`, `DescriptionField`) green without edits.
- [ ] No backend changes (description remains a plain HTML string).
- [ ] "Powered by CKEditor" attribution present and intentionally retained.
- [ ] `npm run typecheck -w frontend`, `npm run test -w frontend`, `npm run build -w frontend` all green.
