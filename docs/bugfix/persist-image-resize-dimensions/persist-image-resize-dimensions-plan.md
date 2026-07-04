# Implementation Plan — persist-image-resize-dimensions
**Ticket:** `docs/bugfix/persist-image-resize-dimensions/persist-image-resize-dimensions.md`
**Type:** Bug
**Title:** Persist image resize dimensions through HTML sanitizers
**Generated:** 2026-07-04

---

## Summary

Images resized via drag handles in the CKEditor 5 rich-text editor resize visually but the resized width is not persisted: on reopening a card the image snaps back to its original size. CKEditor serializes a drag-resized image with the width as an inline `style="width:50%"` on the `<figure>` wrapper (`<figure class="image image-resized" style="width:50%"><img …></figure>`), not on the `<img>`. Two sanitizer layers strip that markup: the backend sanitizer drops `<figure>` entirely (not in its allow-list) and the frontend sanitizer keeps `<figure>` but strips `style`/`width` off it (its scoping hook only force-keeps them on `<img>`). The fix widens both sanitizers' `uponSanitizeAttribute` hooks to keep `style`/`width` on `<figure>` (and `figure`/`figcaption` tags on the backend), and adds identical width-only `style` subsetting (`width`, `max-width` only) to both so no arbitrary CSS can ride along. `editor.getData()` already emits the width — no CKEditor change is needed.

## Root Cause

### The core bug (frontend)

`frontend/src/utils/sanitizeHtml.ts:81` — the hook computes `const keep = isImg || (name === 'class' && isFigureCaption);`. There is no clause keeping `style` or `width` on `<figure>`, so for `<figure style="width:50%">` the hook sets `data.keepAttr = false` and the resize width is stripped. (Preset-class resize like `image-resize-medium` survives because `class` IS kept on `<figure>` — that is why preset resize round-trips but drag-resize does not.)

### The mirrored gap (backend)

`backend/src/utils/sanitizeHtml.ts` — `ALLOWED_TAGS` (`:3-27`) has no `figure`/`figcaption` (only `img`), `ALLOWED_ATTR` (`:29-36`) is `href, src, alt, target, rel` (no `width`/`style`/`class`), and the only `uponSanitizeAttribute` hook (`:55-62`) handles `javascript:`/`data:` URIs only. So `<figure>` is unwrapped and its `class`/`style` are lost at the persistence gate — the reason the width is "not saved".

Data path (from ticket): `editor.getData()` → backend `sanitizeDescription` (`backend/src/services/ticketService.ts:235` create, `:434` update) → DB → backend response → frontend `sanitizeDescription` (`frontend/src/components/ticket-fields/DescriptionField.tsx:105`, rendered via `dangerouslySetInnerHTML`) → render.

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| Backend util | `backend/src/utils/sanitizeHtml.ts` | Add `figure`/`figcaption` to ALLOWED_TAGS; add the mirrored forceKeepAttr scoping hook + width-only style subsetting; keep the URI guard. |
| Backend util test | `backend/src/utils/sanitizeHtml.test.ts` | Add table-driven exact-match cases for figure-resize survival + negative style-prop cases. |
| Frontend util | `frontend/src/utils/sanitizeHtml.ts` | Widen the hook's keep condition to include `style`/`width` on `<figure>`; add the same width-only style subsetting. |
| Frontend util test | `frontend/src/utils/sanitizeHtml.test.ts` | Add a figure-style test matching CKEditor output; update the misleading `:146-157` and the conflicting `:159-167` `float:right` test. |
| (Read-only confirm) | `backend/src/services/ticketService.ts`, `frontend/src/components/ticket-fields/DescriptionField.tsx` | Call sites unchanged; ticketService.test.ts mocks sanitizeDescription so it will not break. |

## Current State

- Backend `ALLOWED_TAGS` (`backend/src/utils/sanitizeHtml.ts:3-27`): `'p','br','strong','em','ul','ol','li','code','pre','blockquote','a','h3','h4','b','i','s','del','strike','u','h1','h2','img'` — no `figure`/`figcaption`.
- Backend `ALLOWED_ATTR` (`backend/src/utils/sanitizeHtml.ts:29-36`): `['href', 'src', 'alt', 'target', 'rel']`.
- Backend current hook (`backend/src/utils/sanitizeHtml.ts:54-62`), verbatim:

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

- Backend `sanitizeDescription` (`backend/src/utils/sanitizeHtml.ts:64-74`), verbatim:

```ts
export function sanitizeDescription(input: string | null | undefined): string {
  if (!input) return '';
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS, ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
    ALLOWED_URI_REGEXP,
  });
}
```

- Frontend `ALLOWED_ATTR` (`frontend/src/utils/sanitizeHtml.ts:36`): `['href', 'src', 'alt', 'target', 'rel']` — `width`/`style`/`class` are ABSENT (kept only via the hook).
- Frontend current hook (`frontend/src/utils/sanitizeHtml.ts:61-88`), verbatim:

```ts
purify.addHook('uponSanitizeAttribute', (node, data) => {
  const name = data.attrName.toLowerCase();

  if (name === 'src' || name === 'href') {
    const value = (data.attrValue ?? '').trim().toLowerCase();
    if (value.startsWith('javascript:') || value.startsWith('data:')) {
      data.keepAttr = false;
    }
    return;
  }

  if (name === 'width' || name === 'style' || name === 'class') {
    const tag = node.nodeName.toLowerCase();
    const isImg = tag === 'img';
    const isFigureCaption = tag === 'figure' || tag === 'figcaption';
    const keep = isImg || (name === 'class' && isFigureCaption);
    if (keep) {
      data.forceKeepAttr = true;
    } else {
      data.keepAttr = false;
    }
  }
});
```

- Backend test structure: table-driven array `cases` of `{ name, input, expected }`, run via `expect(sanitizeDescription(input)).toBe(expected)` (exact-match). No existing figure/style cases — new rows are additive.
- Frontend test structure: table-driven `cases` of `{ name, input, check | expected }`; most rows use a `check: (out) => boolean` predicate asserted `=== true`, a few use exact `expected` via `toBe`. Use predicate (`check`) form for new frontend rows to stay order/quote-resilient (matches existing style).
- Misleading frontend test (`frontend/src/utils/sanitizeHtml.test.ts:146-157`): named "keeps `<figure>`/`<figcaption>` image block with class, img src + style" but places `style="width:50%"` on the `<img>`, not the `<figure>` — proves nothing about figure-style preservation.
- Conflicting frontend test (`frontend/src/utils/sanitizeHtml.test.ts:159-167`): "keeps width, style, and class on `<img>`" with `style="float:right"` — asserts `float:right` survives, which conflicts with the new width-only rule and will FAIL unless updated.
- `ticketService.ts` call sites: `:235` (create, `sanitizeDescription(input.description)`) and `:434` (update, `sanitizeDescription(patch.description)`). `backend/src/services/ticketService.test.ts` mocks `sanitizeDescription` via `vi.mock('../utils/sanitizeHtml', …)` so backend sanitizer changes do NOT break it.
- Versions: backend uses `isomorphic-dompurify@2.36.0` (a pure pass-through shim that re-exports the hoisted `dompurify@3.4.11`); frontend uses `dompurify@3.4.11` directly. Same engine, identical hook API.

## Proposed Implementation

### Change 1 — Backend sanitizer: allow figure/figcaption + mirrored scoping hook + width-only style subsetting

- **File:** `backend/src/utils/sanitizeHtml.ts`
- **What:** (a) Add `'figure'` and `'figcaption'` to `ALLOWED_TAGS`. (b) Add a module-level `subsetWidthStyle(style)` helper. (c) Replace/extend the single URI-guard hook with a combined `uponSanitizeAttribute` hook that keeps the `javascript:`/`data:` guard AND scopes `width`/`style`/`class` via `forceKeepAttr`/`keepAttr=false` (mirroring the frontend), keeping `style`+`width` on `<img>` AND `<figure>`, `class` on `<img>`/`<figure>`/`<figcaption>`, stripping everywhere else, and applying width-only subsetting to `style`. Do NOT add `width`/`style`/`class` to `ALLOWED_ATTR`.
- **Why:** The backend is the persistence gate; `<figure>` must survive write so the resize width is saved. Mirroring the frontend's proven mechanism gives identical security posture on both layers.
- **Code reference:** `backend/src/utils/sanitizeHtml.ts:3-27` (ALLOWED_TAGS), `:29-36` (ALLOWED_ATTR), `:54-62` (hook), `:64-74` (sanitizeDescription).

BEFORE (ALLOWED_TAGS tail, `:3-27`) — currently ends with `…'h1','h2','img'` and has no figure/figcaption.

AFTER:

```ts
// …existing tags…
  'h1',
  'h2',
  'img',
  'figure',
  'figcaption',
];
```

BEFORE (hook, `:54-62`): the verbatim URI-only hook above.

AFTER (helper + combined hook):

```ts
/**
 * Keep only width / max-width declarations from an inline style string.
 * Returns "" when nothing survives, so callers can drop the attribute.
 * Parsing: split on ';', split each decl on the first ':', lower-case + trim
 * the property name, keep only `width` / `max-width`. Surviving declarations
 * are re-joined with '; '.
 */
function subsetWidthStyle(style: string): string {
  const kept: string[] = [];
  for (const decl of (style ?? '').split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    if (prop === 'width' || prop === 'max-width') {
      const val = decl.slice(idx + 1).trim();
      if (val) kept.push(decl.slice(0, idx).trim() + ':' + val);
    }
  }
  return kept.join('; ');
}

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
      // See "Critical Implementation Detail": forceKeepAttr skips DOMPurify's
      // attrValue write-back, so write the subset directly to the node.
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

### Change 2 — Frontend sanitizer: keep figure style/width + add width-only style subsetting

- **File:** `frontend/src/utils/sanitizeHtml.ts`
- **What:** (a) Add the same `subsetWidthStyle` helper in this file (no cross-workspace import). (b) In the hook, widen the `keep` condition so `style` and `width` are kept on `<figure>` (not just `<img>`). (c) For `style`, apply width-only subsetting: if the subset is empty set `data.keepAttr = false`; otherwise write the subset to the node and set `data.forceKeepAttr = true`. Keep `class` on `<img>`/`<figure>`/`<figcaption>` as today. Keep the URI guard.
- **Why:** This is the core bug fix (figure style was dropped at `:81`) plus the symmetric security subsetting.
- **Code reference:** `frontend/src/utils/sanitizeHtml.ts:61-88` (hook), `:81` (the `keep` expression), `:36` (ALLOWED_ATTR unchanged).

BEFORE (`:76-87`, the scoping branch):

```ts
  if (name === 'width' || name === 'style' || name === 'class') {
    const tag = node.nodeName.toLowerCase();
    const isImg = tag === 'img';
    const isFigureCaption = tag === 'figure' || tag === 'figcaption';
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

(Add the identical `subsetWidthStyle` helper from Change 1 in this same file.)

### Change 3 — Backend tests: exact-match figure-resize cases + negative style-prop cases

- **File:** `backend/src/utils/sanitizeHtml.test.ts`
- **What:** Add table rows (exact `expected` via `toBe`) to the existing `cases` array:
  1. **figure-resize survives** — input `<figure class="image image-resized" style="width:50%"><img src="https://example.com/a.png" alt="alt"><figcaption>cap</figcaption></figure>`; predicted expected `<figure class="image image-resized" style="width:50%"><img src="https://example.com/a.png" alt="alt"><figcaption>cap</figcaption></figure>`.
  2. **non-width style props stripped on figure** — input `<figure class="image" style="width:50%; color:red; position:fixed;"><img src="https://example.com/a.png"><figcaption>cap</figcaption></figure>`; predicted expected `<figure class="image" style="width:50%"><img src="https://example.com/a.png"><figcaption>cap</figcaption></figure>`.
  3. **style fully dropped when only disallowed props** — input `<figure style="float:right"><img src="https://example.com/a.png"></figure>`; predicted expected `<figure><img src="https://example.com/a.png"></figure>`.
  4. **CSS-borne script blocked by subsetting** — input `<figure style="background:url(javascript:alert(1))"><img src="https://example.com/a.png"></figure>`; predicted expected `<figure><img src="https://example.com/a.png"></figure>`.
  5. **style on a non-scoped tag stripped** — input `<p style="width:50%">x</p>`; predicted expected `<p>x</p>`.
- **Why:** Proves the resize round-trips AND that arbitrary CSS / CSS-borne URIs are blocked.
- **Code reference:** `backend/src/utils/sanitizeHtml.test.ts:5` (`cases` array), `:99-105` (runner using `toBe`).

> **⚠️ MUST-VERIFY:** The exact `expected` strings depend on (a) attribute ordering (DOMPurify preserves source order), (b) the style-value formatting produced by `subsetWidthStyle` (trailing-semicolon / spacing), and (c) the forceKeepAttr write-back behavior (see the Critical Implementation Detail section). The implementer MUST run the suite and pin each `expected` to the actual output. The predicted strings above are reasoned best-guesses, not guarantees.

### Change 4 — Frontend tests: add figure-style, fix the two flagged rows

- **File:** `frontend/src/utils/sanitizeHtml.test.ts`
- **What:** Use the `check` predicate form (matches existing style).
  1. **ADD** a new row matching CKEditor output, with `style="width:50%"` ON the `<figure>`:

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

  2. **UPDATE** the misleading row at `:146-157` so the name is honest about what it tests (style on `<img>`, not `<figure>`). Keep it as an img-style test: rename to e.g. `'keeps width-style on <img> inside <figure>'`; the `check` assertions still hold under width-only subsetting (`width:50%` survives). (Moving the style onto the figure would duplicate the new ADD row — keep it as the img-style test.)
  3. **UPDATE** the conflicting row at `:159-167` (`float:right`) so it asserts the non-width style is STRIPPED:

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

  4. Leave the preset-class rows at `:204-218` untouched (they must stay green).
- **Why:** Closes the test gaps the ticket calls out and locks the new width-only behavior.
- **Code reference:** `frontend/src/utils/sanitizeHtml.test.ts:146-157`, `:159-167`, `:204-218`, `:221-228` (runner).

> **⚠️ MUST-VERIFY:** Same style-value formatting caveat as Change 3 — run the suite; if `subsetWidthStyle` formats as `width: 50%` (space) rather than `width:50%`, update the `includes('style="width:50%"')` predicate to match. Prefer the helper preserving the input's compact `width:50%` form so CKEditor output round-trips exactly.

### Change 5 — Verification (NO file edits)

- **File:** _(none — execution only)_
- **What:** Run the four gates below until green. No source edits in this change.
- **Why:** Confirms both sanitizers serialize the expected output, types are clean, and no regression in `ticketService`.
- **Code reference:** root `package.json` workspaces (`-w backend` / `-w frontend`), each workspace's `test` = `vitest run`, `typecheck` = `tsc --noEmit`.

## Design Decision: mirror the frontend's forceKeepAttr mechanism

**Recommendation:** the backend should MIRROR the frontend's `forceKeepAttr`/`keepAttr=false` scoping hook. Do NOT add `width`/`style`/`class` to the backend `ALLOWED_ATTR`.

**Justification:**

1. **Consistency / security parity** — both sanitizers end up byte-for-byte identical in shape, making them easy to audit and guaranteeing the same posture on write (backend) and display (frontend).
2. **Least-risky / smallest surface** — keeping these names OFF the global allow-list means they survive ONLY where the hook explicitly keeps them (img/figure/figcaption). Adding them to `ALLOWED_ATTR` would globally allow them on EVERY tag unless additionally scoped, broadening the attack surface.
3. **Proven** — the frontend ships this exact mechanism in production.
4. **No divergence** — `isomorphic-dompurify@2.36.0` is a pure pass-through shim that re-exports the hoisted `dompurify@3.4.11`, the SAME engine the frontend uses, so the `uponSanitizeAttribute` + `forceKeepAttr`/`keepAttr`/`attrValue` API is identical on both sides (confirmed: zero DOMPurify logic lives inside isomorphic-dompurify).

**Resolving ticket req tension:** the ticket req #1 literally says "Add width/style/class to ALLOWED_ATTR (scoping is enforced by the hook)" while req #3 says "mirror the frontend's security posture exactly." The frontend does NOT use `ALLOWED_ATTR` for these names — it uses `forceKeepAttr`. To satisfy "consistent AND least-risky," this plan resolves the tension in favor of the `forceKeepAttr` mirror (this is the more defensible reading of req #3). Surfaced explicitly for reviewer awareness.

## Critical Implementation Detail: style-value write-back under forceKeepAttr

This is the single most likely implementation pitfall.

- Per `dompurify@3.4.11` source (the engine both sanitizers run): inside the attribute loop, after `uponSanitizeAttribute` hooks execute, `forceKeepAttr` causes an early `continue`, and the ONLY place a (possibly mutated) `data.attrValue` is written back to the node (`_setAttributeValue`) runs AFTER that `continue` — i.e. it is skipped when `forceKeepAttr=true`. Consequence: **mutating `data.attrValue` alone does NOT change the serialized `style` value on the `forceKeepAttr` path**; the node keeps its original parsed attribute value.
- Therefore, to apply the width-only subset, the hook must write the subset directly to the live node: `node.setAttribute('style', subset)` (guarded by an `setAttribute` capability check), THEN set `data.forceKeepAttr = true`. When the subset is empty, set `data.keepAttr = false` (this drop DOES work) so no `style=""` is emitted.
- This does NOT undermine the mirror decision — it is a refinement of how the `style` VALUE is applied under `forceKeepAttr`. Both sanitizers apply the identical fix.
- **MUST-VERIFY:** the implementer must run the suites and confirm the serialized `style` is the SUBSET (e.g. `float`/`color`/`position` removed), not the original. If, contrary to the above source reading, `data.attrValue = subset` alone were observed to work on a given build, the direct node write is still harmless and remains the recommended robust form. If node-mutation somehow does not persist, the fallback is `data.attrValue = subset` — but the source evidence favors node-mutation.

## Do NOT Change (explicit exclusions)

- Do NOT add `width`/`style`/`class` to `ALLOWED_ATTR` on either sanitizer (`forceKeepAttr` handles scoping).
- Do NOT change any CKEditor config (`RichTextEditor.tsx` plugins / `editor.getData()` are untouched — serialization already includes the width).
- Do NOT add `h5`/`h6` to the backend allow-list (the frontend already has them; the backend intentionally does not).
- Do NOT introduce a cross-workspace shared module for the style helper — keep a tiny copy in each sanitizer file.
- Do NOT change the `javascript:`/`data:` URI guards or `ALLOWED_URI_REGEXP` on either side.
- Do NOT alter the `sanitizeDescription` config objects (`ALLOW_DATA_ATTR`, `FORBID_TAGS`, `FORBID_ATTR`, `ALLOWED_URI_REGEXP`) beyond the tag additions.
- Do NOT touch `ticketService.ts` or `DescriptionField.tsx` (call sites unchanged).

## Edge Cases & Risks

- **Style-value formatting variance** (trailing `;`, space after `:`) — pin expected strings to actual run output; use predicate `check` on the frontend to absorb order/quote variance.
- **Attribute ordering** — DOMPurify generally preserves source order, but verify per test.
- **Empty style after subsetting** — must fully drop the attribute (`keepAttr=false`), never emit `style=""`.
- **`<figure>` without `<figcaption>`** (CKEditor may omit the caption) — figure+img must still survive.
- **Multiple surviving declarations** (`width` + `max-width`) — join with `'; '`; single-declaration case is what the tests cover.
- **`data:`/`javascript:` inside a `url()` within style** — blocked by subsetting (only width/max-width survive), but add an explicit regression case (Change 3 #4).
- **Vendor-prefixed or malformed declarations** — parser ignores non-`width`/`max-width` props; tolerate missing values.
- **`forceKeepAttr` write-back skip** (see Critical Implementation Detail) — the dominant implementation risk.

## Testing

- **Stack:** Vitest, co-located `*.test.ts`, table-driven (backend exact-match `toBe`; frontend `check` predicates / `toBe`). npm ONLY (AGENTS.md: `npm test -w <workspace>`).
- **Commands (all must be green):**
  - `npm test -w backend`
  - `npm test -w frontend`
  - `npm run typecheck -w backend`
  - `npm run typecheck -w frontend`
- **Focused runs while iterating:**
  - `npm test -w backend -- src/utils/sanitizeHtml.test.ts`
  - `npm test -w frontend -- src/utils/sanitizeHtml.test.ts`
- **Regression guard:** `backend/src/services/ticketService.test.ts` mocks `sanitizeDescription`, so it will not break — but still run `npm test -w backend` to confirm.

## Acceptance Criteria

- [ ] `figure` and `figcaption` are in the backend `ALLOWED_TAGS`.
- [ ] Backend hook mirrors the frontend's forceKeepAttr/keepAttr scoping (style+width on img AND figure; class on img/figure/figcaption).
- [ ] Frontend hook keeps `style`/`width` on `<figure>` (the `:81` bug fixed).
- [ ] Both sanitizers apply identical width-only `style` subsetting (`width`, `max-width` only) via an in-file `subsetWidthStyle` helper.
- [ ] Empty style subset drops the attribute entirely (no `style=""`).
- [ ] `javascript:`/`data:` URI guards remain intact on both sanitizers.
- [ ] `width`/`style`/`class` are NOT added to either `ALLOWED_ATTR`.
- [ ] Backend tests include figure-resize survival + ≥1 negative style-prop case (and a CSS-borne-URI case), exact-match green.
- [ ] Frontend test adds the CKEditor figure-style row; `:146-157` renamed/clarified; `:159-167` updated to assert `float` is stripped; preset-class rows still green.
- [ ] `npm test -w backend`, `npm test -w frontend`, `npm run typecheck -w backend`, `npm run typecheck -w frontend` all pass.
- [ ] No CKEditor config change; no `h5`/`h6` added to backend; no cross-workspace shared module; npm only.

## Out of Scope

- CKEditor config / plugin changes.
- Backend `h5`/`h6` allow-listing.
- Cross-workspace shared sanitization package.
- Changes to `ALLOWED_URI_REGEXP`, `FORBID_TAGS`, `FORBID_ATTR`, or the `sanitizeDescription` options beyond adding tags.
- Changes to `ticketService.ts` or `DescriptionField.tsx`.

## Security Posture

### Now allowed (after the fix)

- Tags: `<figure>` and `<figcaption>` (in addition to existing allow-list, including `<img>`).
- Attributes on `<img>`: `src`, `alt` (existing) + `width`, `style` (width/max-width only), `class`.
- Attributes on `<figure>`: `class`, `style` (width/max-width only), `width`.
- Attributes on `<figcaption>`: `class`.
- Inside `style` on `<img>`/`<figure>`: only `width` and `max-width` declarations survive.
- Existing preset-class image styles (`image-resize-medium`, `image-resize-small`) continue to round-trip.

### Still blocked

- Any CSS property other than `width`/`max-width` inside `style` (`color`, `float`, `position`, `background`, `url()`, `expression`, etc.).
- `style`/`width`/`class` on any tag other than `<img>`/`<figure>`/`<figcaption>` (and `class`-only on `figcaption`).
- `javascript:` and `data:` URIs in `src`/`href` (hook + `ALLOWED_URI_REGEXP`).
- CSS-borne scripts (e.g. `background:url(javascript:…)`) — stripped by subsetting.
- `<script>`, `<style>` element, `<iframe>`, `<object>`, `<embed>`, and event-handler attributes (`onerror`, `onload`, `onclick`, `onmouseover`) — unchanged FORBID config.
- `data:*` attributes (`ALLOW_DATA_ATTR: false`).

## Open Questions

1. Final style-value formatting (`width:50%` vs `width: 50%` vs `width:50%;`) — confirm by running and align helper output + test assertions. (Recommended: preserve the input's compact `prop:value` so CKEditor output round-trips exactly.)
2. Does CKEditor ever emit an empty `<figcaption>` for captioned-then-cleared images? If so, confirm it survives/serializes consistently (it is in `ALLOWED_TAGS`, so it stays).
3. (Confirm-by-running) Does `node.setAttribute('style', subset)` inside the hook persist through serialization under `dompurify@3.4.11`'s `forceKeepAttr` path as the source reading predicts? (Expected: yes.)

## Conventions / Commit Notes

- **Package manager:** **npm ONLY** (AGENTS.md). Never run `pnpm`/`yarn`/`bun`. Do NOT commit `pnpm-lock.yaml`/`pnpm-workspace.yaml`.
- **Formatting:** Prettier, line length 100; 4-space indent JSX / 2-space JS; trailing commas in arrays/objects.
- **Backend layering:** sanitizer lives in `utils`, invoked from the `service` layer (`ticketService.ts`) — consistent with the `Route → Controller → Service → Repository` rule; this change touches only `utils` (+ tests), so no layering change.
- **Git-policy override (from the ticket, supersedes AGENTS.md's default branch/PR/commit-prefix rules):** Work, commit, and push **directly on `main`** — NO branches, NO PR. Single-line commit messages, **NO `SLYK-<id>:` prefix** (ticket number is unidentifiable). Implementation commit message: `Persist image resize dimensions through html sanitizers`. Docs commit message: `Add implementation plan, tasks, and verification report`. Then `git push origin main`. No merge / squash / rebase. (Note: AGENTS.md's "Sacred Rule" still applies in spirit — the planner does not execute git; the implementer stage performs the commits/push with this override.)
- **NOTE for the writer:** do NOT execute any git commands yourself; this section is informational for the implementer stage.
