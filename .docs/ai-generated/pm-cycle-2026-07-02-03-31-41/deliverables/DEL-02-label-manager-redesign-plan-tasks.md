# Task Breakdown — DEL-02 LabelManager Redesign

**Source plan:** `DEL-02-label-manager-redesign-plan.md` (same folder)
**Scope:** Frontend-only — a single-component render-layer rewrite + its co-located tests. No backend, schema, API, hook, or `LabelChip` contract change. No new npm dependency.
**Generated:** 2026-07-02

---

## Scope Reality (read first)

DEL-02 collapses to **two files** that live in the same folder:

| File | Role |
|------|------|
| `frontend/src/components/LabelManager.tsx` | The component rewrite (render layer) |
| `frontend/src/components/LabelManager.test.tsx` | The tests |

Because both deliverables are confined to these two disjoint files, the maximum *zero-conflict* parallelism is **two tasks across two batches**. The test task has a hard contract dependency on the component's final rendered structure (aria-labels, role names, mock surfaces), so it is sequenced after the component — not faked into the same batch.

**Codebase facts verified by Phase-1 analysis (informing every task):**

- All 15 touchpoint files in the plan **exist**. `react-colorful`, `lucide-react`, `@radix-ui/react-tooltip`, `@radix-ui/react-popover`, `vitest`, `@testing-library/react` are all present in `frontend/package.json`.
- `TooltipProvider` is **already mounted app-wide** at `frontend/src/main.tsx:30` (`delayDuration={300}`). The component must **not** add a second provider. Unit tests, however, must mount a local `TooltipProvider` (no app root in jsdom).
- **Two patterns in this redesign have ZERO prior art in the repo** (risk flags): (1) `group-hover`/`opacity-0` hover-reveal — no matches anywhere; (2) a `variant="ghost"` icon button (`icon + p-0`) — no precedent. Closest icon-button precedent is `frontend/src/components/MemberTable.tsx:147` (`Trash2` in a `destructive` button with `aria-label`).
- `ColorPicker` exists but is wired to **zero** consumers today — DEL-02 is its first wiring. It portals its popover to `document.body`, so the row's hover-reveal never affects it.
- The existing test `mockState` has **no `updateIsPending` field** — Task 2 must add it so the "Save disabled while pending" assertion is possible.
- Frozen data contract: `useCreateLabel`/`useUpdateLabel` `mutate` take object payloads; `useDeleteLabel.mutate` takes a **bare id string**. Toasts fire at the call site via the 2nd `mutate` arg `{ onSuccess }` (no toast inside the hooks).

---

## Parallelization Strategy

### Batches

- **Batch 1** — Task 1 (component). Can start immediately; depends only on already-shipped DEL-01 primitives. One file. Single owner.
- **Batch 2** — Task 2 (tests). Starts **after Task 1 merges** (asserts Task 1's rendered contract). One file. Single owner.

These two tasks are **never in the same batch**: although the files are disjoint, the test's input *is* the component's rendered output, so running them concurrently invites wasted rework on contract drift.

### Visual batch diagram

```
                 ┌─────────────────────────────┐
 DEL-01 primitives│  (already in repo)          │
 (ColorPicker,    │  read-only dependency       │
  Card, Button,   └──────────────┬──────────────┘
  TextInput,                     │
  Tooltip)                       ▼
                       ╔═══════════════════════╗
                       ║   BATCH 1   (parallel) ║
                       ║                       ║
                       ║   Task 1 — Component  ║   ← frontend/src/components/LabelManager.tsx
                       ║   rewrite LabelManager║
                       ╚═══════════╤═══════════╝
                                   │  merge Batch 1 first
                                   ▼
                       ╔═══════════════════════╗
                       ║   BATCH 2   (parallel) ║
                       ║                       ║
                       ║   Task 2 — Tests      ║   ← frontend/src/components/LabelManager.test.tsx
                       ║   extend LabelManager ║
                       ║   .test.tsx           ║
                       ╚═══════════╤═══════════╝
                                   │
                                   ▼
                              DEL-02 DONE
                       (manual QA / theme + a11y check)
```

### Merge-order rules

1. **Batch 1 merges before Batch 2 begins.** Task 2 branches from the merged Task 1 result so the test author codes against the *final* rendered structure, not a moving target.
2. Within a batch there is only one task, so intra-batch merge conflicts are impossible.
3. Both files are in the same directory but never edited by both tasks → no cross-task conflict.
4. After Batch 2 merges, run the **manual QA checklist** (light/dark theme, keyboard reachability, non-admin read-only note) from the plan's Testing section — this is verification, not a coded task.

### Summary table

| # | Batch | Target File | Dependencies | Can Parallel With |
|---|-------|-------------|--------------|-------------------|
| 1 | Batch 1 | `frontend/src/components/LabelManager.tsx` | None (DEL-01 primitives already shipped) | Nothing else in scope |
| 2 | Batch 2 | `frontend/src/components/LabelManager.test.tsx` | Task 1 | Nothing else in scope |

### Developer assignment tracks

This is a small, tightly-coupled deliverable, so the most efficient staffing is **two sequential tracks** (one developer can also run both end-to-end):

- **Track A — Component implementer:** Task 1 (Batch 1). Owns the render-layer rewrite. After merge, supports the test author on any contract questions.
- **Track B — Test author:** Task 2 (Batch 2), gated on Task 1 merge. Owns the test harness extension + all test cases.

A third reviewer/QA pass (manual theme + a11y verification per the plan's Testing section) runs after both tracks merge and is not a code task.

> **Why not 3+ tasks?** Every render-layer slice (create row, card list, inline edit, empty state, delete dialog) lives in the **same `return()` of the same file**. Splitting them across tasks would force multiple authors to edit one file in parallel → merge conflicts. They are therefore **subtasks of Task 1**, executed sequentially by one owner. The tests are the only genuinely separable, disjoint file → Task 2.

---

## Task 1 — Rewrite `LabelManager.tsx` render layer (create row + card list + inline edit + empty state)

**Batch:** 1
**Target file (only):** `frontend/src/components/LabelManager.tsx`
**Dependencies:** None (the DEL-01 `ColorPicker` and the other `ui/` primitives already exist and are consumed read-only)
**Plan reference:** steps 1–6 of `DEL-02-label-manager-redesign-plan.md`

### Description

Rewrite the **render layer** of `LabelManager.tsx` so it composes the shared `ui/` primitives and the DEL-01 `ColorPicker`, replaces the `<ul>` of drifting-width chips with a vertical stack of full-width `Card`s (so the action column aligns across rows), makes Edit/Delete hover/focus-revealed icon buttons wrapped in `Tooltip`, mirrors the create row for inline edit, and adds an empty state. The **data layer, props contract, and hook signatures are frozen** — only imports and JSX change.

Read the current file (`frontend/src/components/LabelManager.tsx`, ~189 lines) before coding.

#### What stays identical (do not touch)

- **Props:** `interface LabelManagerProps { projectSlug: string }` ONLY. Do **not** add `canManage`/`isAdmin` — gating lives in `frontend/src/pages/ProjectSettingsPage.tsx` (`renderLabels` returns a `<ReadOnlyNote>` for non-admins). Pushing gating into this component is out of scope.
- **Module constants:** `const DEFAULT_COLOR = '#6B7280';` and `const DELETE_DIALOG_TITLE_ID = 'confirm-delete-label-title';` — reuse the latter as the `ConfirmDialog` `titleId`.
- **Six `useState`** (keep all, same seeds): `newName` (`''`), `newColor` (`DEFAULT_COLOR`), `editingId` (`null`), `editName` (`''`), `editColor` (`''`), `confirmDeleteId` (`null`).
- **Handlers / data flow** (preserve exactly — only the render moves):
  - `handleCreate`: guard on `!newName.trim()`; `createMut.mutate({ name: newName.trim(), color: newColor }, { onSuccess: () => toast.success('Label created.') })`; then `setNewName('')` + `setNewColor(DEFAULT_COLOR)`.
  - `startEdit(id, name, color)`: `setEditingId(id)`, `setEditName(name)`, `setEditColor(color)`.
  - `saveEdit`: guard on `!editingId || !editName.trim()`; `updateMut.mutate({ labelId: editingId, dto: { name: editName.trim(), color: editColor } }, { onSuccess: () => toast.success('Label updated.') })`; then `setEditingId(null)`.
  - `handleConfirmDelete`: guard on `confirmDeleteId === null`; `deleteMut.mutate(confirmDeleteId, { onSuccess: () => toast.success('Label deleted.') })` (**bare string id, not an object**); then `setConfirmDeleteId(null)`.
- **`ConfirmDialog` usage** — reproduce verbatim (see subtask 6).

#### Imports — swap primitives (plan step 1)

- **Remove:** `HexColorPicker`, `HexColorInput` from `react-colorful`. Remove the static `<span aria-hidden style={{ backgroundColor }}>` swatch markup entirely.
- **Add:**
  - `import { ColorPicker } from './ui/ColorPicker';`
  - `import { Card } from './ui/Card';`
  - `import { Button } from './ui/Button';`
  - `import { TextInput } from './ui/TextInput';`
  - `import { Tooltip, TooltipTrigger, TooltipContent } from './ui/Tooltip';` — **NOT** `TooltipProvider`. It is already mounted app-wide at `frontend/src/main.tsx:30`; adding another provider is a double-provider bug.
  - `import { Pencil, Trash2, Tag } from 'lucide-react';`
- **Keep unchanged:** `useState`; `LabelChip` from `./LabelChip`; `ConfirmDialog` from `./ConfirmDialog`; `useLabels` from `@/hooks/useLabels`; `useCreateLabel`/`useUpdateLabel`/`useDeleteLabel` from `@/hooks/useLabelMutations`; `toast` from `@/hooks/useToast`; `Label`/`CreateLabelDto`/`UpdateLabelDto` types from `@/types/label`.

#### Frozen primitive contracts — code against these EXACTLY (do not invent props)

- **`ColorPicker`** (`components/ui/ColorPicker.tsx`, `forwardRef`): `{ value: string; onChange: (hex: string) => void; prefixed?: boolean; aria-label?: string; id?: string; className?: string; contentClassName?: string }`. `value` is `#RRGGBB`; `onChange` always emits `#RRGGBB`. **No `disabled` prop.** The swatch `<button>` **IS** the Radix Trigger (clickable) — this fixes the static-non-clickable-swatch bug. Default swatch `h-8 w-8`. Content portals to `document.body`.
- **`Card`** (`components/ui/Card.tsx`): `{ children; className? }`. **No default padding** (`bg-card border border-border rounded-lg`). **No** `CardHeader`/`CardBody`. Consumer adds `p-*`.
- **`Button`** (`components/ui/Button.tsx`, `forwardRef`, extends `ButtonHTMLAttributes`): `variant?: 'primary'|'secondary'|'ghost'|'destructive'|'destructive-outline'|'outline'` (default `'primary'`); `size?: 'sm'|'md'|'lg'` (default `'md'`); `type` defaults `'button'`. **No `'icon'` size.** `disabled:opacity-50 disabled:pointer-events-none` baked in. Compact square icon button = `<Button variant="ghost" size="sm" className="h-8 w-8 p-0">`.
- **`TextInput`** (`components/ui/TextInput.tsx`, `forwardRef`): identical API to raw `<input>` (controlled `value`/`onChange`); only adds focus-ring base classes.
- **`Tooltip`** (`components/ui/Tooltip.tsx`): **compound** exports — `Tooltip` (Radix Root), `TooltipTrigger` (supports `asChild`, `forwardRef`), `TooltipContent` (`forwardRef`; takes **children**, not a `content` prop). `TooltipProvider` is at app root — do not import it here.
- **`LabelChip`** (`components/LabelChip.tsx`): `{ label: Label; onRemove?: () => void }` — runtime hex via inline `style`. Do **not** change its props/output (shared by `TicketCard`, `LabelMultiSelect`).
- **`ConfirmDialog`** (`components/ConfirmDialog.tsx`): `{ isOpen; title; titleId (REQUIRED, unique); message?; confirmLabel?='Confirm'; cancelLabel?='Cancel'; variant?: 'default'|'destructive'; pending?=false; onConfirm; onCancel; blockBackdropClose?=true }`.

#### Render structure — build EXACTLY this (Task 2 asserts against it)

**Outer shell** — `<div className="space-y-4">` containing `<h2>Labels</h2>`, then the create row, then the list, then the `ConfirmDialog`.

**Create row (plan step 2):**

```jsx
<div className="flex items-center gap-2">
  <ColorPicker value={newColor} onChange={setNewColor} aria-label="New label color" />
  <TextInput value={newName} onChange={(e) => setNewName(e.target.value)}
    placeholder="Label name" aria-label="New label name" className="flex-1" />
  <Button onClick={handleCreate} disabled={!newName.trim() || createMut.isPending}>Add</Button>
</div>
```

**List (plan step 3):** if `labels.length === 0` render the empty state (below); else `<div className="space-y-2">` mapping each label:

- **Edited card** (`editingId === l.id`): `<Card key={l.id} className="p-3">` → edit row (plan step 4).
- **Read card:** `<Card key={l.id} className="group p-3">` → `<div className="flex items-center gap-3">` with:
  - left: `<LabelChip label={l} />`
  - right: `<div className="ml-auto flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">` containing two `Tooltip`-wrapped icon `Button`s:
    - **Edit:** `<Tooltip>` → `<TooltipTrigger asChild>` → `<Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={'Edit ' + l.name} onClick={() => startEdit(l.id, l.name, l.color)}>` with `<Pencil className="h-4 w-4" aria-hidden="true" />`; `<TooltipContent side="bottom">Edit</TooltipContent>`.
    - **Delete:** `<Tooltip>` → `<TooltipTrigger asChild>` → `<Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={'Delete ' + l.name} onClick={() => setConfirmDeleteId(l.id)}>` with `<Trash2 className="h-4 w-4" aria-hidden="true" />`; `<TooltipContent side="bottom">Delete</TooltipContent>`.

**Inline edit (plan step 4)** — inside the edited `Card`:

```jsx
<div className="flex items-center gap-2">
  <ColorPicker value={editColor} onChange={setEditColor} aria-label={'Edit color for ' + editName} />
  <TextInput value={editName} onChange={(e) => setEditName(e.target.value)}
    aria-label="Label name" className="flex-1" />
  <Button onClick={saveEdit} disabled={!editName.trim() || updateMut.isPending}>Save</Button>
  <Button variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
</div>
```

**Empty state (plan step 6):**

```jsx
<Card className="p-6 text-center text-sm text-muted-foreground">
  <Tag className="mx-auto mb-2 h-5 w-5" aria-hidden="true" />
  No labels yet — create your first one.
</Card>
```

**Delete dialog (plan step 5)** — render `<ConfirmDialog>` once at the bottom with the exact current props:

```jsx
<ConfirmDialog
  isOpen={confirmDeleteId !== null}
  title="Delete label?"
  titleId={DELETE_DIALOG_TITLE_ID}
  variant="destructive"
  confirmLabel="Delete"
  cancelLabel="Cancel"
  pending={deleteMut.isPending}
  message="This label will be removed from all tickets. This cannot be undone."
  onConfirm={handleConfirmDelete}
  onCancel={() => setConfirmDeleteId(null)}
/>
```

#### NEW-PATTERN RISK FLAGS (no prior art in this repo — handle deliberately)

1. **Hover-reveal has ZERO matches repo-wide.** Use `opacity-0 ... group-hover:opacity-100 group-focus-within:opacity-100` on the actions wrapper, **and** add `group` to the read `Card`. Pair `group-hover` with `group-focus-within` for keyboard parity. Use `opacity` (NEVER `hidden`/`display:none`) so the icon buttons remain in the tab order and keyboard-reachable when visually hidden.
2. **`variant="ghost"` icon button (icon + `p-0`) has no precedent.** Build it as `<Button variant="ghost" size="sm" className="h-8 w-8 p-0">` and give **each** button a unique `aria-label` (`'Edit ' + l.name` / `'Delete ' + l.name`). Closest precedent is `frontend/src/components/MemberTable.tsx:147` (`Trash2` in a destructive button with `aria-label`).
3. **`ColorPicker` portals to `document.body`**, so the row's `group-hover`/`group-focus-within` reveal does **not** affect the picker popover — no interaction between the two.

### Acceptance Criteria

- [ ] **Create row** renders `ColorPicker` (`value={newColor}`, `aria-label="New label color"`), a `TextInput` (`placeholder="Label name"`, `aria-label="New label name"`, `className="flex-1"`), and a `Button` labeled `Add` (`disabled` when `!newName.trim() || createMut.isPending`); on Add it calls `useCreateLabel`, fires `toast.success('Label created.')` on success, and resets the row to name `''` + color `#6B7280`.
- [ ] **List layout:** each label renders in its own full-width `Card` inside a `<div className="space-y-2">`; every read card has the same structure (`LabelChip` left, actions pinned right with `ml-auto`) so action buttons align vertically across rows. The `<ul>`/`<li>` markup is gone.
- [ ] **Hover/focus-reveal:** Edit/Delete are icon `Button`s (`Pencil`/`Trash2`) wrapped in `Tooltip` (`'Edit'`/`'Delete'`, `side="bottom"`); the actions wrapper is `opacity-0 ... group-hover:opacity-100 group-focus-within:opacity-100`, the read `Card` carries `group`, and the buttons stay in the tab order (opacity, not hidden).
- [ ] **Inline edit:** clicking Edit (`startEdit(l.id, l.name, l.color)`) swaps that card to an editor mirroring the create row (`ColorPicker` + `TextInput` + Save/Cancel); Save calls `useUpdateLabel` with `{ labelId, dto: { name: editName.trim(), color: editColor } }`, fires `toast.success('Label updated.')`, and exits edit mode; Save is disabled while `!editName.trim() || updateMut.isPending`; Cancel calls `setEditingId(null)` and abandons edits without mutating.
- [ ] **Empty state:** when `labels.length === 0`, the empty `Card` (`<Tag>` + `No labels yet — create your first one.`) renders and no list renders; the create row above remains usable.
- [ ] **Delete flow:** clicking the trash icon sets `confirmDeleteId`; the `ConfirmDialog` opens with the exact title/message/labels and `titleId={DELETE_DIALOG_TITLE_ID}`; confirm calls `deleteMut.mutate(<string id>)` (bare id) and fires `toast.success('Label deleted.')`.
- [ ] **Gating:** no `canManage`/`isAdmin` prop added; `LabelManagerProps` stays `{ projectSlug: string }` only.
- [ ] **No backend change:** color stays `#RRGGBB`; `LabelChip` contract unchanged; no edits to hooks, `ConfirmDialog`, or `types/label.ts`.
- [ ] **Theme + a11y:** light and dark both render correctly (pickers/tooltips/cards portal to `document.body` and read `.dark` from `<html>`); icon buttons are keyboard-reachable; tooltips show on hover/focus.
- [ ] **No new npm dependency:** uses only `lucide-react` + the existing `ui/` primitives (which themselves use already-present Radix/react-colorful).
- [ ] **File touched:** only `frontend/src/components/LabelManager.tsx` is modified (no test edits in this task).

### Subtasks

1. **Imports** — remove `react-colorful` + static swatch markup; add `ColorPicker`, `Card`, `Button`, `TextInput`, `{ Tooltip, TooltipTrigger, TooltipContent }`, and `{ Pencil, Trash2, Tag }`; keep the rest.
2. **Create row** — rewrite the top row as `ColorPicker` + `TextInput` + `Add` `Button` on a `flex items-center gap-2`, preserving `handleCreate` + reset.
3. **List + read-state cards** — replace `<ul>`/`<li>` with `<div className="space-y-2">` of read `Card`s (`group p-3`), each with `LabelChip` left and `ml-auto` hover/focus-revealed Edit/Delete tooltip icon buttons.
4. **Inline edit card** — when `editingId === l.id`, render the edited `Card` (`p-3`) with the mirrored editor (`ColorPicker` + `TextInput` + Save/Cancel), preserving `saveEdit` + Cancel behavior.
5. **Empty state** — when `labels.length === 0`, render the `Card` with `<Tag>` + `No labels yet — create your first one.`
6. **Delete dialog wiring** — render `ConfirmDialog` once at the bottom with the exact current props (`titleId={DELETE_DIALOG_TITLE_ID}`), preserving `handleConfirmDelete` with the bare-string mutate.

### Dependencies

**None.** The DEL-01 `ColorPicker` (`frontend/src/components/ui/ColorPicker.tsx`) and the other `ui/` primitives (`Card`, `Button`, `TextInput`, `Tooltip`) already exist in the repo and are consumed read-only.

---

## Task 2 — Rewrite `LabelManager.test.tsx` for the Card + ColorPicker redesign

**Batch:** 2
**Target file (only):** `frontend/src/components/LabelManager.test.tsx`
**Dependencies:** Task 1 (asserts Task 1's final rendered contract)
**Plan reference:** step 7 of `DEL-02-label-manager-redesign-plan.md`

### Description

Edit **exactly one file:** `frontend/src/components/LabelManager.test.tsx`. Keep the existing mock harness (correct in shape) and **extend** it for the new rendered structure introduced by Task 1.

#### What to keep from the existing harness (lines 1–106 of `LabelManager.test.tsx`)

- The `vi.hoisted` `mockState` object and its shape — see the **one addition** below.
- `vi.mock('@/hooks/useLabels')` → `useLabels: () => ({ data: mockState.labels })`.
- `vi.mock('@/hooks/useLabelMutations')` → `useCreateLabel`, `useUpdateLabel`, `useDeleteLabel`.
- `vi.mock('@/hooks/useToast')` → `toast: { success: mockState.toastSuccess }` (only the `toast` named export is consumed by the component; this is sufficient).
- `vi.mock('./ConfirmDialog')` → renders `null` when `!isOpen`, else a `<div role="dialog" aria-label={title}>` with `<h2>{title}</h2>`, optional `<p>{message}</p>`, and buttons labeled **`DoConfirm`** (→ `onConfirm`) and **`DoCancel`** (→ `onCancel`). **Keep verbatim.**
- The `fireOnSuccess(mutateSpy)` helper — reads `mock.calls.at(-1)?.[1]` and invokes `onSuccess`.
- The `beforeEach` reset block.
- The `bugLabel` / `featureLabel` fixtures (`{ id, name, color }`).

#### Three mandatory harness changes

1. **Add `updateIsPending` to `mockState`** (seed `false`) and wire it into the `useUpdateLabel` mock so it returns `{ mutate: mockState.updateMutate, isPending: mockState.updateIsPending }`. The current mock omits `isPending` entirely, which makes a "Save disabled while update pending" assertion impossible. Also reset `mockState.updateIsPending = false` in `beforeEach`.

2. **Add a `ColorPicker` mock.** The real `ColorPicker` (`./ui/ColorPicker`) portals a Radix Popover to `document.body`, making its internal interactions non-deterministic in jsdom. Mirror the `ConfirmDialog` mock style: `vi.mock('./ui/ColorPicker', ...)` rendering a controlled surface. Recommended deterministic shape: a plain `<input type="text" data-testid="color-trigger" aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} />`. This keeps `getByLabelText` working (the component passes `aria-label`s like `"New label color"` / `"Edit color for Bug"`) and lets `fireEvent.change` drive color changes deterministically. **Do not import the real `ColorPicker`.**

3. **Mount `TooltipProvider` in every `render`.** Task 1 wraps the Edit/Delete icon buttons in `Tooltip`, whose `TooltipProvider` is mounted only at app root (`main.tsx:30`) — **not** in unit tests. Each `render(<LabelManager …/>)` must be wrapped in a local `<TooltipProvider>` so Radix Tooltip's context is present. Precedent: `frontend/src/components/ThemeToggle.test.tsx:14`, `frontend/src/components/ui/Tooltip.test.tsx:16`. Implement once as a `renderWithProvider(node)` helper (or a `wrapper` option) and use it everywhere instead of bare `render`.

#### Rendered structure to assert (Task 1's contract — the test depends on this)

- **Create row:** mocked `ColorPicker` (aria-label `New label color`) + `TextInput` aria-label `New label name` + `Button` `Add` (disabled when name empty **or** `createIsPending`).
- **Each read-state card:** a `Card` containing a `LabelChip` and two icon `Button`s accessible by `aria-label`: `getByRole('button', { name: /Edit Bug/ })` and `getByRole('button', { name: /Delete Bug/ })`. The action container carries `opacity-0` at rest and `group-hover:opacity-100 group-focus-within:opacity-100`.
- **Edit card (after clicking Edit):** mocked `ColorPicker` (aria-label like `Edit color for Bug`), `TextInput` aria-label `Label name`, `Button` `Save` (disabled when name empty **or** `updateIsPending`), `Button` `Cancel`.
- **ConfirmDialog mock:** exposes `DoConfirm` / `DoCancel`.
- **Empty state:** with `labels: []`, the text `No labels yet` renders and no Edit/Delete icon buttons are present.

#### Test conventions (verified)

Vitest + `@testing-library/react`, co-located `*.test.tsx`, **`fireEvent` only** (no `userEvent`), hook mocks via `vi.mock` + `vi.hoisted` (**no** real `QueryClientProvider`). RTL query priority: `getByRole` > `getByLabelText` > `getByText`. One behavior per `it`.

### Acceptance Criteria

A verifiable checklist — every item must pass `npm test -- LabelManager` from `frontend/`.

**Harness (conventions):**

- [ ] Uses `fireEvent` only — **no** `userEvent`.
- [ ] All hooks mocked via `vi.mock` + `vi.hoisted` state — **no** real `QueryClientProvider`.
- [ ] `mockState` includes the new `updateIsPending` field (seed `false`, reset in `beforeEach`); `useUpdateLabel` returns `{ mutate, isPending }`.
- [ ] `./ui/ColorPicker` is mocked to a deterministic controlled surface (no real Radix Popover driven).
- [ ] `./ConfirmDialog` mock kept verbatim (`DoConfirm` / `DoCancel`).
- [ ] Every `render` is wrapped in a local `<TooltipProvider>` (or a shared `wrapper` / `renderWithProvider` helper).
- [ ] RTL query priority honored: `getByRole` > `getByLabelText` > `getByText`.
- [ ] One behavior per `it`; table-driven where natural.

**Test cases — each must exist and pass:**

- [ ] **Create — happy path:** type a name → `Add` becomes enabled; click `Add` → `createMutate` called with `{ name, color }`; `fireOnSuccess(createMutate)` → `toast.success('Label created.')`; name resets to `''` and color resets to `#6B7280` (assert via the next create payload **or** the mocked ColorPicker `value`).
- [ ] **Create — trims name** before calling mutate.
- [ ] **Create — Add disabled when name empty** (no mutate fires).
- [ ] **Create — Add disabled when `createIsPending`** (seed `mockState.createIsPending = true`).
- [ ] **List read state:** each label renders inside a `Card` with its `LabelChip` and Edit/Delete icon buttons — assert via `getByRole('button', { name: /Edit Bug/ })`, `getByRole('button', { name: /Delete Bug/ })` (regex, not the old bare `name: 'Edit'`).
- [ ] **Hover/focus reveal — rest state:** the action container's `className` contains `opacity-0` while the buttons remain present, enabled, and keyboard-reachable (`getByRole` finds them).
- [ ] **Hover/focus reveal — revealed:** `fireEvent.mouseEnter` on the card (group) flips the class to include `opacity-100`, **or** focusing an action button satisfies `group-focus-within` (assert deterministically — pick one; do not both).
- [ ] **Inline edit — happy path:** click Edit → card swaps to editor (mocked ColorPicker + `Label name` `TextInput` + Save/Cancel); `getByLabelText('Label name')` shows the current name; change name → click Save → `updateMutate` called with `{ labelId, dto: { name, color } }`; `fireOnSuccess(updateMutate)` → `toast.success('Label updated.')` and the editor exits.
- [ ] **Inline edit — Save disabled when name empty.**
- [ ] **Inline edit — Save disabled when `updateIsPending`** (seed `mockState.updateIsPending = true`).
- [ ] **Inline edit — Cancel** exits edit mode **without** calling `updateMutate`.
- [ ] **Delete confirm — opens:** click the Delete icon button → `DoConfirm` visible (via the `confirm-dialog` test id / `role="dialog"`).
- [ ] **Delete confirm — cancel:** click `DoCancel` → dialog cleared, `deleteMutate` not called.
- [ ] **Delete confirm — confirm:** click `DoConfirm` → `deleteMutate` called with the bare label id string; dialog clears immediately; `fireOnSuccess(deleteMutate)` → `toast.success('Label deleted.')`.
- [ ] **Empty state:** `mockState.labels = []` → `No labels yet` text renders; no Edit/Delete icon buttons present.

**Regression:**

- [ ] Existing assertions still valid under the new layout are **renamed/restructured** to the new selectors (regex aria-labels, `Label name` input label) rather than dropped silently.

### Subtasks

1. **Extend `mockState`** with `updateIsPending: false`; reset it in `beforeEach`.
2. **Rewire `useUpdateLabel` mock** to return `{ mutate: mockState.updateMutate, isPending: mockState.updateIsPending }`.
3. **Add the `ColorPicker` mock** (`vi.mock('./ui/ColorPicker', …)`) — controlled `<input data-testid="color-trigger" aria-label={…} value onChange>`. Confirm it matches the `aria-label`s Task 1 passes (`New label color`, `Edit color for <name>`).
4. **Add the `TooltipProvider` render wrapper** — create `renderWithProvider(node)` (or pass `wrapper`) and replace every `render(<LabelManager …/>)` with it. Cite `ThemeToggle.test.tsx:14` / `Tooltip.test.tsx:16` as precedent.
5. **Rewrite the create tests** for the new row: keep the happy-path + trim + empty-disabled cases; add a `createIsPending` disabled case; assert reset-to-`#6B7280` via the next-create payload or the mocked ColorPicker `value`.
6. **Rewrite the list test** to use regex aria-label selectors (`/Edit Bug/`, `/Delete Bug/`) and assert the read-state `Card` + `LabelChip` presence.
7. **Add the hover/focus-reveal test** — assert `opacity-0` on the action container at rest (buttons still enabled/reachable), then assert the reveal on `mouseEnter` (group-hover) **or** focus (group-focus-within). Keep it deterministic; pick one assertion path.
8. **Rewrite the inline-edit tests** for the new editor: `Label name` input label, Save happy path + toast + exit, Save-disabled-on-empty, Save-disabled-on-`updateIsPending`, Cancel abandons.
9. **Rewrite the delete-confirm tests** using the Delete icon button (`getByRole('button', { name: /Delete Bug/ })`); keep open / cancel / confirm + toast.
10. **Add the empty-state test** — `labels: []` → `No labels yet` present, no Edit/Delete buttons.
11. **Run `npm test -- LabelManager`** from `frontend/`; all tests green; no console errors from missing `TooltipProvider`.

### Dependencies

- **Task 1** — the final rendered structure of `LabelManager.tsx` (create row with `ColorPicker`/`TextInput`/`Button`; one full-width `Card` per label with hover/focus-revealed Edit/Delete icon `Tooltip`-wrapped buttons; inline editor mirroring the create row; `ConfirmDialog` delete flow; empty state). This task only rewrites the test file and cannot be verified green until Task 1 lands its new rendered contract.
- **Read-only references (do not modify):** `frontend/src/components/ui/{ColorPicker,Tooltip,Card,Button,TextInput}.tsx`, `frontend/src/components/{LabelChip,ConfirmDialog}.tsx`, `frontend/src/hooks/{useLabels,useLabelMutations}.ts`.
