# Implementation Plan — SLYK-10

**Ticket:** `docs/deliverables/SLYK-10.md`
**Type:** Enhancement
**Title:** Compact Ticket Metadata Header
**Generated:** 2026-06-30

---

## Summary

The ticket details modal (`TicketDetailModal`) currently renders the **Created By**, **Created At**, and **Updated At** metadata as **three stacked rows** inside a `<dl>` block (`TicketDetailModal.tsx:139-158`), wasting vertical space and visually disconnecting related information. SLYK-10 collapses this into a **single inline row**: creator avatar + name, a clock icon + created-at datetime, and a clock icon + updated-at datetime — all inline with consistent iconography and datetime formatting that stays legible in both light and dark themes.

This is a **frontend-only, presentational enhancement**. No backend, API, schema, or data-shape changes. The new layout reuses existing primitives — the generic `Avatar` component, the `formatDate`/`formatRelativeTime` datetime helpers, and a lucide-react `Clock` icon — composed with the project's semantic Tailwind color tokens (no `dark:` variants, no raw `gray-*`).

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| Component (frontend) | `frontend/src/components/TicketDetailModal.tsx` | The metadata block (`:139-158`) is the sole touch surface — rewrite the `<dl>` into a single inline row; add `Avatar` + `Clock` imports. |
| Test (frontend) | `frontend/src/components/TicketDetailModal.test.tsx` | The "Created/Updated timestamp rows" test (`:192-200`) asserts the old `^(Created|Updated):` text rows; must be updated to match the new inline DOM. The "Created by …" test (`:183-191`) is unaffected by the text and only needs its avatar `<img>` assertion confirmed. |

No backend, schema, route, controller, service, or repository changes. No new files required.

## Proposed Implementation

Build order: component edit → test update → manual verification. One frontend change, one test change.

### Frontend Changes

#### 1. Rewrite the metadata block into a single inline row

**File:** `frontend/src/components/TicketDetailModal.tsx`
**What:** Replace the `<dl>…</dl>` block at `:139-158` with one flex row that lays out, left-to-right and inline:
1. Creator avatar + `Created by {name}` text.
2. A `Clock` icon + created-at datetime (with an absolute `title` tooltip).
3. A `Clock` icon + updated-at datetime (with an absolute `title` tooltip).
**Why:** Reclaims the vertical space of the 3-row `<dl>` and groups the three metadata facts into one scannable line, per SLYK-10 acceptance criteria.

**Code references the change builds on:**
- Existing creator row + avatar: `TicketDetailModal.tsx:141-153`.
- Existing timestamp rows: `TicketDetailModal.tsx:155-156`.
- Generic `Avatar` primitive (`AvatarProps { src?, name?, size?: 'sm'|'md'|'lg', className? }`, `size="sm"` = `h-6 w-6`): `frontend/src/components/ui/Avatar.tsx:10-45`. Avatar already falls back creator→initials→lucide `User` icon (`Avatar.tsx:46-77`), so the manual `ticket.creator.avatarUrl && <img/>` gate can be dropped entirely — pass `src={ticket.creator?.avatarUrl}` and `name={ticket.creator?.fullName}` and let `Avatar` handle the absence.
- Datetime helpers already imported in the file: `formatDate` (`utils/formatDate.ts:4`, absolute `Jun 30, 2026, 02:45 PM`) at `TicketDetailModal.tsx:7`. Add `formatRelativeTime` (`utils/formatRelativeTime.ts:16`, `now`/`X minutes ago`/…) to give the inline timestamps the established **relative-primary + absolute-tooltip** idiom used by `ActivityItem.tsx:28-32`.
- Icon idiom: lucide-react named import, sized via the `size` prop (px), colored via the parent's `text-muted-foreground` (currentColor). Sibling `TicketAttributeForm.tsx:97-110` is the canonical example.

**Proposed markup** (semantic tokens only — no `dark:` variants, no raw `gray-*`):

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
        <span className="truncate">Created by {ticket.creator?.fullName ?? 'Unknown'}</span>
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

**Notes on the markup choices:**
- `flex-wrap` + `gap-y-1` keeps the row readable on narrow modal widths (the modal can be up to `max-w-[min(95vw,1400px)]`, per `TicketDetailModal.test.tsx:177-181`) — on small screens the three segments wrap rather than overflow.
- The `Clock` icon is added once per timestamp as requested ("a clock icon + created-at datetime, and a clock icon + updated-at datetime"). `Clock` is the natural, unambiguous lucide choice; `size={14}` matches the dense metadata idiom and `shrink-0` prevents the icon from squashing.
- `min-w-0` + `truncate` on the creator segment lets long names ellipsize instead of blowing out the row, mirroring `MemberTable.tsx:84`'s `min-w-0` + truncate pattern.
- The `<time dateTime={…}>` element keeps the absolute ISO value accessible to assistive tech / scrapers even though the visible label is relative; the `title` carries the full absolute datetime for hover legibility (same idiom as `ActivityItem.tsx:28-32`).
- When `ticket.creator` is null (FK-dangle, F16 guard), `Avatar` renders its lucide `User` fallback and the text shows `Unknown` — replacing the current behavior of rendering an **empty** row, which is a strict improvement.

#### 2. Update imports

**File:** `frontend/src/components/TicketDetailModal.tsx`
**What:** Add the two new named imports next to the existing ones:
- `import { Clock } from 'lucide-react';` (new line)
- `import { formatRelativeTime } from '@/utils/formatRelativeTime';` (extend the existing `@/utils/formatDate` import area at `:7`).
- `import { Avatar } from '@/components/ui/Avatar';` (new line).

**Why:** Required by the new markup; all three symbols already exist in the codebase.

### Test Changes

#### 3. Update the timestamp rendering test

**File:** `frontend/src/components/TicketDetailModal.test.tsx`
**What:** The test at `:192-200` ("renders Created/Updated timestamp rows") currently matches `^(Created|Updated):` text — that leading-label text no longer exists. Rewrite it to assert the two `<time>` elements render the relative timestamps with absolute `title` tooltips:
- Query `document.querySelectorAll('time[dateTime]')` → expect 2, with `dateTime` values equal to the fixture's `createdAt` and `updatedAt` ISO strings.
- Optionally assert each `<time>`'s `title` attribute equals `formatDate(<iso>)` (reuse the same fixture values) and that two `Clock` icons are present (lucide renders `<svg>`; assert `container.querySelectorAll('svg.lucide-clock')` length 2, or scope by the icon's `aria-hidden` if needed).

**Why:** Keep regression coverage on the metadata rendering without coupling to the old label text. The "Created by …" + avatar test at `:183-191` still passes as-is (the text and avatar `<img>` are preserved) — but verify it still finds the avatar `<img>` (`Avatar` renders the `<img>` only when `src` is truthy, which the fixture provides, so no change needed). No new test files; co-locate per project convention.

## Edge Cases & Risks

- **Narrow viewports / long creator names.** Mitigated by `flex-wrap` + `min-w-0`/`truncate`. Verify the modal at its smallest reasonable width.
- **Creator is null (FK-dangle, F16).** Previously rendered an empty row; now renders the `Avatar`'s lucide `User` fallback + `Unknown`. This is strictly better, but confirm the test fixture / a manual null case renders gracefully. The existing `ticket.creator`-gated tests should still pass.
- **Same createdAt/updatedAt.** When a ticket was just created the two timestamps may be identical; both inline segments will read "now". Acceptable and accurate; no special-casing needed.
- **Locale/timezone.** Both helpers use the browser locale/TZ (`formatDate.ts`, `formatRelativeTime.ts`) — no change from today; consistency across the two inline timestamps is actually improved (both use the same relative style, whereas today both are absolute).
- **Accessibility.** Replacing the (misused) `<dl>` with a `<div>` is fine — the original wasn't a real definition list (timestamps were plain `<div>`, not `<dt>/<dd>`). The `Clock` icons should be decorative (lucide adds `aria-hidden` by default); the `Created by` text + `<time dateTime>` + `title` keep the data accessible. Confirm the icons render with `aria-hidden="true"`.
- **Test coupling to label text.** The only risk is the one test at `:192-200`; addressed in change #3.

## Testing

*Follow project conventions — Vitest + Testing Library; table-driven; one behavior per test; co-locate `*.test.tsx` next to source.*

- **Unit/Component tests (Vitest + Testing Library):**
  - `TicketDetailModal.test.tsx` — update the timestamp test (#3) to assert two `<time>` elements with the fixture's ISO `dateTime` values and absolute `title` tooltips, plus two `Clock` icons.
  - Keep the "Created by {name}" + avatar `<img>` test (`:183-191`) green as-is.
  - Add (or extend) a case for a **null creator**: render a ticket with `creator: null` and assert the avatar fallback (lucide `User`) shows and the text reads `Created by Unknown`.
  - Optional: a case asserting the row is a single flex container (e.g. the metadata `<div>` has `flex` and the three child `<span>`s are siblings) to lock the "single row" acceptance criterion.
- **Manual verification:** Open the ticket details modal in **both light and dark** themes; confirm all three metadata segments sit on one inline row, icons are visible, relative times + hover tooltips are correct, long names truncate, and the layout wraps cleanly at narrow widths. Compare vertical footprint against the current 3-row layout to confirm space is reclaimed.

## Acceptance Criteria

- [ ] Creator (avatar + name) and both timestamps render on a **single inline row** with icons.
- [ ] Vertical space is reclaimed vs. the current 3-row `<dl>` layout.
- [ ] The metadata remains legible in **both light and dark** themes (semantic tokens only — no `dark:` variants, no raw `gray-*`).
- [ ] `Clock` icons accompany the created-at and updated-at datetimes, and datetime formatting is consistent across both.
- [ ] Null-creator case renders a sensible fallback (avatar icon + `Unknown`) instead of an empty row.
- [ ] Updated `TicketDetailModal.test.tsx` passes; no `dark:`/`text-gray-*` regressions.

## Open Questions

- **Datetime format choice.** The plan uses the established **relative-primary + absolute-tooltip** idiom (matching `ActivityItem`). The ticket says "consistent datetime formatting" but does not mandate relative vs. absolute. If the team prefers absolute strings inline (e.g. to match the original `Created: Jun 30, 2026, 02:45 PM`), swap `formatRelativeTime` for `formatDate` in the visible label and keep the `<time dateTime>` for a11y — the rest of the markup is unchanged. **Default per this plan: relative primary + absolute tooltip** (most consistent with the closest sibling component, `ActivityItem`).

## Out of Scope

- No backend / API / schema / migration changes.
- No extraction of the metadata block into a separate `TicketMetadata` component (the block is small and only used here; extraction is not required by the ticket).
- No change to the `Avatar` component, `formatDate`, or `formatRelativeTime` themselves.
- No change to other modals or ticket cards (e.g. `TicketCard`, `ActivityItem`) — those are independent.
- No theming/color-token refactors beyond reusing existing semantic tokens.
