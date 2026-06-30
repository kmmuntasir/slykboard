# Implementation Plan — SLYK-09

**Ticket:** `docs/deliverables/SLYK-09.md`
**Type:** Enhancement
**Title:** Ticket Details Modal Full Width
**Generated:** 2026-06-30

---

## Summary

The ticket details modal (`TicketDetailModal`) is currently capped at `max-w-4xl` (~896px) via the shared `Modal`'s `size="xl"` preset, which is the widest preset available. The ticket asks for the details modal to span almost the full viewport on large screens, capped at roughly `1400px` (`min(95vw, 1400px)`), while preserving the existing max-height and vertical-scroll behavior and keeping the wider layout balanced (no awkward stretching of form fields).

This is a small, self-contained **frontend-only** enhancement. The clean approach is to extend the shared `Modal`'s size-preset map with a new `'full'` preset resolving to `max-w-[min(95vw,1400px)]`, then switch `TicketDetailModal` from `size="xl"` to `size="full"`. No backend, no DB, no new dependencies.

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| UI / shared component | `frontend/src/components/Modal.tsx` | Define the new `'full'` width preset here (single source of truth for modal widths). |
| Feature component | `frontend/src/components/TicketDetailModal.tsx` | Switch its `size` prop from `"xl"` to `"full"`. |
| Layout reference (verify, possibly constrain) | `frontend/src/components/TicketAttributeForm.tsx` | Contains the only grid layout inside the modal (`grid-cols-1 lg:grid-cols-3`, left col `lg:col-span-2`) — the candidate for awkward stretching at ~1400px. |

> Note: the digest reported the `TicketDetailModal` `size="xl"` at both `:217` and `:226` depending on line numbering; the implementer should locate the literal `size="xl"` on the `<Modal>` rendered by `TicketDetailModal` and change that one occurrence.

## Proposed Implementation

### Frontend Changes

#### 1. Add the `'full'` width preset to the shared `Modal`

**File:** `frontend/src/components/Modal.tsx`
**What:** Extend the `ModalSize` union type and the `MODAL_SIZE_CLASS` lookup table (defined at `Modal.tsx:10-16`) to include a new `'full'` preset.

**Why:** Width is controlled exclusively through the `size` prop → `MODAL_SIZE_CLASS` map; this is the single seam to add a new width. No call site passes an inline width class today, so centralizing keeps the pattern consistent.

**Code reference (existing pattern at `Modal.tsx:10-16`):**
```ts
type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const MODAL_SIZE_CLASS: Record<ModalSize, string> = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
};
```

**Change:**
```ts
type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const MODAL_SIZE_CLASS: Record<ModalSize, string> = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-[min(95vw,1400px)]',
};
```

Tailwind v4 arbitrary-value syntax supports `min(95vw,1400px)` directly inside `max-w-[...]` (spaces become underscores; commas are allowed). Precedent for arbitrary values already exists in the codebase (`Modal.tsx` uses `max-h-[90vh]`; `ProjectPicker.tsx:44` uses `max-w-[10rem]`). The `w-full` already on the panel (`Modal.tsx:55-58`) makes the panel fluid, so only the `max-w-*` cap needs to be set here.

#### 2. Preserve max-height & scrolling (no change required — verify)

**File:** `frontend/src/components/Modal.tsx`
**What:** The panel base classes already include `max-h-[90vh] ... overflow-y-auto` (`Modal.tsx:55-58`). The new `'full'` preset is merged into these via `cn(...)`, so the wider panel **automatically** inherits the 90vh cap and vertical scroll.

**Why:** The ticket explicitly requires that existing close/scroll behavior stays intact. Because height/overflow handling lives in the static base classes and not per-preset, the `'full'` preset needs zero extra code to satisfy this. No change needed — just a verification step.

#### 3. Apply `'full'` to the ticket details modal

**File:** `frontend/src/components/TicketDetailModal.tsx`
**What:** On the `<Modal>` rendered by `TicketDetailModal` (the one currently passing `size="xl"`, at `TicketDetailModal.tsx:226`), change the prop to `size="full"`. Leave all other props (`isOpen`, `onClose`, `onEsc`, `titleId`, `title`, `blockBackdropClose={isDirty}`) unchanged.

**Why:** This is the actual delivery of the ticket — making the details modal wide. All other modals (`CreateTicketModal`, `AddMemberModal`, confirm dialogs, etc.) keep their existing sizes untouched.

#### 4. (Verification / optional guard) Keep the wider layout balanced

**File:** `frontend/src/components/TicketAttributeForm.tsx` (read-only verify, optional tweak)
**What:** `TicketAttributeForm.tsx:92` lays out content as `grid grid-cols-1 gap-6 lg:grid-cols-3`, with the left column (`:97`) at `lg:col-span-2` holding the title + description, and the right 1/3 column holding metadata. At ~1400px this grid stretches linearly (the 3-col shape is already in effect past Tailwind's `lg` = 1024px breakpoint, so widening mostly enlarges columns rather than reshaping).

**Why:** Acceptance criterion says the wider layout must "remain balanced (no awkward stretching of form fields)". The grid won't break, but the description textarea / metadata column could feel sprawling at 1400px.

**Recommended action:** Implement steps 1–3 first, then visually verify at ≥1400px width. Only if the description textarea visibly sprawls, optionally cap the form's max read-width (e.g. wrap the `<form>` content or constrain the left column) — keep such a tweak minimal and scoped to this modal path so other consumers of `TicketAttributeForm` (if any) are unaffected. If the layout looks balanced, do **not** add a constraint (avoid scope creep).

## Edge Cases & Risks

- **Grid stretching at ~1400px:** The `TicketAttributeForm` 2:1 grid is the only layout risk; addressed as an optional verify-then-tweak in step 4. Mitigated by the form already being 3-col well before 1400px (shape is stable; only column widths grow).
- **Other consumers of `Modal`:** Adding a new `'full'` key to `MODAL_SIZE_CLASS` and the `ModalSize` union is purely additive — no existing call site changes behavior (none pass `'full'` today, and `Record<ModalSize, string>` forces the new key to be handled). Default stays `'md'`.
- **`TicketAttributeForm` reuse:** If `TicketAttributeForm` is used elsewhere (e.g. inside `CreateTicketModal`), any width constraint tweak must not bleed into those consumers. Confine optional constraints to the `TicketDetailModal`-rendered path or to the modal shell.
- **Tailwind v4 arbitrary-value support:** `min(95vw,1400px)` inside `max-w-[...]` is supported by Tailwind v4 (this project uses `@tailwindcss/vite`, no `tailwind.config`). Confirmed there are no custom `--container-*` / `--breakpoint-*` tokens in `@theme inline` (`frontend/src/index.css:97-141`) — arbitrary-value classes are the established pattern here.
- **Viewport gutter:** The backdrop wrapper uses `p-4` (`Modal.tsx:48`), so at 95vw there's a natural ~8px+ gutter on each side — no risk of the panel touching screen edges.
- **No horizontal overflow expected:** New max-width is in `vw`/`px`, not `%` of an arbitrary parent; the panel is centered in a fixed full-screen backdrop, so horizontal overflow is not a concern.

## Testing

*Follow project conventions — Vitest + Testing Library (frontend); table-driven tests; one behavior per test; co-locate `*.test.tsx` next to source.*

- **Unit tests (`Modal.test.tsx`):** Add a case asserting that `size="full"` renders the panel with the expected class (`max-w-[min(95vw,1400px)]`) and that the base classes (`max-h-[90vh]`, `overflow-y-auto`, `w-full`) are still applied. Use table-driven coverage over all `ModalSize` values → expected class to lock the preset map.
- **Component test (`TicketDetailModal.test.tsx`):** If one exists, assert the rendered `<Modal>` receives `size="full"`. (If no test file exists today, this is optional / out of scope per "high reusability" — prefer the Modal-level unit test.)
- **Manual verification:**
  - Open the ticket details modal at a large viewport (≥1400px) — confirm it spans ~1400px and is centered with a gutter.
  - Narrow the viewport below 1400px — confirm it drops to ~95vw smoothly with no horizontal scrollbar.
  - Confirm content still scrolls vertically when taller than 90vh; confirm close button + backdrop + Esc still work; confirm `blockBackdropClose` guard (unsaved changes) still blocks backdrop close.
  - Visually confirm the `TicketAttributeForm` grid stays balanced; only tweak per step 4 if it sprawls.

## Acceptance Criteria

- [ ] The shared `Modal` exposes a new `'full'` width preset resolving to `~min(95vw, 1400px)`.
- [ ] `TicketDetailModal` renders with `size="full"`.
- [ ] On large screens (≥1400px) the details modal spans almost the full viewport, capped at ~1400px and centered.
- [ ] Below 1400px, the modal gracefully drops to ~95vw with no horizontal overflow.
- [ ] Existing `max-h-[90vh]` cap and vertical scroll behavior are preserved.
- [ ] Close button, backdrop-click close, and Esc close still work; `blockBackdropClose` (unsaved-changes) guard intact.
- [ ] Content remains readable and well-proportioned at the new width (no awkward field stretching).
- [ ] Other modals in the app are unchanged (additive-only change to `Modal`).
- [ ] A `Modal.test.tsx` case covers the new preset's class and preserved base classes.

## Open Questions

- None material. The only discretionary item is whether the `TicketAttributeForm` grid needs a width cap at ~1400px (step 4) — left as a visual-verify-then-decide during implementation, defaulting to no change if balanced.

## Out of Scope

- Backend / API / DB changes (none needed).
- Changes to any modal other than `TicketDetailModal` (`CreateTicketModal`, `AddMemberModal`, confirm dialogs, etc. keep current sizes).
- Introducing a Tailwind theme token (`--container-*` / `--breakpoint-*`) for the new width — arbitrary-value syntax is the established pattern here.
- Redesigning the `Modal` into a variant/theming system (no such system exists today; out of scope).
- Splitting the modal into a sticky-header + scrollable-body layout (the current whole-panel scroll is the existing behavior and is to be preserved).
