# Implementation Plan — Fix: RichTextEditor Bold-button flinch / double-click-triggers-bold
**Ticket:** `docs/bugfix/rte-bold-flinch/rte-bold-flinch-plan.md`
**Type:** Bug
**Title:** Fix: RichTextEditor Bold-button flinch / double-click-triggers-bold (controlled-value sync round-trip)
**Generated:** 2026-07-04

---

## Summary
The Bold toolbar button flinches on click and double-click word-selection spuriously toggles bold because CKEditor's `editor.setData()` is being invoked during active editing. `setData()` rebuilds the model and explicitly clears the selection (`writer.setSelection(null)`), which forces the Bold command to recompute its active state against a reset/collapsed selection and destroys an in-progress word selection. The spurious `setData()` originates in RichTextEditor's controlled-value sync `useEffect`, whose guard compares the incoming `value` prop against the editor's *live* `getData()` (fragile under CKEditor HTML normalization), so the round-trip echo from react-hook-form (`watch`→`setValue`→`value`) defeats the guard and reloads the model. The fix breaks the round-trip at the source: track the data the editor *last emitted* in a ref and only call `setData()` when the incoming `value` is a genuine external change. Defense-in-depth freezes the `data` prop so the `@ckeditor/ckeditor5-react` wrapper's own reconciliation `setData` cannot fire post-mount.

## Root Cause
### Primary: fragile guard in the controlled-value sync effect
`frontend/src/components/RichTextEditor.tsx:229-237` — the effect that syncs the external `value` into the editor:
```tsx
useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const current = editor.getData().trim();
    if (current === value.trim()) return;   // <-- fragile guard
    applyingExternalData.current = true;
    editor.setData(value);                   // <-- reloads model, resets selection
    applyingExternalData.current = false;
}, [value]);
```
- The guard at `RichTextEditor.tsx:232-233` compares the editor's *current* `getData()` to the incoming `value`. This is the wrong comparison: it should compare `value` to what the editor *last emitted*, not to the live model. When the incoming `value` is just the echo of the editor's own prior emission (the controlled round-trip), they can still mismatch because CKEditor normalizes HTML on `getData()`.

### Why setData resets the selection (the flinch mechanism)
`node_modules/@ckeditor/ckeditor5-engine/dist/index.js:22410-22438` — `DataController.set()`:
```js
this.model.enqueueChange(options.batchType || {}, (writer) => {
    writer.setSelection(null);                                                       // :22430
    writer.removeSelectionAttribute(this.model.document.selection.getAttributeKeys());// :22431
    for (const rootName of Object.keys(newData)) {
        const modelRoot = this.model.document.getRoot(rootName);
        writer.remove(writer.createRangeIn(modelRoot));
        writer.insert(this.parse(newData[rootName], modelRoot), modelRoot, 0);
    }
});
```
Every `setData()` explicitly nulls the selection and strips selection attributes, then rebuilds the root. The user's caret/selection is destroyed on each call. The Bold command re-derives `isActive` against the reset selection → the toolbar button's pressed state flinches; a word selection in progress is wiped → double-click appears to "trigger bold" and a subsequent single click toggles it. This explains all three reported symptoms.

### getData() normalizes HTML (why the guard fails)
`node_modules/@ckeditor/ckeditor5-engine/dist/index.js`:
- `BasicHtmlWriter.getHtml()` at `:22019-22027` serializes via the browser's `innerHTML` → attribute order, casing, quote style, void-tag form (`<br>` not `<br/>`) are browser-controlled.
- `ViewDomConverter._processDataFromViewText` at `:9362-9388` converts leading/trailing/double spaces to `\xA0` (`&nbsp;`).
- `DataController.get` defaults `trim:"empty"` at `:22244`.

Net: `editor.getData().trim()` and an externally-supplied `value.trim()` routinely differ even when semantically identical.

### The round-trip loop (amplifier)
`frontend/src/components/ticket-fields/DescriptionField.tsx`:
- `:34` `const descriptionValue = watch('description') ?? '';`
- `:97` `<RichTextEditor value={descriptionValue} ...>`
- `:100-101` `onChange={(html) => setValue('description', html)}`

Loop: editor `onChange` → `setValue('description', html)` → RHF notifies `watch` → `value` prop changes → the sync `useEffect([value])` and the wrapper reconciliation both re-evaluate on every edit. No debounce anywhere in the chain.

### onChange handler & its (insufficient) guard
`RichTextEditor.tsx:255-258`:
```tsx
onChange={(_event, editor) => {
    if (applyingExternalData.current) return;
    onChange(editor.getData());
}}
```
`applyingExternalData` (`RichTextEditor.tsx:131`, toggled at `:234-236`) only suppresses the synchronous re-emit from this component's *own* `setData`. It does not prevent the selection reset, and it does not address the guard fragility.

### Second, wrapper-owned setData path (defense-in-depth target)
`node_modules/@ckeditor/ckeditor5-react/dist/index.js` (v11.2.0):
- `:562-590` `shouldComponentUpdate` → `editorSemaphore.runAfterMount(({ instance }) => { if (shouldUpdateEditorData(props, nextProps, instance)) { instance.data.set(nextProps.data); } })` (the `instance.data.set` call is at `:587`).
- `:827-835` `shouldUpdateEditorData` returns `false` only if `prevProps.data === nextProps.data` OR `editor.data.get() === nextProps.data` (raw compare, no trim).
- The component passes `data={value}` (`RichTextEditor.tsx:243`), so the wrapper re-evaluates this on every re-render; its guard can also be defeated by normalization/drift and is entirely outside the author's `applyingExternalData` guard.
- `:757-760` and `:1162` confirm the wrapper fires the consumer `onChange` ONLY on `modelDocument.on('change:data', …)` — i.e. selection-only changes do NOT emit onChange (so a pure cursor click does not itself emit; the damage comes from `setData` resetting the selection).

### Versions
`@ckeditor/ckeditor5-react@11.2.0`, `ckeditor5@48.3.0`, `@ckeditor/ckeditor5-engine@48.3.0` (declared `^11.2.0` / `^48.3.0` in `frontend/package.json`; `@ckeditor/*` packages are hoisted to the repo-root `node_modules/`).

## Affected Components
| Layer | File | Why |
|-------|------|-----|
| Component | `frontend/src/components/RichTextEditor.tsx` | Primary fix site (~262 lines): the controlled-value sync `useEffect` (`:229-237`), the `onChange` handler (`:255-258`), the `editorRef` (`:126`) / `applyingExternalData` (`:131`) refs, the `onReady` (`:252-254`), and the `<CKEditor data={value}>` prop (`:243`). |
| Test | `frontend/src/components/RichTextEditor.test.tsx` | Co-located tests + the CKEditor mock factory (`:23-96`); mock enhancement to expose a `setData` spy + editor holder. |
| Consumer (no change required) | `frontend/src/components/ticket-fields/DescriptionField.tsx` | The round-trip wiring is correct; the fix lives in RichTextEditor. |

## Proposed Implementation
### Component Changes
#### Change 1 (CORE FIX) — Track last-emitted data; guard the sync effect against the round-trip echo
- **File:** `frontend/src/components/RichTextEditor.tsx`
- **What:** Add a ref that records the exact data string the editor last emitted to the parent. In the sync effect, compare the incoming `value` against this ref (exact string equality — robust, because we store the precise string that was emitted), not against the live `getData()`. Only call `setData()` on a genuine external change.
- **Why:** The current guard compares against `getData()`, which is defeated by CKEditor HTML normalization on the controlled round-trip, causing spurious `setData()` that resets the selection.
- **Code reference:** `RichTextEditor.tsx:229-237`, ref block near `RichTextEditor.tsx:~131`

Add near the existing refs (`RichTextEditor.tsx:~131`):
```tsx
// Tracks the exact data the editor last emitted to the parent. Used to detect
// the controlled round-trip echo (parent setValue -> watch -> value) so we do
// NOT call setData() for content the editor itself just produced. Initialized
// to the initial value so the very first render does not redundantly setData.
const lastEmittedDataRef = useRef<string>(value);
```

BEFORE — sync effect (`RichTextEditor.tsx:229-237`):
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

#### Change 2 (CORE FIX) — Record the emit in onChange
- **File:** `frontend/src/components/RichTextEditor.tsx`
- **What:** Record the exact emitted string into `lastEmittedDataRef` so the parent's echo is recognized and the sync effect does not trigger `setData()`.
- **Why:** Without recording the emit, the round-trip echo cannot be detected by the guarded sync effect.
- **Code reference:** `RichTextEditor.tsx:255-258`

BEFORE — onChange (`RichTextEditor.tsx:255-258`):
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

#### Change 3 (DEFENSE-IN-DEPTH) — Freeze the `data` prop to neutralize the wrapper's own setData reconciliation
- **File:** `frontend/src/components/RichTextEditor.tsx`
- **What:** Add a ref capturing the initial value once and pass `initialDataRef.current` to the wrapper's `data` prop. This is transparent to the test mock (the mock seeds `data` only on mount and never reconciles), so it carries no test risk.
- **Why:** The `@ckeditor/ckeditor5-react` wrapper reconciles data on every re-render via `shouldUpdateEditorData` (`dist/index.js:562-590`, `827-835`), calling `instance.data.set(nextProps.data)` on any prop change it deems different — a SECOND `setData` path that is outside the `applyingExternalData` guard. By freezing the prop, the wrapper only seeds initial data on mount and never re-pushes; the sync effect becomes the single `setData` authority.
- **Code reference:** `RichTextEditor.tsx:243`

Add a ref capturing the initial value once:
```tsx
// Freeze the data seed passed to <CKEditor> at the initial value. The
// @ckeditor/ckeditor5-react wrapper reconciles data on every re-render via
// shouldUpdateEditorData (dist/index.js:562-590, 827-835), calling
// instance.data.set(nextProps.data) on any prop change it deems different —
// a SECOND setData path that is outside our applyingExternalData guard. By
// freezing the prop, the wrapper only seeds initial data on mount and never
// re-pushes; the sync effect above becomes the single setData authority.
const initialDataRef = useRef<string>(value);
```

BEFORE (`RichTextEditor.tsx:243`):
```tsx
<CKEditor editor={ClassicEditor} data={value} config={config} onReady={...} onChange={...} />
```

AFTER:
```tsx
<CKEditor editor={ClassicEditor} data={initialDataRef.current} config={config} onReady={...} onChange={...} />
```

NOTE: this is transparent to the test mock (the mock seeds `data` only on mount and never reconciles — see Testing), so it carries no test risk.

#### Change 4 (optional robustness — evaluate) — Sync in onReady if a genuine external value arrived before the editor was ready
- **File:** `frontend/src/components/RichTextEditor.tsx`
- **What:** If `value` legitimately changed between mount and `onReady` (editor not yet in `editorRef`), the effect bailed with no editor and the change is currently lost until the next `value` change. Optionally cover it in `onReady`. Include only if it does not complicate review. Document the decision either way.
- **Why:** Closes a low-probability gap (value is stable at mount in this app).
- **Code reference:** `RichTextEditor.tsx:252-254` (`onReady`)

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

### Test Changes
#### Mock enhancement (to assert setData was NOT called)
- **File:** `frontend/src/components/RichTextEditor.test.tsx`
- **What:** Today there is NO `setData` spy and the editor instance is never exposed to tests (`RichTextEditor` does not forward `onReady` to consumers). To assert "`setData` was not called", enhance the mock factory (`:23-96`):
  1. Use `vi.hoisted` to create a shared holder, e.g. `{ currentEditor: null as EditorLike | null }`.
  2. In the mock, wrap `setData` in `vi.fn((v) => { el.innerHTML = v; })`.
  3. When building the editor, assign it to the holder: `currentEditor.current = editor;` (in addition to `onReady?.(editor)`).
  Tests then read `currentEditor.current!.setData` (a `vi.fn`) and assert call counts. Because the holder is assigned in the mock's mount `useEffect`, tests must `await waitFor(() => expect(currentEditor.current).not.toBeNull())` before asserting.
- **Why:** Required to verify the core assertion that `setData` is not called on the round-trip echo.
- **Code reference:** `RichTextEditor.test.tsx:23-96`, `:66-70` (getData/setData bodies), `:70` (onReady call), `:83-90` (onChange on input)

#### Tests to add (lock in the fix)
1. **Round-trip guard (the core assertion):** render with `value="<p>first</p>"`; wait for editor ready; simulate an edit via `fireEvent.input` so `onChange` fires and the parent's `onChange` callback (a test spy) records the emitted HTML; then `rerender` with that SAME emitted HTML as `value`; assert `currentEditor.current.setData` was NOT called again after the initial mount (use `setData.mock.calls.length` captured before/after, or `toHaveBeenCalledTimes(0)` relative to the post-mount baseline).
2. **Genuine external change still updates:** render with `value="<p>first</p>"`; `rerender` with `value="<p>second</p>"` (different from anything emitted); assert `setData` WAS called with `"<p>second</p>"` and the editable's textContent becomes `"second"`.
3. **No redundant setData during editing:** simulate several `fireEvent.input` edits, each time re-rendering with the echoed value; assert `setData` is not invoked beyond the genuine-change baseline (only the parent `onChange` spy fires).
4. **Existing tests must still pass** — especially "syncs an external value change into the editor (and does not loop)" (`:157-176`), which today asserts only via `editable.textContent` after `rerender`. Confirm it still passes with the new guard (genuine `<p>first</p>` → `<p>second</p>` change updates; identical `<p>second</p>` re-render does not throw `Maximum update depth exceeded` and leaves textContent `"second"`).

#### How to assert "setData not called" given the mock
Capture `setData` as a `vi.fn` via the enhanced mock's holder. Establish a baseline `const callsBefore = editor.setData.mock.calls.length;` (after mount ready), perform the action (rerender with echoed value), then `expect(editor.setData.mock.calls.length).toBe(callsBefore);`. For the absolute "never called after mount" variant, snapshot `mock.calls.length` right after the `waitFor` ready check.

## Do NOT Change (explicit exclusions)
- Do NOT touch the CKEditor toolbar config, the Bold command definition, or any CKEditor plugin config (the `config` object with toolbar items). The bug is in the controlled-value sync, not the Bold button.
- Do NOT change the exported `RichTextEditor` prop contract `{ value, onChange, placeholder? }` or its export shape — five consumer test files mock this component and depend on that contract.
- Do NOT change `DescriptionField.tsx` wiring (the round-trip via RHF `watch`/`setValue` is correct).
- Do NOT switch package manager — npm ONLY (never pnpm/yarn/bun).
- Do NOT add debouncing to the round-trip as a "fix" — it masks, not fixes, the guard defect.
- Do NOT introduce a focus-based "skip setData while editing" gate as the PRIMARY mechanism (evaluated and rejected: too blunt — it can block legitimate external resets while focused; the `lastEmittedDataRef` guard + frozen data prop already cover the cases without guessing focus state). It may be mentioned as a rejected alternative.

## Edge Cases & Risks
- Genuine external change (load a different ticket, form reset, programmatic reset): `value !== lastEmittedDataRef.current` → `setData()` fires and the editor updates. Correct.
- Round-trip echo (parent hands back exactly what `onChange` emitted): `value === lastEmittedDataRef.current` → skip. Correct.
- Mount: `lastEmittedDataRef` initialized to the initial `value`, so the first effect run is a no-op (editor was seeded by the wrapper via the frozen `data` prop). No redundant mount `setData`. Correct.
- Normalization mismatch on a genuine external value (e.g. backend HTML that differs from `getData()`): `value !== lastEmittedDataRef.current` → `setData()` fires once, then `lastEmittedDataRef = value`, so subsequent re-renders with the same `value` do not re-fire. The editor is no longer "poisoned" into re-firing on every render.
- Known low-probability gap: a genuine external `value` change arriving in the window between mount and `onReady` (effect bails, no editor) is not applied until the next `value` change. Mitigate with Change 4 if desired.

### Regression notes
- Five consumer test files mock `RichTextEditor` as a plain `<textarea aria-label="Description">` and are immune to internal changes as long as the `{ value, onChange, placeholder? }` prop contract and export shape are preserved:
  - `frontend/src/components/TicketDetailModal.test.tsx:13-19` (spec `'./RichTextEditor'`)
  - `frontend/src/components/TicketAttributeForm.test.tsx:4-10` (spec `'./RichTextEditor'`)
  - `frontend/src/components/NewTicketButton.test.tsx:4-10` (spec `'./RichTextEditor'`)
  - `frontend/src/components/CreateTicketModal.test.tsx:4-10` (spec `'./RichTextEditor'`)
  - `frontend/src/components/ticket-fields/DescriptionField.test.tsx:23-26` (spec `'@/components/RichTextEditor'` — alias; NOTE this mock renders `readOnly` with no `onChange`)
- The only real consumer of the genuine component is `frontend/src/components/ticket-fields/DescriptionField.tsx:5,86`.
- The mock enhancement (setData spy + editor holder) MUST NOT break the 6 existing RichTextEditor tests — keep `getData`/`setData` behavior identical (just wrap `setData` in `vi.fn` with the same body) and keep firing `onChange` on `input`.
- No `__mocks__` directories exist; all mocking is inline `vi.mock(...)`.
- Risk of the frozen `data` prop (Change 3): none in tests (mock ignores `data` after mount); in production it only removes a redundant reconciliation path now fully covered by the guarded sync effect.

## Testing
- Stack: Vitest + Testing Library.
- CKEditor is mocked via `vi.mock('@ckeditor/ckeditor5-react', …)` (`:23-96`). The mock builds a fake editor whose `getData` returns `el.innerHTML` and whose `setData` writes `el.innerHTML` (plain functions, NOT spies — `:66-70`), fires `onChange` on `input` only (`:83-90`, mirroring real `change:data`), and calls `onReady` once on mount (`:70`). The mock's `setData` does NOT re-emit `input`/`onChange`, so the real `change:data` feedback loop the `applyingExternalData` guard defends cannot be reproduced in jsdom — loop-prevention tests are necessarily indirect.
- Co-locate `*.test.tsx` next to source (`frontend/src/components/RichTextEditor.test.tsx`).

### Verification commands (implementer must run)
- `npm run test -w frontend` (full frontend Vitest suite)
- `npm run typecheck -w frontend` (tsc --noEmit)
- Focused: `npm run test -w frontend -- RichTextEditor`
- Manual QA (confirm acceptance criteria): load a ticket whose description has bold/formatted text; single-click at various cursor positions (Bold must not flinch); double-click a word to select it (Bold must not toggle, and its pressed state must match whether the selected word is actually bold); toggle Bold via the button on a selection and verify it applies/removes correctly.

## Acceptance Criteria
- [ ] Clicking inside the editor does NOT toggle / visibly flinch the Bold button.
- [ ] The Bold button's active state reflects ONLY the actual current selection's formatting.
- [ ] Double-click to select a word does NOT trigger bold.
- [ ] All existing RichTextEditor tests and the five consumer-mock suites pass; typecheck is clean.

## Out of Scope
- Refactoring the RHF wiring in DescriptionField.
- Replacing/upgrading CKEditor or the React wrapper.
- Changing toolbar/Bold/plugin configuration.
- Adding debounce/throttle to the value pipeline.

## Open Questions
1. Apply Change 4 (onReady sync for the mount-to-ready window) or treat as an accepted low-probability edge case? (Recommendation: include only if trivial and review-friendly; otherwise document as a known, low-probability gap.)
2. Confirm during manual QA that no residual flinch remains after Change 1+2; if any remains, Change 3 (frozen `data` prop) is the intended backstop for the wrapper path.
