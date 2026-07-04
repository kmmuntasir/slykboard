# Bug: Resized image dimensions are not persisted (sanitizers strip resize markup)

## Symptom
Images inside the rich-text editor (CKEditor 5) show resize handles when
selected and resizing works visually, but the resized dimensions are **not
saved** when the editor is saved. On reopen of the card modal, the image
reverts to its original size. We must ensure the image's applied size is
serialized into saved content and restored on render.

## Root cause (confirmed)
The editor (`frontend/src/components/RichTextEditor.tsx`, CKEditor 5 plugins:
Image, ImageCaption, ImageStyle, ImageToolbar, ImageResize) serializes a
drag-resized image as:

```html
<figure class="image image-resized" style="width:50%"><img src="…" alt="…"></figure>
```

i.e. the width lives as an inline `style` on the **`<figure>`** (NOT on the
`<img>`). The preset ImageStyle classes (`image-resize-large/medium/small`)
live as a `class` on the `<figure>`. The serialization itself
(`editor.getData()`) already includes the width — **no CKEditor config change
is needed**. The problem is purely two sanitizer layers that strip the
resize-carrying markup.

### Data path
`editor.getData()` → backend `sanitizeDescription`
(`backend/src/services/ticketService.ts:235` create, `:434` update) → DB →
backend response → frontend `sanitizeDescription`
(`frontend/src/components/ticket-fields/DescriptionField.tsx:105`) → render.

### Layer 1 — BACKEND sanitizer (persistence gate; why it's "not persisted")
**File:** `backend/src/utils/sanitizeHtml.ts`
- `ALLOWED_TAGS` (`:3-27`) has no `figure` / `figcaption` — only `img`. → The
  `<figure>` wrapper carrying `image-resized` + `style="width:…"` is stripped on
  write.
- `ALLOWED_ATTR` (`:29-36`) is `href, src, alt, target, rel` — no `width`,
  `style`, `class`.
- The only `uponSanitizeAttribute` hook (`:55-62`) handles `javascript:`/
  `data:` URIs only — no width/style/class scoping.
- `sanitizeDescription`: `:64-74`.

### Layer 2 — FRONTEND sanitizer (display; also strips CKEditor output)
**File:** `frontend/src/utils/sanitizeHtml.ts`
- `ALLOWED_TAGS` (`:8-35`) DOES include `figure` + `figcaption`.
- The `uponSanitizeAttribute` hook (`:61-88`) scopes `width`/`style`/`class`:
  ```ts
  const keep = isImg || (name === 'class' && isFigureCaption);  // figure keeps ONLY class
  ```
  → `style`/`width` are kept on `<img>` but STRIPPED from `<figure>`. Since
  CKEditor's drag-resize puts `style="width:…"` on the `<figure>`, the frontend
  display sanitizer drops it. Preset-class styles (`image-resize-medium`/`small`)
  survive on `<figure>` (class is kept for figures), so preset resize round-trips
  but drag-resize does not.
- `width`/`style`/`class` are NOT in `ALLOWED_ATTR`; they are force-kept on
  scoped elements via `data.forceKeepAttr = true`, and stripped elsewhere via
  `data.keepAttr = false`.
- Display call site: `DescriptionField.tsx:105`.

### Misleading existing test
`frontend/src/utils/sanitizeHtml.test.ts:146-157` ("keeps `<figure>`… img src +
style") places `style="width:50%"` on the **`<img>`**, NOT on the `<figure>` —
that does NOT match CKEditor 5's actual output (style on figure). The preset-class
tests at `:204-218` ARE accurate. NOTE the test at `:159-167` ("keeps width,
style, and class on `<img>`") uses `style="float:right"` — this will conflict
with the new width-only style restriction and must be updated.

## Implementation requirements

### 1. Backend sanitizer (`backend/src/utils/sanitizeHtml.ts`)
Widen so resize markup survives the write path AND mirror the frontend's
mechanism for consistency/security:
- Add `figure` and `figcaption` to `ALLOWED_TAGS`.
- Do **NOT** add `width`/`style`/`class` to the global `ALLOWED_ATTR`; instead
  add a `uponSanitizeAttribute` hook that mirrors the frontend's
  `forceKeepAttr`/`keepAttr=false` scoping (this makes backend and frontend
  byte-for-byte consistent — the frontend already works this way). The hook
  must KEEP `style`/`width`/`class` on `<img>` AND KEEP `style`/`width`/`class`
  on `<figure>` (the crucial fix — CKEditor puts width on the figure). Strip
  these attributes everywhere else (e.g. `<p style>`, `<div class>`).
- Merge with the existing `javascript:`/`data:` URI guard (keep it intact).

### 2. Frontend sanitizer (`frontend/src/utils/sanitizeHtml.ts`)
Fix the hook so `style`/`width` are ALSO kept on `<figure>` (currently dropped).
Keep `class` on figure. The current condition
`keep = isImg || (name === 'class' && isFigureCaption)` must be widened so a
figure keeps `style`/`width` too.

### 3. Security — width-only style subsetting (BOTH sanitizers)
Neither sanitizer currently subsets individual style declarations. Add it so
arbitrary CSS cannot ride through the now-allowed `style`:
- When keeping `style` on `<img>` or `<figure>`, parse the declarations and keep
  ONLY width-related properties: `width` and `max-width` (match the frontend's
  posture; mirror the exact same allow-set on the backend). Strip every other
  declaration (`position`, `background`, `url()`, `color`, `float`, `expression`,
  etc.). If nothing remains, drop the `style` attribute entirely.
- Apply the SAME subsetting logic on BOTH sanitizers (extract a tiny shared
  helper within each file; do not introduce a cross-workspace dependency).
- `javascript:` / `data:` URI guards must still work.

### 4. Tests
- **Backend** (`backend/src/utils/sanitizeHtml.test.ts`, table-driven exact-match
  style): add cases proving
  `<figure class="image image-resized" style="width:50%"><img src=…></figure>`
  survives `sanitizeDescription` with figure + class + style + img intact; and a
  negative case that disallowed style props (e.g. `position:fixed`,
  `background:url(javascript:…)`, arbitrary non-width style) are stripped while
  width is kept.
- **Frontend** (`frontend/src/utils/sanitizeHtml.test.ts`): ADD a test matching
  CKEditor's actual output — `style="width:50%"` on the **`<figure>`** —
  asserting it is preserved. UPDATE the misleading `:146-157` and the conflicting
  `:159-167` (`float:right`) tests so they remain accurate under width-only
  subsetting. Keep all preset-class tests green.
- Run BOTH suites (`npm test -w backend`, `npm test -w frontend`) and typechecks
  (`npm run typecheck -w backend`, `npm run typecheck -w frontend`). All green.

## Scope / non-goals
- No CKEditor config change.
- Do NOT add `h5`/`h6` to the backend allow-list (out of scope; frontend already
  has them).
- No new cross-workspace packages; package manager is **npm only**.

## Git policy (user override for this ticket)
- Work, commit, and push **directly on `main`** — NO branches, NO PR.
- Single-line commit message, **NO `SLYK-<id>:` prefix** (ticket number
  unidentifiable). Implementation commit message:
  `Persist image resize dimensions through html sanitizers`
- Docs commit message: `Add implementation plan, tasks, and verification report`
- Then `git push origin main`. No merge/squash/rebase.

## Verification criteria
- Drag-resized image markup (width on `<figure>`) round-trips through the
  backend sanitizer (write) and the frontend sanitizer (display).
- Preset-class resize still works; security guards intact (no arbitrary CSS/JS).
- All backend AND frontend tests + typechecks green.
