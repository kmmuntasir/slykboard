# Verification — rte-bold-flinch (commit 6a9ce98)

**Plan:** `docs/bugfix/rte-bold-flinch/rte-bold-flinch-plan.md`
**Tasks:** `docs/bugfix/rte-bold-flinch/rte-bold-flinch-plan-tasks.md`
**Commit:** `6a9ce98` (fix committed; NOT pushed)
**Branch:** `main`
**HEAD:** `6a9ce98` (HEAD == 6a9ce98; `main` is 1 ahead of `origin/main`)
**Date:** 2026-07-04
**Verifier phase:** read-only — NO commits, pushes, or branches were made during verification.

---

## Context

Bugfix in the SLYK npm-workspaces monorepo (frontend = React 19 + Vite + Tailwind + Vitest + Testing Library). The RichTextEditor's Bold toolbar button flinched on click and double-click word-selection spuriously toggled bold, because CKEditor's `editor.setData()` was invoked during active editing via the controlled-value round-trip echo (parent `setValue`→`watch`→`value`), and `setData()` nulls the selection (`writer.setSelection(null)`) which forces the Bold command to recompute its active state. The fix was committed as `6a9ce98` on `main` (NOT pushed; HEAD == 6a9ce98; `main` is 1 ahead of `origin/main`). The fix touches exactly two files: `frontend/src/components/RichTextEditor.tsx` (+48/−14) and `frontend/src/components/RichTextEditor.test.tsx` (+92). Verification phase — NO commits/pushes/branches were made.

---

## Overall Verdict

> **Verdict: PASS-WITH-NOTES** — Every task (T1, T2, T3) acceptance criterion is met; all automated gates (typecheck + full Vitest suite + 5 consumer suites) are green; all explicit exclusions honored; blast radius is exactly 2 files. The three runtime UX acceptance criteria are code-level-met and require the optional, plan-scheduled manual QA to confirm in a real browser (jsdom cannot reproduce the bug's reproduction mechanism).

---

## Status Counts

| Status | Count | Percentage |
|--------|-------|------------|
| Implemented | 3 | 100% |
| Partial | 0 | 0% |
| Missing | 0 | 0% |
| Modified | 0 | 0% |
| **Total** | **3** | **100% Implemented** |

- T1 (component fix): **Implemented** (5/5 subtasks, all exclusions honored)
- T2 (tests): **Implemented** (mock enhancement + 3 new tests; 6 existing intact) — with the test-discrimination note below
- T3 (verification gate): **Implemented** (typecheck clean; full suite green; 5 consumer suites green)

---

## Verification Commands Actually Run

All four commands were executed by the verifier; exact results quoted.

1. **`npm run typecheck -w frontend`** → **CLEAN / exit 0.** Output was just the npm script banner + `tsc --noEmit` with no diagnostics.
2. **`npm run test -w frontend`** (FULL suite) → **119 test files / 1053 tests, all passed** in 129.63s. Vitest v3.2.6.
3. **Focused: `npm run test -w frontend -- src/components/RichTextEditor.test.tsx`** → **1 file / 15 tests passed** (6 existing RichTextEditor tests + 6 `isValidImageUrl` tests + 3 new tests = 15).
4. **Five consumer-mock suites explicit run: `npm run test -w frontend -- src/components/TicketDetailModal.test.tsx src/components/TicketAttributeForm.test.tsx src/components/CreateTicketModal.test.tsx src/components/NewTicketButton.test.tsx src/components/ticket-fields/DescriptionField.test.tsx`** → **5 files / 78 tests passed.** Per-file: NewTicketButton 2, CreateTicketModal 4, DescriptionField 6, TicketAttributeForm 30, TicketDetailModal 36.

---

## Per-Task Results

### T1 — Core component fix: echo-guarded controlled-value sync — **Implemented**

File: `frontend/src/components/RichTextEditor.tsx` (+48/−14)

**Public contract UNCHANGED (exclusion honored):**
- `interface RichTextEditorProps { value: string; onChange: (html: string) => void; placeholder?: string; }` (`RichTextEditor.tsx:23-27`, unchanged)
- `export function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps)` — NAMED export, `RichTextEditor.tsx:123` (unchanged)

**T1(a) Refs added — PASS:**
- `const lastEmittedDataRef = useRef<string>(value);` — `RichTextEditor.tsx:136` (initialized to `value`)
- `const initialDataRef = useRef<string>(value);` — `RichTextEditor.tsx:142` (initialized to `value`)
- Both placed immediately after `applyingExternalData` (ref at `:131`), which is preserved unchanged.

**T1(b) Sync effect guard rewritten — PASS** (`RichTextEditor.tsx:241-253`):
- Old guard `editor.getData().trim() === value.trim()` is GONE.
- New guard: `if (value === lastEmittedDataRef.current) return;` — `:248`
- Body still toggles `applyingExternalData` (`:249` true / `:251` false), calls `editor.setData(value)` — `:250`, and NEWLY appends `lastEmittedDataRef.current = value;` — `:252`.

**T1(c) onChange records emit — PASS** (`RichTextEditor.tsx:279-286`):
- `if (applyingExternalData.current) return;` early-return still first — `:280`
- `const html = editor.getData();` — `:282`
- `lastEmittedDataRef.current = html;` — `:284` (set BEFORE parent call)
- `onChange(html);` — `:285`

**T1(d) data prop frozen — PASS:**
- `<CKEditor ... data={initialDataRef.current} ...>` — `:266` (NOT `data={value}`).

**T1(e) onReady gap-closer — PASS (INCLUDED)** (`RichTextEditor.tsx:267-277`):
- `editorRef.current = editor;` first — `:268`
- `if (value !== lastEmittedDataRef.current) { applyingExternalData.current = true; editor.setData(value); applyingExternalData.current = false; lastEmittedDataRef.current = value; }` — `:272-276`

**Reachability crux (the core of the bug fix) — PASS:**
- Exactly **2** `editor.setData(...)` call sites in the component: `:250` (sync effect, gated by `value === lastEmittedDataRef.current` at `:248` AND `editorRef.current` at `:244`) and `:274` (onReady, gated by `value !== lastEmittedDataRef.current` at `:272`).
- The onChange handler writes `lastEmittedDataRef.current = html` at `:284` BEFORE propagating to the parent, so the parent's echo satisfies the effect's `===` guard.
- The SECOND setData path — the `@ckeditor/ckeditor5-react` wrapper's own `shouldUpdateEditorData` reconciliation (`instance.data.set(nextProps.data)`) — is neutralized by freezing `data={initialDataRef.current}` (`:266`); `prevProps.data === nextProps.data` now always holds on re-render so the wrapper never re-pushes.
- **Conclusion: `editor.setData()` is no longer reachable during active editing or on the controlled round-trip echo.** It is reachable ONLY for (i) genuine external `value` changes via the effect, and (ii) the mount-to-ready gap via onReady.

**T1 exclusions honored — all PASS:**
- CKEditor `config` useMemo untouched: `const config = useMemo<EditorConfig>` at `:146`; `plugins:` at `:149`; `toolbar: { items: [...TOOLBAR_ITEMS] }` at `:171`. `TOOLBAR_ITEMS` constant (`:69`) and `HEADING_OPTIONS` (`:90`) unchanged. The `bold`/`italic`/etc. toolbar items, the Bold command, and plugin config appear NOWHERE in the commit diff.
- Prop contract + named export unchanged (see above).
- `applyingExternalData` loop-guard preserved (ref `:131`; toggled in effect `:249`/`:251` and onReady `:273`/`:275`; early-return in onChange `:280`).
- NO debounce/throttle/`setTimeout`/`useDeferredValue`/`useTransition` in the round-trip (grep returned zero matches).
- NO focus-based skip gate (no `document.activeElement` / `isFocused` / `:focus` check used to gate setData; the `focus-within` at `:259` is a CSS ring rule, not a gate).

**T1 acceptance criteria:**
- [x] Both refs (`lastEmittedDataRef`, `initialDataRef`) added and initialized to `value`.
- [x] Sync effect guards on `value === lastEmittedDataRef.current` and updates the ref after `setData`.
- [x] `onChange` records emitted HTML into `lastEmittedDataRef.current` before calling the parent `onChange`.
- [x] `<CKEditor data={...}>` uses `initialDataRef.current` (frozen).
- [x] `onReady` applies a genuine external value that arrived pre-ready.
- [x] Public props contract `{ value, onChange, placeholder? }` and named export are UNCHANGED.
- [x] `npm run typecheck -w frontend` is clean.
- [x] `npm run test -w frontend -- src/components/RichTextEditor.test.tsx` — the 6 existing tests still pass (the genuine-change sync test at test-file `:169` still passes since `<p>first</p>`→`<p>second</p>` is a real external change).

---

### T2 — Co-located test: setData spy + 3 new echo-guard assertions — **Implemented**

File: `frontend/src/components/RichTextEditor.test.tsx` (+92)

**T2(a) Mock enhancement — PASS:**
- Imports updated: `import { describe, it, expect, vi, afterEach, type Mock } from 'vitest';` — `:18`; `waitFor` added to the @testing-library/react import.
- `vi.hoisted` shared holder `currentEditor`, OUTSIDE the `vi.mock` factory — `:26-32`.
- `getData: () => el.innerHTML,` unchanged — `:63`.
- `setData: vi.fn((value: string) => { el.innerHTML = value; })` — same body, now wrapped in `vi.fn` spy — `:64-66`.
- Mount effect assigns `currentEditor.current = editor;` alongside `onReady?.(editor);` — `:69-70`.
- `onInput` of `ck-editable` still calls `onChange?.({}, editor)` (the `change:data` stand-in) — intact.
- `afterEach(() => { currentEditor.current = null; })` — `:190-191` (prevents tests seeing a prior unmounted editor).

**T2(b) The 6 existing tests — INTACT** (unchanged; `git show 6a9ce98` confirms no hunk touches them):
- `:114` 'renders the wrapper with the rich-text + focus-ring family classes'
- `:125` 'renders toolbar buttons for the configured items'
- `:138` 'passes the initial value prop through to the editable'
- `:144` 'propagates editor.getData() to onChange when the editable receives input'
- `:159` 'passes the placeholder prop into the editor config'
- `:169` 'syncs an external value change into the editor (and does not loop)' — still asserts via `editable.textContent` after `rerender` `<p>first</p>`→`<p>second</p>` then `<p>second</p>`→`<p>second</p>`. PASSES.
- `isValidImageUrl` `describe` at `:262` (6 table-driven cases) — intact.

**T2(b) The 3 new tests — present, meaningful, well-structured:**
- `:194` 'does not call setData when the parent echoes the just-emitted value (round-trip guard)' — baselines `setData.mock.calls.length` (`:203`), fires input (`:209`), captures emitted HTML, rerenders with the echo (`:217`), asserts `setData.mock.calls.length` unchanged (`:218`).
- `:221` 'calls setData for a genuine external value change' — rerenders `<p>first</p>`→`<p>second</p>` (`:229`), asserts `setData` called with `'<p>second</p>'` (`:232`) and editable textContent `'second'` (`:233`).
- `:236` 'does not call setData on repeated echoed re-renders during editing' — 3 edit+echo rerenders in a loop, asserts `setData.mock.calls.length` unchanged from baseline (`:256`).

**T2 acceptance criteria:**
- [x] `vi.hoisted` holder exists and exposes `setData` as a `vi.fn`.
- [x] The mount effect assigns `currentEditor.current = editor`.
- [x] The 6 existing tests STILL pass (no behavioral change to getData/setData/input).
- [x] The 3 new tests pass and assert via `setData.mock.calls.length`.
- [x] `npm run test -w frontend -- src/components/RichTextEditor.test.tsx` is fully green (15/15).

> ⚠️ See **Notes & caveats** below for the test-discrimination limitation — the 3 new tests are behavior-locks, not regression-catchers for this specific bug.

---

### T3 — Verification gate — **Implemented**

- `npm run typecheck -w frontend` → exit 0, clean.
- `npm run test -w frontend` → 119 files / 1053 tests, all green.
- All 5 consumer-mock suites green (78/78). Each mocks RichTextEditor BY NAMED EXPORT and depends only on `{ value, onChange }` (or `{ value }` for read-only DescriptionField), so each is IMMUNE to the internal RichTextEditor fix:
  - `TicketDetailModal.test.tsx` — mock spec `vi.mock('./RichTextEditor')` at `:13`; renders `<textarea aria-label="Description">` keyed on `{ value, onChange }`. 36 tests.
  - `TicketAttributeForm.test.tsx` — mock at `:4`; same shape. 30 tests.
  - `CreateTicketModal.test.tsx` — mock at `:4`; same shape. 4 tests.
  - `NewTicketButton.test.tsx` — mock at `:4`; same shape. 2 tests.
  - `ticket-fields/DescriptionField.test.tsx` — mock spec `vi.mock('@/components/RichTextEditor')` at `:23` (alias path); renders read-only `<textarea aria-label="Description">` keyed on `{ value }` only. 6 tests.
- No regressions.
- Manual QA (the optional, plan-scheduled runtime confirmation of the 3 UX symptoms) cannot run in CI/jsdom and remains as follow-up.

**T3 acceptance criteria:**
- [x] `npm run typecheck -w frontend` exits 0.
- [x] `npm run test -w frontend` exits 0 (all suites green).
- [x] All 5 consumer-mock suites confirmed green.
- [x] No regressions.

---

## Acceptance-Criteria Mapping

(From the plan's Acceptance Criteria section.)

- **(a) Clicking inside the editor does NOT toggle/visibly flinch the Bold button** — CODE-LEVEL MET (setData no longer reachable on the controlled echo via the effect `:248` guard AND the wrapper path neutralized via frozen data prop `:266`; both verified by reachability analysis). RUNTIME confirmation pending optional manual QA.
- **(b) The Bold button's active state reflects ONLY the actual current selection's formatting** — CODE-LEVEL MET (a downstream consequence of (a): no spurious setData means no spurious `writer.setSelection(null)`, so the Bold command's `isActive` is no longer recomputed against a reset selection). RUNTIME confirmation pending optional manual QA.
- **(c) Double-click to select a word does NOT trigger bold** — CODE-LEVEL MET (same root-cause elimination as (a)/(b): the in-progress word selection is no longer wiped by a spurious setData). RUNTIME confirmation pending optional manual QA.
- **All existing RichTextEditor tests + the five consumer-mock suites pass; typecheck clean** — MET (automated).

---

## Notes & Caveats

### Test-discrimination limitation (flag prominently)

All three new tests (T2) would ALSO PASS against the OLD code in this mock environment. The mock's `getData()` returns `el.innerHTML` verbatim (`:63`) with NO CKEditor HTML normalization. Normalization drift is exactly the real-world mechanism that defeated the OLD trim-guard (`editor.getData().trim() === value.trim()`); it cannot be reproduced in jsdom. For exact-string echoes (tests 1 & 3), the old trim-guard ALSO skips setData. For test 2 (genuine change), the old guard ALSO calls setData correctly. Therefore:

- **Tests 1 & 3 are behavior locks** (they pin the post-fix contract and would catch a future regression that re-introduces unconditional/redundant setData), NOT regression-catchers for THIS bug.
- **Test 2 is a regression-preservation test** (genuine external changes still update), not a flinch-catcher.

This is the documented, accepted limitation the plan/tasks already disclose ("jsdom cannot reproduce the real `change:data` feedback loop"). The spy machinery itself (`vi.hoisted`, `setData as Mock`, baseline-delta idiom) is correct and sound; only the bug's reproduction is bounded by the environment. The TRUE verification that `setData` is unreachable on the echo comes from the CODE-LEVEL reachability analysis (T1), not from these tests.

### Manual QA pending

The three UX acceptance criteria (click-no-flinch, Bold-active-matches-selection, double-click-no-bold) are runtime behaviors that automated jsdom tests CANNOT reproduce — the mock returns `el.innerHTML` verbatim with no CKEditor HTML normalization, which is precisely the real-world mechanism that defeated the old guard. Runtime confirmation of the 3 UX symptoms still requires the optional manual QA the plan already schedules. These are documented & accepted limitations, NOT implementation gaps.

---

## Regression Assessment

**LOW regression risk.** Blast radius is exactly 2 files (confirmed via `git show 6a9ce98 --stat` and `--name-only`). No config/toolbar/plugin, no prop contract, no DescriptionField wiring, no lockfile/package.json touched. The fix is purely additive ref-based echo detection plus a frozen initial-data prop; the pre-existing `applyingExternalData` loop-guard is preserved. The only behavioral change is: `setData` is now skipped on the exact-string echo and on every re-render (was: called whenever CKEditor normalization made `getData()` differ from `value`). Genuine external changes (load a different ticket, form reset, programmatic reset) still call `setData` — covered by the onReady gap-closer (`:272-276`) and the guarded effect (`:248-252`), and asserted by test `:221`. Five consumer suites are structurally insulated (named-export mocks). Known low-probability edge (genuine external value arriving between mount and onReady) is explicitly handled by the onReady gap-closer.

---

## Summary

The rte-bold-flinch bugfix (commit `6a9ce98`) is **PASS-WITH-NOTES**: all three tasks are fully implemented, every automated gate is green (typecheck clean, full frontend suite 119 files / 1053 tests passing, and all five consumer-mock suites green at 78/78), every explicit exclusion is honored, and the blast radius is confirmed at exactly two files. The root cause — spurious `editor.setData()` on the controlled round-trip echo — is eliminated at the code level via the `lastEmittedDataRef` guard on the sync effect (`RichTextEditor.tsx:248`) and neutralization of the wrapper's own reconciliation path via the frozen `data={initialDataRef.current}` prop (`:266`), verified by an exhaustive reachability analysis showing `setData()` is no longer reachable during active editing or on the echo. The notes are environmental, not gaps: the three new tests are sound behavior-locks but cannot reproduce this specific regression in jsdom (no CKEditor HTML normalization), and the three runtime UX symptoms therefore require the optional, plan-scheduled manual QA for final confirmation.
