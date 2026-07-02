# Implementation Plan — DEL-02

**Ticket:** `/.docs/ai-generated/pm-cycle-2026-07-02-03-31-41/deliverables/DEL-02-label-manager-redesign.md`
**Type:** Enhancement (frontend-only)
**Title:** LabelManager redesign — create row + card list + inline edit
**Generated:** 2026-07-02

---

## Summary

The Labels section in Project Settings is rendered by `frontend/src/components/LabelManager.tsx`. It has two UX problems the owner flagged: (1) the create row picks color only through a plain hex text field plus a *static, non-clickable* swatch (`<span aria-hidden>`), and it uses raw `<input>`/`<button>` elements instead of the `ui/` primitives; (2) the label list is a `<ul>` whose items are text-width `LabelChip`s next to "Edit"/"Delete" **text** links, so because every chip is a different width the action links never line up into a column — the list looks uneven and unaligned. There is also no empty state.

This deliverable redesigns `LabelManager` (frontend only — **no backend, schema, API, or `LabelChip` contract change, and no new npm dependency**). It (a) rewires the create row and the inline editor onto the new shared `ColorPicker` primitive built in DEL-01 (`frontend/src/components/ui/ColorPicker.tsx`), and onto the `ui/` primitives (`TextInput`, `Button`); (b) replaces the `<ul>` with a vertical stack of one **full-width `Card` per label**, where each card has an identical structure (color preview + name on the left, action buttons pinned to the right) so the action column aligns vertically across all rows; (c) makes Edit/Delete **hover-revealed icon buttons** wrapped in `Tooltip`, also revealed on keyboard focus; (d) keeps the existing inline edit (now mirroring the create row via `ColorPicker` + `TextInput` + Save/Cancel); (e) keeps the `ConfirmDialog` delete flow; and (f) adds a friendly empty state. The data layer — `useLabels` / `useCreateLabel` / `useUpdateLabel` / `useDeleteLabel`, the per-call `toast.success` wiring, and the `ConfirmDialog` usage — is reused **as-is**.

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| Component (rewrite render layer) | `frontend/src/components/LabelManager.tsx` | Create row, list, inline edit, and empty state all change. Data layer + props contract stay. |
| Tests (extend) | `frontend/src/components/LabelManager.test.tsx` | Update assertions for the new structure; add empty-state, hover/focus-reveal, inline-edit, delete-confirm cases. |
| Consumed (new, from DEL-01) | `frontend/src/components/ui/ColorPicker.tsx` | Drives color in create row + inline edit. **Read-only dependency — do not modify.** |
| Reused (unchanged) | `frontend/src/components/ui/{Card,Button,TextInput,Tooltip}.tsx` | Surface primitives the redesign composes. |
| Reused (unchanged) | `frontend/src/components/LabelChip.tsx` | Color preview on each card. **Frozen contract — do not alter props/output.** |
| Reused (unchanged) | `frontend/src/components/ConfirmDialog.tsx` | Delete confirmation. |
| Reused (unchanged) | `frontend/src/hooks/useLabels.ts`, `frontend/src/hooks/useLabelMutations.ts` | Data layer. **Frozen signatures — do not edit.** |
| Reused (unchanged) | `frontend/src/types/label.ts` | `Label`, `CreateLabelDto`, `UpdateLabelDto`. |
| Reused (unchanged) | `frontend/src/pages/ProjectSettingsPage.tsx` | Admin gating (`canManage`) stays in the parent; `LabelManager` keeps its `projectSlug`-only prop. |

> **No backend, route, controller, service, repository, schema, or migration file is touched.**

## Evidence — current state (read via Explore agents)

- `LabelManager.tsx` is the sole render target; ~189 lines. Props: `interface LabelManagerProps { projectSlug: string }` only — **no** `canManage`/`isAdmin` prop. Admin gating is entirely the parent's job.
- `ProjectSettingsPage.tsx` renders `<LabelManager projectSlug={slug} />` only from a `renderLabels` helper that returns a `<ReadOnlyNote>` ("You need admin access to manage labels.") for non-admins — so `LabelManager` is **admin-only-by-mount**. The redesign must **not** push `canManage` into the component.
- Current create row: static `<span aria-hidden="true" style={{ backgroundColor: newColor }}>` swatch (not clickable), a raw `<input type="text" aria-label="New label name">`, a `react-colorful` `<HexColorInput>` (hex text only, **no picker**), and a raw `<button>` "Add".
- Current list: `<ul className="space-y-2">` → `<li className="flex flex-wrap items-center gap-2">` → read state is `<LabelChip label={l} />` + two plain text buttons ("Edit" / "Delete"). `flex-wrap` lets the actions drift relative to differently-sized chips — the misalignment root cause.
- Current edit state: a flat inline row reusing a static swatch span + a full `<HexColorPicker>` square + `<HexColorInput>` + name `<input>` + "Save"/"Cancel". (Asymmetry: edit shows a full picker, create does not.)
- **No empty state** — zero labels renders an empty `<ul>`.
- State held (six `useState`): `newName`, `newColor` (seed `DEFAULT_COLOR`), `editingId`, `editName`, `editColor`, `confirmDeleteId`. Constant `const DEFAULT_COLOR = '#6B7280';`.
- Toasts wired at the call site: `import { toast } from '@/hooks/useToast';` → `toast.success('Label created.' | 'Label updated.' | 'Label deleted.')` passed as the 2nd `mutate` arg (the hooks define **no internal `onSuccess`**).
- **No icons imported today**; "Edit"/"Delete"/"Save"/"Cancel"/"Add" are plain text.

### Frozen contracts the redesign depends on (must reuse unchanged)

- **`ColorPicker`** (`components/ui/ColorPicker.tsx`, named export, `forwardRef`): props `{ value: string; onChange: (hex: string) => void; prefixed?: boolean (default true); aria-label?: string (default 'Color'); id?: string; className?: string; contentClassName?: string }`. `value` is `#RRGGBB`; `onChange` always emits `#RRGGBB`. **No `disabled` prop; open state is uncontrolled (Radix manages).** The swatch `<button>` *is* the Radix Trigger; Content portals to `document.body`. Default swatch `h-8 w-8`, picker `size-44`, hex input `w-40`, Content `sideOffset={4} align="start"`. Override swatch size via `className`.
- **`Card`** (`components/ui/Card.tsx`, named export): props `{ children; className? }`. **No default padding** (`bg-card border border-border rounded-lg`); **no** `CardHeader`/`CardBody` subcomponents — consumer adds `p-*`.
- **`Button`** (`components/ui/Button.tsx`, named export, `forwardRef`): extends `ButtonHTMLAttributes<HTMLButtonElement>`; props `{ variant?: 'primary'|'secondary'|'ghost'|'destructive'|'destructive-outline'|'outline' (default 'primary'); size?: 'sm'|'md'|'lg' (default 'md') }`. `type` defaults to `'button'`. `disabled:opacity-50 disabled:pointer-events-none` baked in. **No `'icon'` size variant.** Compact square icon button: `<Button variant="ghost" size="sm" className="h-8 w-8 p-0">`.
- **`TextInput`** (`components/ui/TextInput.tsx`, named export, `forwardRef`): `type = InputHTMLAttributes<HTMLInputElement>` — **identical API to raw `<input>`** (standard controlled `value`/`onChange`); only adds baked focus-ring base classes.
- **`Tooltip`** (`components/ui/Tooltip.tsx`): **compound** named exports `TooltipProvider`, `Tooltip` (= Radix `Root`), `TooltipTrigger` (`asChild` supported), `TooltipContent` (wraps `Portal`+`Content`+`Arrow`). Content supplied as `TooltipContent` **children** (no `content`/`label` prop). `TooltipProvider` **must already be mounted at app root** (`main.tsx`) — the coder should verify before relying on it.
- **`Label`** (`types/label.ts`): `{ id: string; name: string; color: string /* #RRGGBB uppercase */ }`. DTOs: `CreateLabelDto { name; color }` (both required), `UpdateLabelDto { name?; color? }`.
- **Hooks** (`hooks/useLabels.ts` plural; `hooks/useLabelMutations.ts`): `useLabels(slug)` → `UseQueryResult<Label[]>`; `useCreateLabel(slug)` → `mutate({ name; color })`; `useUpdateLabel(slug)` → `mutate({ labelId; dto: { name?; color? } })` (optimistic); `useDeleteLabel(slug)` → `mutate(<labelId string>)` (optimistic). None define internal `onSuccess`.
- **`LabelChip`** (`components/LabelChip.tsx`): props `{ label: Label; onRemove?: () => void }`; `inline-flex` span sized to text, runtime hex via **inline `style`** (`backgroundColor` + `readableTextColor` from `@/utils/color`). **Do not change.**
- **`ConfirmDialog`** (`components/ConfirmDialog.tsx`): controlled via `isOpen`; props include `{ isOpen; title; titleId (required, unique); message?: ReactNode; confirmLabel?; cancelLabel?; variant?: 'default'|'destructive'; pending?; onConfirm; onCancel; blockBackdropClose? }`. The existing delete usage is the exact contract to reproduce: `isOpen={confirmDeleteId !== null}`, `title="Delete label?"`, unique `titleId`, `variant="destructive"`, `pending={deleteMut.isPending}`, `message="This label will be removed from all tickets. This cannot be undone."`.
- **Icons:** `lucide-react` named imports, project-wide icon size `className="h-4 w-4"` with `aria-hidden="true"` when decorative. Precedent for delete: `Trash2`; use `Pencil` for edit.
- **Tests:** Vitest + `@testing-library/react`, `fireEvent` (not `userEvent`), co-located `*.test.tsx`. The dominant pattern mocks the hooks with `vi.mock` + `vi.hoisted` state (**no real `QueryClientProvider`**), mocks **both** `useToast` and `toast` exports, and mocks `ConfirmDialog` to expose deterministic `DoConfirm`/`DoCancel` buttons. Per-call `onSuccess` is driven with a `fireOnSuccess(mutateSpy)` helper that invokes the 2nd `mutate` arg.

## Proposed Implementation

Frontend-only. Order by build dependency. The component keeps its props (`{ projectSlug }`) and the six `useState` fields; only the render layer + imports change.

### 1. Imports — `frontend/src/components/LabelManager.tsx`

**What:** Swap out the ad-hoc `react-colorful` direct usage and raw elements for the shared primitives.

- **Remove:** `HexColorPicker`, `HexColorInput` imports from `react-colorful` (the new `ColorPicker` encapsulates both). Remove any inline swatch `<span>` markup.
- **Add:** `import { ColorPicker } from './ui/ColorPicker';`, `import { Card } from './ui/Card';`, `import { Button } from './ui/Button';`, `import { TextInput } from './ui/TextInput';`, `import { Tooltip, TooltipTrigger, TooltipContent } from './ui/Tooltip';` (import `TooltipProvider` too only if it is not already mounted app-wide — verify `main.tsx`; do **not** add a redundant provider).
- **Add:** `import { Pencil, Trash2 } from 'lucide-react';` (and an empty-state icon, e.g. `Tag` or `Tags`, if used).
- **Keep unchanged:** `LabelChip`, `ConfirmDialog`, the four label hooks, `toast` from `@/hooks/useToast`, `Label`/`CreateLabelDto`/`UpdateLabelDto` types, `DEFAULT_COLOR`.

**Why:** Collapse the create/edit color UI onto the single shared primitive (DEL-01's stated purpose) and adopt the project's `ui/` primitives for consistency.

### 2. Create row — rewrite

**What:** A single horizontal row using the primitives.

```
<div className="flex items-center gap-2">
  <ColorPicker value={newColor} onChange={setNewColor} aria-label="New label color" />
  <TextInput
    value={newName}
    onChange={(e) => setNewName(e.target.value)}
    placeholder="Label name"
    aria-label="New label name"
    className="flex-1"
  />
  <Button onClick={handleCreate} disabled={!newName.trim() || createMut.isPending}>
    Add
  </Button>
</div>
```

- `handleCreate`: `createMut.mutate({ name: newName.trim(), color: newColor }, { onSuccess: () => { toast.success('Label created.'); setNewName(''); setNewColor(DEFAULT_COLOR); } })` — same wiring as today, untouched data contract (`CreateLabelDto = { name; color }`).
- `ColorPicker.value` is the controlled `newColor` (#RRGGBB); `onChange={setNewColor}` because the picker already emits `#RRGGBB`. The swatch is now the interactive trigger (fixes "static, non-clickable swatch").

**Why:** Replaces raw elements + hex-only field with the visual picker + `ui/` primitives; preserves the create data flow and toast/reset behavior.

### 3. List — one full-width `Card` per label (read state)

**What:** Replace the `<ul>`/`<li>` with a vertical stack of `Card`s.

```
{labels.length === 0 ? (
  <EmptyState />            // see step 6
) : (
  <div className="space-y-2">
    {labels.map((l) =>
      editingId === l.id ? (
        <Card key={l.id} className="p-3">
          <EditRow ... />     // see step 5 (mirrors create row)
        </Card>
      ) : (
        <Card key={l.id} className="group p-3">
          <div className="flex items-center gap-3">
            {/* left: color preview + name */}
            <LabelChip label={l} />
            {/* right: hover/focus-revealed actions, pinned to the right edge */}
            <div className="ml-auto flex items-center gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0"
                          aria-label={`Edit ${l.name}`} onClick={() => startEdit(l)}>
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Edit</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0"
                          aria-label={`Delete ${l.name}`} onClick={() => setConfirmDeleteId(l.id)}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Delete</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </Card>
      )
    )}
  </div>
)}
```

- `Card` has no padding → pass `className="group p-3"` (the `group` flag drives reveal; `p-3` is the body padding).
- Use `<LabelChip label={l} />` for the color preview + name (reuse, **frozen** — no props/output change). If a larger swatch is desired alongside, render an additional decorative `<span style={{ backgroundColor: l.color }} className="h-6 w-6 rounded-full" aria-hidden="true" />`; **do not** replace the chip's inline `style` with a Tailwind dynamic class.
- Actions use `ml-auto` so they pin to the right edge of every card → the action column is **vertically aligned across all rows** (directly fixes the misalignment).
- **Hover + keyboard reveal:** actions use `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`. `opacity` (not `hidden`/`display:none`) keeps the buttons in the tab order, so they remain keyboard-reachable; `group-focus-within` reveals them when any action (or the card) receives focus. This satisfies "hover-reveal is also triggered by keyboard focus."
- `startEdit(l)` unchanged: `setEditingId(l.id); setEditName(l.name); setEditColor(l.color);`
- Delete click sets `confirmDeleteId` (the `ConfirmDialog` opens — see step 7).

**Why:** Identical card structure per label → aligned action column; hover-reveal keeps the list clean by default but discoverable; icons + tooltips are accessible and theme-consistent.

### 4. Inline edit — mirror the create row

**What:** When `editingId === l.id`, that card swaps to an editor with the same primitives as the create row.

```
<div className="flex flex-wrap items-center gap-2">
  <ColorPicker value={editColor} onChange={setEditColor} aria-label={`Edit color for ${editName}`} />
  <TextInput
    value={editName}
    onChange={(e) => setEditName(e.target.value)}
    aria-label="Label name"
    className="flex-1"
  />
  <Button onClick={saveEdit} disabled={!editName.trim() || updateMut.isPending}>Save</Button>
  <Button variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
</div>
```

- `saveEdit`: `updateMut.mutate({ labelId: editingId, dto: { name: editName.trim(), color: editColor } }, { onSuccess: () => { toast.success('Label updated.'); setEditingId(null); } })` — same contract as today (`UpdateLabelDto`, optimistic update handled by the hook).
- Cancel: `setEditingId(null)` (abandons in-memory edits).
- Save disabled while name empty (and while pending) — matches the acceptance criterion.

**Why:** Collapses the old asymmetry (create hex-only vs. edit full picker) onto one shared `ColorPicker`-based editor; preserves the update data flow, toast, and exit-edit behavior.

### 5. Delete — keep `ConfirmDialog` exactly

**What:** No change to the dialog usage. Keep:

```
<ConfirmDialog
  isOpen={confirmDeleteId !== null}
  title="Delete label?"
  titleId={DELETE_DIALOG_TITLE_ID}     // e.g. 'confirm-delete-label-title', unique
  variant="destructive"
  confirmLabel="Delete"
  cancelLabel="Cancel"
  pending={deleteMut.isPending}
  message="This label will be removed from all tickets. This cannot be undone."
  onConfirm={handleConfirmDelete}
  onCancel={() => setConfirmDeleteId(null)}
/>
```

- `handleConfirmDelete`: read `const id = confirmDeleteId;` then `setConfirmDeleteId(null);` (optimistic close) and `deleteMut.mutate(id, { onSuccess: () => toast.success('Label deleted.') })` — the bare-`string` arg contract is unchanged.

**Why:** Reuse the existing, theme-consistent confirmation surface and its frozen contract; only the trigger moved (text link → trash icon button).

### 6. Empty state

**What:** When `labels.length === 0`, render a friendly empty state instead of an empty list.

```
<Card className="p-6 text-center text-sm text-muted-foreground">
  <Tag className="mx-auto mb-2 h-5 w-5" aria-hidden="true" />
  No labels yet — create your first one.
</Card>
```

(Icon/copy may be adjusted to house style; the key is a visible, friendly message when there are zero labels.)

**Why:** Closes the "renders nothing" gap; the create row remains above it so the user can immediately add one.

### 7. Tests — extend `frontend/src/components/LabelManager.test.tsx`

**What:** Keep the existing mock harness (mocked `useLabels`, `useLabelMutations`, `useToast` exporting **both** `toast` and `useToast`, and the `ConfirmDialog` `DoConfirm`/`DoCancel` mock) and the `fireOnSuccess(mutateSpy)` helper. Update existing assertions and add cases.

- **ColorPicker in tests:** Because `ColorPicker` portals a Radix Popover, assert color changes robustly by **mocking** `ColorPicker` to a controlled surface (e.g. a `<button data-testid="color-trigger" />` plus an `<input>` that calls `onChange`), mirroring how `ConfirmDialog` is mocked — or assert only via the `onChange` callback. This keeps tests deterministic without driving Radix.
- Cases to cover:
  - **Create:** type a name → `Add` enabled; click `Add` → `createMutate` called with `{ name, color }`; `fireOnSuccess(createMutate)` → `toast.success('Label created.')`; name resets to `''` and color to `#6B7280`. `Add` disabled when name empty or `createIsPending`.
  - **List layout / read state:** each label renders inside a `Card` with a `LabelChip` preview and Edit/Delete icon buttons (assert via `getByRole('button', { name: /Edit Bug/ })` etc.).
  - **Hover/focus reveal:** actions are present but hidden at rest (assert the reveal class / `opacity-0`, or that they are not visually visible); after `fireEvent.mouseEnter`/`pointerEnter` on the card (group-hover) **or** after focusing an action button (`group-focus-within`) they become visible/reachable. Assert keyboard reachability (the buttons are in the tab order even when visually hidden).
  - **Inline edit:** click Edit → card swaps to editor (`ColorPicker` + name `TextInput` + Save/Cancel); change name → click Save → `updateMutate` called with `{ labelId, dto: { name, color } }`; `fireOnSuccess(updateMutate)` → `toast.success('Label updated.')` and exits edit mode. Cancel → exits edit without calling the mutation.
  - **Delete confirm:** click Delete (trash) → `ConfirmDialog` opens (assert `DoConfirm` visible via the mock); click `DoConfirm` → `deleteMutate` called with the label id; `fireOnSuccess(deleteMutate)` → `toast.success('Label deleted.')`.
  - **Empty state:** with `labels = []`, the empty message ("No labels yet…") renders and the list does not.
- Use `fireEvent` (project default), RTL priority `getByRole` > `getByLabelText` > `getByText`, and one behavior per test.

## Edge Cases & Risks

- **Hover-reveal must not break keyboard access.** Use `opacity` (not `hidden`/`display:none`) so icon buttons stay in the tab order; drive reveal with `group-hover` + `group-focus-within`. A pure-`:hover` reveal would hide actions from keyboard users.
- **Disabled buttons + Tooltip:** Radix Tooltip does not fire `pointerenter`/`focus` on a disabled button. The Edit/Delete buttons here are enabled at rest (they are hidden, not disabled), so this is fine — but do **not** add `disabled` to a tooltip-wrapped trigger without wrapping the trigger in a `<span>`.
- **Theme/portal invariant.** `ColorPicker.Content` and `TooltipContent` portal to `document.body` and resolve `.dark` from `<html>` — do not relocate the `.dark` class. Verify light + dark both render correctly.
- **`TooltipProvider` must be mounted app-wide** (`main.tsx`). Verify before relying on `Tooltip`; only add a provider locally if it is genuinely missing (avoid double providers).
- **`Card` has no default padding** — every card must carry its own `p-*`, or content will touch the border.
- **`Button` has no `icon` size** — compact square actions use `className="h-8 w-8 p-0"` (caller wins via `cn`).
- **`LabelChip` is shared** by `TicketCard` and `LabelMultiSelect`; reuse it for the preview but **do not** change its props/output (the runtime hex stays inline `style`, never a Tailwind dynamic class).
- **Color stays `#RRGGBB`.** `ColorPicker.onChange` already emits uppercase-ish `#RRGGBB`; the server canonicalizes casing, so no normalization change is needed.
- **No backend/API/schema change** — color format, `Label` shape, and all hook signatures are frozen; do not invent new props on `LabelManager` (keep `projectSlug`-only; gating stays in `ProjectSettingsPage`).
- **No new npm dependency** — `lucide-react`, `react-colorful`, `sonner`, and Radix are already present.
- **Regression risk:** the four hooks are unchanged, so query/mutation behavior (including optimistic update/rollback and the global error toast funnel) is unaffected.

## Testing

*Frontend: Vitest + @testing-library/react, co-located `*.test.tsx`, `fireEvent`, hook mocks via `vi.mock` + `vi.hoisted` (no real `QueryClientProvider`), mocked `ConfirmDialog` (`DoConfirm`/`DoCancel`), `fireOnSuccess` helper to drive per-call toasts.*

- **Unit/component tests** (`frontend/src/components/LabelManager.test.tsx`): create (incl. reset + disabled states), list read-state layout, hover/focus reveal + keyboard reachability, inline edit (save toasts + exits; cancel abandons), delete-confirm flow, and empty state — as enumerated in step 7.
- **Manual verification:**
  1. Open Project Settings → Labels as an admin; confirm the create row shows the `ColorPicker` swatch (click opens the popover with the square picker + hex field), a name `TextInput`, and an "Add" `Button`.
  2. Add a label → toast "Label created." fires; row resets to default color + empty name.
  3. Confirm the list is one full-width `Card` per label; action icons align vertically across rows; icons are hidden at rest and appear on hover and on Tab focus.
  4. Click a card's Edit (pencil) → editor swaps in (ColorPicker + name + Save/Cancel); change name + color → Save → toast "Label updated." and card returns to read state; Cancel abandons.
  5. Click Delete (trash) → `ConfirmDialog` opens with the exact copy; confirm → toast "Label deleted."
  6. Delete all labels → empty state message appears with the create row still usable.
  7. Toggle light/dark theme → picker popover, tooltips, cards all render correctly.
  8. As a non-admin → confirm only the read-only note renders (no `LabelManager` controls) — unchanged gating.

## Acceptance Criteria

- [ ] **Create row:** uses the `ColorPicker` primitive (swatch → popover with picker + hex field), a `TextInput` for the name, and a `Button` for "Add"; creating a label works via `useCreateLabel`, shows the "Label created." toast, and resets the row (name `''`, color `#6B7280`).
- [ ] **List layout:** labels render as one full-width `Card` each in a vertical stack; every card has an identical structure (preview + name left, actions pinned right) so the action buttons align vertically across rows.
- [ ] **Actions:** Edit/Delete are hover-revealed icon buttons wrapped in `Tooltip` ("Edit"/"Delete"); revealed on card hover **and** keyboard focus; Delete opens the existing `ConfirmDialog` with the exact copy.
- [ ] **Inline edit:** selecting Edit swaps the card to an editor mirroring the create row (`ColorPicker` + name `TextInput` + Save/Cancel); Save calls `useUpdateLabel`, toasts "Label updated." and exits edit mode (disabled while name empty); Cancel abandons changes.
- [ ] **Empty state:** with zero labels, a friendly empty message is shown instead of an empty list.
- [ ] **Gating:** non-admins still see only the read-only note — no new controls for them (no new props on `LabelManager`).
- [ ] **No backend change:** color stays `#RRGGBB`; `LabelChip` shape/contract unchanged; no new npm dependency.
- [ ] **Theme parity & a11y:** works in light and dark mode; icon buttons are keyboard-reachable, tooltips show, hover-reveal is also triggered by keyboard focus.
- [ ] **Tests:** the redesign ships with tests (create, edit, delete-confirm, empty state, hover/focus-reveal) following the repo's conventions.

## Out of Scope

- Search/filter of labels.
- Per-label ticket count or any new label metadata.
- Any change to `LabelChip` (shared by tickets/selection).
- Backend, schema, or API changes; new npm dependencies.
- Changes to `LabelManager`'s prop contract or to `ProjectSettingsPage` gating.
- Changes to the label hooks (`useLabels`, `useLabelMutations`) or to `ConfirmDialog`.
