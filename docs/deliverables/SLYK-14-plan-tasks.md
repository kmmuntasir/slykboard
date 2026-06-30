# Task Breakdown — SLYK-14

**Source plan:** `docs/deliverables/SLYK-14-plan.md`
**Type:** Bug — Form Field Label Icon/Text Alignment
**Generated:** 2026-06-30

> **Note on line numbers:** All file references below use the **current, verified** line numbers from a Phase-1 codebase audit. The plan's original citations were stale by ~1–6 lines; implementers should re-anchor by grep before editing.

---

## Parallelization Strategy (merge-order rules)

Batches are **dependency-ordered, not time-ordered**. Merge in this order; never merge a later batch before an earlier one on `develop`.

1. **Batch 1 = foundation, fully parallel.** The three Batch-1 tasks touch **disjoint files** (`Field.tsx`, `LabelMultiSelect.tsx`, `Field.test.tsx`) with **zero overlapping edits**, so they can be developed on three separate branches and landed in any order. *Merge caveat:* if both the `Field.tsx` (B1-1) and `Field.test.tsx` (B1-3) branches will be rebased onto the same base, merge **B1-1 before B1-3** to avoid a trivial rebase conflict over the new prop in the `FieldProps` interface. B1-2 (`LabelMultiSelect.tsx`) is conflict-free with both.
2. **Batch 2 = consumers, strictly after Batch 1.** Every Batch-2 task depends on the **merged** Batch-1 change it consumes:
   - B2-4 (`TicketAttributeForm.tsx` icon migration + regression tests) → **requires B1-1 (`Field.tsx` `icon` prop) merged first.** If merged before B1-1, it references a non-existent prop → compile break.
   - B2-5 (`LabelMultiSelect.test.tsx` "Labels" count===1 assertion) → **requires B1-2 (caption removed) merged first.** If merged before B1-2, the assertion fails (two captions still present).
   - These two Batch-2 tasks are disjoint (`TicketAttributeForm.tsx`/`.test.tsx` vs `LabelMultiSelect.test.tsx`) and can run in parallel **after** their respective Batch-1 dependency is merged.
3. **Batch 3 = final verification, after ALL of B1 + B2.** Single task, single developer, merge last. Nothing in B3 edits source — it only runs the suite and does manual/visual checks — so it cannot be parallelized; it is the gate.

**Merge order (strict):**

```
B1-1 → B1-3              (both touch Field; merge 1 before 3 to avoid trivial conflict)
B1-2  (anytime in B1, conflict-free)
───── B1 complete ─────
B2-4  (needs B1-1)   ‖   B2-5  (needs B1-2)     ← parallel, disjoint files
───── B2 complete ─────
B3-6  (needs B1∪B2)  ← merge LAST
```

**Conflict rule of thumb:** two branches can be developed in parallel iff they edit **disjoint files** (verify with `git diff --name-only`). When two branches both edit `Field.tsx` or `FieldProps`, sequence them.

---

## Visual Batch-Dependency Diagram

```
                        ┌─────────────────────────────────────────────┐
                        │            BATCH 1  (parallel)              │
                        │   disjoint files · merge in any order       │
                        │   (merge B1-1 before B1-3: both touch Field)│
                        │                                             │
   B1-1  Field.tsx ───────────┐                                       │
        (add icon prop)       │                                       │
                              │       B1-2  LabelMultiSelect.tsx      │
                              │            (remove caption :62)       │
                              │                  │                    │
                              │       B1-3  Field.test.tsx            │
                              │            (icon-prop coverage)       │
                              │                  │  (merge AFTER B1-1)│
                        └─────┼──────────────────┼────────────────────┘
                              │                  │
              ╔═══════════════╪══════════════════╪═══════╗  ← merge barrier:
              ║   "B1 fully merged to develop"   │       ║    no B2 work
              ╚═══════════════╪══════════════════╪═══════╝    starts before this
                              ▼                  ▼
                        ┌─────────────────────────────────────────────┐
                        │            BATCH 2  (parallel)              │
                        │   each task waits on its specific B1 parent │
                        │                                             │
   B2-4  TicketAttributeForm.tsx       B2-5  LabelMultiSelect.test.tsx│
        + .test.tsx                         ("Labels" count===1)      │
        (needs B1-1) ────────────────  (needs B1-2) ──────────────────│
                              │                  │                    │
                        └─────┼──────────────────┼────────────────────┘
                              │                  │
              ╔═══════════════╪══════════════════╪═══════╗  ← merge barrier:
              ║   "B2 fully merged to develop"   │       ║    B3 cannot
              ╚═══════════════╪══════════════════╪═══════╝    start before this
                              ▼                  ▼
                        ┌─────────────────────────────────────────────┐
                        │      BATCH 3  (serial · gate · merge LAST)  │
                        │                                             │
                        │   B3-6  Final verification                  │
                        │         • npm test (7 specs)                │
                        │         • AddMemberModal unchanged          │
                        │         • light + dark themes               │
                        │         • SLYK-08 states intact             │
                        │         (depends on B1∪B2 — ALL)            │
                        └─────────────────────────────────────────────┘
```

Legend: solid arrows = hard merge dependency (consumer cannot compile/assert without the producer merged). `‖` inside a batch = parallel-safe (disjoint files). `╔═╗` barriers = global merge checkpoints on `develop`.

---

## Task Summary Table

| # | Batch | Target File | Dependencies | Can-Parallel-With |
|---|-------|-------------|--------------|-------------------|
| B1-1 | 1 | `frontend/src/components/ui/Field.tsx` (add `icon` prop) | None | B1-2, B1-3 (disjoint files) |
| B1-2 | 1 | `frontend/src/components/LabelMultiSelect.tsx` (remove caption `:62`) | None | B1-1, B1-3 (disjoint files) |
| B1-3 | 1 | `frontend/src/components/ui/Field.test.tsx` (icon-prop coverage) | None *(merge after B1-1 to avoid prop-interface rebase conflict)* | B1-2 (disjoint); B1-1 OK to develop in parallel but **merge after B1-1** |
| B2-4 | 2 | `frontend/src/components/TicketAttributeForm.tsx` + `TicketAttributeForm.test.tsx` (icon migration + single-caption/inline-icon regression tests) | **B1-1 merged** | B2-5 (disjoint files) |
| B2-5 | 2 | `frontend/src/components/LabelMultiSelect.test.tsx` ("Labels" count===1 assertion) | **B1-2 merged** | B2-4 (disjoint files) |
| B3-6 | 3 | *(no source — verification)* full `npm test` across 7 specs + manual theme/visual/SLYK-08 checks | **B1-1, B1-2, B1-3, B2-4, B2-5 all merged** | nothing (terminal gate) |

---

## Developer Assignment Tracks

**Track A — "Field owner" (owns the primitive end-to-end):**
B1-1 (`Field.tsx`) → B1-3 (`Field.test.tsx`) → **(handoff)** B2-4 (`TicketAttributeForm.tsx` icon migration + regression tests) → standby for B3-6.
*Rationale:* one mind owns the `icon` prop contract (interface + test + first real consumer). Minimizes prop-API churn.

**Track B — "LabelMultiSelect owner" (owns the duplicate-caption fix):**
B1-2 (`LabelMultiSelect.tsx` caption removal) → B2-5 (`LabelMultiSelect.test.tsx` count===1) → **(handoff)** run B3-6's SLYK-08 states portion.
*Rationale:* caption removal + its regression assertion + the SLYK-08 preservation guard are one cohesive responsibility; keeps the SLYK-08 risk isolated to one dev.

**Track C — "Verifier / integration":**
During Batch 2, confirm the modal regression sweep stays green (`CreateTicketModal.test`, `NewTicketButton.test`, `TicketDetailModal.test`, `AddMemberModal.test`), then **own B3-6 outright** (full `npm test`, theme + `AddMemberModal` visual checks).
*Rationale:* the verifier meets the integration surface (all five modal tests) before B3, so B3 is a confirmation, not a discovery.

**Minimum viable:** 2 devs (Track A + Track B) cover all of B1+B2; Track C folds into whoever is free. **3 devs** unlock full parallelism in B1 and B2.

**Critical handoff rule:** Track A must merge B1-1 before B2-4 can start; Track B must merge B1-2 before B2-5 can start. Coordinate the B1 merge checkpoint as a single sync point.

---

## BATCH 1 — Foundation (parallel, zero-dependency)

### Task B1-1 — Extend `Field` primitive with an optional inline `icon` prop

**Title:** SLYK-14: Add optional `icon` prop to the `Field` primitive, rendered inline-left of the label text

**Description:**

File: `frontend/src/components/ui/Field.tsx`

The shared `Field` primitive currently renders a plain block label span with no icon support. The label markup is a single span at `Field.tsx:24`:
```tsx
<span className="mb-1 block text-sm font-medium">{label}</span>
```
The `FieldProps` interface (`Field.tsx:8-15`) has no `icon` field.

**Modify:**
- **`FieldProps` interface** (`Field.tsx:8-15`): add `/** Optional icon rendered inline-left of the label text (on the same line). */ icon?: ReactNode;`. `ReactNode` is already imported (`Field.tsx:5`) — prefer `ReactNode` over `LucideIcon` to keep the prop flexible and match how it is consumed (callers pass already-sized `<Icon size={14} />` elements).
- **Component signature** (`Field.tsx:18`): destructure `icon` from props.
- **Label span** (`Field.tsx:24`): branch on `icon`.
  - When `icon` is present → render `<span className="mb-1 flex items-center gap-1.5 text-sm font-medium">{icon}{label}</span>` (icon **before** label text → icon visually left in the flex row).
  - When absent → keep the current span **verbatim**: `<span className="mb-1 block text-sm font-medium">{label}</span>`. This preserves `AddMemberModal`'s six icon-less usages byte-for-byte.

**Constraints:**
- Render the `icon` node **verbatim** — do not coerce size or wrap it. Callers pass already-sized elements.
- Do **NOT** add `text-muted-foreground` to the unified label span. Doing so would mute every label, including `AddMemberModal`. Keep the label at the default foreground (no explicit color class).
- Do **NOT** introduce `dark:` variants. Tailwind v4 here is CSS-first via `@theme inline` in `frontend/src/index.css`; token classes automatically theme-correct in both light/dark.
- `error` rendering (`<p role="alert">`), `htmlFor` association, and the outer `<label className={cn('block', className)}>` wrapping must remain unchanged.

**Code references:** label span `Field.tsx:24`; `FieldProps` `Field.tsx:8-15`; render body `Field.tsx:21-30`; `AddMemberModal.tsx:241,283,302,312,322,331` (no-icon consumers that define the safety contract).

**Acceptance Criteria:**
- [ ] `FieldProps` has a documented `icon?: ReactNode` field.
- [ ] With `icon` set: label span class is `mb-1 flex items-center gap-1.5 text-sm font-medium`, and the icon node precedes `{label}` in DOM order (icon visually left).
- [ ] Without `icon`: label span class is exactly `mb-1 block text-sm font-medium` (unchanged from current — `AddMemberModal`-compatible).
- [ ] No `text-muted-foreground`, no `dark:` variants added anywhere.
- [ ] `error` still renders `<p role="alert">`; `htmlFor` association preserved; outer `<label>` `cn('block', className)` behavior unchanged.
- [ ] Component compiles cleanly under the project `tsconfig` (`jsx: react-jsx`, path alias `@/* → ./src/*`).

**Dependencies:** None.

---

### Task B1-2 — Remove the duplicate "Labels" caption from `LabelMultiSelect`

**Title:** SLYK-14: Delete the unconditional duplicate "Labels" caption span in `LabelMultiSelect`

**Description:**

File: `frontend/src/components/LabelMultiSelect.tsx`

`LabelMultiSelect` unconditionally renders its own hardcoded caption span at `LabelMultiSelect.tsx:62`:
```tsx
<span className="mb-1 block text-sm font-medium">Labels</span>
```
This stacks as a duplicate on top of the `Field` caption passed via `label="Labels"` from `TicketAttributeForm.tsx:152`. Sibling controls (`PrioritySelect`, `UserSelect`, `ChecklistEditor`) already suppress their own caption via a `hideLabel` prop; `LabelMultiSelect` has no such suppression, so a pure removal of this single span is the minimal fix. (Do **not** add a `hideLabel` prop to `LabelMultiSelect` — removal is sufficient and keeps the diff minimal.)

**Modify:**
- Delete the single caption span at `LabelMultiSelect.tsx:62` (the `<span className="mb-1 block text-sm font-medium">Labels</span>` line inside the root `<div ref={containerRef}>`, immediately above the trigger `<button>`).

**SLYK-08 regression guard — MUST preserve (do NOT touch these):**
- `useLabels` destructure including `isError` + `refetch` — `LabelMultiSelect.tsx:26`.
- `canManageLabels` computation — `LabelMultiSelect.tsx:29`.
- Trigger `disabled={isLoading || isError}` — `LabelMultiSelect.tsx:70` (on the `<button>` at `:64`).
- Error → `<Retry message="Couldn't load labels" onRetry={() => void refetch()} />` inside the `{isError && (...)}` block starting `:78` (`:82-84`).
- Loading skeleton (`{isLoading && (...)}`) with `<SkeletonLine className="h-4 w-1/2" />` and `<SkeletonLine className="h-4 w-2/3" />` — `:88-93`.
- Popover empty state with role-aware `<EmptyState>` and conditional `action`, using `canManageLabels` — `:95-121`.

Removing only line 62 does **not** intersect any of these branches.

**Code references:** duplicate caption `LabelMultiSelect.tsx:62`; canonical caption stays at `TicketAttributeForm.tsx:152` (`label="Labels"`); sibling `hideLabel` pattern: `PrioritySelect.tsx:33`, `UserSelect.tsx:34`.

**Acceptance Criteria:**
- [ ] The `<span ...>Labels</span>` caption above the trigger button is removed.
- [ ] The diff is a **single-line deletion** — no other line in `LabelMultiSelect.tsx` is modified.
- [ ] Trigger `disabled={isLoading || isError}` intact.
- [ ] `<Retry>`, `<SkeletonLine>`, and role-aware `<EmptyState>` branches untouched.
- [ ] Component still compiles; `LabelMultiSelect.test.tsx` stays green.

**Dependencies:** None.

---

### Task B1-3 — Add `icon`-prop coverage to `Field.test.tsx`

**Title:** SLYK-14: Add table-driven `icon`-prop test coverage to `Field.test.tsx` (inline-left, no-icon unchanged)

**Description:**

File: `frontend/src/components/ui/Field.test.tsx`

The existing `Field.test.tsx` covers label text, `error` (`role="alert"` present/absent), `htmlFor` association, and children — but has no coverage for the `icon` prop added in B1-1. Add table-driven cases asserting the inline-left behavior and that the no-icon path stays `block` (locks in `AddMemberModal` compatibility). All five pre-existing `it` blocks must remain unchanged and green.

**Add (table-driven preferred, one behavior per `it`):**

- *Behavior: with `icon`* → renders the provided icon node; the label span class contains `flex` and `items-center`; and the icon element **precedes** the label text in DOM order (icon visually left).
  - Pass a sentinel icon such as `<span data-testid="field-icon">ⓘ</span>` as the `icon` prop; locate the label via `getByText(label)`; assert the label span's `classList` contains `flex` and `items-center`; assert the icon (`getByTestId('field-icon')`) is a child of the same label span and precedes the text node (use `compareDocumentPosition` returning `Node.DOCUMENT_POSITION_PRECEDING`, or assert `span.querySelector('[data-testid="field-icon"]')` comes before the text in source order).
- *Behavior: without `icon`* → label span class is `block` (not `flex`); no icon rendered.

**Implementation notes:**
- This is a **DOM-order** assertion (the plan's "DOM-order assertion correctness" risk): `flex` + source order is what places the icon left — assert via DOM order, not via CSS.
- Import `vi` from `vitest` only if needed; the project uses Vitest 3 + Testing Library (`@testing-library/react@16`), `vite.config.ts` with `environment: 'jsdom'`, `globals: true`, setup `./src/test-setup.ts`.

**Code references:** existing `it` blocks in `Field.test.tsx` (label `:11`, `role="alert"` `:21`/`:30`, `htmlFor` `:40`, children `:48`); the prop under test is B1-1's product at `Field.tsx:24`.

**Acceptance Criteria:**
- [ ] New test(s) assert: when `icon` is provided, the label span class includes `flex items-center` and the icon precedes the label text in DOM order.
- [ ] New test asserts: without `icon`, the label span retains the `block` class (no flex).
- [ ] All 5 pre-existing tests remain unchanged and pass.
- [ ] `npm test -- frontend/src/components/ui/Field.test.tsx` is green (after B1-1 is merged).

**Dependencies:** None at edit time. *Runtime:* the new `icon` assertions can only pass once B1-1 ships. This task is edit-conflict-free with B1-1 (disjoint files) and may be authored in parallel; **merge B1-1 before B1-3** to avoid a trivial rebase conflict over the new prop in the interface.

---

## BATCH 2 — Consumers (after their Batch-1 dependency)

### Task B2-4 — Migrate the six `TicketAttributeForm` icons into the `Field` `icon` prop + add single-caption/inline-icon regression tests

**Title:** SLYK-14: Remove the six duplicated inline icon spans in `TicketAttributeForm`, pass icons via `Field`'s `icon` prop, and add label-row regression tests

**Description:**

**Part A — Icon migration.** File: `frontend/src/components/TicketAttributeForm.tsx`.

Once `Field` exposes the `icon` prop (B1-1), remove the six duplicated consumer-side icon spans and pass each icon via `<Field icon={…}>`. Each icon span is a sibling of the control, sitting between the `<Field label=…>` opening tag and the control, of the form:
```tsx
<span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
    <LucideIcon size={14} />
</span>
```

Per-field before/after (line numbers from the verified current source):

| # | Field | `<Field>` opens at | Icon span lines | Icon element | After |
|---|-------|--------------------|-----------------|--------------|-------|
| 1 | Title | `:96` | `:97-99` | `<AlignLeft size={14} />` | `<Field label="Title" error={…} icon={<AlignLeft size={14} />}>` + control only |
| 2 | Description | `:108` | `:109-111` | `<AlignLeft size={14} />` | `<Field label="Description" error={…} icon={<AlignLeft size={14} />}>` + control only |
| 3 | Priority | `:130` | `:131-133` | `<Flag size={14} />` | `<Field label="Priority" error={…} icon={<Flag size={14} />}>` + `<PrioritySelect hideLabel …/>` |
| 4 | Assignee | `:141` | `:142-144` | `<UserCircle size={14} />` | `<Field label="Assignee" error={…} icon={<UserCircle size={14} />}>` + `<UserSelect hideLabel …/>` |
| 5 | Labels | `:152` | `:153-155` | `<Tags size={14} />` | `<Field label="Labels" icon={<Tags size={14} />}>` + `<LabelMultiSelect …/>` (no `hideLabel` — that prop does not exist) |
| 6 | Checklist | `:163` | `:164-166` | `<ListChecks size={14} />` | `<Field label="Checklist" icon={<ListChecks size={14} />}>` + `<ChecklistEditor hideLabel dense …/>` |

**Net structural change per field:** delete the three-line `<span>…<Icon/></span>` block; add `icon={<Icon size={14} />}` to the opening `<Field>` tag. No new spans, no new classes, no color/`text-muted-foreground` migration (the `Field` label keeps the default foreground per B1-1).

**Keep unchanged:**
- The `lucide-react` import at `TicketAttributeForm.tsx:5` (`import { AlignLeft, Flag, UserCircle, Tags, ListChecks } from 'lucide-react';`) — still needed to pass icon elements.
- Sibling `hideLabel` usage on `PrioritySelect` (`:136`), `UserSelect` (`:147`), `ChecklistEditor` (`:167`). `LabelMultiSelect` has no `hideLabel` and does **not** get one here (its duplicate caption is removed in B1-2).
- Every control's props, the `register`/`watch`/`setValue` wiring, the zod schema, the `<fieldset disabled={readOnly}>` wrapper, and the sticky footer.

**Part B — Regression tests.** File: `frontend/src/components/TicketAttributeForm.test.tsx`.

Add a new `describe('SLYK-14 label row', …)` block reusing the existing mock setup already wired at the top of the file (`RichTextEditor`/`PrioritySelect`/`UserSelect`/`LabelMultiSelect` mocks + `baseDefaults`). Two table-driven behaviors:

- *Behavior A — each field renders exactly one caption.* For each label text in `['Title','Description','Priority','Assignee','Labels','Checklist']`, assert the caption text appears **exactly once** in the rendered form (e.g. `screen.getAllByText(label).length === 1`). *Note:* the consumer icon spans being removed in Part A contained only the icon (no text), so the duplicate-caption signal for the icon-on-its-own-line bug is structural (DOM) — pair Behavior A with B.

- *Behavior B — the icon shares the label row.* For each of the six fields, assert that the caption text and the lucide `<svg>` icon are children of the **same** `Field` label span, the span's `classList` contains `flex` and `items-center`, the span contains exactly one `<svg>`, and the `<svg>` **precedes** the caption text in DOM order (icon on the left). This is the plan's "DOM-order assertion correctness" — verify via source/DOM order, not CSS.

Because the mocked `PrioritySelect`/`UserSelect`/`LabelMultiSelect`/`ChecklistEditor` don't render real lucide icons, the icons under test come from the `Field` `icon` prop (B1-1) + `TicketAttributeForm`'s lucide import (Part A) — the mocks don't interfere with the label row. Keep all existing assertions green (the `getByLabelText('Title'|'Description'|'Priority'|'Assignee')` queries rely on `aria-label` set by the mocks — unaffected).

**Code references:** icon spans `TicketAttributeForm.tsx:97-99,109-111,131-133,142-144,153-155,164-166`; `Field` call sites `:96,108,130,141,152,163`; replacement API = B1-1's `FieldProps.icon` + flex label span. Existing test render helper pattern in `TicketAttributeForm.test.tsx`; `baseDefaults` at top of the test file; mock block at top of the test file.

**Acceptance Criteria:**
- [ ] All six `<Field>` usages carry an `icon={…}` prop matching the table (Title/Description → `AlignLeft size={14}`, Priority → `Flag size={14}`, Assignee → `UserCircle size={14}`, Labels → `Tags size={14}`, Checklist → `ListChecks size={14}`).
- [ ] Zero occurrences of the consumer icon-span class string `mb-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground` remain in `TicketAttributeForm.tsx` (`grep -c` === 0).
- [ ] `PrioritySelect`/`UserSelect`/`ChecklistEditor` still receive `hideLabel` (`:136,147,167`); `LabelMultiSelect` is unchanged by this task.
- [ ] The `lucide-react` import line `:5` is intact and still exports all five icons; no stray `<AlignLeft|Flag|UserCircle|Tags|ListChecks>` usages remain other than the six `icon={…}` props and the import.
- [ ] New `describe('SLYK-14 label row')` block added; all pre-existing `describe`/`it` blocks untouched and still passing.
- [ ] Behavior A asserts each of the six captions appears exactly once.
- [ ] Behavior B asserts, for each field, the caption span has class `flex` + `items-center`, contains exactly one `<svg>`, and the `<svg>` precedes the caption text in DOM order.
- [ ] Behavior B **fails** against the pre-fix markup (sanity check): temporarily reverting Part A makes Behavior B fail — confirms the test actually guards the bug.
- [ ] `npm test -- TicketAttributeForm` is green end-to-end after B1-1 + B2-4 land. No new mock introduced; no change to `baseDefaults`.
- [ ] No change to `AddMemberModal.tsx` (uses `Field` without `icon` — unaffected).

**Dependencies:** **B1-1** (`Field.tsx` `icon` prop + flex label span). This task cannot compile/assert until `FieldProps.icon` exists and the label span renders `{icon}{label}` inline. Hard dependency.

---

### Task B2-5 — Add "Labels" caption count===1 regression assertion to `LabelMultiSelect.test.tsx`

**Title:** SLYK-14: Assert the "Labels" caption renders exactly once in `LabelMultiSelect.test.tsx`

**Description:**

File: `frontend/src/components/LabelMultiSelect.test.tsx`

This test file renders the **real** `LabelMultiSelect` component (not a mock), and is therefore the only place that exercises the duplicate-caption markup. Add a regression assertion that the "Labels" caption appears **exactly once** (the file currently does not count captions — it queries the trigger button by name via `getByRole('button', { name: 'Labels' })`, which matches uniquely today because the caption is a plain `<span>`, not a button). After B1-2 removes the unconditional caption span, the `Field` caption (passed via `label="Labels"` from `TicketAttributeForm.tsx:152`) becomes the single authoritative caption — but note that `LabelMultiSelect` rendered in isolation here does **not** wrap itself in a `Field`, so the "Labels" text should appear **zero** times as a caption span inside `LabelMultiSelect`'s own DOM, and the trigger button still resolves by name.

**Add:**
- A `describe('SLYK-14 duplicate caption', …)` block with an `it` asserting that `container.querySelectorAll('span')` yields no span whose text content is exactly `"Labels"` (i.e. the hardcoded caption is gone). Keep the existing SLYK-08 state assertions (loading disabled, `<Retry>` on error, `<SkeletonLine>` on loading, role-aware `<EmptyState>` on empty) green and unmodified.

**Reuse** the existing mock setup / render helpers already present in the file (do not introduce a new mock). Do not couple this assertion to `LabelMultiSelect`'s parent `Field` caption — that interaction is covered by the integration check in B3-6 and by B2-4's `TicketAttributeForm` tests.

**Code references:** duplicate caption removed by B1-2 at `LabelMultiSelect.tsx:62`; existing SLYK-08 assertions in `LabelMultiSelect.test.tsx` (trigger button by name "Labels", disabled while loading/error, Retry, skeleton, EmptyState, role-aware CTA).

**Acceptance Criteria:**
- [ ] New assertion verifies no span with text content `"Labels"` exists inside the rendered `LabelMultiSelect`'s DOM (caption removed).
- [ ] All pre-existing SLYK-08 state assertions (loading disabled, error → Retry, loading → skeleton, empty → role-aware EmptyState) remain unmodified and green.
- [ ] No new mock introduced; existing render helpers reused.
- [ ] `npm test -- LabelMultiSelect` is green after B1-2 + B2-5 land.

**Dependencies:** **B1-2** (`LabelMultiSelect.tsx` caption removal merged). If merged before B1-2, the new assertion fails (caption span still present).

---

## BATCH 3 — Final Verification (gate, merge last)

### Task B3-6 — Full-suite verification + theme/visual sign-off

**Title:** SLYK-14: Final verification — full test suite green, AddMemberModal unchanged, both themes correct, SLYK-08 states intact

**Description:**

**Target:** no source files — verification only (read-only task; if it finds a defect, file a follow-up task rather than editing here).

**Objective:** Prove the SLYK-14 fix is complete, regression-free, and visually correct before the ticket is closed.

**Steps:**

1. **Automated suite — run the relevant Vitest specs and confirm each is green:**
   ```bash
   npm test -- Field.test TicketAttributeForm.test CreateTicketModal.test \
                NewTicketButton.test TicketDetailModal.test LabelMultiSelect.test AddMemberModal.test
   ```
   Confirm, specifically:
   - `Field.test.tsx` — no-icon path (`block` label) **and** new `icon` path (`flex items-center`, icon precedes label text in DOM order) pass.
   - `TicketAttributeForm.test.tsx` — each of the six fields renders **exactly one** caption; icon shares the label row.
   - `LabelMultiSelect.test.tsx` — hardcoded "Labels" caption span is gone; SLYK-08 states intact.
   - `CreateTicketModal.test.tsx`, `NewTicketButton.test.tsx`, `TicketDetailModal.test.tsx`, `AddMemberModal.test.tsx` — all green (regression).

2. **`AddMemberModal` visual unchanged check.** `AddMemberModal.tsx` uses `Field` six times **without** an icon (`:241, :283, :302, :312, :322, :331`). Open the modal and confirm its six labels render **identically** to pre-fix (block label span, no flex row, no icon slot) — the no-icon path must be byte-for-byte equivalent DOM on the label rows.

3. **Both themes.** Open `CreateTicketModal` and `TicketDetailModal` in **light** and **dark** themes. Confirm, per field (Title, Description, Priority, Assignee, Labels, Checklist):
   - icon sits to the **left** of the label text on the **same line** (single flex row),
   - no duplicate caption,
   - label color is the **default foreground** (not muted — verifies the "no `text-muted-foreground` drift" risk is avoided),
   - no `dark:` variants were introduced (token classes only).

4. **SLYK-08 `LabelMultiSelect` states intact** (the four mutually-exclusive branches):
   - **Loading:** trigger `disabled`; skeleton renders beneath trigger.
   - **Error:** trigger `disabled`; `<Retry message="Couldn't load labels" />` renders; `refetch()` wired.
   - **Empty:** popover opens to role-aware `<EmptyState>`; `canManageLabels` gates the "Create labels" action.
   - **Happy:** labels list renders, selection toggles, chips reflect `value`.

**Definition of Done:** all listed specs green; `AddMemberModal` visually unchanged; light + dark both correct; all four SLYK-08 states reproduced. Only then does SLYK-14 close.

**Acceptance Criteria:**
- [ ] All 7 named test specs green.
- [ ] `AddMemberModal` label rows visually unchanged from pre-fix.
- [ ] Light and dark themes both show icon-left / single-line / single-caption / default-foreground labels.
- [ ] All four SLYK-08 `LabelMultiSelect` states (loading, error, empty, happy) behave correctly.
- [ ] No `dark:` variants introduced anywhere in the touched files.

**Dependencies:** **B1-1, B1-2, B1-3, B2-4, B2-5** all merged to `develop`.

---

## Appendix — Plan-vs-Reality Line-Number Drift (for implementers)

The original plan's cited line numbers were stale; the breakdown above uses the **current, verified** numbers. Drift table:

| Item | Plan said | Actual (current) |
|------|-----------|------------------|
| `Field` label span | `Field.tsx:31` | `Field.tsx:24` |
| `FieldProps` interface | `Field.tsx:10-20` | `Field.tsx:8-15` |
| `Field` render body | `Field.tsx:28-40` | `Field.tsx:21-30` |
| Icon spans (Title…Checklist) | `:92-94 … :156-158` | `:97-99, :109-111, :131-133, :142-144, :153-155, :164-166` |
| `<Field>` opens (Title…Checklist) | `:90-91 … :154-155` | `:96, :108, :130, :141, :152, :163` |
| `LabelMultiSelect` duplicate caption | `:61` | `:62` |
| `AddMemberModal` `Field` sites | `:241, :283, :302, :312, :322, :331` | matches exactly |

**Implementation discipline:** re-anchor every reference by `grep` before editing; do not trust line numbers blindly.
