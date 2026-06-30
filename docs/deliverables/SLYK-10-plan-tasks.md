# Task Breakdown — SLYK-10 (Compact Ticket Metadata Header)

**Plan:** `docs/deliverables/SLYK-10-plan.md`
**Ticket:** `docs/deliverables/SLYK-10.md`
**Type:** Enhancement (frontend-only, presentational)
**Generated:** 2026-06-30

---

## Overview

SLYK-10 collapses the three-row `<dl>` metadata block in `TicketDetailModal` into a **single inline row** (creator avatar + name, `Clock` icon + created-at, `Clock` icon + updated-at), reusing existing primitives (`Avatar`, `formatDate`, `formatRelativeTime`, lucide `Clock`) with the project's semantic Tailwind tokens.

This is a small, tightly-coupled change: **2 files touched** (one component, one co-located test) plus a read-only verification pass. The work decomposes into **3 sequential batches / 3 tasks**.

### Codebase Verification (Phase 1 — confirmed via analyst delegations)

All plan claims hold against the current source. Notable findings:

- **`TicketDetailModal.tsx`** — metadata `<dl>` block at **~lines 139–157** (plan cited 139–158; minor drift, content identical). Current import block lines 1–19; `formatDate` at **:8**; **no** lucide-react import yet; **no** `Avatar` import yet.
- **`TicketDetailModal.test.tsx`** — `makeTicket` fixture (`:62–82`) returns `creator:{id:'u1',fullName:'Ada Lovelace',avatarUrl:'https://example.com/a.png'}`, `createdAt:'2026-06-01T00:00:00.000Z'`, `updatedAt:'2026-06-02T00:00:00.000Z'`, with `...overrides` spread. Timestamp test at **~:192–200** (uses `getAllByText(/^(Created|Updated):/)` → breaks under new markup). "Created by" + avatar test at **~:183–191** (stays green). **No null-creator fixture exists yet.**
- **`Avatar`** (`ui/Avatar.tsx`) — `AvatarProps { src?, name?, size?: 'sm'|'md'|'lg', className? }`; fallback chain `src-img → initials → lucide User icon in bg-muted circle`; wrapper gets `aria-label="Unassigned"` when name is absent.
- **`formatRelativeTime`** (`utils/formatRelativeTime.ts`) — relative idiom; canonical usage in `ActivityItem.tsx` (relative visible + absolute `formatDate` in `title`).
- **`Ticket` type** (`types/ticket.ts`) — `creator: Creator | null`, `createdAt: string`, `updatedAt: string` (ISO).
- **Conventions** — `text-muted-foreground` dominant (100+ usages, test-enforced); icons queried in tests via `querySelector('svg.lucide-clock')`; 4-space TSX indent, `printWidth: 100`, single quotes, trailing commas (`.prettierrc.json`); jsdom + `@testing-library/jest-dom` globals; `npm test` = `vitest run`.
- **Caveat:** `formatRelativeTime`'s "established idiom" rests on a single precedent (`ActivityItem`); the project is *almost* `dark:`-free (`TicketCard.tsx:32` is one exception, irrelevant here). `Clock` from lucide has **no prior usage** in `frontend/src` — this is the first.

---

## Parallelization Strategy

### Batch Execution Model

This ticket is a **single critical path** — one component, one co-located test, one verify. Batches are strictly serial.

1. **Batch 1** — component rewrite + imports (root task; no dependencies).
2. **Batch 2** — test updates (assertions depend on Batch 1's exact DOM).
3. **Batch 3** — read-only verification + dual-theme manual QA (gate before merge).

> **Merge order:** `[B1-T1]` must merge before `[B2-T1]` (tests assert B1's markup); `[B2-T1]` must merge before `[B3-T1]` (verify runs the suite).

### Visual Dependency Diagram

```
        ┌──────────────┐        ┌──────────────┐        ┌────────────────────┐
        │   BATCH 1    │        │   BATCH 2    │        │      BATCH 3       │
        │  Component   │──────▶ │   Tests      │──────▶ │ Verification + QA  │
        │  (1 file)    │        │  (1 file)    │        │   (read-only)      │
        └──────────────┘        └──────────────┘        └────────────────────┘
        TicketDetailModal.tsx   TicketDetailModal        npm test / tsc / lint
        — rewrite <dl>          .test.tsx                — dark/gray grep audit
        — add imports           — update ts test         — dual-theme manual QA
                                 — add null-creator
```

### Task-Level DAG

```
[B1-T1] Rewrite metadata <dl> → single inline row + imports   (TicketDetailModal.tsx)
   │   (subsumes plan change #1 markup + #2 imports — same file region, one task)
   ▼
[B2-T1] Update timestamp test + add null-creator test         (TicketDetailModal.test.tsx)
   │   (test must reflect B1-T1's new DOM)
   ▼
[B3-T1] Verification + manual QA                              (no file writes)
        gates: npm test / tsc / lint / grep audit / dual-theme QA
```

### Summary Table

| # | Batch | Task | Target File | Dependencies | Can Parallel With |
|---|-------|------|-------------|--------------|-------------------|
| 1 | B1 | `[B1-T1]` Rewrite `<dl>` → inline row + add imports | `frontend/src/components/TicketDetailModal.tsx` | — (root) | Nothing (source of truth for B2 assertions) |
| 2 | B2 | `[B2-T1]` Update timestamp test + null-creator test | `frontend/src/components/TicketDetailModal.test.tsx` | `[B1-T1]` | — |
| 3 | B3 | `[B3-T1]` Verification + dual-theme manual QA | *(none — read-only)* | `[B1-T1]`, `[B2-T1]` | — |

**Critical path:** `[B1-T1]` → `[B2-T1]` → `[B3-T1]` (fully serial).

### Developer Assignment Tracks

**Track A — Single developer (recommended).** This is a genuinely one-dev ticket: 2 files, tightly coupled (test asserts component DOM), ~half-day total.

```
Dev 1:  [B1-T1] ──▶ [B2-T1] ──▶ [B3-T1]
        component →  tests   →  verify
```

**Track B — Two developers (only if B1-T1 is the bottleneck).** A second dev can help in one place without merge conflicts — **after** `[B1-T1]`'s markup is frozen, Dev 2 drafts `[B2-T1]` against the B1 PR diff and pre-stages the `[B3-T1]` grep audit + manual-QA checklist text (read-only, non-coding). Parallelism ceiling ~15–20% time saved; not recommended unless B1-T1 slips.

---

## Tasks

### Task 1 — `[B1-T1]` Rewrite `TicketDetailModal` metadata into a single inline row (imports + markup)

**Batch:** 1
**Target File:** `frontend/src/components/TicketDetailModal.tsx`
**Dependencies:** None

#### Description

The complete, cohesive presentational change for SLYK-10 in one file. Collapses the three-row `<dl>` metadata block into one inline flex row: creator avatar + name, a `Clock` icon + created-at, and a `Clock` icon + updated-at. Adds three imports next to the existing ones — all symbols already exist in the codebase (no new files). Imports and markup edits are in the same file (contiguous import block + the `<dl>` region), so they are one task to avoid merge-conflict surface.

**Part A — Imports (edit the import block, lines 1–19).**

1. After the `@tanstack/react-query` import (line 3), add a new external-lib line:
   ```tsx
   import { Clock } from 'lucide-react';
   ```
2. Replace the `formatDate` import at **:8** (`import { formatDate } from '@/utils/formatDate';`) with:
   ```tsx
   import { formatDate } from '@/utils/formatDate';
   import { formatRelativeTime } from '@/utils/formatRelativeTime';
   ```
3. Add the `Avatar` import to the local `./` component group (after the last local import, e.g. `import { Retry } from './Retry';`):
   ```tsx
   import { Avatar } from './ui/Avatar';
   ```

**Part B — Markup rewrite. Replace the entire `<dl>` block at lines 139–157** (comment at `:139` through `</dl>` at `:157`) with this single inline-row `<div>` (semantic tokens only; no `dark:`, no `gray-*`):

```tsx
{/* VIEW HEADER — display ID is the modal title; creator + timestamps read-only, one compact row */}
<div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
    {/* Creator: avatar + "Created by {name}" */}
    <span className="inline-flex min-w-0 items-center gap-1.5">
        <Avatar
            src={ticket.creator?.avatarUrl ?? null}
            name={ticket.creator?.fullName ?? null}
            size="sm"
        />
        <span className="truncate">
            Created by {ticket.creator?.fullName ?? 'Unknown'}
        </span>
    </span>

    {/* Created at: clock icon + relative time, absolute tooltip */}
    <span className="inline-flex items-center gap-1">
        <Clock size={14} className="shrink-0" />
        <time dateTime={ticket.createdAt} title={formatDate(ticket.createdAt)}>
            {formatRelativeTime(ticket.createdAt)}
        </time>
    </span>

    {/* Updated at: clock icon + relative time, absolute tooltip */}
    <span className="inline-flex items-center gap-1">
        <Clock size={14} className="shrink-0" />
        <time dateTime={ticket.updatedAt} title={formatDate(ticket.updatedAt)}>
            {formatRelativeTime(ticket.updatedAt)}
        </time>
    </span>
</div>
```

**Why these choices (cite-ready):**
- `Avatar` (`ui/Avatar.tsx`: `AvatarProps { src?, name?, size?: 'sm'|'md'|'lg', className? }`, fallback chain `src → initials → lucide User`) supersedes the manual `{ticket.creator.avatarUrl && <img/>}` gate — drop that gate entirely; pass `src`/`name` (nullable) + `size="sm"`.
- Relative-primary + absolute-tooltip idiom matches `ActivityItem.tsx` (`formatRelativeTime` visible, `formatDate` in `title`); the `<time dateTime>` wrapper is the a11y upgrade.
- `Clock size={14}` matches the dense-metadata icon idiom (`TicketAttributeForm.tsx:97–110`); lucide renders `aria-hidden` by default.
- `flex-wrap` + `gap-y-1` + `min-w-0`/`truncate` handle narrow modal widths and long names (mirrors `MemberTable.tsx:84`).
- Null-creator (F16 FK-dangle): previously an empty row; now renders `Avatar`'s `User` fallback + `Created by Unknown` — strict improvement.

**Conventions enforced:** 4-space TSX indent, single quotes, trailing commas, `printWidth` ≤ 100, `text-muted-foreground` only.

#### Acceptance Criteria
- [ ] Three new imports present: `Clock` from `lucide-react`; `formatRelativeTime` from `@/utils/formatRelativeTime`; `Avatar` from `./ui/Avatar`.
- [ ] The `<dl>` block (`:139–157`) is replaced by a single `<div>` with class `flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground`.
- [ ] Creator segment renders `<Avatar src={ticket.creator?.avatarUrl ?? null} name={ticket.creator?.fullName ?? null} size="sm" />` + `Created by {ticket.creator?.fullName ?? 'Unknown'}` text.
- [ ] Two `<time>` elements exist: `dateTime={ticket.createdAt}` / `dateTime={ticket.updatedAt}`, each with `title={formatDate(...)}` and visible `{formatRelativeTime(...)}`.
- [ ] Each timestamp segment is prefixed by a `<Clock size={14} className="shrink-0" />` (2 `Clock` icons total).
- [ ] No `dark:` variants and no raw `gray-*` classes anywhere in the new block.
- [ ] Manual `{ticket.creator.avatarUrl && <img/>}` gate is removed; `formatDate` is still imported (used in `title`).
- [ ] `npm run build` (tsc + Vite) passes with no type errors.
- [ ] `npx prettier --check frontend/src/components/TicketDetailModal.tsx` passes.
- [ ] Manual check in light **and** dark: three segments on one row, icons visible, relative times + hover tooltips correct, long names truncate, layout wraps at narrow widths.

---

### Task 2 — `[B2-T1]` Update `TicketDetailModal.test.tsx` timestamp assertions + add null-creator test

**Batch:** 2
**Target File:** `frontend/src/components/TicketDetailModal.test.tsx`
**Dependencies:** `[B1-T1]` (assertions assume B1-T1's new DOM)

#### Description

Update the co-located test file to match the new inline-row markup, and add the missing null-creator coverage. Different file from B1-T1 (zero conflict surface), but the new assertions (`<time>`, `svg.lucide-clock`, `aria-label="Unassigned"`, `Created by Unknown`) only pass once B1-T1's markup is in place — hence the hard dependency.

**Prettier:** 4-space TSX indent, `printWidth: 100`, single quotes — match the existing file's style exactly.

##### Subtask 2a — Add `formatDate` import (top of file)

Add alongside the existing `@/...` imports:
```ts
import { formatDate } from '@/utils/formatDate';
```
(`formatDate` is a pure Intl formatter, deterministic by locale — reusing it decouples the `title` assertion from the exact rendered string.)

##### Subtask 2b — Replace the "renders Created/Updated timestamp rows" test (currently `:192–200`)

**OLD code to replace:**
```ts
    it('renders Created/Updated timestamp rows', async () => {
        renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });
        // formatDate renders both rows with a leading label.
        const rows = screen.getAllByText(/^(Created|Updated):/);
        expect(rows).toHaveLength(2);
        expect(rows[0]!.textContent).toMatch(/^Created:/);
        expect(rows[1]!.textContent).toMatch(/^Updated:/);
    });
```
(This breaks under B1-T1's markup — the `Created:`/`Updated:` labels are gone.)

**NEW code (drop-in replacement at the same site):**
```ts
    it('renders two inline <time> elements (created/updated) with relative text, absolute tooltip, and clock icons', async () => {
        renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });
        // Two <time> elements exist (created + updated), each carrying the raw fixture ISO.
        const times = document.querySelectorAll('time[dateTime]');
        expect(times).toHaveLength(2);
        expect(times[0]!).toHaveAttribute('dateTime', '2026-06-01T00:00:00.000Z');
        expect(times[1]!).toHaveAttribute('dateTime', '2026-06-02T00:00:00.000Z');
        // Each <time>'s hover tooltip carries the absolute formatDate(iso) string.
        expect(times[0]!).toHaveAttribute('title', formatDate('2026-06-01T00:00:00.000Z'));
        expect(times[1]!).toHaveAttribute('title', formatDate('2026-06-02T00:00:00.000Z'));
        // A decorative Clock icon accompanies each timestamp (lucide renders svg.lucide-clock).
        expect(document.querySelectorAll('svg.lucide-clock')).toHaveLength(2);
    });
```
**Notes:**
- `dateTime` values pinned to the `makeTicket` fixture's `createdAt`/`updatedAt` (`:79–80`) — deterministic, locale-independent.
- `title` reuses `formatDate` so the assertion never hardcodes a locale-formatted string.
- `svg.lucide-clock` is the stable lucide-react class — locks "two clock icons" without coupling to icon `size`.
- Do **not** assert the visible relative text (`now`/`X days ago`) — `formatRelativeTime` is clock-dependent (`formatRelativeTime.ts:23`) and would make the test flaky.

##### Subtask 2c — Add a null-creator test (new `it`, immediately after 2b)

No null-creator fixture exists yet — `makeTicket` always sets `creator` to the `u1` object. Use the `...overrides` spread to render `creator: null` and assert the fallback per the `Avatar.test` convention (`Avatar.tsx:74–83` renders a `<span aria-label="Unassigned">` with a lucide `User` icon when both `src` and `name` are absent):

```ts
    it('renders the avatar fallback (aria-label "Unassigned") and "Created by Unknown" when creator is null', async () => {
        renderModal({ ticket: makeTicket({ creator: null, creatorId: null }) });
        await screen.findByRole('dialog', { name: 'SLYK-101' });
        // Text falls back to "Unknown" per the inline-row markup (SLYK-10-T1).
        expect(screen.getByText('Created by Unknown')).toBeInTheDocument();
        // Avatar fallback wrapper carries aria-label="Unassigned" (Avatar.test convention).
        expect(document.querySelector('[aria-label="Unassigned"]')).not.toBeNull();
        // No avatar <img> is rendered when there is no src.
        expect(document.querySelector('img[src="https://example.com/a.png"]')).toBeNull();
        // The two timestamps still render (creator-absence must not drop metadata).
        expect(document.querySelectorAll('time[dateTime]')).toHaveLength(2);
    });
```
**Notes:**
- `creatorId: null` set alongside `creator: null` keeps the fixture internally consistent.
- `aria-label="Unassigned"` matches the exact string in `Avatar.tsx:80`; if B1-T1 instead renders the initials-fallback branch, this test fails and surfaces the mismatch — intended guardrail.

##### Subtask 2d — Confirm (do NOT modify) the "Created by …" + avatar test (`:183–191`)

The existing block stays green under B1-T1 (text `Created by Ada Lovelace` and the avatar `<img src="https://example.com/a.png">` are both preserved). **No edit** — listed here only for reviewer confirmation that it remains untouched.

#### Acceptance Criteria
- [ ] `npm test -- TicketDetailModal` passes (full file, zero failures).
- [ ] Only `frontend/src/components/TicketDetailModal.test.tsx` is modified (no component, no other test files).
- [ ] The old `^(Created|Updated):` text query is fully removed (no remaining `getAllByText(/^(Created|Updated):/)`).
- [ ] Two `<time>` elements present with `dateTime` = `'2026-06-01T00:00:00.000Z'` and `'2026-06-02T00:00:00.000Z'` (matching `makeTicket` `:79–80`).
- [ ] Each `<time>` has `title` equal to `formatDate(<its ISO>)` (relative text intentionally **not** asserted).
- [ ] Exactly two `svg.lucide-clock` icons render.
- [ ] A new null-creator test exists asserting `Created by Unknown`, a wrapper with `aria-label="Unassigned"`, **no** avatar `<img>`, and still two `<time>` elements.
- [ ] The pre-existing "renders Created by {creator.fullName} and the creator avatar" test (`:183–191`) is **unchanged** and still passes.
- [ ] No new `dark:` variants or `gray-*` classes introduced (this is a test file, so grep the whole frontend for regressions).
- [ ] `npx prettier --check frontend/src/components/TicketDetailModal.test.tsx` passes.
- [ ] `npx tsc --noEmit` (frontend) passes — added `formatDate` import resolves.

#### Out of Scope (this task)
- No change to `TicketDetailModal.tsx`, `Avatar.tsx`, `formatDate.ts`, `formatRelativeTime.ts`, or any other source file.
- No new test files (co-locate per project convention).
- No assertion on the visible relative-time string, the single-row `<div>` layout, or `flex-wrap` behavior — those belong to manual verification (Task 3), to avoid brittleness.

---

### Task 3 — `[B3-T1]` Verify SLYK-10 — automated gates, token audit, dual-theme manual QA

**Batch:** 3
**Target File:** *(none — read-only)*
**Dependencies:** `[B1-T1]`, `[B2-T1]` (both must be merged to the working branch)

#### Description

After Batches 1 & 2 land, confirm the compact metadata header meets every acceptance criterion in the plan without regressing the codebase. This task is **read-only / verification-only** — it produces no code; if a check fails, it re-opens the offending Batch 1 or Batch 2 task with specifics. Project test runner: **Vitest** (`npm test` = `vitest run`), jsdom + `@testing-library/jest-dom`. Run from `frontend/`.

##### Phase A — Automated Gates
1. From `frontend/`, run `npm test` (Vitest). Expect all of `TicketDetailModal.test.tsx` green: the updated timestamp test (two `<time>` + two `.lucide-clock`), the unchanged "Created by {name}"+avatar `<img>` test, and the **new** null-creator test. Capture pass count.
2. Run the project's type-check / build (`npm run build` runs `tsc` + Vite) — confirm no TS errors reference `TicketDetailModal.tsx` (new imports `Clock`, `formatRelativeTime`, `Avatar` must resolve).
3. Run lint if configured (`npm run lint`) — confirm no new warnings/errors in the two touched files.

##### Phase B — Static Token Audit (grep; no `dark:`/`gray-*` regressions)
4. `grep -nE "dark:|text-gray-|bg-gray-|border-gray-" frontend/src/components/TicketDetailModal.tsx` → expect **zero** matches. The new markup must use only semantic tokens.
5. Confirm the only color classes in the rewritten metadata block are semantic (eyeball `git diff develop -- frontend/src/components/TicketDetailModal.tsx`).

##### Phase C — Manual QA Checklist (run in BOTH light and dark themes)
- [ ] All three segments (creator avatar+name, created-at, updated-at) sit on **one inline row** at default modal width.
- [ ] Both `Clock` icons render and are **visible** (not clipped, not 0×0) in each theme.
- [ ] Relative timestamps are correct; hovering each shows the **absolute** datetime tooltip (`title`).
- [ ] A **long creator name** truncates with ellipsis (`min-w-0` + `truncate`); row does not overflow.
- [ ] At **narrow modal width** the row wraps cleanly (`flex-wrap` + `gap-y-1`) — no horizontal scroll, no overlap.
- [ ] **Null-creator** ticket (or dangling FK) renders the `User` icon fallback + `Created by Unknown`, not an empty row.
- [ ] **Vertical footprint** is visibly smaller than the pre-change 3-row `<dl>` (side-by-side compare via branch switch / screenshot from `develop`).
- [ ] Identical `createdAt`/`updatedAt` (freshly created ticket) reads "now" twice — acceptable, no jank.

#### Acceptance Criteria (task done when)
- [ ] `npm test` green; failing-test count = 0 for `TicketDetailModal.test.tsx` (timestamp test, avatar/name test, null-creator test all pass).
- [ ] `tsc`/build clean — no type errors in the touched files.
- [ ] Lint clean on the two touched files (or no new violations vs. `develop`).
- [ ] Grep audit returns **zero** `dark:` or raw `gray-*` matches in `TicketDetailModal.tsx`.
- [ ] Every Manual QA checkbox above passes in **both** light and dark themes.
- [ ] If any check fails: a concise failure report with `path:line` evidence is produced and the offending Batch 1/2 task is re-opened (no edits made by this task).
- [ ] Final report maps each plan Acceptance Criterion (6 items, plan §"Acceptance Criteria") to the check that proves it.

#### Dependencies
- **Depends on:** `[B1-T1]` (component rewrite + imports) **AND** `[B2-T1]` (test updates incl. null-creator). Cannot start until both are merged.
- **Blocks:** PR readiness / merge to `develop` (this task is the merge gate).

---

## Notes

- Task IDs `[B1-T1]` / `[B2-T1]` / `[B3-T1]` are stable within this document; an orchestrator ingesting this breakdown will assign its own numbering, mapping each `[*-T1]` 1:1 to a dispatched delegation + commit.
- The plan's **Open Question** (relative vs. absolute primary datetime label) is resolved per the plan default: **relative primary + absolute tooltip** (most consistent with the closest sibling component, `ActivityItem`). If the team prefers absolute inline labels, swap `formatRelativeTime` for `formatDate` in the visible label and keep `<time dateTime>` for a11y — the rest of the markup is unchanged; Task 2's timestamp test would then assert the visible absolute text instead of (or in addition to) the `dateTime` attribute.
