# Verification — persist-image-resize-dimensions (commit 48702b8)

**Plan:** `docs/bugfix/persist-image-resize-dimensions/persist-image-resize-dimensions-plan.md`
**Tasks:** `docs/bugfix/persist-image-resize-dimensions/persist-image-resize-dimensions-plan-tasks.md`
**Commit:** `48702b8` "Persist image resize dimensions through html sanitizers" (committed; NOT pushed)
**Branch:** `main`
**Date:** 2026-07-04
**Verifier phase:** read-only — NO commits, pushes, or branches were made during verification.

---

## Context

Bugfix in the SLYK npm-workspaces monorepo (backend = Node + Vitest; frontend = React 19 + Vite + Tailwind + Vitest + Testing Library). The bug: CKEditor's drag-resize emits `width` as `style="width:50%"` on the `<figure>` wrapper, not as an attribute. Both the backend and frontend DOMPurify-based `sanitizeDescription` sanitizers allowed `width`/`style` only on `<img>`, so the figure-level width was stripped on save→display round-trip, collapsing resized images to natural size. The fix widens the sanitizer hook to also keep `width`/`style`/`class` on `<figure>` (frontend) and introduces a mirrored width-only `style` subsetting helper on both sides so `width`/`max-width` survive while arbitrary CSS (`position`, `background:url(javascript:…)`, `color`, `float`) is stripped. The fix was committed as `48702b8` on `main` (NOT pushed). Blast radius is exactly the four sanitizer/test files (+180/−20); both write path (`backend/src/services/ticketService.ts:235/434`) and display path (`frontend/src/components/ticket-fields/DescriptionField.tsx:105`) call the same `sanitizeDescription` helper and are byte-identical/unchanged by the commit. Verification phase — NO commits/pushes/branches were made.

---

## Overall Verdict

> **Verdict: PASS** — All five tasks (T1–T5) are fully Implemented (5/5, 100%). The core bug — CKEditor's `<figure style="width:50%">` drag-resize output being stripped on save→display round-trip — is fixed on both backend and frontend via a mirrored, tightly-scoped widening of the sanitizer hook plus a width-only `style` subsetting helper that strips arbitrary CSS while preserving `width`/`max-width`. All four gates green first-hand (backend 858/858 + clean typecheck; frontend 1054/1054 + clean typecheck); empirical round-trip confirms the bug is resolved. Security posture is preserved/strengthened (URI guards intact, arbitrary CSS stripped, scoped tags only, script/iframe still stripped). Two informational notes (preset-class tests frontend-only by design; no dedicated frontend CSS-borne-URI-on-figure test) are non-blocking and not spec violations. No gaps found.

---

## Status Counts

| Status | Count | Percentage |
|--------|-------|------------|
| Implemented | 5 | 100% |
| Partial | 0 | 0% |
| Missing | 0 | 0% |
| Modified | 0 | 0% |
| **Total** | **5** | **100% Implemented** |

- T1 (Backend sanitizer — figure/figcaption allow + mirrored forceKeepAttr hook + width-only style subset): **Implemented**
- T2 (Frontend sanitizer — keep figure style/width + width-only style subset): **Implemented**
- T3 (Backend tests — exact-match figure-resize & negative style-prop cases): **Implemented**
- T4 (Frontend tests — CKEditor figure-style row; fix misleading + conflicting rows): **Implemented**
- T5 (Verification — full npm test/typecheck gates both workspaces): **Implemented**

---

## Verification Commands Actually Run

All five commands were executed by the verifier; exact results quoted.

1. **`npm test -w backend`** → **42 test files / 858 tests, all passed** (Duration ~42s). Includes `src/utils/sanitizeHtml.test.ts (27 tests)`. → **exit 0**
2. **`npm run typecheck -w backend`** → **CLEAN / exit 0.** `tsc --noEmit`, 0 diagnostics.
3. **`npm test -w frontend`** → **119 test files / 1054 tests, all passed.** → **exit 0**
4. **`npm run typecheck -w frontend`** → **CLEAN / exit 0.** `tsc --noEmit`, 0 diagnostics.
5. **Targeted: `npm test -w frontend -- src/utils/sanitizeHtml.test.ts`** → **1 test file / 41 tests, all passed.** → **exit 0**

> Note: the verbose `pino` request-error lines and the `Query data cannot be undefined` React-Query warning in `App.test.tsx` are expected/intentional negative-path noise; the corresponding tests pass. Not failures.

---

## Per-Task Results

### T1 — Backend sanitizer: allow figure/figcaption + mirrored forceKeepAttr hook + width-only style subsetting — **Implemented**

File: `backend/src/utils/sanitizeHtml.ts` (+84)

**ALLOWED_TAGS additions — PASS:**
- `ALLOWED_TAGS` contains `figure` (`backend/src/utils/sanitizeHtml.ts:27`) and `figcaption` (`:28`). Nothing else added.

**ALLOWED_ATTR unchanged — PASS:**
- `ALLOWED_ATTR` (`backend/src/utils/sanitizeHtml.ts:31-36`) = `['href','src','alt','target','rel']`; `width`/`style`/`class` NOT present — they are force-kept solely via the hook.

**Removed now-unused const — PASS:**
- Removed now-unused `DANGEROUS_URI` const (grep returns zero hits).

**T1(a) URI guard kept as branch-1 early return — PASS:**
- `backend/src/utils/sanitizeHtml.ts:84-89` — `name==='src'||name==='href'` → trim/lowercase → `startsWith('javascript:')` || `startsWith('data:')` → `data.keepAttr=false`; `return`. `ALLOWED_URI_REGEXP` (`:39-45`) unchanged.

**T1(b) Scoped force-keep — PASS** (`backend/src/utils/sanitizeHtml.ts:95-107`):
- `keep = isImg || (isFigure && (name==='style'||'width'||'class')) || (isFigcaption && name==='class')`; `!keep` → `data.keepAttr=false; return`. Exactly the required matrix.

**T1(c) Width-only style subset — PASS:**
- `subsetWidthStyle` helper at `backend/src/utils/sanitizeHtml.ts:53-64` splits on `;`, keeps only props `width`/`max-width` with non-empty value, joins survivors with `'; '`, returns `''` when none survive.
- Hook at `:110-125`: empty subset → `data.keepAttr=false` (no `style=""` leak); non-empty → `node.setAttribute('style', subset)` (`:122`) executed BEFORE `data.forceKeepAttr=true` (`:124`), honoring the dompurify@3.4.11 MUST-VERIFY that forceKeepAttr early-continues past `_setAttributeValue`.

**T1 acceptance criteria:**
- [x] `figure`/`figcaption` in backend `ALLOWED_TAGS`; nothing else added
- [x] `uponSanitizeAttribute` keeps javascript:/data: URI guard as branch 1 (early return) and scopes width/style/class via forceKeepAttr/keepAttr=false in branch 2
- [x] `keep` = style+width+class on `<img>` AND `<figure>`, class on `<figcaption>`, stripped elsewhere
- [x] `subsetWidthStyle` helper in-file; style subset to width/max-width only; empty subset drops attribute (no style="")
- [x] style subset applied via node.setAttribute('style', subset) before forceKeepAttr=true
- [x] width/style/class NOT added to backend ALLOWED_ATTR; DANGEROUS_URI const removed
- [x] `npm run typecheck -w backend` clean (0 errors)
- [x] `npm test -w backend` passes (858/858)

---

### T2 — Frontend sanitizer: keep figure style/width + width-only style subsetting — **Implemented**

File: `frontend/src/utils/sanitizeHtml.ts` (+61/−20)

**CORE FIX — `keep` condition — PASS** (`frontend/src/utils/sanitizeHtml.ts:101-110`):
- Now keeps `style` AND `width` (and `class`) on `<figure>`: `keep = isImg || (isFigure && (name==='style'||'width'||'class')) || (isFigcaption && name==='class')`. The old `:81` class-only-on-figure bug is fixed.

**class still kept — PASS:**
- `class` still kept on `<img>`/`<figure>`/`<figcaption>` (img via isImg keeps all three; figcaption class-only).

**Width-only style subset — PASS:**
- `subsetWidthStyle` helper at `frontend/src/utils/sanitizeHtml.ts:50-64`, byte-for-byte mirrored with backend (keeps only width/max-width, `prop:val` compact join `'; '`, `''` when empty).
- Hook at `:111-127`: empty subset → `data.keepAttr=false; return`; non-empty → `node.setAttribute('style', subset)` (`:118-125`) before `data.forceKeepAttr=true`.

**URI guard + ALLOWED_ATTR unchanged — PASS:**
- src/href URI guard unchanged (`frontend/src/utils/sanitizeHtml.ts:89-96`); `ALLOWED_URI_REGEXP` (`:42-46`) unchanged. width/style/class NOT added to frontend ALLOWED_ATTR (`:36` = `['href','src','alt','target','rel']`).

**Comments consistent — PASS:**
- Block comment `frontend/src/utils/sanitizeHtml.ts:66-83` now reads "img and figure may carry all three … figcaption may carry only class. The style value is subset to width / max-width only." Inline `:97-103` and `:114-116` (setAttribute-before-forceKeepAttr rationale) accurate. Old misleading "figure/figcaption keep only class" comment removed/rewritten.

**T2 acceptance criteria:**
- [x] `keep` keeps style AND width on `<figure>` (the `:81` bug fixed); class still kept on img/figure/figcaption
- [x] `subsetWidthStyle` helper in-file; style subset to width/max-width only; empty subset drops attribute (no style="")
- [x] style subset applied via node.setAttribute('style', subset) before forceKeepAttr=true
- [x] src/href URI guard branch unchanged; width/style/class NOT added to frontend ALLOWED_ATTR
- [x] `npm run typecheck -w frontend` clean (0 errors)

---

### T3 — Backend tests: exact-match figure-resize & negative style-prop cases — **Implemented**

File: `backend/src/utils/sanitizeHtml.test.ts` (+33). Table-driven `{name,input,expected}` via `toBe` exact-match.

**Five new rows added** (all `expected` pinned to actual run output):
- figure-resize markup survives (CKEditor `style="width:50%"` on `<figure>`) — `backend/src/utils/sanitizeHtml.test.ts:72-77` ✅
- non-width style props stripped on figure, width kept (`color:red; position:fixed`) — `:79-84` ✅
- style dropped when only disallowed props (`float:right`) — `:86-91` ✅
- CSS-borne script (`background:url(javascript:alert(1))`) blocked by subsetting — `:93-98` ✅
- style stripped on non-scoped tag `<p style="width:50%">` — `:100-103` ✅

**Existing URI rows still present** — PASS:
- `javascript:` href (`backend/src/utils/sanitizeHtml.test.ts:32-34`), `javascript:` img src (`:59-61`), `data:` img src (`:64-66`).

**Negative style-prop coverage — PASS:**
- `position`, `background`, `color`, `float` all explicitly stripped (`:79-98`).

**CSS-borne-URI case — PASS:**
- Present at `:93-98`.

**Suite state — PASS:**
- All existing backend rows still pass; full backend suite 858/858 green; typecheck clean.

**Empirical round-trip** (one-off `npx tsx` script in backend pkg, temp, deleted after):
- INPUT `<figure style="width:50%"><img src="https://x/a.png"></figure>` → OUTPUT `<figure style="width:50%"><img src="https://x/a.png"></figure>` (preserved exactly, compact colon).
- INPUT `<figure style="position:absolute;width:50%">…` → OUTPUT `<figure style="width:50%">…` (position stripped, width kept).
- Confirms the bug fix end-to-end.

**T3 acceptance criteria:**
- [x] Five new exact-match rows added (figure-resize survival; non-width props stripped w/ width kept; style dropped when only disallowed; CSS-borne url(javascript:) blocked; style stripped on <p>)
- [x] A negative style-prop case AND a CSS-borne-URI case both present
- [x] Every `expected` pinned to ACTUAL run output
- [x] All existing backend rows still pass; `npm test -w backend` fully green (858/858); typecheck clean

> Note (informational, not a gap): preset-class resize tests (`image-resize-medium`/`small`) are frontend-only by spec design (T4d); backend uses `image image-resized` + inline `style` convention which IS covered by the `:72-77` row.

---

### T4 — Frontend tests: CKEditor figure-style row; fix misleading + conflicting rows — **Implemented**

File: `frontend/src/utils/sanitizeHtml.test.ts` (+22/−2). `check: (o) => boolean` predicate form.

**New CKEditor figure-style row — PASS** (`frontend/src/utils/sanitizeHtml.test.ts:146-157`):
- Input `<figure class="image image-resized" style="width:50%">…`; `check` asserts `style="width:50%"` survives on the figure. The `width:50%` (compact, no space) formatting round-trips exactly through `subsetWidthStyle`.

**Renamed misleading row — PASS** (`frontend/src/utils/sanitizeHtml.test.ts:159-170`):
- Now `'keeps width-style on <img> inside <figure> (class on figure)'` — honestly describes an img-side style (no behavior change, no figure-style duplication).

**Updated conflicting float row — PASS** (`frontend/src/utils/sanitizeHtml.test.ts:172-181`):
- `'keeps width + class on <img>, strips non-width style (float)'` — asserts `!o.includes('style=') && !o.includes('float')` while `width="100"` and `class="editor-img"` survive (correctly inverted from old assertion).

**Preset-class resize rows untouched & green — PASS:**
- `image-resize-medium` (`frontend/src/utils/sanitizeHtml.test.ts:218-227`) and `image-resize-small` (`:228-234`).

**Negative style-prop coverage — PASS:**
- `<p style="color:red">` stripped (`:183-186`); non-width float stripped on scoped `<img>` (`:172-181`); class stripped on non-scoped tag (`:188-191`). (CSS-borne-URI on figure is backend-only T3 by design; frontend defense for it falls out of width-only subsetting.)

**Suite state — PASS:**
- Full frontend suite 1054/1054 green; typecheck clean.

**T4 acceptance criteria:**
- [x] New CKEditor figure-style row (predicate form) asserting `style="width:50%"` on `<figure>`
- [x] `:146-157` row renamed to honest img-style test (no behavior change)
- [x] `:159-167` row updated to assert float STRIPPED while width/class survive
- [x] Preset-class rows `:204-218` untouched and still green
- [x] Full frontend suite green (`npm test -w frontend` exit 0); typecheck clean

---

### T5 — Verification: full npm test/typecheck gates both workspaces — **Implemented**

- `npm test -w backend` exits 0 (858/858)
- `npm test -w frontend` exits 0 (1054/1054)
- `npm run typecheck -w backend` exits 0 (0 errors)
- `npm run typecheck -w frontend` exits 0 (0 errors)

**No regression in `ticketService.test.ts` — PASS:**
- It mocks `sanitizeDescription` (`backend/src/services/ticketService.test.ts:145-147` `vi.mock('../utils/sanitizeHtml', …)` delegating to a `vi.hoisted` spy at `:25-28` `sanitizeMock`); unchanged by fix (`git show 48702b8 -- backend/src/services/ticketService.test.ts` empty). `ticketService.test.ts (66 tests)` green.

**Scope confirmed — PASS:**
- `git show 48702b8 --stat` shows exactly the four intended files (+180/−20); `--name-only` lists four lines, no fifth. No `.pi/settings.json`, no lockfiles, no service/component files.

**T5 acceptance criteria:**
- [x] `npm test -w backend` exits 0 (858/858)
- [x] `npm test -w frontend` exits 0 (1054/1054)
- [x] `npm run typecheck -w backend` exits 0 (0 errors)
- [x] `npm run typecheck -w frontend` exits 0 (0 errors)
- [x] No regression in `ticketService.test.ts`
- [x] `git show 48702b8 --stat` shows exactly the four intended files (+180/−20); `--name-only` lists four lines, no fifth

---

## Acceptance-Criteria Mapping

(From the plan's Acceptance Criteria section.)

- **(a) figure/figcaption allowed & width survives round-trip** — CODE-LEVEL MET (backend `:27-28`, frontend `:101-110`); MET automated (backend test `:72-77`, frontend test `:146-157`, plus empirical tsx round-trip).
- **(b) Arbitrary CSS stripped, width/max-width kept** — CODE-LEVEL MET (`subsetWidthStyle` backend `:53-64` / frontend `:50-64`); MET automated (backend `:79-103`, frontend `:172-186`).
- **(c) Scoped stripping — style/width/class on non-scoped tags removed** — CODE-LEVEL MET (hook `!keep` branch backend `:106` / frontend `:112-116`); MET automated (backend `<p style>` `:100-103`, frontend `:183-191`).
- **(d) URI guards intact; script/iframe still stripped** — CODE-LEVEL MET (URI guard backend `:84-89` / frontend `:89-96`; `script`/`iframe` not in ALLOWED_TAGS); MET automated (backend `:32-34,59-66`, frontend `:193-210`).

---

## Notes & Caveats

Both items below are informational and NON-BLOCKING.

### 1. Preset-class resize tests are frontend-only by design

The `image-resize-medium`/`small` rows live only in the frontend suite (`frontend/src/utils/sanitizeHtml.test.ts:218-234`); the backend never had them and uses the `image image-resized` + inline-`style` convention instead (covered by backend row `:72-77`). This is consistent with the plan's scope split and is NOT a backend gap.

### 2. Frontend has no dedicated `background:url(javascript:)`-on-figure test

That case is scoped to backend T3 (`backend/src/utils/sanitizeHtml.test.ts:93-98`). The frontend's defense against CSS-borne payloads falls out of width-only subsetting (any non-width prop is dropped), but it is not explicitly asserted in the frontend suite. Flagged for transparency; NOT a violation of T4's acceptance criteria.

---

## Regression Assessment

**LOW regression risk.** Blast radius is exactly the four sanitizer/test files (`git show 48702b8 --stat`, +180/−20, no fifth file). The fix is isolated to the sanitizer internals; both data-path call sites are byte-identical and unchanged by the commit:

- **WRITE path:** `backend/src/services/ticketService.ts:234-235` (create) and `:433-434` (update) call `sanitizeDescription(...)`; `git show 48702b8 -- backend/src/services/ticketService.ts` is empty.
- **DISPLAY path:** `frontend/src/components/ticket-fields/DescriptionField.tsx:104-106` calls `sanitizeDescription(descriptionValue)` via `dangerouslySetInnerHTML`; `git show 48702b8 -- frontend/src/components/ticket-fields/DescriptionField.tsx` is empty.
- **Consumer-suite insulation:** `backend/src/services/ticketService.test.ts` mocks `sanitizeDescription` (`:145-147` + `:25-28`), so sanitizer-internal changes cannot regress the service tests (66/66 green).

### Security-posture confirmation (explicit)

The fix WIDENS the sanitizer (allows width/style/class on `<figure>`) but does NOT weaken security:

- Arbitrary/non-width CSS (`position`, `background:url(javascript:…)`, `color`, `float`) is STRIPPED by width-only `subsetWidthStyle`; only `width`/`max-width` survive.
- When the subset is empty, the `style` attribute is dropped entirely (no `style=""` leak).
- `style`/`width`/`class` remain stripped on non-scoped tags (e.g. `<p style>`).
- `javascript:`/`data:` URI guards on src/href are UNCHANGED (defense-in-depth alongside `ALLOWED_URI_REGEXP`).
- `script`/`iframe`/etc. remain NOT in ALLOWED_TAGS and are stripped.
- CSS-borne script (`background:url(javascript:alert(1))`) is blocked because its declaration never matches `width`/`max-width` (asserted backend `:93-98`).

**Security posture: PRESERVED/STRENGTHENED** — the new capability is tightly scoped to width-on-figure and cannot be used to inject arbitrary CSS or script.

---

## Summary

The persist-image-resize-dimensions bugfix (commit `48702b8`) is **PASS**: all five tasks (T1–T5) are fully implemented (5/5, 100%), every automated gate is green first-hand (backend `npm test -w backend` 858/858 + `npm run typecheck -w backend` clean; frontend `npm test -w frontend` 1054/1054 + `npm run typecheck -w frontend` clean; targeted frontend sanitizer suite 41/41), and the blast radius is confirmed at exactly four files (+180/−20, no fifth). The root cause — CKEditor's `<figure style="width:50%">` drag-resize output being stripped on save→display round-trip — is eliminated at the code level via a mirrored, tightly-scoped widening of the `uponSanitizeAttribute` hook on both backend (`backend/src/utils/sanitizeHtml.ts:95-107`) and frontend (`frontend/src/utils/sanitizeHtml.ts:101-110`), plus a byte-for-byte mirrored width-only `style` subsetting helper (`subsetWidthStyle` at backend `:53-64` / frontend `:50-64`) that preserves `width`/`max-width` while stripping arbitrary CSS. The empirical tsx round-trip confirms the bug is resolved end-to-end (`<figure style="width:50%">` preserved exactly; `position:absolute` stripped with `width` kept). The two informational notes (preset-class tests frontend-only by design; no dedicated frontend CSS-borne-URI-on-figure test) are non-blocking and not spec violations — the frontend's defense against CSS-borne payloads falls out of width-only subsetting. No gaps found.
