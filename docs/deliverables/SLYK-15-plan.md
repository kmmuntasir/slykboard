# Implementation Plan — SLYK-15

**Ticket:** `docs/deliverables/SLYK-15.md`
**Type:** Bug
**Title:** Ticket Modal Sticky Footer Gap
**Generated:** 2026-06-30

---

## Summary

The `TicketDetailModal` footer (the Save/Cancel / Close action bar, owned by
`TicketAttributeForm`) is rendered as a `position: sticky; bottom: 0` bar that
sits *inside* the shared `Modal`'s single scroll container. When the user
scrolls back up past the sticky threshold, the footer's painted footprint
detaches from the panel's bottom edge and a thin strip of scrolling content
becomes visible below/behind the footer. The fix must guarantee that no
scrolling content is ever visible behind or below the footer, across the full
scroll lifecycle (down then up past the threshold) and in both light and dark
themes.

The cleanest, lowest-risk, convention-correct fix is to **render the footer
non-sticky** (explicitly permitted by the ticket: "or render it non-sticky"),
removing the fragile negative-margin bleed entirely. An alternative that
preserves the always-visible footer is documented under
[Alternatives](#alternatives-not-chosen) for the owner to consider.

## Root Cause

The shared `Modal` panel is a **single scroll container** capped at `90vh`,
with `p-6` padding on all four sides (`frontend/src/components/Modal.tsx:81`):

```
max-h-[90vh] w-full overflow-y-auto rounded-lg border border-border bg-background p-6 text-foreground shadow-xl outline-none
```

There is **no flex-column split** (header / scrollable body / fixed footer) and
**no footer slot** in the shell. The header is a non-sticky inline sibling
(`Modal.tsx:69-78`), and everything else — including the action footer — is raw
`{children}` living inside that one padded scroll region.

The action footer is owned by `TicketAttributeForm`, rendered as the last child
of its `<form>` (`frontend/src/components/TicketAttributeForm.tsx:159-163`):

```jsx
{/* F44: sticky footer, right-aligned, single Button size. Lives outside
     <fieldset disabled> so Cancel/Close remain clickable. */}
<div className="sticky bottom-0 -mx-6 -mb-6 mt-6 flex justify-end gap-2 border-t border-border bg-background px-6 py-3">
```

It works by negating the panel's `p-6` with `-mx-6 -mb-6` so the `border-t`
spans the full panel width and the bar reaches the panel's bottom edge — but
**only reliably while the `sticky bottom-0` element is pinned** (content taller
than `90vh` and scrolled to a position where the footer is stuck).

The defect is the **`sticky bottom-0` + negative-margin (`-mx-6 -mb-6`) +
`mt-6` combination inside a padded single-scroll container**:

- `position: sticky` tracks the scroll position; it is only "flush" while pinned.
  Across the stuck → unstuck transition (e.g. scrolling back up past the
  threshold, or when content is shorter than the viewport), the element returns
  to normal flow.
- The `-mb-6` negative bottom margin and `mt-6` spacing mean the in-flow
  footprint does not reliably cover the panel's `p-6` bottom-padding strip and
  rounded bottom edge, so a thin gap opens between the footer's `bg-background`
  box and the panel's bottom border.
- Through that strip the still-scrolling content (which lives behind the footer
  in the same scroll container) is visible — the "bleed-through" reported in the
  ticket.

Confirmed non-causes (`path:line` evidence):

- **Not opacity.** The footer is `bg-background` — fully opaque, the same token
  as the panel — in both themes. There is **no `dark:` variant** and no
  `backdrop-blur` anywhere in the shell or footer; theming is via semantic CSS
  variables (`frontend/src/index.css:11` light `--background`, `:53` dark).
- **Not global CSS.** No stylesheet targets the modal/dialog/footer; the only
  overflow/height-adjacent rule is `html, body, #root { height: 100% }`
  (`frontend/src/index.css:108-110`). All behavior is inline Tailwind utilities.
- **Not a second scroll container.** The only other `overflow-y-auto` region is
  the unrelated right-column checklist in `TicketAttributeForm.tsx:123`
  (`lg:max-h-[70vh]`), a sibling of the footer, not its scroll ancestor.

The footer is **Details-tab-scoped** (it lives inside `TicketAttributeForm`,
inside the Details `TabsContent`); the Time Tracking and Activity tabs render no
footer (`frontend/src/components/TicketDetailModal.tsx:150-261`). The bug is
therefore observed on the Details tab.

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| Component (footer) | `frontend/src/components/TicketAttributeForm.tsx` | Owns the buggy sticky footer (`:159-163`); class string changes here |
| Component (shell) | `frontend/src/components/Modal.tsx` | Scroll container + `p-6` that the footer's negative margins key off (`:81`); context only under the chosen fix |
| Component (consumer) | `frontend/src/components/TicketDetailModal.tsx` | Renders `TicketAttributeForm` inside the tabbed body (`:150-261`); verify no layout assumption breaks |
| Test | `frontend/src/components/TicketAttributeForm.test.tsx` | Asserts the sticky footer (`:407-421`); must be updated to the new contract |

## Proposed Implementation

The recommended fix is **Approach A: render the footer non-sticky**. It is the
smallest, most robust change, directly endorsed by the ticket ("or render it
non-sticky"), and it **structurally eliminates** the gap mechanism (no sticky,
no negative margins → nothing to detach across the scroll lifecycle). The footer
remains fully opaque (`bg-background`) and full-width naturally as a block child
of the form.

### Frontend Changes

#### 1. De-sticky the footer — `frontend/src/components/TicketAttributeForm.tsx`

**File:** `frontend/src/components/TicketAttributeForm.tsx`
**What:** Replace the sticky, negative-margin footer div with a normal
in-flow footer. Remove `sticky bottom-0 -mx-6 -mb-6`; keep the visual divider,
spacing, alignment, and opaque background.
**Why:** Removes the exact mechanism that produces the gap. The footer now
always paints flush at the end of the form content with no positional
dependence on scroll state.
**Code reference:** current footer at `TicketAttributeForm.tsx:161`.

Change the class string from:

```
sticky bottom-0 -mx-6 -mb-6 mt-6 flex justify-end gap-2 border-t border-border bg-background px-6 py-3
```

to (non-sticky, in-flow, still opaque + full-width + divider):

```
mt-6 flex justify-end gap-2 border-t border-border bg-background pt-6
```

Notes:
- `sticky bottom-0`, `-mx-6`, `-mb-6` are removed — no more reliance on the
  panel's `p-6` padding, no more scroll-state-dependent footprint.
- `bg-background` is retained so the footer stays fully opaque and theme-correct
  (harmless on a non-sticky element; can be dropped if the owner prefers — the
  panel behind it is the same token anyway).
- `border-t border-border` retained for the visual separator; `mt-6` retained
  for spacing above the divider; horizontal padding is no longer needed because
  the div is no longer breaking out of the panel's `p-6`.
- Update the `F44` comment (`TicketAttributeForm.tsx:159-160`) so it no longer
  claims "sticky footer".

#### 2. Update the footer regression test — `frontend/src/components/TicketAttributeForm.test.tsx`

**File:** `frontend/src/components/TicketAttributeForm.test.tsx`
**What:** The existing test ("footer is sticky and right-aligned…",
`:407-421`) asserts `document.querySelector('form > div.sticky')`. Update it to
the new contract: assert the footer is right-aligned (`justify-end`), renders
the expected action buttons, is **not** `sticky`, and is present as the last
child of the form. Keep it table-driven where cases already are.
**Why:** The contract changed by design; the test must assert the new
behavior, not the old buggy one.
**Code reference:** `TicketAttributeForm.test.tsx:407-421`.

#### 3. (Verify, likely no change) Consumer — `frontend/src/components/TicketDetailModal.tsx`

**File:** `frontend/src/components/TicketDetailModal.tsx`
**What:** No code change expected. Confirm the Details tab body still lays out
cleanly with the footer at the end of the form (the tabbed body composes
`TicketAttributeForm` unchanged otherwise, `:150-261`). Confirm Time Tracking /
Activity tabs are unaffected (they render no footer).
**Why:** Guards against accidental layout regression from removing the negative
margins (e.g. spacing where the footer used to bleed out of the panel padding).
**Code reference:** `TicketDetailModal.tsx:212-221` (Modal consumption).

#### 4. (Audit) Other consumers of the sticky-footer-in-padded-panel pattern

**What:** Grep the frontend for `sticky bottom-0` / `-mb-6` footers inside any
modal/form rendered through `Modal`. The analysts confirmed the pattern is
isolated to `TicketAttributeForm`, but a final `rg "sticky bottom-0"` sweep
should confirm no sibling form reuses it. If any does, apply the same change.
**Why:** Ensures the same defect class is not left latent elsewhere.

## Edge Cases & Risks

- **UX trade-off (accepted):** A non-sticky footer means that when the Details
  tab content is taller than `90vh`, the user must scroll to the bottom to reach
  Save/Cancel. The ticket explicitly permits this outcome ("whichever yields a
  clean result"). If always-visible actions are later required, adopt
  [Approach B](#alternatives-not-chosen).
- **Scroll-lock still active:** `useModalA11y` sets `body { overflow: hidden }`
  on open (`frontend/src/hooks/useModalA11y.ts:48`); this is independent of the
  panel's own scroll and is unaffected.
- **Both themes:** Footer + panel both use the opaque `bg-background` token in
  light and dark (no `dark:` variants, no transparency) — the fix holds in both.
- **No layout shift:** Removing `-mx-6 -mb-6` returns the footer to living inside
  the panel's `p-6`; the net visual change is the footer no longer spans edge-to-
  edge with its `border-t`. If edge-to-edge divider is desired on the non-sticky
  footer, it can be re-added scoped to the form without reintroducing sticky.
  Flagged as an [open question](#open-questions-optional).
- **Other modals:** Backward compatible — only `TicketAttributeForm` changes; the
  shared `Modal` is untouched under Approach A, so no other modal consumer is
  affected.
- **Regression risk:** Low. Change is confined to one class string + one test.

## Testing

*Project conventions — Vitest + Testing Library; table-driven; one behavior per
test; co-locate `*.test.tsx` next to source.*

- **Unit tests (`TicketAttributeForm.test.tsx`):**
  - Footer is **not** sticky (assert absence of the `sticky` class).
  - Footer is right-aligned (`justify-end`) and renders Cancel/Close + primary
    action (submit label) for both the editable and `readOnly` cases.
  - Footer is the last child of the `<form>` and lives outside the disabled
    `<fieldset>` (Cancel/Close remain enabled when the fieldset is disabled).
- **Component/integration:**
  - Render `TicketDetailModal` within the `Modal` portal; on the Details tab,
    assert no element in the footer region carries `sticky` or negative-margin
    classes.
  - (If a `jsdom` scroll assertion is feasible) after scrolling the panel to
    top, the footer has no gap class — primarily a manual-verification target.
- **Manual verification (required — the bug is visual/scroll-driven):**
  1. Open a ticket whose Details tab content exceeds `90vh`.
  2. Scroll down, then scroll back up past the point where the footer used to
     stick. Confirm **no strip of scrolling content is visible below/behind the
     footer at any point** in the cycle.
  3. Repeat with short content (no scroll) — footer sits cleanly at the end of
     the form.
  4. Toggle light and dark themes; confirm the footer is fully opaque and flush
     in both.
  5. Switch to Time Tracking / Activity tabs; confirm no footer and no layout
     regression.

## Acceptance Criteria

- [ ] No scrolling content is ever visible behind or below the footer, at any
      scroll position (down then back up past the former sticky threshold).
- [ ] Footer reads as flush with the modal content end; fully opaque in both
      light and dark themes.
- [ ] Footer remains right-aligned with the correct action buttons (editable vs
      `readOnly`), and Cancel/Close stay clickable when the form fieldset is
      disabled.
- [ ] `TicketAttributeForm.test.tsx` updated to the new (non-sticky) contract
      and passing.
- [ ] No other modal/form in the app still relies on the buggy
      `sticky bottom-0` + negative-margin-inside-padded-panel pattern.

## Alternatives (not chosen)

**Approach B — Flex-column Modal shell with a dedicated, non-scrolling footer
slot (preserves always-visible footer).** Convert the `Modal` panel
(`Modal.tsx:81`) from a single scroll container into a `flex flex-col` with
three regions: a `shrink-0` header, a `flex-1 min-h-0 overflow-y-auto` body
wrapping `{children}`, and an optional `shrink-0` footer slot
(`border-t bg-background px-6 py-3`). The action buttons move out of
`TicketAttributeForm`'s sticky div and are passed via the new `footer` prop at
the `TicketDetailModal` level.

- **Pros:** Footer is always visible without scrolling; standard accessible
  modal pattern; no sticky/negative-margin fragility.
- **Cons / why deferred:** Larger surface — touches the **shared** `Modal`
  (every consumer), the `p-6` padding contract that other forms may assume, and
  the `TicketDetailModal` tabbed composition. The footer is currently
  Details-tab-scoped (form submit + `readOnly` + `onCancel` + `submitLabel` live
  inside `TicketAttributeForm`); lifting it to the Modal level would make it show
  on all tabs or require conditional rendering per tab — a behavior change beyond
  the bug. Not justified when Approach A fully resolves the defect.
- **Trigger to revisit:** If product later requires Save/Cancel to be always
  visible without scrolling, implement Approach B (and decide cross-tab footer
  behavior then).

## Open Questions (optional)

- On the non-sticky footer, should the `border-t` divider still span the full
  panel width (edge-to-edge), or is an in-flow divider within the `p-6` padding
  acceptable? (Default: in-flow within padding — simplest; no edge-to-edge
  bleed needed once the bar is non-sticky.)

## Out of Scope

- Always-visible (non-scrolling) footer behavior — see Approach B; not required
  to fix the gap.
- Any change to the shared `Modal` shell under Approach A.
- Time Tracking / Activity tab content (they render no footer).
- The unrelated right-column `lg:max-h-[70vh] overflow-y-auto` checklist region
  in `TicketAttributeForm.tsx:123`.
