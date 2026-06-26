# F43 — Modal size prop + themeable panel + X icon (keep useModalA11y): Plan + Task Breakdown

> **Feature:** F43 — Modal size prop + themeable panel + X icon (keep useModalA11y) (Phase 2 — Ticket Modal & Forms · Enhancement)
> **Feature index:** [`ui-redesign-features.md`](../../ui-redesign-features.md)
> **Slug:** `SLYK` · **Depends on:** F35 (done) · **PRD ref:** §5.1 (Modal size + themeable + X), §2.5 (Modal.tsx:48 hardcoded), §9.2 (Radix react-dialog deferred)
> **Sources:** [`prd-ui-redesign.md`](../../../prd-ui-redesign.md), the project rules discovered for this repo, plus dependency feature task docs: [F35](../F35-shared-ui-primitives/F35-shared-ui-primitives-tasks.md)

---

## 1. F43 Recap

**Goal:** Make `Modal` size-aware and theme-correct without touching its a11y shell.

**Ships:** `Modal` accepts `size?: 'sm'|'md'|'lg'|'xl'` (`md` default, backward-compatible); panel uses `bg-background text-foreground border-border` (no `bg-white`); close button uses `<X size={20} />`.

**Acceptance (definition of done):**
- `size` maps `sm→max-w-md`, `md→max-w-lg` (default), `lg→max-w-2xl`, `xl→max-w-4xl`.
- `Modal.tsx:48` `bg-white` swapped for tokens; `×` → `<X>`.
- `useModalA11y` untouched (focus trap, Esc, scroll lock).
- Existing Modal consumers still work at default size.
- Test: `size` prop applies correct `max-w-*`; Esc still closes.

**Edge cases to resolve up front:**
- Radix `react-dialog` swap (§9.2) → **Decision:** deferred to a later feature; F43 keeps the hand-rolled `useModalA11y` shell. No new runtime dependency.
- Backward compatibility across 8 existing consumers (none pass `size` today, all default to `max-w-lg`) → **Decision:** default `'md'` maps to `max-w-lg`, the current panel width; zero consumer edits required.
- Close-button raw colors `text-gray-500 hover:text-gray-700` → **Decision:** migrate to `text-muted-foreground hover:text-foreground` tokens (implied by the theme-correct goal; F35 tokens are live).
- Close-button glyph swap and existing test querying `aria-label="Close dialog"` (`Modal.test.tsx:108`) → **Decision:** keep the `aria-label` unchanged; only the visible glyph swaps. Test survives untouched.

---

## 2. Codebase Analysis Summary

- **State:** partial. `Modal.tsx` exists (68 lines) and is consumed by 8 components; it lacks a `size` prop and uses hardcoded `bg-white` + a `×` glyph. F35 (tokens + primitives) is done — `bg-background`, `text-foreground`, `border-border`, `text-muted-foreground` resolve; `cn` lives at `@/components/ui/cn`; `lucide-react` `X` is importable.
- **Existing structure this feature builds on:**
  - `frontend/src/components/Modal.tsx` — `ModalProps` interface (`:10-20`), `useModalA11y({isOpen,onClose,onEsc})` wiring (`:31`), panel div at `:48` (`max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl outline-none`), close button at `:54-61` (`×` glyph, `aria-label="Close dialog"`, `text-2xl leading-none text-gray-500 hover:text-gray-700`).
  - `frontend/src/hooks/useModalA11y.ts` (83 lines) — focus trap + Esc + scroll lock + Tab wrap + focus restore; returns `{ dialogRef }`. **Frozen by F43.**
  - `frontend/src/components/ui/cn.ts` — `cn()` className merge helper (F35).
  - `frontend/src/components/Modal.test.tsx` (111 lines, 7 tests) — `aria-label="Close dialog"` query at `:108`.
- **Prior art / partial work:** none. This feature is the first size/theme pass over `Modal.tsx`.
- **Consumers (no edits required — backward compatible):** `ConfirmDiscardDialog`, `CreateTicketModal`, `ProjectColumnsManager`, `TicketDetailModal`, `TicketNotFound`, `DeleteTicketConfirm`, `SettingsPage`. All use the default `max-w-lg`; default `'md'` preserves this.
- **File paths the plan references that do NOT exist yet:** none. All targets exist; this is modify-only.
- **Project rules** this plan must satisfy:
  - `.claude/rules/js-style-guide.md` — no `any`; PascalCase components/types; explicit prop interfaces; 4-space JSX / 2-space TS; ≤100 cols.
  - `.claude/rules/js-testing-rules.md` — Vitest; table-driven preferred; RTL `getByRole` priority.
  - `.claude/rules/js-development-rules.md` — Tailwind classes (no inline styles); functional components + hooks.
  - `.claude/rules/git-guidelines.md` — commit prefix `SLYK-F43:`; rebase-and-merge only.
- **Hidden coupling to plan for:** none. The `size` map is pure presentation; `useModalA11y` is frozen; the `aria-label` string is the test's anchor and must not change.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Size → width mapping | **`sm→max-w-md`, `md→max-w-lg` (default), `lg→max-w-2xl`, `xl→max-w-4xl`** | Verbatim from PRD §5.1; `'md'` default preserves the current `max-w-lg` panel for all 8 consumers. |
| D2 | className composition | **`cn()` from `@/components/ui/cn`** | F35 primitive; merges the static panel base with the size-driven `max-w-*` without string concat. |
| D3 | Panel token swap | **`bg-background text-foreground border border-border`** replaces `bg-white` | PRD §5.1 verbatim; makes the panel theme-correct for light/dark. |
| D4 | Close glyph | **`<X size={20} />` from `lucide-react`** replaces `×` | PRD §5.1 verbatim; `lucide-react` already in tree. `aria-label="Close dialog"` retained for a11y + test stability. |
| D5 | Close-button recolor | **`text-muted-foreground hover:text-foreground`** replaces `text-gray-500 hover:text-gray-700` | F35 token migration implied by the theme-correct goal; removes last raw grays. |
| D6 | a11y shell | **`useModalA11y` frozen, untouched** | PRD §5.1 + §9.2: focus trap, Esc, scroll lock, focus restore stay hand-rolled; Radix swap deferred. |

> **Out of F43 scope (explicitly deferred):** Radix `@radix-ui/react-dialog` swap (tracked in PRD §9.2 for a later feature); any consumer-side opt-in to non-default sizes (consumers keep working at default `'md'`); `useModalA11y` internals.

> **Owner sign-off needed:** none. All decisions resolve to verbatim PRD text or to the F35 token migration already in motion.

---

## 4. Architecture Overview (Target Tree)

```
frontend/src/components/
├── Modal.tsx          # MODIFY — add size type + map, cn() panel, X icon, token swap, close recolor
└── Modal.test.tsx     # MODIFY — add size table-driven tests + X-icon present + Esc + backward-compat
```

Only 2 files change. No new files, no new exports beyond the optional `size` prop on `Modal`, no schema or env touch.

Data flow is unchanged: `Modal` renders into a `createPortal` at `document.body`, wires `useModalA11y` for the a11y shell, and now reads an optional `size` prop to pick the panel `max-w-*` class via `cn()`.

---

## 5. Parallelization Strategy

Tasks are grouped into **3 batches** by dependency order. This is a solo-sequential feature: each batch is a single task touching the same file set, so there is no intra-batch parallelism — batches gate each other.

### Batch dependency diagram

```
Batch A (T1: Modal.tsx)  →  Batch B (T2: Modal.test.tsx)  →  Batch C (T3: verify)
```

- Batch A → Batch B is a hard barrier: tests assert against the new `size` prop and `<X>` glyph that T1 introduces.
- Batch B → Batch C is a hard barrier: T3 runs the full suite (lint, typecheck, tests) against the merged result of T1+T2.

### Merge order rules

1. Batch A (T1) merges first — `Modal.tsx` carries the new `size` prop + themeable panel + X icon.
2. Batch B (T2) merges second — `Modal.test.tsx` adds size/Esc/X-icon/backward-compat coverage.
3. Batch C (T3) merges last — verification gate; records commit SHA + exit codes.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | A | `frontend/src/components/Modal.tsx` | — (F35 done) | — |
| **T2** | B | `frontend/src/components/Modal.test.tsx` | T1 | — |
| **T3** | C | (verification only — no edits) | T1, T2 | — |

### Developer assignment tracks

- **Solo:** T1 → T2 → T3.
- **2 devs:** not recommended — overlapping file (`Modal.tsx`/`Modal.test.tsx`); keep solo.
- **3 devs:** not applicable.

---

## 6. Tasks

### T1 — Modal: size prop + themeable panel + X icon

**Batch:** A · **Depends on:** None (F35 done) · **Parallel with:** —

**Description:** Modify `frontend/src/components/Modal.tsx` to (a) add an optional `size?: 'sm'|'md'|'lg'|'xl'` prop defaulting to `'md'`; (b) map it to a `max-w-*` class and compose the panel `className` with `cn()`; (c) swap the hardcoded `bg-white` panel for `bg-background text-foreground border border-border`; (d) replace the `×` glyph with `<X size={20} />` from `lucide-react`; (e) recolor the close button to `text-muted-foreground hover:text-foreground`. Leave `useModalA11y` and the `aria-label="Close dialog"` string untouched.

Create / Modify:
- `frontend/src/components/Modal.tsx` — add the size type + map + imports + recolor. Full target file:

```tsx
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { useModalA11y } from '../hooks/useModalA11y';
import { cn } from './ui/cn';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

// F43: size → panel width. 'md' default preserves the prior max-w-lg for all
// existing consumers (none pass size today → backward compatible).
const MODAL_SIZE_CLASS: Record<ModalSize, string> = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
};

// F16 D1: reusable accessible dialog shell (0 deps). Renders into a portal at
// document.body, wires the useModalA11y hook (focus trap, Esc, scroll lock,
// focus restore), and exposes backdrop-click + a labelled close button.
// `blockBackdropClose` disables backdrop-click close (e.g. for a dirty form).
interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    /** Intercept Esc (e.g. dirty-confirm). Falls back to onClose. */
    onEsc?: () => void;
    titleId: string;
    title: string;
    children: ReactNode;
    /** When true, a backdrop click does NOT close (e.g. dirty form). */
    blockBackdropClose?: boolean;
    /** Panel width preset. Defaults to 'md' (max-w-lg, backward-compatible). */
    size?: ModalSize;
}

export function Modal({
    isOpen,
    onClose,
    onEsc,
    titleId,
    title,
    children,
    blockBackdropClose,
    size = 'md',
}: ModalProps) {
    const { dialogRef } = useModalA11y({ isOpen, onClose, onEsc });
    if (!isOpen) return null;

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onMouseDown={(e) => {
                // Only close when the backdrop itself (not a child) is clicked.
                if (e.target === e.currentTarget && !blockBackdropClose) onClose();
            }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className={cn(
                    'max-h-[90vh] w-full overflow-y-auto rounded-lg border border-border bg-background p-6 text-foreground shadow-xl outline-none',
                    MODAL_SIZE_CLASS[size],
                )}
            >
                <div className="mb-4 flex items-center justify-between">
                    <h2 id={titleId} className="text-lg font-semibold">
                        {title}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close dialog"
                        className="text-muted-foreground hover:text-foreground"
                    >
                        <X size={20} />
                    </button>
                </div>
                {children}
            </div>
        </div>,
        document.body,
    );
}
```

Notes for the implementer:
- `cn()` merges the static panel base (now theme-correct) with `MODAL_SIZE_CLASS[size]`; the size class wins for `max-w-*`.
- The `aria-label="Close dialog"` string is the test's anchor (`Modal.test.tsx:108`) — do **not** change it.
- `useModalA11y({ isOpen, onClose, onEsc })` call is byte-identical to current — frozen per D6.
- 2-space TS indent, 4-space JSX indent, lines ≤100 cols.

**Acceptance Criteria:**
- [ ] `ModalProps` declares `size?: 'sm' | 'md' | 'lg' | 'xl'` with JSDoc; default `'md'` in the destructure.
- [ ] `MODAL_SIZE_CLASS` maps `sm→max-w-md`, `md→max-w-lg`, `lg→max-w-2xl`, `xl→max-w-4xl`.
- [ ] Panel `className` uses `cn(...)`; base contains `bg-background text-foreground border border-border` and no `bg-white` / no `max-w-lg` literal (the latter moved into the map).
- [ ] Close button renders `<X size={20} />` from `lucide-react`; no `×` glyph remains.
- [ ] Close button className is `text-muted-foreground hover:text-foreground` (no `text-gray-*`).
- [ ] `aria-label="Close dialog"` retained verbatim.
- [ ] `useModalA11y` call and `onMouseDown` backdrop logic unchanged.
- [ ] No `any`; explicit `ModalSize` type; file compiles with `tsc --noEmit`.

**Dependencies:** None (F35 done).

---

### T2 — Tests: size table-driven + Esc + X-icon + backward compat

**Batch:** B · **Depends on:** T1 · **Parallel with:** —

**Description:** Extend `frontend/src/components/Modal.test.tsx` with new cases for the F43 surface without regressing the existing 7 tests. Add: (a) a table-driven test asserting each `size` value applies the correct `max-w-*` class to the panel; (b) a test that pressing Escape triggers `onClose`; (c) a test that the close button renders the X icon (queryable via `aria-label="Close dialog"` → assert an SVG is present); (d) a backward-compat test rendering `Modal` with no `size` and asserting the panel carries `max-w-lg`.

Create / Modify:
- `frontend/src/components/Modal.test.tsx` — append the four new test groups below to the existing `describe('Modal', ...)` block (do not delete existing tests). Match the file's existing import style and RTL setup.

```tsx
// Table-driven: size prop → panel max-w-* class.
describe('Modal size prop', () => {
    const sizeCases = [
        { size: 'sm', expected: 'max-w-md' },
        { size: 'md', expected: 'max-w-lg' },
        { size: 'lg', expected: 'max-w-2xl' },
        { size: 'xl', expected: 'max-w-4xl' },
    ] as const;

    sizeCases.forEach(({ size, expected }) => {
        it(`applies ${expected} for size='${size}'`, () => {
            render(
                <Modal
                    isOpen
                    onClose={vi.fn()}
                    titleId="t1"
                    title="Size test"
                    size={size}
                >
                    body
                </Modal>,
            );
            const dialog = screen.getByRole('dialog');
            expect(dialog.className).toContain(expected);
        });
    });

    it('defaults to max-w-lg when size is omitted (backward compatible)', () => {
        render(
            <Modal isOpen onClose={vi.fn()} titleId="t1" title="Default size">
                body
            </Modal>,
        );
        expect(screen.getByRole('dialog').className).toContain('max-w-lg');
    });
});

// F43: Esc still closes (useModalA11y untouched — regression guard).
it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
        <Modal isOpen onClose={onClose} titleId="t1" title="Esc test">
            body
        </Modal>,
    );
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
});

// F43: X icon replaced the × glyph; the button is still reachable via its
// stable aria-label and now renders an SVG.
it('renders the X icon inside the close button', () => {
    render(
        <Modal isOpen onClose={vi.fn()} titleId="t1" title="Icon test">
            body
        </Modal>,
    );
    const closeBtn = screen.getByRole('button', { name: 'Close dialog' });
    expect(closeBtn.querySelector('svg')).toBeInTheDocument();
});
```

Notes for the implementer:
- The existing test at `:108` queries `aria-label="Close dialog"` — the X-icon test reuses the same label, so no selector churn.
- `fireEvent.keyDown(document.body, ...)` mirrors how `useModalA11y` attaches its Esc listener (document-level). If the existing suite already proves Esc via a different target, reuse that target for consistency.
- Keep the table-driven shape per `.claude/rules/js-testing-rules.md`; `getByRole` priority per the same rule.
- If the file uses `import { describe, it, expect, vi } from 'vitest'` and `import { render, screen, fireEvent } from '@testing-library/react'` already, do not re-import.

**Acceptance Criteria:**
- [ ] Four `size` cases (`sm`/`md`/`lg`/`xl`) each assert the panel `className` contains the mapped `max-w-*`.
- [ ] Backward-compat case: omitting `size` yields a panel with `max-w-lg`.
- [ ] Escape-press case asserts `onClose` called exactly once.
- [ ] X-icon case asserts the close button (via `aria-label="Close dialog"`) contains an `<svg>`.
- [ ] All 7 pre-existing tests still pass unmodified.
- [ ] `vitest run` is green; no `any` in new code.

**Dependencies:** T1.

---

### T3 — Integration verification & sign-off

**Batch:** C (terminal) · **Depends on:** T1, T2 · **Parallel with:** —

**Description:** The final definition-of-done gate. Run every tool against the as-merged feature (T1+T2 on the same branch), fix gaps, record proof. No code edits unless a tool fails.

Steps:
1. From `frontend/`: `npx tsc --noEmit` — confirm `Modal.tsx` typechecks (the new `size` prop, `ModalSize`, `MODAL_SIZE_CLASS`, `cn` import).
2. From `frontend/`: `npx vitest run src/components/Modal.test.tsx` — confirm the original 7 tests + the new F43 tests are green.
3. From `frontend/`: `npm run lint` (and `npx prettier --check src/components/Modal.tsx src/components/Modal.test.tsx`) — confirm zero warnings on changed files; 2-space TS / 4-space JSX / ≤100 cols.
4. Manual smoke (optional but recommended): render any existing consumer (e.g. `CreateTicketModal`) at default size in the running app and confirm the panel still appears at `max-w-lg`, is theme-correct in light + dark, the X icon is visible and clickable, and Escape closes it.
5. Confirm no consumer file needed an edit (backward compat) — `git diff --stat` should show only `Modal.tsx` and `Modal.test.tsx`.
6. Record the commit SHA and the four exit codes below.

**Acceptance Criteria:**
- [ ] `tsc --noEmit` exits 0.
- [ ] `vitest run src/components/Modal.test.tsx` exits 0 (all size, Esc, X-icon, backward-compat, and pre-existing tests pass).
- [ ] Lint + Prettier exit 0 on changed files.
- [ ] `git diff --stat` shows exactly `frontend/src/components/Modal.tsx` and `frontend/src/components/Modal.test.tsx` (no consumer edits).
- [ ] Every F43 acceptance bullet from §1 is satisfied: size map correct; `bg-white` gone + tokens applied; `×` → `<X>`; `useModalA11y` untouched; default-size consumers still render at `max-w-lg`.

**Dependencies:** T1, T2.

---

## 7. Final F43 Acceptance Checklist

- [ ] `size` prop maps `sm→max-w-md`, `md→max-w-lg` (default), `lg→max-w-2xl`, `xl→max-w-4xl`.
- [ ] `Modal.tsx:48` `bg-white` replaced with `bg-background text-foreground border border-border`; `×` replaced with `<X size={20} />`.
- [ ] `useModalA11y` untouched (focus trap, Esc, scroll lock, focus restore intact).
- [ ] All 8 existing Modal consumers render correctly at the default `'md'` size (`max-w-lg`) with no consumer-side edits.
- [ ] Close button recolored `text-muted-foreground hover:text-foreground` (no raw `text-gray-*`).
- [ ] `aria-label="Close dialog"` retained (a11y + test anchor).
- [ ] Lint + format checks pass on an empty change.
- [ ] Typecheck + test pass.

**Integration record (fill during the terminal task):**
- Feature commit SHA: `________`
- Changed files (from `git diff --stat`): `frontend/src/components/Modal.tsx`, `frontend/src/components/Modal.test.tsx`
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0`

---

## 8. Schema deltas owned by this feature

None. F43 is presentation-only (Tailwind classes + one optional React prop). No database, migration, env, or API-shape change.
