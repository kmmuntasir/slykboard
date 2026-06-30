# Manual Accessibility Verification — SLYK-11

> ## ⚠️ Execution status: DEFERRED — live QA required
>
> This runbook was **authored** as part of SLYK-11 (Ticket Details Modal Tabbed
> Layout) but **NOT executed**.
>
> **Reason:** the build environment that produced this document has **no live
> browser, no axe-core, and no Lighthouse** available. Automated a11y tooling
> cannot be run here, and no pass/fail results, axe scores, or Lighthouse scores
> may be fabricated.
>
> **What must happen before merge sign-off:** a human QA engineer must execute
> every checklist item below against the **merged T1–T4 branch** on a **real
> device/browser**, in **both light and dark themes**, and fill in the blank
> result cells (Pass / Fail / Blocked + notes). Until those cells are filled by
> a human, SLYK-11's accessibility acceptance is **unverified**.
>
> **Scope note:** SLYK-12 (timer live-update) checks are **OUT OF SCOPE** for
> this runbook — see "Out of Scope" at the bottom. Manual spot-check only.

---

## How to use this runbook

- Perform all steps against the **merged T1–T4 branch** (the Radix-based
  `Tabs` primitive + the restructured `TicketDetailModal`).
- Open the **Ticket Details Modal** for a normal (non-deleted) ticket, then
  work through each checklist group.
- Each item has **two result cells**: `T-L` (theme-light) and `T-D`
  (theme-dark). **Leave them blank until QA executes** — do not pre-fill.
- Convention for filled cells: `PASS`, `FAIL (note)`, `BLOCKED (note)`.
- Required tooling for the human QA pass: a keyboard, a screen reader
  (VoiceOver on macOS / NVDA on Windows), the **axe DevTools** browser
  extension, and **Lighthouse** (Chrome DevTools → Lighthouse → Accessibility).

---

## Checklist Group A — Keyboard tablist navigation

> Verifies arrow-key / Home / End / Tab semantics delivered by the Radix
> `Tabs` primitive, plus activation and panel focus movement.

| ID  | Step (perform manually)                                                                                                                                       | T-L (light) | T-D (dark) |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------- |
| A1  | Open the modal and `Tab` from the page until focus lands on the **first tab trigger (Details)**. Confirm focus ring is visible and on Details.                |             |            |
| A2  | With focus on Details, press **ArrowRight** and confirm focus/selection cycles in order: **Details → Time Tracking → Activity** (one press = one step).       |             |            |
| A3  | With focus on Activity, press **ArrowLeft** and confirm the cycle **reverses**: Activity → Time Tracking → Details.                                           |             |            |
| A4  | Press **Home** from any tab and confirm focus jumps to the **first** tab (Details); press **End** and confirm it jumps to the **last** tab (Activity).        |             |            |
| A5  | Activate a tab (Radix default is automatic activation on arrow; if a trigger is reached via Tab without activation, press **Enter/Space**). Then press **Tab** — focus must move **into the active panel content** (not back into the tablist). |             |            |

---

## Checklist Group S — Screen-reader roles / labels

> Verifies the ARIA contract: `tablist` / `tab` / `tabpanel` roles,
> `aria-selected`, `aria-controls` ↔ `aria-labelledby` pairing, and the
> Comments placeholder accessible name. Use a screen reader (VoiceOver/NVDA)
> and/or the browser's Accessibility tree inspector.

| ID  | Step (perform manually)                                                                                                                                                                       | T-L (light) | T-D (dark) |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------- |
| S1  | Inspect the tablist in the a11y tree: confirm `role="tablist"` on the list, `role="tab"` on each trigger (Details / Time Tracking / Activity), and `role="tabpanel"` on each panel. Confirm the **active** tab exposes `aria-selected="true"` and the inactive tabs `aria-selected="false"`. |             |            |
| S2  | Confirm each trigger's `aria-controls` references its panel's `id`, and each panel's `aria-labelledby` references its trigger's `id` (bidirectional pairing). Separately, confirm the **Comments placeholder section** in the Details tab has an **accessible name** (e.g. `aria-label="Comments"` or a visible heading picked up as the section name) and is announced as such by the screen reader. |             |            |

---

## Checklist Group X — axe-core + Lighthouse (automated, on open modal)

> These require real tooling that is **not available in the build environment**.
> Run them on a real browser against the **open modal** (modal must be open and
> the Details tab active; then repeat per tab as needed).

| ID  | Step (perform manually)                                                                                                                                                               | T-L (light) | T-D (dark) |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------- |
| X1  | With the modal open, run **axe DevTools** scan. Record the result: number of issues by severity (critical / serious / moderate / minor) and any tablist/ARIA-related violations. **Record the actual score/issue list here — do not invent.** |             |            |
| X2  | With the modal open, run **Lighthouse → Accessibility** audit. Record the numeric a11y score (0–100) and any flagged opportunities. **Record the actual score here — do not invent.** |             |            |

---

## Checklist Group P — Session persistence

> Verifies the `activeTab` `useState` survives in-modal re-renders (P1) and
> resets on close (P2).

| ID  | Step (perform manually)                                                                                                                                                       | T-L (light) | T-D (dark) |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------- |
| P1  | Open the modal, switch to the **Activity** (or Time Tracking) tab, then trigger a **background board refetch** while the modal stays open (wait for the board polling interval, or force a refetch). Confirm the **active tab does not revert** to Details — it stays on Activity. |             |            |
| P2  | Close the modal (after handling the dirty guard if edits exist), then **reopen** it. Confirm the active tab **resets to Details** on reopen (reset-on-close is the expected behavior). |             |            |

---

## Checklist Group D — Dirty-guard (tab-agnostic) + RHF preservation

> Verifies the unsaved-changes guard fires regardless of active tab, and that
> the `forceMount` + `hidden` mitigation preserves React Hook Form edits across
> tab switches (the highest-risk requirement in SLYK-11).

| ID  | Step (perform manually)                                                                                                                                                       | T-L (light) | T-D (dark) |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------- |
| D1  | **Dirty-guard, tab-agnostic:** on the **Details** tab, make an unsaved edit (e.g. change title/description/priority/assignee) so `isDirty` is true. Switch to the **Time Tracking** tab. Attempt to **close** the modal (X button, backdrop click, or Esc). Confirm the **`ConfirmDiscardDialog`** appears. **RHF preservation:** while still on Time Tracking (dirty Details), switch back to Details and confirm **the in-progress edits are still present** (not reset). |             |            |

---

## AC Mapping — runbook item → SLYK-11 plan Acceptance Criterion

Each runbook item maps to the specific Acceptance Criterion it satisfies in
`docs/deliverables/SLYK-11-plan.md` ("Acceptance Criteria" section).

| Runbook item | SLYK-11 plan Acceptance Criterion satisfied |
| ------------ | ------------------------------------------- |
| A1           | Tab navigation is keyboard-accessible with correct ARIA and arrow-key/Home/End support (keyboard focus reaches the tablist / first trigger). |
| A2           | Same AC — **ArrowRight** cycles Details → Time Tracking → Activity. |
| A3           | Same AC — **ArrowLeft** reverses the cycle. |
| A4           | Same AC — **Home/End** jump to first/last tab. |
| A5           | Same AC — activation (Enter/Space or automatic) selects the panel; `Tab` moves into the **active panel content**, not back into the tablist. Also supports: "active tab persists while modal open" (selection is reflected in the panel). |
| S1           | Tab navigation is keyboard-accessible with correct ARIA — `role="tablist"` / `role="tab"` / `role="tabpanel"`, `aria-selected` present and correct. |
| S2           | Same ARIA AC — `aria-controls`/`aria-labelledby` pairing. Also satisfies: "a clearly-marked **Comments placeholder** below the form" (the placeholder must have an accessible name). |
| X1           | Same ARIA AC — automated axe scan surfaces zero tablist violations on the open modal. |
| X2           | Same ARIA AC — Lighthouse a11y audit on the open modal (no tablist/ARIA regressions). |
| P1           | "The active tab **persists while the modal is open** (survives re-renders)." |
| P2           | Same AC — active tab **resets on close** (close+reopen returns to Details). |
| D1 (guard)   | "The existing footer/save behavior continues to work within the Details tab; **unsaved-changes guard still fires from any tab**." |
| D1 (RHF)     | "Switching tabs does **not lose in-progress form edits** (RHF state preserved)" — the `forceMount` + `hidden` mitigation. |

> **Soft-delete gating** (plan AC: "Soft-deleted tickets keep timer/time-log/
> manual-entry gated out and the form read-only") is **not separately
> itemized** as a manual a11y step here — it is a functional gate exercised by
> the SLYK-11 component tests and should be spot-checked by QA alongside S1/S2
> (Time Tracking trigger disabled/hidden; form read-only when `deletedAt` set).
>
> **Timer live-update** behavior is explicitly **OUT OF SCOPE** (SLYK-12) — see
> below.

---

## Out of Scope

- **SLYK-12 (timer live-update) checks** are **OUT OF SCOPE** for this runbook.
  Timer live-update verification (interval ticking, `isStarting` window,
  cross-tab start/stop staleness, `refetchInterval`) belongs to SLYK-12.
  Here, perform only a **manual spot-check** that `TimerControls`, `TimeLog`,
  and `ManualEntryForm` render correctly inside the Time Tracking tab — no
  timer-internal behavior assertions.
- **Comments implementation** (SLYK-13) — only the placeholder's accessible
  name is verified here (S2). The Comments section itself is not implemented.
- This runbook does **not** replace the SLYK-11 unit/component tests
  (`Tabs.test.tsx`, `TicketDetailModal.test.tsx`); it is the complementary
  manual + automated a11y pass.

---

## Sign-off

| Role | Name | Date | Notes |
| ---- | ---- | ---- | ----- |
| QA (executed runbook) |      |      |       |
| Frontend review        |      |      |       |
| Merge approver         |      |      |       |

_Result cells above must be filled by a human on a real device before this
section is signed._
