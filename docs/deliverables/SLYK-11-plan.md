# Implementation Plan — SLYK-11

**Ticket:** `docs/deliverables/SLYK-11.md`
**Type:** Enhancement
**Title:** Ticket Details Modal Tabbed Layout
**Generated:** 2026-06-30

---

## Summary

The `TicketDetailModal` currently renders its body as a single long scroll: the SLYK-10 metadata header, the `TicketAttributeForm` (with its own sticky Save/Cancel footer), `TimerControls`, `TimeLog`, `ManualEntryForm`, the admin delete entry, and the `ActivityFeed` — all stacked linearly. SLYK-11 restructures that body into **three tabs**:

1. **Details** — the SLYK-10 metadata header + the `TicketAttributeForm` + a clearly-marked placeholder for the Comments section (SLYK-13, not yet implemented).
2. **Time Tracking** — `TimerControls` + `TimeLog` + `ManualEntryForm`.
3. **Activity** — `ActivityFeed`.

The tabs must be keyboard-accessible with correct ARIA (`role="tablist"` / `role="tab"` / `role="tabpanel"`, `aria-selected`, `aria-controls`, `aria-labelledby`, sensible tab order) and the active tab must persist for the duration the modal is open (resets on close is acceptable). The existing footer/save behavior must continue to work within the Details tab.

This is **frontend-only**. No backend, schema, migration, or API contract changes.

### Boundaries (explicitly out of scope here)
- **Do NOT implement Comments** (SLYK-13). Leave a clearly-marked placeholder section in the Details tab.
- **Do NOT fix timer live-update bugs** (SLYK-12). They are reported below under "Open Questions / Reported for SLYK-12" but must not be addressed in this ticket.

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| UI primitive (NEW) | `frontend/src/components/ui/Tabs.tsx` | New accessible tablist primitive consumed by the modal. |
| Package manifest | `frontend/package.json` | Add `@radix-ui/react-tabs` dependency (recommended approach). |
| Component | `frontend/src/components/TicketDetailModal.tsx` | Restructure the resolved body branch into 3 tab panels; add `activeTab` session state. |
| Component (unchanged, just relocated) | `frontend/src/components/TicketAttributeForm.tsx` | Moves into the Details tab panel; keeps its own footer/save. No code change expected. |
| Component (unchanged, just relocated) | `frontend/src/components/TimerControls.tsx` | Moves into Time Tracking tab. No change. |
| Component (unchanged, just relocated) | `frontend/src/components/TimeLog.tsx` | Moves into Time Tracking tab. No change. |
| Component (unchanged, just relocated) | `frontend/src/components/ManualEntryForm.tsx` | Moves into Time Tracking tab. No change. |
| Component (unchanged, just relocated) | `frontend/src/components/ActivityFeed.tsx` | Moves into Activity tab. No change. |

No new hooks, stores, API clients, types, or backend files are required.

## Proposed Implementation

### Backend Changes
None. This is a frontend-only enhancement.

### Frontend Changes

Build order: **primitive first → then restructure the modal around it.**

---

#### 1. Add the `@radix-ui/react-tabs` dependency

**File:** `frontend/package.json`
**What:** Add `@radix-ui/react-tabs` to dependencies and install.
**Why:** The project already standardizes on Radix for a11y-heavy primitives (`@radix-ui/react-dropdown-menu` in `components/ui/Dropdown.tsx`, `@radix-ui/react-tooltip`) — see `package.json:17-18`. Radix Tabs gives correct ARIA, roving tabindex, arrow-key navigation, and focus management for free, matching the existing convention. The alternative (hand-rolling on the `hooks/useModalA11y.ts` precedent) is more code and more risk for no benefit.
**Code reference:** `components/ui/Dropdown.tsx` (the Radix-wrapper shape to mirror), `components/ui/Button.tsx:18-37` (variant-map + `forwardRef` + `cn` convention).

> If the team prefers zero new deps, fall back to a hand-rolled tablist modeled on `hooks/useModalA11y.ts` (roving-tabindex + arrow-key handler + manual `aria-*`). The Radix approach is the recommendation.

---

#### 2. Create `frontend/src/components/ui/Tabs.tsx`

**File:** `frontend/src/components/ui/Tabs.tsx` (NEW)
**What:** A small reusable Tabs primitive wrapping `@radix-ui/react-tabs`, exporting composable subcomponents: `Tabs.Root`, `Tabs.List`, `Tabs.Trigger`, `Tabs.Content` (or flat `Tabs` / `TabList` / `Tab` / `TabPanel` named exports — match the project's preferred shape, but keep it composable).
**Why:** There is **no existing tab primitive** in the repo (confirmed: zero matches for `tablist`/`role="tab"`/`aria-selected`/`Tabs` in `frontend/src`). A shared primitive in `components/ui/` is the established home for primitives (`Avatar`, `Badge`, `Button`, `Card`, `Dropdown`, `Field`, `SelectInput`, `TextInput`, `Textarea`, `Tooltip`, plus `cn`).
**Conventions to follow (evidence-backed):**
- Merge classes with `cn` from `components/ui/cn.ts:7` (`twMerge(clsx(...))`, shadcn style).
- Use semantic Tailwind tokens only — `bg-accent` / `text-accent-foreground` for the selected trigger, `text-muted-foreground` for inactive, `border-border`, `ring-ring`. Raw hex is disallowed (`tokens.test.ts:99`).
- Apply `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` to triggers, matching `Button.tsx:28`.
- `forwardRef` + rest-spread, never swallow `className` (mirror `Button.tsx:37`).
- Use `lucide-react` icons if any iconography is needed (already a dep, `package.json:27`).

**Controlled/uncontrolled:** Support both, but the modal will use it **controlled** (value/onValueChange) so the active tab is owned by `activeTab` session state in the modal. Radix Tabs supports `value`/`onValueChange` natively.

**Accessibility (provided by Radix, verify):**
- `role="tablist"` on the list, `role="tab"` on triggers, `role="tabpanel"` on content.
- `aria-selected` on the active trigger, `aria-controls` (trigger→panel id), `aria-labelledby` (panel→trigger id).
- Arrow-key navigation between triggers, Home/End to jump to first/last, focus moves with selection (Radix default `activationMode="automatic"`).

---

#### 3. Add `activeTab` session state to `TicketDetailModal`

**File:** `frontend/src/components/TicketDetailModal.tsx`
**What:** Add a new `useState` at the modal top level alongside the existing session state (`confirmOpen`, `isDirty`, `deleteConfirmOpen` — `TicketDetailModal.tsx:42-44`):

```ts
const [activeTab, setActiveTab] = useState<"details" | "time" | "activity">("details");
```

**Why:** The active tab must persist across re-renders within the open modal and reset when the modal closes. Since the modal is mounted/unmounted on route match (`BoardPage.tsx:159-196` — open = route present, close = navigate away), a plain `useState` at the modal top naturally resets on close and survives all in-session re-renders. **No Zustand store / `persist` middleware is needed** — there is no precedent for session-persisted modal UI state in the repo, and the requirement explicitly allows reset-on-close.
**Code reference:** the four existing top-level `useState` calls at `TicketDetailModal.tsx:42-45` — the new one sits there as a fifth, layout-agnostic piece of session state.

---

#### 4. Restructure the resolved body branch into 3 tab panels

**File:** `frontend/src/components/TicketDetailModal.tsx`
**What:** Inside the resolved branch (the `else` branch that currently renders the linear stack), wrap the body in `<Tabs value={activeTab} onValueChange={setActiveTab}>` and distribute the existing blocks into three `Tabs.Content` panels under one `Tabs.List`. The mapping (with current source locations):

| Tab | Blocks moved in (path:line) |
|-----|------------------------------|
| **Details** (`value="details"`) | soft-delete banner (`TicketDetailModal.tsx:123-132`), SLYK-10 metadata header (`:136-160`), `TicketAttributeForm` (`:162-178`, gated `readOnly={!!ticket.deletedAt}`), admin delete entry (`:200-207`), **+ Comments placeholder (NEW, see step 5)**. |
| **Time Tracking** (`value="time"`) | `TimerControls` (`:163`), `TimeLog` (`:166`), `ManualEntryForm` (`:169`) — all gated by `!ticket.deletedAt`. **Disabled/hidden when soft-deleted.** |
| **Activity** (`value="activity"`) | `ActivityFeed` (`:218`). |

The `Tabs.List` (tablist row) sits above the three panels. The modal title (`modalTitle`, `TicketDetailModal.tsx:65, 226`) stays in the `Modal` header as today — it is **not** a tab.

**Why:** Achieves the three-tab goal while reusing every existing child component unchanged. All six children are independently `ticketId`-prop-backed and self-contained, so this is pure JSX relocation — no state lifting, no prop changes.

**Preserve per-block gating:**
- `!ticket.deletedAt` gating on the three time-tracking blocks must be preserved. Cleanest: render the **Time Tracking tab trigger** disabled (or hidden) when `ticket.deletedAt` is set, and keep the per-block gates as a defense-in-depth.
- The admin delete entry and the read-only form behavior stay exactly as today.

**Critical — preserve RHF form state across tab switches:** React Hook Form state lives **inside** `TicketAttributeForm` (`TicketAttributeForm.tsx:42-49`, `defaultValues` seeded once by the modal). If the Details tab panel unmounts when the user switches to Time Tracking, RHF resets → `isDirty` flips false → the unsaved-changes guard (`useBlocker` at `TicketDetailModal.tsx:82`, `requestClose` at `:88-91`) silently breaks and in-progress edits are lost.

Two safe options — **pick one**:
1. **(Recommended) Keep all three tab panels mounted; toggle visibility via CSS.** With Radix Tabs, use `forceMount` on each `Tabs.Content` and hide inactive ones with `hidden` (or `className` conditional `hidden`). This guarantees `TicketAttributeForm` never unmounts while the modal is open, so RHF state, `isDirty`, and the dirty-guard all behave identically to today.
2. Lift form state out of `TicketAttributeForm` so it survives unmount. **Rejected** — it's a large refactor outside this ticket's scope and the modal already relies on RHF living in the child.

> Implementer note: option 1 is a one-line `forceMount` + `hidden`-toggle per panel and is the convention-correct choice. The Activity and Time Tracking panels are cheap to keep mounted (they're `useQuery`-backed and dedupe).

**Sticky footer compatibility:** The Save/Cancel footer lives **inside** `TicketAttributeForm` (`TicketAttributeForm.tsx:177-189`) and uses `-mx-6 -mb-6` to span the modal body. Because the form stays inside the Details panel (and the panel stays mounted per option 1), the sticky footer continues to span the modal body exactly as today. Verify visually that the negative margins still align when the tablist is present above — if the panel has extra padding from the Tabs primitive, adjust the form's negative-margin offsets to match the new container padding, but do **not** move the footer out of the form.

---

#### 5. Add the Comments placeholder in the Details tab

**File:** `frontend/src/components/TicketDetailModal.tsx`
**What:** Below `TicketAttributeForm` inside the Details panel, render a clearly-marked placeholder section, e.g.:

```tsx
{/* SLYK-13: Comments section — not yet implemented. Replace this placeholder when SLYK-13 lands. */}
<section aria-label="Comments" className="mt-6 border-t border-border pt-4">
  <h3 className="text-sm font-medium text-muted-foreground">Comments</h3>
  <p className="mt-2 text-sm text-muted-foreground italic">
    Comments are not available yet.
  </p>
</section>
```

**Why:** The ticket explicitly requires Comments to live in the Details tab below the form, but SLYK-13 (Comments) is not yet implemented — confirmed absent: no `Comments.tsx`, no comment API client, no comment types anywhere in `frontend/src`. The placeholder reserves the slot so SLYK-13 is a drop-in.

---

#### 6. Verify accessibility & session persistence (no new code)

**What:** Manual + (optional) automated checks — see Testing below. No additional implementation work; this is verification that the Radix primitive + controlled `activeTab` state deliver the keyboard/ARIA and session-persistence requirements.

## Edge Cases & Risks

- **RHF form state loss on tab switch (HIGH).** If the Details panel unmounts, RHF resets and `isDirty`/dirty-guard break. Mitigation: keep all panels mounted via Radix `forceMount` + `hidden` toggle (step 4, option 1). This is the single most important implementation detail.
- **Unsaved-changes guard across tabs.** Because `isDirty` is lifted to the modal (`TicketDetailModal.tsx:43`) via `TicketAttributeForm.onDirtyChange` (`:173`), and the form stays mounted, the guard (`useBlocker`, `requestClose`, `Modal.blockBackdropClose`) works regardless of which tab is active. Verify the user can be on the Time Tracking tab with dirty Details and still get the confirm-discard dialog on close.
- **Soft-deleted ticket.** `!ticket.deletedAt` gating on timer/time-log/manual-entry must be preserved. Decide and document: when soft-deleted, the Time Tracking trigger should be disabled/hidden, and the form should stay read-only (`readOnly={!!ticket.deletedAt}`) as today.
- **Sticky footer span.** The form's `-mx-6 -mb-6` footer must still span the modal body with the tablist above. Re-check after restructuring; adjust negative margins only if the Tabs container adds padding.
- **Modal title vs. tabs.** The modal title (`formatTicketId(...)` header) is **not** a tab — it stays in the `Modal` header. Only the body is tabbed.
- **Focus management.** Radix Tabs moves focus with selection by default. Ensure opening the modal still focuses the first tab trigger (or the first form field) consistently with the existing `useModalA11y` focus behavior — verify no double focus-trap conflict.
- **No regressions to Timer/Activity/TimeLog rendering.** They are pure relocations; their internal `useQuery`/`useMutation` keys are unchanged, so cache behavior is identical.
- **No persisted-store precedent.** Do not introduce Zustand `persist` for the active tab — `useState` satisfies the requirement (reset-on-close is explicitly acceptable).

## Testing

*Follow project conventions — Vitest + Testing Library; table-driven tests; one behavior per test; co-locate `*.test.tsx` next to source.*

- **Unit tests (`Tabs.test.tsx`):**
  - Renders `tablist`/`tab`/`tabpanel` roles; selected tab has `aria-selected="true"`; inactive `false`.
  - Each trigger `aria-controls` matches its panel `id`; each panel `aria-labelledby` matches its trigger `id`.
  - Arrow Right/Left move focus between triggers; Home/End jump to first/last.
  - Controlled mode: `onValueChange` fires on activation; `value` drives the active panel.
  - `forceMount` panels stay in the DOM (visibility hidden) when inactive.
- **Component tests (`TicketDetailModal.test.tsx`):**
  - All three tabs render; correct content lands in each (Details: header + form + Comments placeholder + admin delete; Time Tracking: TimerControls + TimeLog + ManualEntryForm; Activity: ActivityFeed).
  - Switching to Time Tracking and back to Details **preserves** form input values and keeps `isDirty` true (guards against RHF unmount-reset regression) — table-driven across field types (title, description, priority, assignee).
  - Active tab persists across an unrelated re-render (e.g. query refetch) while the modal stays open.
  - Soft-deleted ticket: Time Tracking trigger disabled/hidden; form read-only; per-block gates honored.
  - Dirty Details + active Time Tracking tab → close attempt shows the confirm-discard dialog.
  - Priority: `getByRole("tab", { name: /details|time tracking|activity/i })` over test ids.
- **Integration tests:** Not required — this is a layout restructure with no new data flow.
- **Manual verification (accessibility):**
  - Keyboard-only: Tab to the tablist, arrow keys between tabs, Enter/Space (or auto-activation) switches panel, panels expose correct `role`/`aria-*` under a screen reader (VoiceOver/NVDA).
  - Axe/lighthouse on the open modal: zero tablist violations.
  - Active tab survives a board background refetch while open; resets to Details after close+reopen.

## Acceptance Criteria

- [ ] The modal presents three clearly labeled tabs — **Details**, **Time Tracking**, **Activity** — with the correct content in each.
- [ ] Time tracking (TimerControls, TimeLog, ManualEntryForm) lives **entirely** in tab 2; ActivityFeed lives **entirely** in tab 3.
- [ ] The SLYK-10 metadata header and the `TicketAttributeForm` appear in tab 1, with a clearly-marked Comments placeholder below the form (SLYK-13 not yet implemented).
- [ ] Tab navigation is keyboard-accessible with correct ARIA (`role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`, `aria-controls`, `aria-labelledby`) and arrow-key/Home/End support.
- [ ] The active tab persists while the modal is open (survives re-renders) and resets on close.
- [ ] The existing footer/save behavior continues to work within the Details tab; unsaved-changes guard still fires from any tab.
- [ ] Switching tabs does **not** lose in-progress form edits (RHF state preserved).
- [ ] Soft-deleted tickets keep timer/time-log/manual-entry gated out and the form read-only.
- [ ] No timer live-update bugs are introduced or fixed (that is SLYK-12's scope).

## Open Questions  *(optional)*

- **Dependency decision:** OK to add `@radix-ui/react-tabs`? (Recommended — matches the existing Radix convention.) If not, fall back to a hand-rolled tablist modeled on `hooks/useModalA11y.ts`.
- **Soft-deleted UX:** When a ticket is soft-deleted, should the Time Tracking tab trigger be *disabled* (visible but non-interactive) or *hidden*? Plan assumes disabled; confirm with owner.
- **Reported for SLYK-12 (do NOT fix here):** The analyst digests surfaced timer live-update issues that belong to SLYK-12's scope — listed only so SLYK-12 has the evidence:
  - `TimerControls` interval: when `stop` is clicked the elapsed display stops updating before the mutation resolves, and the readout doesn't tick during the `isStarting` window until the first 1000ms tick fires (`TimerControls.tsx:31-41`).
  - `useTimer` and `TimerControls` both call `useServerTime()` (`useTimer.ts:18`, `TimerControls.tsx:26`) — harmless double-dependency surface.
  - No `refetchInterval` on `timerKeys.active()` / `timerKeys.entries()` (`TimerControls.tsx:25`) — cross-tab start/stop leaves the local counter visually stale until window-focus refetch.

## Out of Scope

- Implementing the Comments section (SLYK-13) — placeholder only.
- Fixing timer live-update bugs (SLYK-12) — reported, not fixed.
- Any backend, schema, migration, API, or type changes.
- Extracting the SLYK-10 metadata header into its own component (SLYK-10 deliberately left it inline; this ticket keeps it inline).
- Persisting the active tab across modal close/reopen (reset-on-close is acceptable per the ticket).
- Lifting `TicketAttributeForm`'s RHF state out of the child component.
