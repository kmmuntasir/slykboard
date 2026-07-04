# Task Breakdown — rte-bold-flinch
**Plan:** `docs/bugfix/rte-bold-flinch/rte-bold-flinch-plan.md`
**Generated:** 2026-07-04

---

## CRITICAL GIT POLICY
**Breakdown phase only. Do NOT create branches. Do NOT run `git checkout -b`. Do NOT commit or push.** Implementation tasks (T1, T2) edit files only; the verification task (T3) runs tests only.

## Summary
3 tasks across 3 sequential batches on a single developer track. Two files are edited (`frontend/src/components/RichTextEditor.tsx`, `frontend/src/components/RichTextEditor.test.tsx`) plus one verification-only task that runs the full frontend gate. This is a small, scoped bugfix (controlled-value sync echo guard) and is intentionally not over-fragmented.

## DO NOT CHANGE (global exclusions — applies to every task)
- Do NOT touch the CKEditor toolbar config, the Bold command definition, or any CKEditor plugin config (the `config` object). The bug is in controlled-value sync, not the Bold button.
- Do NOT change the exported `RichTextEditor` prop contract `{ value, onChange, placeholder? }` or its export shape (named export). Five consumer test files depend on it.
- Do NOT change `frontend/src/components/ticket-fields/DescriptionField.tsx` wiring (the react-hook-form `watch`/`setValue` round-trip is correct — the fix lives in RichTextEditor).
- Do NOT switch package manager — **npm ONLY** (never pnpm/yarn/bun).
- Do NOT add debouncing/throttling to the round-trip as a "fix".
- Do NOT introduce a focus-based "skip setData while editing" gate as the primary mechanism.

---

## Parallelization Strategy

Single-track sequential pipeline: each batch has exactly one task, and each task depends on the previous one. No parallelization.

### Batch / Dependency Diagram
```
Batch 1: [T1] ──> Batch 2: [T2] ──> Batch 3: [T3]
```

### Merge-order rules
- Merge in strict batch order: T1 → T2 → T3.
- (Single-track; no within-batch ordering decisions.)

### Summary
| # | Batch | Target File | Dependencies | Can Parallel With |
|---|-------|-------------|--------------|-------------------|
| T1 | 1 | `frontend/src/components/RichTextEditor.tsx` | None | — |
| T2 | 2 | `frontend/src/components/RichTextEditor.test.tsx` | T1 | — |
| T3 | 3 | — (verification only) | T1, T2 | — |

### Suggested developer tracks
- **Track A (sole):** T1 → T2 → T3

---

## Tasks

### T1 — Core component fix: echo-guarded controlled-value sync
**Description:** Edit `frontend/src/components/RichTextEditor.tsx` ONLY (named export at line 123; props `RichTextEditorProps` lines 23-27 / 37-40 must stay unchanged). Implement 4 core changes plus 1 optional subtask from the plan.

**(a) Add two refs** near the existing refs, after `applyingExternalData` (line 131 — the existing change:data loop guard, which MUST be preserved unchanged):
```tsx
// Tracks the exact data the editor last emitted to the parent. Used to detect
// the controlled round-trip echo (parent setValue -> watch -> value) so we do
// NOT call setData() for content the editor itself just produced. Initialized
// to the initial value so the very first render does not redundantly setData.
const lastEmittedDataRef = useRef<string>(value);
// Freeze the data seed passed to <CKEditor> at the initial value. The
// @ckeditor/ckeditor5-react wrapper reconciles data on every re-render via
// shouldUpdateEditorData (calls instance.data.set(nextProps.data)) — a SECOND
// setData path outside our applyingExternalData guard. Freezing the prop makes
// the sync effect below the single setData authority.
const initialDataRef = useRef<string>(value);
```

**(b) Rewrite the sync effect** (currently lines 229-237). BEFORE (quote verbatim):
```tsx
useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const current = editor.getData().trim();
    if (current === value.trim()) return;
    applyingExternalData.current = true;
    editor.setData(value);
    applyingExternalData.current = false;
}, [value]);
```
AFTER:
```tsx
useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    // Only push GENUINE EXTERNAL changes (loaded ticket, programmatic/form reset).
    // Skip when `value` is just the echo of what this editor last emitted via
    // onChange — otherwise setData() reloads the model and resets the selection,
    // which flinches the toolbar and disrupts an in-progress selection.
    if (value === lastEmittedDataRef.current) return;
    applyingExternalData.current = true;
    editor.setData(value);
    applyingExternalData.current = false;
    lastEmittedDataRef.current = value;
}, [value]);
```
Key switch: comparison target changes from `editor.getData().trim()` (live, CKEditor-normalized, fragile) to `lastEmittedDataRef.current` (exact emitted string). The ref is updated after each setData.

**(c) Record the emit in onChange** (currently lines 255-258). BEFORE (quote verbatim):
```tsx
onChange={(_event, editor) => {
    if (applyingExternalData.current) return;
    onChange(editor.getData());
}}
```
AFTER:
```tsx
onChange={(_event, editor) => {
    if (applyingExternalData.current) return;
    const html = editor.getData();
    // Record the exact emitted string so the parent's echo (value === html)
    // is recognized by the sync effect and does NOT trigger setData().
    lastEmittedDataRef.current = html;
    onChange(html);
}}
```

**(d) Freeze the `data` prop** (currently line 250): change `data={value}` → `data={initialDataRef.current}`.

> **DO NOT CHANGE:** config object, Bold command, CKEditor plugin config, exported prop contract `{ value, onChange, placeholder? }`, named export shape, `DescriptionField.tsx` wiring, package manager (npm only). Do NOT add debouncing/throttling. Do NOT introduce a focus-based gate. Preserve the existing `applyingExternalData` loop guard unchanged.

**Acceptance criteria:**
- [ ] Both refs (`lastEmittedDataRef`, `initialDataRef`) added and initialized to `value`.
- [ ] Sync effect guards on `value === lastEmittedDataRef.current` and updates the ref after `setData`.
- [ ] `onChange` records emitted HTML into `lastEmittedDataRef.current` before calling the parent `onChange`.
- [ ] `<CKEditor data={...}>` uses `initialDataRef.current` (frozen).
- [ ] (If included) `onReady` applies a genuine external value that arrived pre-ready.
- [ ] Public props contract `{ value, onChange, placeholder? }` and named export are UNCHANGED.
- [ ] `npm run typecheck -w frontend` is clean.
- [ ] `npm run test -w frontend -- src/components/RichTextEditor.test.tsx` — the 6 existing tests still pass (the genuine-change sync test at :157 still passes since `<p>first</p>`→`<p>second</p>` is a real external change).

**Dependencies:** None
**Subtasks:**
- (a) Add `lastEmittedDataRef` and `initialDataRef` refs.
- (b) Rewrite sync effect to guard on `lastEmittedDataRef.current`.
- (c) Record emit in `onChange`.
- (d) Freeze `<CKEditor data={initialDataRef.current}>`.
- **(e) [OPTIONAL / REVIEW] onReady gap-closer** (currently lines 252-254). Recommended AFTER:
  ```tsx
  onReady={(editor) => {
      editorRef.current = editor;
      if (value !== lastEmittedDataRef.current) {
          applyingExternalData.current = true;
          editor.setData(value);
          applyingExternalData.current = false;
          lastEmittedDataRef.current = value;
      }
  }}
  ```
  Include it. If a reviewer prefers to omit it, the documented low-probability gap is: a genuine external value arriving between mount and `onReady` would not be applied.

**Verify commands:** `npm run typecheck -w frontend` · `npm run test -w frontend -- src/components/RichTextEditor.test.tsx`

---

### T2 — Co-located test: setData spy + 3 new echo-guard assertions
**Description:** Edit `frontend/src/components/RichTextEditor.test.tsx` ONLY. The file imports `describe, it, expect, vi` from vitest; `render, screen, fireEvent` from @testing-library/react; `RichTextEditor, isValidImageUrl` from `./RichTextEditor`. The existing `vi.mock('@ckeditor/ckeditor5-react', ...)` is at line 22 (async factory, hoisted). Factory body lines 22-96: `EditorLike` interface (`getData(): string`, `setData(value: string): void`) at :25-28; `MockCKEditorProps` (`config?`, `data?`, `onChange?`, `onReady?`) at :30-38; mock `CKEditor` at :40-97 uses local `editableRef` + `editorRef` (NOT exposed via any holder), a mount-only `useEffect` (:47-59) that builds a fake `editor` whose getData/setData read/write `el.innerHTML`, calls `onReady?.(editor)` once; renders a `role="toolbar"` (aria-label="Formatting") with one `<button aria-label={item}>` per toolbar item, and a `contentEditable[data-testid="ck-editable"]` whose `onInput` calls `onChange?.({}, editor)`.

**(a) Mock enhancement** (REQUIRED to assert "setData was NOT called"):
1. Add a `vi.hoisted` shared holder near the top of the factory/file:
   ```tsx
   const { currentEditor } = vi.hoisted(() => ({ currentEditor: null as null | { getData(): string; setData(v: string): void } }));
   ```
2. In the mock, wrap `setData` in `vi.fn` keeping the SAME body:
   ```tsx
   setData: vi.fn((v: string) => { el.innerHTML = v; }),
   ```
3. In the mount-only effect (lines 47-59), assign the editor to the holder alongside `onReady?.(editor)`:
   ```tsx
   currentEditor.current = editor;
   onReady?.(editor);
   ```

**CONSTRAINT (flag prominently):** the enhancement MUST NOT break the 6 existing tests — keep `getData`/`setData` behavior identical (same body, just wrapped in `vi.fn`), and keep firing `onChange` on `input`. The mock's `setData` does NOT re-emit `input`/`onChange` (jsdom cannot reproduce the real `change:data` feedback loop the `applyingExternalData` guard defends), so loop-prevention is asserted indirectly.

**Assertion idiom** to use in the new tests: after `await waitFor(() => expect(currentEditor.current).not.toBeNull())`, capture a baseline `const callsBefore = currentEditor.current.setData.mock.calls.length;`, perform the action, then assert on `currentEditor.current.setData.mock.calls.length`.

**(b) Add 3 new test cases** inside `describe('RichTextEditor')`:
1. **"does not call setData when the parent echoes the just-emitted value (round-trip guard)":** render `<RichTextEditor value="<p>first</p>" onChange={...} />`; wait for editor ready; capture baseline; `fireEvent.input` on the `ck-editable` so `onChange` fires and records the emitted HTML in `lastEmittedDataRef` (use a test spy `onChange` to capture the emitted string); `rerender(<RichTextEditor value={emittedHtml} onChange={...} />)`; assert `setData.mock.calls.length` is unchanged from baseline.
2. **"calls setData for a genuine external value change":** render `value="<p>first</p>"`; `rerender` with `value="<p>second</p>"`; assert `setData` WAS called with `"<p>second</p>"` and the editable's textContent becomes `"second"`.
3. **"does not call setData on repeated echoed re-renders during editing":** perform several `fireEvent.input` edits, re-rendering each time with the echoed value; assert `setData` is never invoked beyond the genuine-change baseline (only the parent `onChange` spy fires).

(Test case 4 from the plan — "existing tests still pass" — is a verification assertion, not a new test; ensure the existing `'syncs an external value change into the editor (and does not loop)'` test at :157 stays green.)

> **DO NOT CHANGE:** the 6 existing test cases (only the shared mock factory, and additive new tests). Do NOT change the export/prop contract assertions. Do NOT introduce a global CKEditor mock (keep it local — no leak into consumer suites). npm only.

**Acceptance criteria:**
- [ ] `vi.hoisted` holder exists and exposes `setData` as a `vi.fn`.
- [ ] The mount effect assigns `currentEditor.current = editor`.
- [ ] The 6 existing tests STILL pass (no behavioral change to getData/setData/input).
- [ ] The 3 new tests pass and assert via `setData.mock.calls.length`.
- [ ] `npm run test -w frontend -- src/components/RichTextEditor.test.tsx` is fully green.

**Dependencies:** T1 (the new test cases assert T1's guarded behavior; the mock enhancement is independent but lives in the same file as the cases)
**Verify command:** `npm run test -w frontend -- src/components/RichTextEditor.test.tsx`

---

### T3 — Verification: full frontend suite + typecheck + consumer-mock regression
**Description:** Verification only — NO file edits. Run the full frontend verification gate and confirm no regressions across the co-located suite and the five consumer-mock suites (which mock RichTextEditor by named export as a `<textarea aria-label="Description">` keyed on `{ value, onChange }` — immune to internals if T1 preserved the contract).
- Run `npm run typecheck -w frontend` — must be clean (0 errors).
- Run `npm run test -w frontend` — must be fully green.
- Explicitly confirm these five consumer-mock suites pass:
  - `frontend/src/components/TicketDetailModal.test.tsx`
  - `frontend/src/components/TicketAttributeForm.test.tsx`
  - `frontend/src/components/CreateTicketModal.test.tsx`
  - `frontend/src/components/NewTicketButton.test.tsx`
  - `frontend/src/components/ticket-fields/DescriptionField.test.tsx`
- **Manual QA (optional / follow-up — cannot run in CI):** load a ticket whose description has bold/formatted text; single-click at various cursor positions (Bold must not flinch); double-click a word to select it (Bold must not toggle, and pressed state must match actual formatting); toggle Bold via the button on a selection (applies/removes correctly).

> **DO NOT CHANGE:** do NOT edit any files in this task. Do NOT commit/push. Do NOT create branches.

**Acceptance criteria:**
- [ ] `npm run typecheck -w frontend` exits 0.
- [ ] `npm run test -w frontend` exits 0 (all suites green).
- [ ] All 5 consumer-mock suites confirmed green.
- [ ] No regressions.

**Dependencies:** T1, T2
**Verify commands:** `npm run typecheck -w frontend` · `npm run test -w frontend`
