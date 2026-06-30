# Implementation Plan — SLYK-14

**Ticket:** `docs/deliverables/SLYK-14.md`
**Type:** Bug
**Title:** Form Field Label Icon/Text Alignment
**Generated:** 2026-06-30

---

## Summary

In the ticket modal form (`TicketAttributeForm`, used by both `CreateTicketModal` and `TicketDetailModal`), every field label shows the text on one line and its icon on the line *below* it, instead of the icon sitting inline to the left of the text. Additionally, the Labels field renders the caption "Labels" twice. The fix is to make the shared `Field` primitive own the icon (an optional `icon` prop rendered inline to the left of the label text on the same line), remove the six duplicated inline icon spans currently injected by each field in `TicketAttributeForm`, and remove the duplicate hardcoded "Labels" caption rendered by `LabelMultiSelect`. The result is a single, consistent label row per field (icon + text inline), in both light and dark themes, with no duplicate captions.

## Root Cause

The shared `Field` primitive at `frontend/src/components/ui/Field.tsx:28-40` renders its label as a block-level span and has **no icon support**:

```tsx
<label htmlFor={htmlFor} className={cn('block', className)}>
    <span className="mb-1 block text-sm font-medium">{label}</span>   // Field.tsx:31
    {children}
    ...
```

Because the primitive has no icon slot, each of the six fields in `frontend/src/components/TicketAttributeForm.tsx` (Title, Description, Priority, Assignee, Labels, Checklist) manually injects a **second, separate span as the first child of `<Field>`** — producing two stacked label-like rows: the primitive's plain-text label span, followed by the consumer's icon span (`mb-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground` + the lucide icon), then the control. The icon therefore lands on its own line below the text. Evidence: icon spans at `TicketAttributeForm.tsx:92-94`, `:103-105`, `:123-125`, `:134-136`, `:145-147`, `:156-158`.

The duplicate "Labels" caption has a separate cause: `LabelMultiSelect` renders its own hardcoded caption span at `frontend/src/components/LabelMultiSelect.tsx:61` (`<span className="mb-1 block text-sm font-medium">Labels</span>`) in addition to the `Field` primitive's caption for the same field (`TicketAttributeForm.tsx:143-144` passes `label="Labels"`). Unlike `PrioritySelect`, `UserSelect`, and `ChecklistEditor` — which each accept a `hideLabel` prop (used at `TicketAttributeForm.tsx:139, 151, 165`) to suppress their own caption — `LabelMultiSelect` always renders its caption unconditionally, so two stack vertically.

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| UI primitive | `frontend/src/components/ui/Field.tsx` | Add optional `icon` prop; render it inline to the left of the label text inside the existing label span. Update `FieldProps`. |
| Component | `frontend/src/components/TicketAttributeForm.tsx` | Remove the six duplicated inline icon spans (Title/Description/Priority/Assignee/Labels/Checklist); pass the icon via the new `icon` prop instead. |
| Component | `frontend/src/components/LabelMultiSelect.tsx` | Remove the hardcoded "Labels" caption span (`:61`) so only the `Field` caption shows. Preserve all SLYK-08 error/loading/empty states. |
| Test | `frontend/src/components/ui/Field.test.tsx` | Add coverage for the `icon` prop (inline, to the left of text, single row). Keep existing assertions green. |
| Tests (regression) | `frontend/src/components/TicketAttributeForm.test.tsx`, `CreateTicketModal.test.tsx`, `NewTicketButton.test.tsx`, `TicketDetailModal.test.tsx`, `LabelMultiSelect.test.tsx` | Verify no caption-count/icon-placement regressions; keep green. |

> **Unaffected by design:** `AddMemberModal.tsx` uses `Field` six times (`:241, :283, :302, :312, :322, :331`) **without** an icon. Because the new `icon` prop is optional and the no-icon path renders exactly as today, `AddMemberModal` stays byte-for-byte identical. This is a key safety property of the fix.

## Proposed Implementation

### Frontend Changes

#### 1. Extend the `Field` primitive with an optional inline icon

**File:** `frontend/src/components/ui/Field.tsx`
**What:**
- Add an optional `icon?: React.ReactNode` (or `icon?: LucideIcon` if type-tightness is preferred — but `ReactNode` keeps it flexible and matches how it's consumed) to `FieldProps` (`Field.tsx:10-20`).
- In the render body (`Field.tsx:28-40`), change the label span so that when `icon` is provided it renders the icon inline to the **left** of the label text on the same line, using a flex row. Keep the existing label span as the single source of truth (no second span).
- Concretely: switch the label `<span className="mb-1 block text-sm font-medium">` to `<span className="mb-1 flex items-center gap-1.5 text-sm font-medium">` and render `{icon}{label}` when `icon` is set, or just `{label}` when not.
- **Theme consistency:** use only the existing token-based classes — do NOT introduce `dark:` variants (none exist in this form today). The label currently inherits the default foreground (high-contrast in both themes); keep that — do **not** add `text-muted-foreground` to the unified label span, since that would change the label color across all six fields and `AddMemberModal`. If a muted look is desired it can be opt-in later; for this bugfix, preserve current label color (no explicit color class).
- **Icon sizing:** callers currently use lucide `size={14}`. The `icon` prop will receive an already-sized icon element (e.g. `<AlignLeft size={14} />`), so `Field` just renders it verbatim — no size coercion.

**Why:** Single ownership of the label row inside the primitive removes the duplicated span pattern entirely and gives every field a consistent inline layout by default.
**Code reference:** builds on the existing label span at `Field.tsx:31`. `AddMemberModal` usages confirm the no-icon path must remain unchanged.

#### 2. Move icons into the `Field` `icon` prop in `TicketAttributeForm`

**File:** `frontend/src/components/TicketAttributeForm.tsx`
**What:** For each of the six `<Field>` usages, delete the inline icon span (the `<span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">` with the lucide icon) and pass that icon via the new `icon` prop on `<Field>` instead. Net effect per field: one `<Field label="…" icon={<Icon size={14} />} …>` and the control, with no extra span.

| Field | `<Field>` call site | Icon to move | Icon |
|-------|---------------------|--------------|------|
| Title | `TicketAttributeForm.tsx:90-91` | `:92-94` | `AlignLeft size={14}` |
| Description | `:101-102` | `:103-105` | `AlignLeft size={14}` |
| Priority | `:121-122` | `:123-125` | `Flag size={14}` |
| Assignee | `:132-133` | `:134-136` | `UserCircle size={14}` |
| Labels | `:143-144` | `:145-147` | `Tags size={14}` |
| Checklist | `:154-155` | `:156-158` | `ListChecks size={14}` |

The lucide-react import at `TicketAttributeForm.tsx:5` is retained (still needed to pass the icon elements).

**Why:** Removes the duplicated markup that caused the icon-on-a-separate-line bug; makes every field rely on the primitive's single, consistent inline label.
**Code reference:** each icon span being removed is the consumer-side anti-pattern described in the Root Cause; the new `Field` `icon` prop is its replacement.

#### 3. Remove the duplicate "Labels" caption from `LabelMultiSelect`

**File:** `frontend/src/components/LabelMultiSelect.tsx`
**What:** Delete the unconditional caption span at `LabelMultiSelect.tsx:61` (`<span className="mb-1 block text-sm font-medium">Labels</span>`). The `Field` caption (`TicketAttributeForm.tsx:143-144`, `label="Labels"`) becomes the single, authoritative caption — matching how `PrioritySelect`/`UserSelect`/`ChecklistEditor` already behave (they suppress their own caption and rely on the `Field` caption).
**Why:** Eliminates the stacked duplicate caption. Consistent with sibling controls that already rely solely on the `Field` caption.
**Code reference:** the duplicate is `LabelMultiSelect.tsx:61`; the canonical caption stays at `TicketAttributeForm.tsx:143-144`.

**SLYK-08 regression guard — MUST preserve (do not touch these):**
- `LabelMultiSelect.tsx:20` — `const { data: labels = [], isLoading, isError, refetch } = useLabels(projectSlug);` (keep `isError` + `refetch`).
- `LabelMultiSelect.tsx:25` — `canManageLabels` computation.
- `LabelMultiSelect.tsx:68-70` — trigger `disabled={isLoading || isError}`.
- `LabelMultiSelect.tsx:77-82` — error state `<Retry message="Couldn't load labels" onRetry={() => void refetch()} />`.
- `LabelMultiSelect.tsx:85-90` — loading skeleton beneath the disabled trigger.
- `LabelMultiSelect.tsx:95-111` — popover empty state with role-aware `<EmptyState>` and `action`.

Removing line 61 alone is the minimal, safe change; it does not intersect any of the above branches.

#### 4. Update / add tests

**File:** `frontend/src/components/ui/Field.test.tsx`
**What:** Add a table-driven case for the `icon` prop: when `icon` is provided, the label container is a flex row with the icon rendered **before** the label text on the same line (assert the icon element precedes the label text in DOM order, and the label span has `flex items-center`). Keep the existing no-`icon` tests (label rendered, error rendered with `role="alert"`) green to lock in the `AddMemberModal`-compatible no-icon path.
**Why:** Locks in the inline-left behavior and the no-regression no-icon path.

**Files:** `TicketAttributeForm.test.tsx`, `LabelMultiSelect.test.tsx` (and the modal tests).
**What:** Add a regression assertion that each field renders **exactly one** caption and that icons appear on the same line as their label text. For `LabelMultiSelect`, assert "Labels" caption count === 1. Reuse existing mock setup (`TicketAttributeForm.test.tsx:42`, `CreateTicketModal.test.tsx:41`, `NewTicketButton.test.tsx:39`, `TicketDetailModal.test.tsx:45`).
**Why:** Prevents both bugs from silently returning.

## Edge Cases & Risks

- **`AddMemberModal` must not change.** It uses `Field` without an icon (`AddMemberModal.tsx:241, :283, :302, :312, :322, :331`). The `icon` prop is optional; the no-icon branch must render exactly as today (block label span, no flex). Verify with the existing `Field.test.tsx` no-icon assertions plus a visual check of `AddMemberModal`.
- **Label color drift.** The consumer icon spans currently carry `text-muted-foreground`; the `Field` label has no explicit color (inherits default foreground). The unified label should **not** add `text-muted-foreground`, or every label (including `AddMemberModal`) would mute. Keep the label at default foreground; only the icon inherits the label color. If a muted label is later desired, make it opt-in — out of scope here.
- **Icon sizing.** Callers pass `<Icon size={14} />` (already-sized elements). `Field` renders the node verbatim; do not wrap with a fixed size that could override.
- **DOM-order assertion correctness.** "Icon to the left" means the icon node precedes the label text in the flex row — verify via DOM order in tests, not via CSS, since `flex` + source order is what places it left.
- **SLYK-08 regression.** The `LabelMultiSelect` change is a single-line removal of an unrelated caption; it must not touch loading/error/empty/`disabled`/`canManageLabels` logic. Re-run `LabelMultiSelect.test.tsx` after the change.
- **Accessibility.** The label span + `<label htmlFor>` association is unchanged. Icons are decorative; if any icon conveys meaning, ensure an `aria-hidden` on the lucide icon (lucide icons are decorative by default) — confirm no existing a11y test breaks.
- **Two themes.** No `dark:` variants exist in this area today; the refactor must keep using token classes only so light/dark both stay correct.

## Testing

*Project conventions: Vitest + Testing Library; table-driven; one behavior per test; co-locate `*.test.tsx` next to source.*

- **Unit tests — `Field`:** (a) no `icon` → renders label text, label span is `block` (AddMemberModal-compatible); (b) with `icon` → label span is `flex items-center`, icon node precedes label text in DOM order; (c) `error` still renders `<p role="alert">`; (d) `htmlFor` association preserved.
- **Unit tests — `LabelMultiSelect`:** "Labels" caption renders exactly once; SLYK-08 error/empty/loading states still behave (trigger disabled on `isLoading || isError`; `<Retry>` on error; skeleton on loading; role-aware `<EmptyState>` on empty).
- **Integration tests — `TicketAttributeForm`:** for each of the six fields, exactly one caption rendered and the icon shares the label row (assert icon and label text are siblings inside the same flex label span).
- **Regression tests:** `CreateTicketModal.test.tsx`, `NewTicketButton.test.tsx`, `TicketDetailModal.test.tsx`, `AddMemberModal` tests all stay green.
- **Manual verification:** open the ticket create/edit modal in both light and dark themes; confirm every field label shows icon + text on one line with the icon on the left, no field has a duplicate caption, and the Labels dropdown still shows error/loading/empty states correctly (SLYK-08).

## Acceptance Criteria

- [ ] Every field label (Title, Description, Priority, Assignee, Labels, Checklist) shows the icon to the **left** of the text on the **same line**.
- [ ] No field renders a duplicate caption; the Labels field shows "Labels" exactly once.
- [ ] Alignment is consistent across all fields and in **both** light and dark themes (token-based classes only, no `dark:` variants introduced).
- [ ] `AddMemberModal` is visually unchanged (uses `Field` without an icon; no-icon path renders as before).
- [ ] SLYK-08 `LabelMultiSelect` behavior preserved: trigger disabled on load/error, `<Retry>` on error, skeleton on loading, role-aware empty state on empty.
- [ ] All existing tests pass; new `Field` icon-prop and single-caption regression tests added and passing.

## Open Questions

- Should the unified label use a muted foreground (`text-muted-foreground`) to match the *current* look of the icon spans, or the default (high-contrast) foreground to match the *current* look of the `Field` label? **Recommendation:** default foreground (no explicit color), to avoid changing `AddMemberModal` and to keep this a pure alignment fix. If product wants the muted look, make it opt-in later.

## Out of Scope

- Re-styling labels (color, weight, size) beyond what's needed to place the icon inline.
- Adding a `hideLabel` prop to `LabelMultiSelect` for parity with `PrioritySelect`/`UserSelect`/`ChecklistEditor` — not needed since we simply remove its unconditional caption.
- Backend changes (none required — this is a pure frontend presentation bug).
- Refactoring the icon-as-JSX-element pattern to a `LucideIcon` type or a registry; the current pass-the-element approach is sufficient and keeps the diff minimal.
