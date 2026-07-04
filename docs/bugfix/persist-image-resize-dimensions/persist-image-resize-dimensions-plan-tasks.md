# Task Breakdown — persist-image-resize-dimensions
**Plan:** `docs/bugfix/persist-image-resize-dimensions/persist-image-resize-dimensions-plan.md`
**Generated:** 2026-07-04

---

## CRITICAL GIT POLICY
- Work, commit, and (later) push **directly on `main`** — NO branches, NO `git checkout -b`, NO PR, NO `SLYK-<id>:` commit-message prefix. (The ticket id is unidentifiable; this override supersedes AGENTS.md's default branch/PR/prefix rules.)
- The implementation is committed as **a SINGLE commit on `main`** with this exact single-line message: `Persist image resize dimensions through html sanitizers`.
- Stage ONLY these four files in that commit: `backend/src/utils/sanitizeHtml.ts`, `backend/src/utils/sanitizeHtml.test.ts`, `frontend/src/utils/sanitizeHtml.ts`, `frontend/src/utils/sanitizeHtml.test.ts`. Do NOT stage the pre-existing, unrelated `.pi/settings.json` modification. Do NOT stage any lockfiles or `pnpm-*` files.
- Do NOT push in this pipeline stage — the orchestrator pushes `origin main` after verification passes. The implementation tasks only commit locally on `main`.
- A SEPARATE docs commit (`Add implementation plan, tasks, and verification report`) is made later by the docs/verifier stage — NOT by the implementation tasks. Do not create it here.
- **npm ONLY** — never `pnpm`/`yarn`/`bun`. Run per-workspace via `-w backend` / `-w frontend`.

## Summary
5 tasks across 3 batches; two parallel tracks (backend: T1→T3; frontend: T2→T4) converging on a verification task T5. Bug: CKEditor 5 drag-resized images emit `<figure class="image image-resized" style="width:50%">…</figure>` but two sanitizer layers strip the resize width — the backend sanitizer drops `<figure>` entirely (not in `ALLOWED_TAGS`) and the frontend sanitizer keeps `<figure>` but strips `style`/`width` off it (its scoping hook at `frontend/src/utils/sanitizeHtml.ts:81` force-keeps them on `<img>` and only `class` on `<figure>`). Fix widens both `uponSanitizeAttribute` hooks to keep `style`/`width` on `<figure>` (and adds `figure`/`figcaption` to the backend `ALLOWED_TAGS`), plus identical width-only `style` subsetting (`width`/`max-width` only) on both layers so no arbitrary CSS rides along. `width`/`style`/`class` are deliberately kept OFF both `ALLOWED_ATTR` lists — scoping is enforced solely by the hook's `forceKeepAttr`/`keepAttr=false`. Backend and frontend edit independent files → parallelizable; within a workspace the sanitizer task precedes its test task.

## DO NOT CHANGE (global exclusions — applies to every task)
- Do NOT add `width`/`style`/`class` to `ALLOWED_ATTR` on EITHER sanitizer — scoping is enforced exclusively by the hook (`forceKeepAttr`/`keepAttr=false`). (Backend `ALLOWED_ATTR` at `backend/src/utils/sanitizeHtml.ts:29-36`; frontend `ALLOWED_ATTR` at `frontend/src/utils/sanitizeHtml.ts:36` — both stay `['href','src','alt','target','rel']`.)
- Do NOT add `h5`/`h6` to the backend allow-list (frontend has them; backend intentionally does not).
- Do NOT change the `javascript:`/`data:` URI guards or `ALLOWED_URI_REGEXP` on either side (defense-in-depth stays intact).
- Do NOT change the `sanitizeDescription` config objects beyond the backend tag additions (keep `ALLOW_DATA_ATTR`, `FORBID_TAGS`, `FORBID_ATTR`, `ALLOWED_URI_REGEXP` as-is).
- Do NOT change any CKEditor config / `RichTextEditor.tsx` / `editor.getData()` — serialization already emits the width.
- Do NOT introduce a cross-workspace shared module for the style helper — keep a tiny in-file copy in each sanitizer.
- Do NOT touch `backend/src/services/ticketService.ts` or `frontend/src/components/ticket-fields/DescriptionField.tsx` (call sites unchanged; `ticketService.test.ts` mocks `sanitizeDescription` so it will not break).
- Do NOT stage `.pi/settings.json`, lockfiles, or `pnpm-*` files. **npm ONLY.**

---

## Parallelization Strategy

Two parallel tracks across independent workspaces, converging on one verification task.

### Batch / Dependency Diagram
```
Backend track:   [T1] ──> [T3] ─┐
                              ├─> [T5]
Frontend track:  [T2] ──> [T4] ─┘
```

### Merge-order rules
- Backend and frontend edit disjoint files — no merge-conflict surface; the two tracks can proceed in parallel.
- Within a workspace, the sanitizer task strictly precedes its test task: T1 before T3; T2 before T4.
- ⚠️ T2 and T4 must be implemented CONSECUTIVELY with no full-frontend-suite gate check between them: T2 intentionally makes the existing `frontend/src/utils/sanitizeHtml.test.ts:159-167` `float:right` test fail (it now correctly strips `float`), and the test is only green again after T4 updates it. T2's standalone verify is typecheck-only.
- All four `npm test/typecheck -w <workspace>` gates must be green at the convergence gate (T5) before the single implementation commit is made.

### Summary
| # | Batch | Target File | Dependencies | Can Parallel With |
|---|-------|-------------|--------------|-------------------|
| T1 | 1 | `backend/src/utils/sanitizeHtml.ts` | None | T2 |
| T2 | 1 | `frontend/src/utils/sanitizeHtml.ts` | None | T1 |
| T3 | 2 | `backend/src/utils/sanitizeHtml.test.ts` | T1 | T4 |
| T4 | 2 | `frontend/src/utils/sanitizeHtml.test.ts` | T2 | T3 |
| T5 | 3 | — (verification only) | T1, T2, T3, T4 | — |

### Suggested developer tracks
- **Track A (backend):** T1 → T3 → T5
- **Track B (frontend):** T2 → T4 → T5
- T1 and T2 run in parallel; T3 and T4 run in parallel; both converge at T5.

---

## Tasks

### T1 — Backend sanitizer: allow figure/figcaption + mirrored forceKeepAttr hook + width-only style subsetting
**Description:** Edit `backend/src/utils/sanitizeHtml.ts` ONLY. Three edits:

**(a) Add `figure`/`figcaption` to `ALLOWED_TAGS`** (`backend/src/utils/sanitizeHtml.ts:3-27`, currently ends `…'h1','h2','img'`). Append `'figure'` and `'figcaption'` after `'img'`. Do NOT add anything else.

AFTER (tail of the array):
```ts
  'h1',
  'h2',
  'img',
  'figure',
  'figcaption',
];
```

**(b) Add a module-level `subsetWidthStyle(style)` helper** (place it just above the hook). Keep only `width`/`max-width` declarations; return `""` when nothing survives so callers can drop the attribute:

```ts
/**
 * Keep only width / max-width declarations from an inline style string.
 * Returns "" when nothing survives, so callers can drop the attribute.
 */
function subsetWidthStyle(style: string): string {
  const kept: string[] = [];
  for (const decl of (style ?? '').split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    if (prop === 'width' || prop === 'max-width') {
      const val = decl.slice(idx + 1).trim();
      if (val) kept.push(`${decl.slice(0, idx).trim()}:${val}`);
    }
  }
  return kept.join('; ');
}
```

**(c) Replace the URI-only hook with a COMBINED `uponSanitizeAttribute` hook** (`backend/src/utils/sanitizeHtml.ts:54-62`; the explanatory comment block sits at `:47-53`). Keep the `javascript:`/`data:` guard as branch 1 (early return), and add a branch 2 that scopes `width`/`style`/`class` via `forceKeepAttr`/`keepAttr=false`. These names are NOT in `ALLOWED_ATTR`, so the hook force-keeps them where allowed and drops them elsewhere.

BEFORE (quote verbatim, `:54-62`):
```ts
const DANGEROUS_URI = /^(?:javascript|data):/i;
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (
    (data.attrName === 'href' || data.attrName === 'src') &&
    DANGEROUS_URI.test(data.attrValue)
  ) {
    data.keepAttr = false;
  }
});
```

AFTER:
```ts
DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  const name = data.attrName.toLowerCase();

  // javascript: / data: URI guard (unchanged behavior; defense-in-depth with
  // ALLOWED_URI_REGEXP).
  if (name === 'src' || name === 'href') {
    const value = (data.attrValue ?? '').trim().toLowerCase();
    if (value.startsWith('javascript:') || value.startsWith('data:')) {
      data.keepAttr = false;
    }
    return;
  }

  // Scope width/style/class to specific elements. These names are NOT in
  // ALLOWED_ATTR, so we force-keep them where allowed and drop elsewhere.
  if (name === 'width' || name === 'style' || name === 'class') {
    const tag = node.nodeName.toLowerCase();
    const isImg = tag === 'img';
    const isFigure = tag === 'figure';
    const isFigcaption = tag === 'figcaption';
    const keep =
      isImg ||
      (isFigure && (name === 'style' || name === 'width' || name === 'class')) ||
      (isFigcaption && name === 'class');

    if (!keep) {
      data.keepAttr = false;
      return;
    }

    if (name === 'style') {
      const subset = subsetWidthStyle(data.attrValue ?? '');
      if (subset === '') {
        data.keepAttr = false; // never emit style=""
        return;
      }
      // forceKeepAttr skips DOMPurify's attrValue write-back, so write the
      // subset directly to the node BEFORE setting forceKeepAttr (see
      // MUST-VERIFY below).
      if (node && typeof (node as Element).setAttribute === 'function') {
        (node as Element).setAttribute('style', subset);
      }
      data.forceKeepAttr = true;
      return;
    }

    data.forceKeepAttr = true;
  }
});
```
Note: the module-level `DANGEROUS_URI` const is no longer referenced after the rewrite (the guard is inlined) — remove it to avoid an unused-variable typecheck/lint failure.

> **⚠️ MUST-VERIFY:** Both workspaces run `dompurify@3.4.11`. In that build, when `uponSanitizeAttribute` sets `forceKeepAttr=true`, dompurify hits an early `continue` (`node_modules/dompurify/dist/purify.js:1792`) that skips `_setAttributeValue` — so mutating `data.attrValue` alone does NOT apply the width-only subset. The hook MUST write the subset directly to the live node via `node.setAttribute('style', subset)` BEFORE setting `forceKeepAttr=true` (as shown above), and set `data.keepAttr=false` when the subset is empty so no `style=""` is emitted. Run `npm test -w backend` and confirm the serialized `style` is the SUBSET (e.g. `color`/`float`/`position` removed), not the original. If — contrary to this source reading — `node.setAttribute` were observed NOT to persist, the acceptable fallback is `data.attrValue = subset`, but the node-write is the recommended robust form.

> **DO NOT CHANGE:** backend `ALLOWED_ATTR` (`:29-36`), `ALLOWED_URI_REGEXP` (`:44-45`), the `sanitizeDescription` config object (`:64-74`) beyond the tag additions, the `javascript:`/`data:` guard semantics, no `h5`/`h6`, no cross-workspace import. Commit per the CRITICAL GIT POLICY (single implementation commit; do not push). npm only.

**Acceptance criteria:**
- [ ] `'figure'` and `'figcaption'` are in backend `ALLOWED_TAGS` (`backend/src/utils/sanitizeHtml.ts:3-27`); nothing else added.
- [ ] The combined `uponSanitizeAttribute` hook keeps the `javascript:`/`data:` URI guard as branch 1 (early return) and scopes `width`/`style`/`class` via `forceKeepAttr`/`keepAttr=false` in branch 2.
- [ ] `keep` resolves to: `style`+`width`+`class` on `<img>` AND `<figure>`, `class` on `<figcaption>`, stripped everywhere else.
- [ ] `subsetWidthStyle` helper exists in-file; `style` is subset to `width`/`max-width` only; empty subset drops the attribute entirely (no `style=""`).
- [ ] The style subset is applied via `node.setAttribute('style', subset)` before `forceKeepAttr=true` (per the MUST-VERIFY).
- [ ] `width`/`style`/`class` are NOT added to backend `ALLOWED_ATTR`; the now-unused `DANGEROUS_URI` const is removed.
- [ ] `npm run typecheck -w backend` is clean (0 errors).
- [ ] Existing backend suite stays green: `npm test -w backend` passes (T1 is additive; no existing case uses `figure`/`style`).

**Dependencies:** None
**Subtasks:**
- (a) Append `'figure'`, `'figcaption'` to `ALLOWED_TAGS`.
- (b) Add the `subsetWidthStyle` helper above the hook.
- (c) Replace the URI-only hook with the combined hook; remove the unused `DANGEROUS_URI` const.
**Verify command(s):** `npm run typecheck -w backend` · `npm test -w backend` · `npm test -w frontend` · `npm run typecheck -w frontend`

---

### T2 — Frontend sanitizer: keep figure style/width + width-only style subsetting
**Description:** Edit `frontend/src/utils/sanitizeHtml.ts` ONLY. The frontend `ALLOWED_TAGS` already includes `figure`/`figcaption`/`img` (`:32-34`) — NO tag additions needed. Two edits:

**(a) Add the `subsetWidthStyle` helper** as an in-file copy (identical to T1's helper; place it above the hook). Do NOT import it across workspaces.

**(b) Widen the scoping branch of the hook** (`frontend/src/utils/sanitizeHtml.ts:76-87`) so `style`/`width` are kept on `<figure>` (the `:81` bug), and apply width-only `style` subsetting. The `src`/`href` URI guard branch (`:67-73`) stays UNCHANGED.

BEFORE (quote verbatim, `:76-87`):
```ts
  if (name === 'width' || name === 'style' || name === 'class') {
    const tag = node.nodeName.toLowerCase();
    const isImg = tag === 'img';
    const isFigureCaption = tag === 'figure' || tag === 'figcaption';
    // img keeps all three; figure/figcaption keep only `class`.
    const keep = isImg || (name === 'class' && isFigureCaption);
    if (keep) {
      data.forceKeepAttr = true;
    } else {
      data.keepAttr = false;
    }
  }
```

AFTER:
```ts
  if (name === 'width' || name === 'style' || name === 'class') {
    const tag = node.nodeName.toLowerCase();
    const isImg = tag === 'img';
    const isFigure = tag === 'figure';
    const isFigcaption = tag === 'figcaption';
    const keep =
      isImg ||
      (isFigure && (name === 'style' || name === 'width' || name === 'class')) ||
      (isFigcaption && name === 'class');

    if (!keep) {
      data.keepAttr = false;
      return;
    }

    if (name === 'style') {
      const subset = subsetWidthStyle(data.attrValue ?? '');
      if (subset === '') {
        data.keepAttr = false; // never emit style=""
        return;
      }
      if (node && typeof (node as Element).setAttribute === 'function') {
        (node as Element).setAttribute('style', subset);
      }
      data.forceKeepAttr = true;
      return;
    }

    data.forceKeepAttr = true;
  }
```

> **⚠️ MUST-VERIFY (same forceKeepAttr node-write detail as T1):** Under `dompurify@3.4.11`, `forceKeepAttr=true` skips `_setAttributeValue`, so the width-only `style` subset MUST be written via `node.setAttribute('style', subset)` before `forceKeepAttr=true`, and `data.keepAttr=false` used when the subset is empty. Run `npm test -w frontend` AFTER T4 to confirm the serialized `style` is the subset.

> **⚠️ SEQUENCING (critical):** T2 INTENTIONALLY breaks the existing `frontend/src/utils/sanitizeHtml.test.ts:159-167` `float:right` test (the test asserts `style="float:right"` survives; after T2 `float` is correctly stripped). Do NOT run the full frontend suite as a gate between T2 and T4. Implement T2 then T4 consecutively; only then is the frontend suite green. For T2's standalone check, run `npm run typecheck -w frontend` (clean) only.

> **DO NOT CHANGE:** frontend `ALLOWED_ATTR` (`:36`), `ALLOWED_TAGS`, `ALLOWED_URI_REGEXP` (`:44-45`), the `src`/`href` URI guard branch (`:67-73`), the `sanitizeDescription` config object, no cross-workspace import. Commit per the CRITICAL GIT POLICY. npm only.

**Acceptance criteria:**
- [ ] The `keep` condition now keeps `style` AND `width` on `<figure>` (the `frontend/src/utils/sanitizeHtml.ts:81` bug is fixed); `class` still kept on `<img>`/`<figure>`/`<figcaption>`.
- [ ] `subsetWidthStyle` helper exists in-file; `style` subset to `width`/`max-width` only; empty subset drops the attribute (no `style=""`).
- [ ] Style subset applied via `node.setAttribute('style', subset)` before `forceKeepAttr=true`.
- [ ] `src`/`href` URI guard branch unchanged; `width`/`style`/`class` NOT added to frontend `ALLOWED_ATTR`.
- [ ] `npm run typecheck -w frontend` is clean (0 errors). (Full `npm test -w frontend` green is verified after T4.)

**Dependencies:** None (the frontend sanitizer edit is independent of the backend; but T4 depends on T2)
**Subtasks:**
- (a) Add the in-file `subsetWidthStyle` helper.
- (b) Replace the scoping branch (`:76-87`) with the widened version that keeps figure style/width and subsets style.
**Verify command(s):** `npm run typecheck -w frontend` · (defer `npm test -w frontend` until T4 — see sequencing note) · `npm run typecheck -w backend` · `npm test -w backend`

---

### T3 — Backend tests: exact-match figure-resize & negative style-prop cases
**Description:** Edit `backend/src/utils/sanitizeHtml.test.ts` ONLY. The suite is table-driven: a `cases` array of `{ name, input, expected }` run via `expect(sanitizeDescription(input)).toBe(expected)` (exact-match). Add FIVE new rows to the `cases` array (additive; do not modify existing rows). Use exact-match `expected` via `toBe` (backend convention).

The rows (inputs and PREDICTED `expected` — see MUST-VERIFY):
```ts
{
  name: 'figure-resize markup survives',
  input:
    '<figure class="image image-resized" style="width:50%"><img src="https://example.com/a.png" alt="alt"><figcaption>cap</figcaption></figure>',
  expected:
    '<figure class="image image-resized" style="width:50%"><img src="https://example.com/a.png" alt="alt"><figcaption>cap</figcaption></figure>',
},
{
  name: 'non-width style props stripped on figure, width kept',
  input:
    '<figure class="image" style="width:50%; color:red; position:fixed;"><img src="https://example.com/a.png"><figcaption>cap</figcaption></figure>',
  expected:
    '<figure class="image" style="width:50%"><img src="https://example.com/a.png"><figcaption>cap</figcaption></figure>',
},
{
  name: 'style dropped when only disallowed props on figure',
  input:
    '<figure style="float:right"><img src="https://example.com/a.png"></figure>',
  expected:
    '<figure><img src="https://example.com/a.png"></figure>',
},
{
  name: 'CSS-borne script (url javascript:) blocked by subsetting',
  input:
    '<figure style="background:url(javascript:alert(1))"><img src="https://example.com/a.png"></figure>',
  expected:
    '<figure><img src="https://example.com/a.png"></figure>',
},
{
  name: 'style stripped on non-scoped tag (<p>)',
  input: '<p style="width:50%">x</p>',
  expected: '<p>x</p>',
},
```

> **⚠️ MUST-VERIFY:** The `expected` strings above are the plan's reasoned PREDICTIONS, not guarantees. They depend on (a) attribute ordering (dompurify generally preserves source order), (b) the exact `style`-value formatting produced by `subsetWidthStyle` (spacing around `:`, trailing `;`), and (c) the `forceKeepAttr` node-write behavior from T1. The implementer MUST run `npm test -w backend -- src/utils/sanitizeHtml.test.ts`, read the actual serialized output for each failing row, and PIN each `expected` to the real output. Prefer a `subsetWidthStyle` output format that round-trips CKEditor's compact `width:50%` exactly.

> **DO NOT CHANGE:** existing `cases` rows, the table-driven runner (`toBe` exact-match), the test file structure. Commit per the CRITICAL GIT POLICY. npm only.

**Acceptance criteria:**
- [ ] Five new exact-match rows added (figure-resize survival; non-width style props stripped with width kept; style dropped when only disallowed props; CSS-borne `url(javascript:)` blocked; style stripped on `<p>`).
- [ ] A negative style-prop case AND a CSS-borne-URI case are both present.
- [ ] Every `expected` is pinned to the ACTUAL run output (run the suite and adjust predictions to match).
- [ ] All existing backend rows still pass; `npm test -w backend` fully green; `npm run typecheck -w backend` clean.

**Dependencies:** T1 (the sanitizer must allow `figure`/`figcaption` and subset style before these expectations can hold)
**Verify command(s):** `npm test -w backend -- src/utils/sanitizeHtml.test.ts` · `npm test -w backend` · `npm run typecheck -w backend` · `npm test -w frontend` · `npm run typecheck -w frontend`

---

### T4 — Frontend tests: add CKEditor figure-style row; fix the misleading + conflicting rows
**Description:** Edit `frontend/src/utils/sanitizeHtml.test.ts` ONLY. The suite is table-driven with `cases` of `{ name, input, check | expected }`; most rows use a `check: (o) => boolean` predicate asserted `=== true`. Use the `check` predicate form for new/updated rows (frontend convention — order/quote-resilient). Four actions:

**(a) ADD** a new row matching CKEditor drag-resize output, with `style="width:50%"` ON the `<figure>`:
```ts
{
  name: 'keeps drag-resized <figure> style=width (CKEditor output)',
  input:
    '<figure class="image image-resized" style="width:50%"><img src="https://example.com/a.png" alt="alt"><figcaption>cap</figcaption></figure>',
  check: (o) =>
    o.includes('<figure') &&
    o.includes('class="image image-resized"') &&
    o.includes('style="width:50%"') &&
    o.includes('<img') &&
    o.includes('src="https://example.com/a.png"') &&
    o.includes('<figcaption') &&
    o.includes('cap</figcaption>'),
},
```

**(b) UPDATE the misleading row at `frontend/src/utils/sanitizeHtml.test.ts:146-157`** (currently named `'keeps <figure>/<figcaption> image block with class, img src + style'` but the `style` is on the `<img>`, not `<figure>`). Rename it to honestly describe an IMG-style test, e.g. `'keeps width-style on <img> inside <figure>'`. Keep the `check` assertions (the `width:50%` on `<img>` still survives under width-only subsetting). Do NOT move the style onto the figure (that would duplicate row (a)).

**(c) UPDATE the conflicting row at `frontend/src/utils/sanitizeHtml.test.ts:159-167`** (currently `'keeps width, style, and class on <img>'` with `style="float:right"` and asserts the float SURVIVES). After T2, `float` is stripped — so the test MUST assert the non-width style is REMOVED while width + class survive:
```ts
{
  name: 'keeps width + class on <img>, strips non-width style (float)',
  input:
    '<img src="https://example.com/a.png" width="100" style="float:right" class="editor-img">',
  check: (o) =>
    o.includes('src="https://example.com/a.png"') &&
    o.includes('width="100"') &&
    o.includes('class="editor-img"') &&
    !o.includes('style=') &&
    !o.includes('float'),
},
```

**(d) LEAVE the preset-class rows at `frontend/src/utils/sanitizeHtml.test.ts:204-218` UNTOUCHED** (`ImageStyle` medium/small width-preset classes on `<figure>`). They must stay green.

> **⚠️ MUST-VERIFY:** If `subsetWidthStyle` formats the value as `width: 50%` (space after `:`) rather than the input's compact `width:50%`, the `style="width:50%"` predicate in row (a) will fail — update the predicate to match the actual serialized format. Prefer the helper preserving the compact form so CKEditor output round-trips exactly. Run `npm test -w frontend` to confirm.

> **DO NOT CHANGE:** the preset-class rows `:204-218`, the `cases` array runner, other unrelated rows, test file structure. Commit per the CRITICAL GIT POLICY. npm only.

**Acceptance criteria:**
- [ ] New CKEditor figure-style row added (`check` predicate form) asserting `style="width:50%"` on the `<figure>`.
- [ ] `:146-157` row renamed to an honest img-style test (no behavior change).
- [ ] `:159-167` row updated to assert `float` is STRIPPED while `width`/`class` survive.
- [ ] Preset-class rows `:204-218` untouched and still green.
- [ ] Full frontend suite green: `npm test -w frontend` exits 0; `npm run typecheck -w frontend` clean.

**Dependencies:** T2 (the sanitizer must keep figure style/width and subset style before the new/updated expectations hold)
**Subtasks:**
- (a) Add the CKEditor figure-style row.
- (b) Rename/clarify the `:146-157` row.
- (c) Update the `:159-167` float row to assert stripping.
- (d) Confirm preset-class rows untouched.
**Verify command(s):** `npm test -w frontend -- src/utils/sanitizeHtml.test.ts` · `npm test -w frontend` · `npm run typecheck -w frontend` · `npm test -w backend` · `npm run typecheck -w backend`

---

### T5 — Verification: full npm test/typecheck gates both workspaces
**Description:** Verification ONLY — NO file edits. Run every gate until green and confirm scope.
- `npm test -w backend` — fully green (existing rows + the five new T3 rows).
- `npm test -w frontend` — fully green (including the new T4 row and the two updated rows; the previously-conflicting `:159-167` float row now passes).
- `npm run typecheck -w backend` — 0 errors.
- `npm run typecheck -w frontend` — 0 errors.
- Confirm `backend/src/services/ticketService.test.ts` is green (it mocks `sanitizeDescription`, so it must not regress) — covered by `npm test -w backend`.
- Confirm scope: `git status` shows ONLY the four source/test files modified for this work; the unrelated pre-existing `.pi/settings.json` modification is NOT staged. No lockfiles / `pnpm-*` staged.
- After green: make the SINGLE implementation commit on `main` with message `Persist image resize dimensions through html sanitizers`, staging only the four files (per CRITICAL GIT POLICY). Do NOT push (the orchestrator pushes post-verification).

> **DO NOT CHANGE:** do NOT edit any files in this task. Do NOT push. Do NOT create branches. Do NOT stage `.pi/settings.json`. npm only.

**Acceptance criteria:**
- [ ] `npm test -w backend` exits 0.
- [ ] `npm test -w frontend` exits 0.
- [ ] `npm run typecheck -w backend` exits 0.
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] No regression in `ticketService.test.ts`.
- [ ] `git status` shows only the four intended files staged for the implementation commit; `.pi/settings.json` unstaged.
- [ ] Single implementation commit on `main` with message `Persist image resize dimensions through html sanitizers`; no push performed.

**Dependencies:** T1, T2, T3, T4
**Verify command(s):** `npm test -w backend` · `npm test -w frontend` · `npm run typecheck -w backend` · `npm run typecheck -w frontend`
