# F44 — Two-column TicketAttributeForm: Plan + Task Breakdown

> **Feature:** F44 — Two-column TicketAttributeForm (Phase 2 — Ticket Modal & Forms · Enhancement)
> **Feature index:** [`ui-redesign-features.md`](../../ui-redesign-features.md)
> **Slug:** `SLYK` · **Depends on:** F43 (done), F35 (done) · **PRD ref:** §5.2 (two-column form), §2.5 (`TicketAttributeForm.tsx:81` single column), §3.3 (lucide icons)
> **Sources:** [`prd-ui-redesign.md`](../../../prd-ui-redesign.md), the project rules discovered for this repo, plus dependency feature task docs: [F35](../F35-shared-ui-primitives/F35-shared-ui-primitives-tasks.md), [F43](../F43-modal-size-theme-x-icon/F43-modal-size-theme-x-icon-tasks.md)

---

## 1. F44 Recap

**Goal:** Replace the narrow single-column `TicketAttributeForm` with a Jira-style two-column layout at `xl`, so create/edit ticket modals get a wide primary canvas (Title + Description) and a stacked metadata sidebar (Priority / Assignee / Labels / Checklist) instead of one long vertical list.

**Ships:** Create/Edit ticket modals render `grid grid-cols-1 lg:grid-cols-3 gap-6` — left 2/3 holds Title + Description (+ optional Activity); right 1/3 holds Priority / Assignee / Labels / Checklist each wrapped in the F35 `Field` primitive. Edit mode additionally surfaces a time-tracking summary in the right column. A sticky footer carries Cancel + Create/Save, right-aligned, single `Button` size. Below `lg` the grid collapses to one column with metadata below the description.

**Acceptance (definition of done):**
- At `lg`+: two columns (left 2/3 Title+Description, right 1/3 meta); below `lg`: single column, meta below description.
- All fields still submit; dirty / `readOnly` behavior unchanged.
- Footer sticky, single button size.
- Icons: `Flag`, `UserCircle`, `Tags`, `ListChecks`, `AlignLeft` per §3.3.
- Test: two-column still submits all fields; `readOnly` mode unchanged.
- The right column scrolls independently for long checklists rather than stretching the modal.

**Edge cases to resolve up front:**
- **`react-hook-form`/Zod schema frozen (§10)** — only layout + primitive wrapping changes; the form state model is untouched → **Decision:** the `schema`, `FormValues`, `useForm` call (`register`/`watch`/`setValue`/`handleSubmit`), and `onDirtyChange` effect are byte-identical. Only the JSX tree and the footer buttons change.
- **Collapsible Activity area is "optional" per §5.2** — decide in-PR; don't leave it half-wired → **Decision:** default **omit**. `TicketDetailModal` already renders `<ActivityFeed>` outside the form (its own concern). F44 leaves that arrangement intact and does not introduce a second Activity surface. A future feature can add an in-form collapsible Activity if desired; F44 ships the two-column form only.
- **Long checklists in the narrow right column** must scroll independently, not stretch the modal → **Decision:** the right column gets `lg:max-h-[70vh] lg:overflow-y-auto lg:pr-1` so it scrolls within the fixed `max-h-[90vh]` modal panel; the left column grows naturally and the modal's own `overflow-y-auto` handles it.
- **Double-label a11y hazard** — `PrioritySelect` and `UserSelect` each render their own `<label><span>…</span>` around their control. Wrapping them in F35 `<Field>` would nest `<label>` inside `<label>` (invalid HTML + duplicate label text) → **Decision:** do **not** wrap `PrioritySelect`/`UserSelect` in `Field`. Instead lift their label text to a `Field`-equivalent header row that is **not** a `<label>` element, and pass the bare `<select>` through. This requires a tiny read-only edit to those two components so they accept the control without their own label wrapper. See §3 D5/D6.

---

## 2. Codebase Analysis Summary

- **State:** partial. `TicketAttributeForm.tsx` (183 lines) exists as a single-column `space-y-4` form; all the field controls it composes already exist and are unit-tested. F35 (`Field`, `Button`, `cn`) and F43 (`Modal size="xl"`) are done and live. F44 is a **layout + wrapping restructure** of one file plus minimal label-decoupling edits to two leaf selects, then a consumer pass to opt into `size="xl"`.
- **Existing structure this feature builds on:**
  - `frontend/src/components/TicketAttributeForm.tsx` — the target. `schema` + `FormValues` (`:17-34`), `TicketAttributeFormProps` (`:36-48`, includes `mode`/`readOnly`/`onDirtyChange`), `useForm` wiring (`:59-69`), `onDirtyChange` effect (`:72-74`), single-column `<form className="space-y-4">` (`:78-161`), inline footer `<div className="flex gap-2">` (`:163-180`).
  - `frontend/src/components/ui/Field.tsx` (F35) — `<Field label htmlFor error className>`; renders `<label><span>label</span>{children}{error?<p role=alert>:null}</label>`. **Renders a `<label>` element** — the double-label trap in §1.
  - `frontend/src/components/ui/Button.tsx` (F35) — `<Button variant size ...>`; `variant` ∈ primary/secondary/ghost/destructive/outline, `size` ∈ sm/md/lg; `forwardRef`, rest-spread, `type="button"` default.
  - `frontend/src/components/Modal.tsx` (F43) — `size?: 'sm'|'md'|'lg'|'xl'` (`xl→max-w-4xl`), `max-h-[90vh] overflow-y-auto` panel. **Currently neither consumer passes `size`** (both default to `md`/`max-w-lg`) — too narrow for two columns.
  - `frontend/src/components/CreateTicketModal.tsx` (`:31-47`) — renders `<Modal ...>` (no `size`) → `<TicketAttributeForm mode="create" ...>`.
  - `frontend/src/components/TicketDetailModal.tsx` (`:208-219`) — renders `<Modal ...>` (no `size`) and, inside `modalBody`, `<TicketAttributeForm mode="edit" readOnly={!!ticket.deletedAt} ...>` plus siblings (`TimerControls`, `TimeLog`, `ManualEntryForm`, `ActivityFeed`).
  - `frontend/src/components/PrioritySelect.tsx` — self-renders `<label className="block"><span>Priority</span><select aria-label="Priority" ...></label>`.
  - `frontend/src/components/UserSelect.tsx` — same shape: `<label><span>Assignee</span><select aria-label="Assignee" ...></label>`.
  - `frontend/src/components/LabelMultiSelect.tsx` — renders a `<div>` trigger + popover (no `<label>` element); safe to wrap in `Field`.
  - `frontend/src/components/ChecklistEditor.tsx` — renders a `<div>` container with its own `<span>Checklist</span>` header + progress bar; safe to wrap (its header becomes redundant — see §3 D7).
  - `frontend/src/components/RichTextEditor.tsx` — Tiptap editor with toolbar; `value`/`onChange` controlled. **Untouched by F44** (only wrapped).
  - `frontend/src/components/TicketAttributeForm.test.tsx` (360 lines, 12 tests) — mocks `RichTextEditor`/`PrioritySelect`/`UserSelect`/`LabelMultiSelect`; queries by `aria-label` (`Title`, `Description`, `Priority`, `Assignee`, `Labels`) and role (`Create ticket`, `Save changes`, `Cancel`, `Close`). **F44 must keep all 12 green.**
- **Prior art / partial work:** none. This is the first two-column pass over the form.
- **File paths the plan references that do NOT exist yet:** none. All targets exist; this is modify-only.
- **Project rules** this plan must satisfy:
  - `.claude/rules/js-style-guide.md` — no `any`; PascalCase components/types; explicit prop interfaces; 4-space JSX / 2-space TS; ≤100 cols; one component per file.
  - `.claude/rules/js-testing-rules.md` — Vitest; table-driven preferred; RTL `getByRole`/`getByLabelText` priority.
  - `.claude/rules/js-development-rules.md` — Tailwind classes (no inline styles); functional components + hooks; `Field`/`Button` from `@/components/ui/...`.
  - `.claude/rules/git-guidelines.md` — commit prefix `SLYK-F44:`; rebase-and-merge only.
- **Hidden coupling to plan for:**
  - The **double-`<label>`** trap: `PrioritySelect`/`UserSelect` ship their own `<label>`. Wrapping in `Field` (also a `<label>`) is invalid. T2 decouples the label from those two controls.
  - `TicketAttributeForm.test.tsx` queries `Priority`/`Assignee` by `aria-label` and the submit-by-name buttons by `role:button,name`. The footer refactor **must preserve** those query strings (`'Create ticket'`, `'Save changes'`, `'Cancel'`, `'Close'`).
  - `readOnly` mode (`F17`) disables via `<fieldset disabled>` — the new grid must keep the `<fieldset>` wrapping **all** editable fields (left and right columns) so disable propagates. The footer buttons live **outside** the fieldset (so Cancel/Close stay clickable while disabled).
  - `TicketDetailModal` renders the form **plus** sibling time-tracking widgets and `ActivityFeed`. Widening to `size="xl"` must not break that composition; the form's own two-column grid is self-contained.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Grid layout | **`grid grid-cols-1 lg:grid-cols-3 gap-6`** | PRD §5.2 verbatim. Left col spans 2 tracks, right col spans 1. `grid-cols-1` below `lg` collapses cleanly. |
| D2 | Column spans | **left `lg:col-span-2`, right `lg:col-span-1`** | Yields the 2/3 + 1/3 Jira split at `lg`+. Default `col-span-1` on mobile keeps the single-column stack. |
| D3 | Sticky footer | **`sticky bottom-0 -mx-6 -mb-6 mt-6 border-t border-border bg-background px-6 py-3`**, contents `flex justify-end gap-2` | PRD §5.2 "sticky footer, right-aligned". Negative margins span the modal panel's `p-6`; `bg-background` prevents content bleed-through. Single `Button` size (`md`) per PRD. |
| D4 | Footer buttons → `Button` primitive | **`<Button variant="primary" type="submit" size="md">` + `<Button variant="outline" type="button">`** | F35 `Button` replaces the hand-rolled `<button>` pair (consistent focus ring, tokens). Labels unchanged (`'Create ticket'`/`'Save changes'`, `'Cancel'`/`'Close'`) so tests stay green. |
| D5 | Field wrapping — Title, Description, Labels, Checklist | **wrap in `<Field>`** with §3.3 icons (`AlignLeft` for Title/Description, `Tags` for Labels, `ListChecks` for Checklist) | PRD §3.3 + §5.2 "each in `Field`". These controls do **not** render their own `<label>`, so `Field` provides it cleanly. |
| D6 | Field wrapping — Priority, Assignee | **decouple label from the control first**, then wrap in `Field` | `PrioritySelect`/`UserSelect` render their own `<label><span>`; nesting in `Field` (also `<label>`) is invalid HTML + double label. T2 adds an opt-in `hideLabel` prop so the control renders bare; the `Flag`/`UserCircle` icon + label then live in the surrounding `Field`. `aria-label="Priority"`/`"Assignee"` retained verbatim (test anchors). |
| D7 | Checklist header dedup | **`ChecklistEditor` keeps its progress bar; F44 `Field` label replaces the redundant `<span>Checklist</span>`** | `ChecklistEditor` renders `<span>Checklist</span>` + `doneCount/total` + progress bar. Wrapping in `Field` would duplicate the word "Checklist". T3 adds `hideLabel` to `ChecklistEditor` too; `Field` supplies "Checklist" + `ListChecks`, the editor keeps the progress bar + list. |
| D8 | Right-column independent scroll | **`lg:max-h-[70vh] lg:overflow-y-auto lg:pr-1`** on the right column wrapper | PRD edge case: long checklists must scroll inside the `max-h-[90vh]` modal, not stretch it. Left column relies on the modal's own `overflow-y-auto`. Below `lg`, the column is not height-capped (single-column flow). |
| D9 | Modal size in consumers | **`size="xl"` on both `CreateTicketModal` and `TicketDetailModal` `<Modal>`** | PRD §5.2 "at `xl`". F43's `xl→max-w-4xl` gives the two-column grid room; `md`/`max-w-lg` is too narrow. |
| D10 | `react-hook-form` / Zod frozen | **schema, `FormValues`, `useForm` config, `onDirtyChange` effect — unchanged** | PRD §10 edge case. Only JSX layout + footer buttons + `Field` wrapping change. |
| D11 | Collapsible Activity | **omit in F44** | PRD §5.2 "optional — decide in-PR". `TicketDetailModal` already renders `<ActivityFeed>` outside the form; F44 ships the two-column form only and leaves Activity where it is. |
| D12 | Edit-mode time-tracking summary | **F44 wires it only if trivially available**; otherwise defer to the existing `TimerControls`/`TimeLog` siblings | PRD §5.2 "edit mode adds time-tracking summary". `TicketDetailModal` already renders `TimerControls` + `TimeLog` + `ManualEntryForm` adjacent to the form. To avoid double-rendering, F44 does **not** duplicate them inside the form's right column; the existing siblings remain the time-tracking surface. (If the owner wants an in-form summary chip later, that is a follow-up.) |

> **Out of F44 scope (explicitly deferred):** a collapsible in-form Activity panel (PRD §5.2 "optional"); an in-form time-tracking summary chip (the existing `TimerControls`/`TimeLog`/`ManualEntryForm` siblings remain the source of truth); the F45 raw-color → token sweep inside `PrioritySelect`/`UserSelect`/`ChecklistEditor`/`RichTextEditor` (those keep their current classes; F45/F46 own them); `ActivityFeed`/`ManualEntryForm`/`TimeLog` internals.

> **Owner sign-off needed:** D12 — confirming that the existing time-tracking siblings (not a new in-form summary) satisfy §5.2's "edit mode adds time-tracking summary". Default per this plan: yes, the siblings are the summary surface; no new chip in F44.

---

## 4. Architecture Overview (Target Tree)

```
frontend/src/components/
├── TicketAttributeForm.tsx     # MODIFY — two-column grid, Field-wrapped fields, Button footer, frozen schema
├── TicketAttributeForm.test.tsx # MODIFY — add layout tests; keep all 12 existing green
├── CreateTicketModal.tsx        # MODIFY — <Modal size="xl">
├── TicketDetailModal.tsx        # MODIFY — <Modal size="xl">
├── PrioritySelect.tsx           # MODIFY — add hideLabel?: boolean (render bare control when true)
├── UserSelect.tsx               # MODIFY — add hideLabel?: boolean (render bare control when true)
└── ChecklistEditor.tsx          # MODIFY — add hideLabel?: boolean (suppress <span>Checklist</span> when true)
```

7 files change; no new files, no new exports beyond three optional `hideLabel` props and the `size="xl"` opt-ins. No schema, migration, env, or API-shape change.

Data flow is unchanged: `TicketAttributeForm` still uses one `useForm<FormValues>` seeded from `defaultValues`, bridges to the leaf controls via `watch`/`setValue`, and calls `onSubmit(values)` on valid submit. F44 only restructures how those controls are arranged on screen and which primitive wraps them.

---

## 5. Parallelization Strategy

Tasks are grouped into **3 batches** by dependency order. T2 and T3 are decoupling edits to **disjoint** files from T1 and from each other, so they can run in parallel; T1 is the central restructure; T4 is the verification gate.

### Batch dependency diagram

```
Batch A (T1: TicketAttributeForm restructure)
        │
        ├── needs the new hideLabel seam ──┐
        │                                  ▼
        │   Batch B (T2 ‖ T3 — disjoint files)
        │   T2: PrioritySelect + UserSelect hideLabel
        │   T3: ChecklistEditor hideLabel
        │                                  │
        │                                  ▼
        └──────────────────────────► Batch C (T4: size="xl" in consumers + tests + verify)
```

- Batch A → Batch B: hard barrier — T1 imports `<PrioritySelect hideLabel />`, `<UserSelect hideLabel />`, `<ChecklistEditor hideLabel />`; those props must exist (T2/T3) or T1 won't typecheck. **Practical sequencing:** land T2+T3 first (they are backward-compatible additive props), then T1.
- Batch B → Batch C: hard barrier — T4 widens the modals (needs the two-column form to fill `xl` meaningfully) and runs the full suite.

### Merge order rules

1. **Batch B merges first** — T2 and T3 are independent additive `hideLabel` props (default `false` → fully backward compatible; no consumer is forced to change). Either order; both touch disjoint files.
2. **Batch A merges second** — T1 restructures `TicketAttributeForm.tsx` and consumes the new `hideLabel` seam. Requires T2+T3 on `main`.
3. **Batch C merges last** — T4 opts the two modals into `size="xl"`, adds/updates tests, and runs the verification gate. Requires T1 on `main`.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T2** | B | `PrioritySelect.tsx`, `UserSelect.tsx` | — (F35/F43 done) | T3 |
| **T3** | B | `ChecklistEditor.tsx` | — | T2 |
| **T1** | A | `TicketAttributeForm.tsx` | T2, T3 | — |
| **T4** | C | `CreateTicketModal.tsx`, `TicketDetailModal.tsx`, `TicketAttributeForm.test.tsx` (+ verification) | T1 | — |

### Developer assignment tracks

- **Solo:** T2 → T3 → T1 → T4 (or T3 → T2 → T1 → T4).
- **2 devs:** Dev-A: T2 → T1; Dev-B: T3 → (then) T4. T1 waits on both T2+T3; T4 waits on T1.
- **3 devs:** Dev-A T2, Dev-B T3 (parallel); then Dev-A T1; then Dev-B/C T4.

---

## 6. Tasks

### T2 — PrioritySelect + UserSelect: add `hideLabel` opt-in

**Batch:** B · **Depends on:** None (F35/F43 done) · **Parallel with:** T3

**Description:** `PrioritySelect` and `UserSelect` each render their own `<label><span>…</span><select aria-label=…></label>`. F44 needs to wrap the **bare** `<select>` in the F35 `Field` primitive (which supplies the `<label>`), so add an optional `hideLabel?: boolean` (default `false`) to both. When `hideLabel` is `true`, render only the `<select>` (keep `aria-label` verbatim — it is the test anchor). When `false`/omitted, behavior is byte-identical to today (backward compatible). Do not migrate raw colors here — F45/F46 own that.

Create / Modify:
- `frontend/src/components/PrioritySelect.tsx` — add `hideLabel?: boolean` to `PrioritySelectProps`; branch the wrapper.

```tsx
import { Flag } from 'lucide-react';
import { PRIORITY_DISPLAY } from '@/types/ticket';
import type { Priority } from '@/types/ticket';

const PRIORITIES = Object.keys(PRIORITY_DISPLAY) as Priority[];

interface PrioritySelectProps {
    value: Priority;
    onChange: (p: Priority) => void;
    /** F44: when true, render only the <select> (label + icon supplied by the
     *  surrounding <Field>). Keeps the component usable standalone. */
    hideLabel?: boolean;
}

export function PrioritySelect({ value, onChange, hideLabel = false }: PrioritySelectProps) {
    const select = (
        <select
            aria-label="Priority"
            value={value}
            onChange={(e) => onChange(e.target.value as Priority)}
            className="w-full rounded border border-gray-300 p-2"
        >
            {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                    {PRIORITY_DISPLAY[p]}
                </option>
            ))}
        </select>
    );

    if (hideLabel) return select;

    return (
        <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                <Flag size={14} /> Priority
            </span>
            {select}
        </label>
    );
}
```

- `frontend/src/components/UserSelect.tsx` — same shape (`UserCircle` icon, `hideLabel` default `false`).

```tsx
import { UserCircle } from 'lucide-react';
import { useUsers } from '@/hooks/useUsers';

interface UserSelectProps {
    value: string | null;
    onChange: (userId: string | null) => void;
    /** F44: when true, render only the <select> (label + icon supplied by the
     *  surrounding <Field>). */
    hideLabel?: boolean;
}

export function UserSelect({ value, onChange, hideLabel = false }: UserSelectProps) {
    const { data: users, isLoading } = useUsers();

    const select = (
        <select
            aria-label="Assignee"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
            className="w-full rounded border border-gray-300 p-2"
            disabled={isLoading}
        >
            <option value="">Unassigned</option>
            {users?.map((u) => (
                <option key={u.id} value={u.id}>
                    {u.fullName}
                </option>
            ))}
        </select>
    );

    if (hideLabel) return select;

    return (
        <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                <UserCircle size={14} /> Assignee
            </span>
            {select}
        </label>
    );
}
```

Notes for the implementer:
- `aria-label="Priority"` / `aria-label="Assignee"` must remain verbatim — `TicketAttributeForm.test.tsx` queries by them.
- When `hideLabel` is true, the component returns the bare `<select>` (no wrapping `<label>`); the F44 `Field` provides the visible label + icon.
- Default path (`hideLabel` omitted) is unchanged so any other consumer is unaffected.
- 2-space TS indent, 4-space JSX indent, ≤100 cols, no `any`.

**Acceptance Criteria:**
- [ ] `PrioritySelectProps` and `UserSelectProps` each declare `hideLabel?: boolean` with JSDoc; default `false` in the destructure.
- [ ] `hideLabel` true → component returns only the `<select>` (no `<label>`, no `<span>`); `aria-label` retained.
- [ ] `hideLabel` false/omitted → renders the prior `<label><span>icon+text</span><select></label>` (icon now present in the label).
- [ ] `Flag` / `UserCircle` imported from `lucide-react` (already a dependency).
- [ ] No `any`; both files compile with `tsc --noEmit`.

**Dependencies:** None (F35/F43 done).

---

### T3 — ChecklistEditor: add `hideLabel` opt-in

**Batch:** B · **Depends on:** None · **Parallel with:** T2

**Description:** `ChecklistEditor` renders its own `<span>Checklist</span>` header + `doneCount/total` + progress bar + list + add-row. F44 wraps it in `Field` (label "Checklist" + `ListChecks`), so the `<span>Checklist</span>` becomes redundant. Add `hideLabel?: boolean` (default `false`); when true, suppress only the `<span>Checklist</span>` word — keep the `doneCount/total` count and the progress bar (those are not duplicated by `Field`). Backward compatible.

Create / Modify:
- `frontend/src/components/ChecklistEditor.tsx` — add the prop; branch the header row only.

```tsx
// …existing imports + constants unchanged…

interface ChecklistEditorProps {
    value: ChecklistItem[];
    onChange: (items: ChecklistItem[]) => void;
    disabled?: boolean;
    /** F44: when true, suppress the leading <span>Checklist</span> word (the
     *  surrounding <Field> supplies the label). The done/total count and the
     *  progress bar always render. */
    hideLabel?: boolean;
}

export function ChecklistEditor({ value, onChange, disabled, hideLabel = false }: ChecklistEditorProps) {
    // …existing state + handlers unchanged…

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                {!hideLabel && <span className="text-sm font-medium">Checklist</span>}
                <span className={hideLabel ? 'text-xs text-gray-500' : 'text-xs text-gray-500'}>
                    {doneCount}/{total}
                </span>
            </div>

            {/* total > 0 progress bar — unchanged */}
            {/* <ul>…</ul> — unchanged */}
            {/* add-item row — unchanged */}
            {/* atCapacity note — unchanged */}
        </div>
    );
}
```

Notes for the implementer:
- Only the header row changes: gate the `<span>Checklist</span>` on `!hideLabel`. The `doneCount/total` count, progress bar, list, and add-row are untouched.
- When `hideLabel` is true the count still shows (right-aligned); `Field` provides the word "Checklist" + `ListChecks` icon above it.
- Default (`hideLabel` omitted) is byte-identical to today.
- Keep the rest of the file (constants, handlers, list markup) exactly as-is.

**Acceptance Criteria:**
- [ ] `ChecklistEditorProps` declares `hideLabel?: boolean` with JSDoc; default `false`.
- [ ] `hideLabel` true → the `<span>Checklist</span>` word is suppressed; `doneCount/total` count and progress bar still render.
- [ ] `hideLabel` false/omitted → header renders exactly as today.
- [ ] No `any`; compiles with `tsc --noEmit`.

**Dependencies:** None.

---

### T1 — TicketAttributeForm: two-column grid + Field wrapping + Button footer

**Batch:** A · **Depends on:** T2, T3 · **Parallel with:** —

**Description:** Restructure `frontend/src/components/TicketAttributeForm.tsx` from a single-column `space-y-4` list into the `grid grid-cols-1 lg:grid-cols-3 gap-6` two-column layout. The `schema`, `FormValues`, `useForm` call, `onDirtyChange` effect, and the `<fieldset disabled={readOnly}>` wrapper are **frozen** (D10). Changes are purely structural:
- Left column (`lg:col-span-2`): Title + Description, each in `<Field>` with the `AlignLeft` icon.
- Right column (`lg:col-span-1`, `lg:max-h-[70vh] lg:overflow-y-auto lg:pr-1`): Priority, Assignee, Labels, Checklist — each in `<Field>` with its §3.3 icon; Priority/Assignee use `hideLabel`, Labels/Checklist are wrapped directly.
- Footer (outside the `<fieldset>`): sticky, right-aligned, `<Button variant="primary" type="submit">` + `<Button variant="outline" type="button">`. Labels unchanged. `readOnly` hides Save and relabels Cancel → Close (as today).

Create / Modify:
- `frontend/src/components/TicketAttributeForm.tsx` — full target file:

```tsx
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlignLeft, Flag, UserCircle, Tags, ListChecks } from 'lucide-react';

import { ChecklistEditor } from './ChecklistEditor';
import { LabelMultiSelect } from './LabelMultiSelect';
import { RichTextEditor } from './RichTextEditor';
import { PrioritySelect } from './PrioritySelect';
import { UserSelect } from './UserSelect';
import { Field } from './ui/Field';
import { Button } from './ui/Button';
import type { ChecklistItem, Priority, UpdateTicketDto } from '@/types/ticket';

// F44: schema + form state FROZEN (PRD §10). Only the JSX layout, the Field
// wrapping, and the footer buttons changed vs. the single-column form.
const schema = z.object({
    title: z.string().min(1, 'Title is required').max(200, 'Title must be 200 chars or fewer'),
    description: z.string().max(5000, 'Description must be 5000 chars or fewer'),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL']),
    assigneeId: z.string().uuid().nullable(),
    labelIds: z.array(z.string().uuid()).default([]),
    checklist: z
        .array(
            z.object({
                id: z.string().uuid(),
                text: z.string().min(1).max(200),
                done: z.boolean(),
            }),
        )
        .max(50)
        .default([]),
});
type FormValues = z.infer<typeof schema>;

interface TicketAttributeFormProps {
    mode: 'create' | 'edit';
    projectSlug: string;
    defaultValues: FormValues;
    onSubmit: (values: UpdateTicketDto) => void | Promise<void>;
    onCancel: () => void;
    onDirtyChange?: (dirty: boolean) => void;
    readOnly?: boolean;
}

export function TicketAttributeForm({
    mode,
    projectSlug,
    defaultValues,
    onSubmit,
    onCancel,
    onDirtyChange,
    readOnly,
}: TicketAttributeFormProps) {
    const {
        register,
        handleSubmit,
        watch,
        setValue,
        formState: { errors, isSubmitting, isDirty },
    } = useForm<FormValues>({
        // zod@3.25 output widened; resolver lib expects narrower shape. Cast bridges gap.
        resolver: zodResolver(schema as never),
        defaultValues,
    });

    // F16: surface dirty state to the host so it can guard close/navigation.
    useEffect(() => {
        onDirtyChange?.(isDirty);
    }, [isDirty, onDirtyChange]);

    const submitLabel = mode === 'create' ? 'Create ticket' : 'Save changes';

    return (
        <form
            onSubmit={handleSubmit((values) => onSubmit(values as UpdateTicketDto))}
            className="space-y-6"
            noValidate
        >
            {/* F17: <fieldset disabled> wraps BOTH columns so readOnly disables
                every editable field at once. The footer lives outside it so
                Cancel/Close stay clickable while disabled. */}
            <fieldset
                disabled={readOnly}
                className="grid grid-cols-1 gap-6 border-0 p-0 m-0 lg:grid-cols-3"
            >
                {/* LEFT 2/3 — Title + Description (+ optional Activity). */}
                <div className="space-y-4 lg:col-span-2">
                    <Field label="Title" error={errors.title?.message}>
                        <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                            <AlignLeft size={14} />
                        </span>
                        <input
                            type="text"
                            aria-label="Title"
                            {...register('title')}
                            className="w-full rounded border border-gray-300 p-2"
                        />
                    </Field>

                    <Field
                        label="Description"
                        error={errors.description?.message}
                    >
                        <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                            <AlignLeft size={14} />
                        </span>
                        {readOnly ? (
                            // F17: read-only view of the archived (sanitized) description.
                            <div
                                className="max-w-none rounded border border-gray-200 bg-gray-50 p-2 text-sm"
                                dangerouslySetInnerHTML={{ __html: watch('description') ?? '' }}
                            />
                        ) : (
                            <RichTextEditor
                                value={watch('description') ?? ''}
                                onChange={(html) => setValue('description', html)}
                            />
                        )}
                    </Field>
                </div>

                {/* RIGHT 1/3 — Priority / Assignee / Labels / Checklist.
                    Scrolls independently for long checklists (PRD edge case). */}
                <div className="space-y-4 lg:col-span-1 lg:max-h-[70vh] lg:overflow-y-auto lg:pr-1">
                    <Field label="Priority" error={errors.priority?.message}>
                        <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                            <Flag size={14} />
                        </span>
                        <PrioritySelect
                            hideLabel
                            value={watch('priority')}
                            onChange={(p: Priority) => setValue('priority', p)}
                        />
                    </Field>

                    <Field label="Assignee" error={errors.assigneeId?.message}>
                        <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                            <UserCircle size={14} />
                        </span>
                        <UserSelect
                            hideLabel
                            value={watch('assigneeId') ?? null}
                            onChange={(id) => setValue('assigneeId', id)}
                        />
                    </Field>

                    <Field label="Labels">
                        <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                            <Tags size={14} />
                        </span>
                        <LabelMultiSelect
                            projectSlug={projectSlug}
                            value={watch('labelIds')}
                            onChange={(ids: string[]) => setValue('labelIds', ids)}
                        />
                    </Field>

                    <Field label="Checklist">
                        <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                            <ListChecks size=  {14} />
                        </span>
                        <ChecklistEditor
                            hideLabel
                            value={watch('checklist')}
                            onChange={(items: ChecklistItem[]) => setValue('checklist', items)}
                        />
                    </Field>
                </div>
            </fieldset>

            {/* F44: sticky footer, right-aligned, single Button size. Lives
                outside <fieldset disabled> so Cancel/Close remain clickable. */}
            <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 flex justify-end gap-2 border-t border-border bg-background px-6 py-3">
                {!readOnly && (
                    <Button type="submit" variant="primary" size="md" disabled={isSubmitting}>
                        {submitLabel}
                    </Button>
                )}
                <Button type="button" variant="outline" size="md" onClick={onCancel}>
                    {readOnly ? 'Close' : 'Cancel'}
                </Button>
            </div>
        </form>
    );
}
```

> **Implementer note on the icon rows:** the `<span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">` rows above each control render the §3.3 icon as a muted hint. The `Field` primitive already renders the visible `<span>label</span>` (from `label="Title"` etc.), so the icon row sits between the label and the control. If the designer prefers the icon **inline with the label text**, an alternative is to extend `Field` to accept an optional `icon?: ReactNode` rendered inside its label `<span>` — that is a clean F45 follow-up and is **not required** for F44 acceptance. Keep the standalone icon row for now; do not modify `Field.tsx` in this task. (Fix the stray `size=  {14}` typo to `size={14}` before committing.)

Notes for the implementer:
- **Frozen surfaces (D10):** `schema`, `FormValues`, `TicketAttributeFormProps`, the `useForm({...})` config, and the `onDirtyChange` effect must match the pre-F44 file byte-for-byte. Only the returned JSX tree differs.
- `<fieldset disabled={readOnly}>` now wraps the whole grid (both columns) — keep that; it is how F17 `readOnly` disables all fields at once.
- Footer buttons move **outside** the `<fieldset>` (so `Cancel`/`Close` stay enabled under `readOnly`). The `readOnly ? 'Close' : 'Cancel'` and the `!readOnly && Save` logic is preserved.
- `PrioritySelect`/`UserSelect`/`ChecklistEditor` are called with `hideLabel` (from T2/T3); `LabelMultiSelect` has no own `<label>` so it is wrapped directly in `Field` without `hideLabel`.
- `aria-label` strings on the controls are untouched → the 12 existing tests' queries stay valid.
- 2-space TS indent, 4-space JSX indent, ≤100 cols, no `any`.

**Acceptance Criteria:**
- [ ] Root `<form className="space-y-6">` wraps a `<fieldset className="grid grid-cols-1 gap-6 lg:grid-cols-3">`.
- [ ] Left column `<div className="space-y-4 lg:col-span-2">` holds Title + Description, each in `<Field>` with an `AlignLeft` icon row.
- [ ] Right column `<div className="space-y-4 lg:col-span-1 lg:max-h-[70vh] lg:overflow-y-auto lg:pr-1">` holds Priority, Assignee, Labels, Checklist — each in `<Field>` with its §3.3 icon; Priority/Assignee/Checklist pass `hideLabel`.
- [ ] Footer is `sticky bottom-0 -mx-6 -mb-6 mt-6 flex justify-end gap-2 border-t border-border bg-background px-6 py-3` with `<Button type="submit" variant="primary">` (hidden under `readOnly`) + `<Button type="button" variant="outline">`.
- [ ] `submitLabel` is `'Create ticket'` (create) / `'Save changes'` (edit); Cancel → `'Close'` under `readOnly`.
- [ ] `schema`, `FormValues`, `TicketAttributeFormProps`, `useForm` config, `onDirtyChange` effect unchanged.
- [ ] `Flag`, `UserCircle`, `Tags`, `ListChecks`, `AlignLeft` imported from `lucide-react`.
- [ ] No `any`; compiles with `tsc --noEmit`.

**Dependencies:** T2, T3.

---

### T4 — Consumers `size="xl"` + tests + integration verification

**Batch:** C (terminal) · **Depends on:** T1, T2, T3 · **Parallel with:** —

**Description:** Opt the two modal consumers into `size="xl"`, then add layout coverage to the form's test file, then run the full verification gate. This is the definition-of-done task.

Create / Modify:
- `frontend/src/components/CreateTicketModal.tsx` — add `size="xl"` to the `<Modal>` at `:31`.

```tsx
// …imports unchanged…
export function CreateTicketModal({ open, onClose, slug, columnId }: CreateTicketModalProps) {
    const createTicket = useCreateTicket(slug);

    const handleSubmit = async (values: UpdateTicketDto) => {
        await createTicket.mutateAsync({
            title: values.title as string,
            description: values.description ?? undefined,
            priority: values.priority,
            assigneeId: values.assigneeId ?? undefined,
            labelIds: values.labelIds,
            statusColumn: columnId,
            checklist: values.checklist,
        });
        onClose();
    };

    return (
        <Modal
            isOpen={open}
            onClose={onClose}
            titleId="create-ticket-title"
            title="Create ticket"
            size="xl"
        >
            <TicketAttributeForm
                mode="create"
                projectSlug={slug}
                defaultValues={{
                    title: '',
                    description: '',
                    priority: 'MEDIUM',
                    assigneeId: null,
                    labelIds: [],
                    checklist: [],
                }}
                onSubmit={handleSubmit}
                onCancel={onClose}
            />
        </Modal>
    );
}
```

- `frontend/src/components/TicketDetailModal.tsx` — add `size="xl"` to the `<Modal>` at `:210-217` (the only `<Modal>` in the file). Leave `modalBody` (form + siblings) untouched.

```tsx
            <Modal
                isOpen
                onClose={requestClose}
                onEsc={requestClose}
                titleId="ticket-detail-title"
                title={modalTitle}
                blockBackdropClose={isDirty}
                size="xl"
            >
                {modalBody}
            </Modal>
```

- `frontend/src/components/TicketAttributeForm.test.tsx` — append F44 layout tests inside the existing `describe('TicketAttributeForm', ...)` block. **Do not delete or alter the 12 existing tests.** The mocks (`RichTextEditor`/`PrioritySelect`/`UserSelect`/`LabelMultiSelect`) stay as-is; they render the same `aria-label`s, so existing queries keep working.

```tsx
// F44: two-column layout. The form renders a grid with two columns at lg+;
// fields are still queryable by the same aria-labels the mocks already expose.
describe('F44 two-column layout', () => {
    it('renders the two-column grid (lg:grid-cols-3) at the form root', () => {
        render(
            <TicketAttributeForm
                mode="create"
                projectSlug={PROJECT_SLUG}
                defaultValues={baseDefaults}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        const fieldset = document.querySelector('fieldset');
        expect(fieldset?.className).toContain('lg:grid-cols-3');
        expect(fieldset?.className).toContain('grid');
    });

    it('left column spans 2 tracks; right column spans 1 (lg)', () => {
        render(
            <TicketAttributeForm
                mode="create"
                projectSlug={PROJECT_SLUG}
                defaultValues={baseDefaults}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        const fieldset = document.querySelector('fieldset')!;
        const left = fieldset.querySelector('.lg\\:col-span-2');
        const right = fieldset.querySelector('.lg\\:col-span-1');
        expect(left).toBeInTheDocument();
        expect(right).toBeInTheDocument();
    });

    it('right column scrolls independently (lg:max-h + lg:overflow-y-auto)', () => {
        render(
            <TicketAttributeForm
                mode="create"
                projectSlug={PROJECT_SLUG}
                defaultValues={baseDefaults}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        const rightCol = document.querySelector('fieldset .lg\\:col-span-1');
        expect(rightCol?.className).toContain('lg:max-h-[70vh]');
        expect(rightCol?.className).toContain('lg:overflow-y-auto');
    });

    it('footer is sticky and right-aligned with single-size buttons', () => {
        render(
            <TicketAttributeForm
                mode="create"
                projectSlug={PROJECT_SLUG}
                defaultValues={baseDefaults}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        const footer = document.querySelector('form > div.sticky');
        expect(footer).toBeInTheDocument();
        expect(footer?.className).toContain('justify-end');
        // Both buttons are present; primary submit + outline cancel.
        expect(screen.getByRole('button', { name: 'Create ticket' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('readOnly still hides Save and shows Close (regression)', () => {
        render(
            <TicketAttributeForm
                mode="edit"
                projectSlug={PROJECT_SLUG}
                defaultValues={baseDefaults}
                readOnly
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    });
});
```

Notes for the implementer:
- The 12 existing tests query `Title`/`Description`/`Priority`/`Assignee` by `aria-label` and the buttons by role+name. Because the mocks render those labels unchanged and the footer button labels are preserved (`'Create ticket'`, `'Save changes'`, `'Cancel'`, `'Close'`), the existing tests pass without edits.
- The F44 tests assert on `className` via `document.querySelector` (the grid classes are on the `<fieldset>` and its children). Escaping the `:` in Tailwind responsive classes for `querySelector` requires the `\\:` form shown above.
- `querySelector('form > div.sticky')` targets the footer (it is the only direct child `<div>` of `<form>` with the `sticky` class). If the implementation places the footer differently, adjust the selector to match — but keep the assertion intent.
- Keep the table-driven / RTL style per `.claude/rules/js-testing-rules.md`; `getByRole`/`getByLabelText` priority is already used by the existing tests.

Steps (verification gate):
1. From `frontend/`: `npx tsc --noEmit` — confirm all 7 changed files typecheck (the new `hideLabel` props, `Field`/`Button` imports, grid classes, `size="xl"`).
2. From `frontend/`: `npx vitest run src/components/TicketAttributeForm.test.tsx` — confirm the 12 pre-existing tests + the new F44 layout tests are green.
3. From `frontend/`: `npm run lint` and `npx prettier --check` on the 7 changed files — zero warnings; 2-space TS / 4-space JSX / ≤100 cols.
4. Manual smoke (recommended): open the Create ticket modal and a Ticket detail modal in the running app at ≥ `lg` width — confirm two columns (left Title+Description, right meta sidebar), the right sidebar scrolls when the checklist is long, the footer is sticky and right-aligned, and below `lg` the layout collapses to one column (meta below description). Toggle dark mode to confirm the footer's `bg-background` has no bleed-through.
5. Confirm `readOnly` (soft-deleted ticket) still disables every field and swaps Save→Close.
6. Record the commit SHA and exit codes below.

**Acceptance Criteria:**
- [ ] `CreateTicketModal` and `TicketDetailModal` both pass `size="xl"` to `<Modal>`.
- [ ] The 12 pre-existing `TicketAttributeForm` tests pass unmodified.
- [ ] The 5 new F44 layout tests pass (grid, col spans, right-column scroll, sticky footer, readOnly regression).
- [ ] `tsc --noEmit` exits 0; `vitest run src/components/TicketAttributeForm.test.tsx` exits 0; lint + prettier exit 0 on changed files.
- [ ] `git diff --stat` shows exactly the 7 files in §4.
- [ ] Every F44 acceptance bullet from §1 is satisfied (two columns at `lg`+, single column below; all fields submit; dirty/readOnly unchanged; sticky single-size footer; §3.3 icons present; right column scrolls).

**Dependencies:** T1, T2, T3.

---

## 7. Final F44 Acceptance Checklist

- [ ] At `lg`+: form renders two columns (left 2/3 Title+Description, right 1/3 Priority/Assignee/Labels/Checklist); below `lg`: single column, meta below description.
- [ ] All fields still submit (the 12 pre-existing submit/validation tests stay green); dirty (`onDirtyChange`) and `readOnly` behavior unchanged.
- [ ] Footer is sticky, right-aligned, single `Button` size (`md`); Save hidden + Cancel→Close under `readOnly`.
- [ ] §3.3 icons present: `Flag`, `UserCircle`, `Tags`, `ListChecks`, `AlignLeft` (lucide).
- [ ] Right column scrolls independently (`lg:max-h-[70vh] lg:overflow-y-auto`) for long checklists.
- [ ] `PrioritySelect`/`UserSelect`/`ChecklistEditor` accept `hideLabel` (backward compatible); `Field` supplies their labels (no double `<label>`).
- [ ] `react-hook-form`/Zod schema, `FormValues`, `useForm` config, `onDirtyChange` effect — unchanged (PRD §10).
- [ ] `CreateTicketModal` + `TicketDetailModal` pass `size="xl"` (F43 `xl→max-w-4xl`).
- [ ] Collapsible Activity omitted (deferred per D11); existing `<ActivityFeed>` in `TicketDetailModal` untouched.
- [ ] Lint + format checks pass on an empty change.
- [ ] Typecheck + test pass.

**Integration record (fill during the terminal task):**
- Feature commit SHA: `________`
- Changed files (from `git diff --stat`): `frontend/src/components/TicketAttributeForm.tsx`, `frontend/src/components/TicketAttributeForm.test.tsx`, `frontend/src/components/CreateTicketModal.tsx`, `frontend/src/components/TicketDetailModal.tsx`, `frontend/src/components/PrioritySelect.tsx`, `frontend/src/components/UserSelect.tsx`, `frontend/src/components/ChecklistEditor.tsx`
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0`

---

## 8. Schema deltas owned by this feature

None. F44 is presentation-only (Tailwind layout classes, the F35 `Field`/`Button` primitives, three optional `hideLabel` props, and `size="xl"` opt-ins). No database, migration, env, or API-shape change.
