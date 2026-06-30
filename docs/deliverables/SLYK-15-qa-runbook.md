# Manual QA Runbook — SLYK-15 (Ticket Modal Sticky Footer Gap)

> Ticket: **SLYK-15** — [Bugfix] Ticket Modal Sticky Footer Gap
> Source issue: `docs/deliverables.md` (DEL-15) / original issue #9g.
>
> ## ⚠️ Execution status: DEFERRED — no live browser in CI/agent environment
>
> This runbook was **authored** as part of SLYK-15 Task T5 (Final Verify Gate)
> but has **NOT been executed**. There is **no live browser, no running app,
> and no live DOM** available in this build/agent environment, so manual
> visual/scroll checks against the running app **cannot** be performed here.
>
> Every manual step below is explicitly marked
> **STATUS: DEFERRED (no live browser in CI/agent environment)**. No manual
> pass/fail result has been recorded and none may be fabricated. A human QA
> engineer must execute this runbook against the running app on a real
> browser, fill in each `Result: ____` field, and sign the Sign-off block
> before SLYK-15 is considered visually verified.

---

## Scope

This runbook verifies the SLYK-15 fix end-to-end:

- The modal footer in **`CreateTicketModal`** (create flow) and the **Details**
  tab of **`TicketDetailModal`** (view/edit flow) must seat **flush at the
  bottom of the modal** — fully opaque, covering the full content width.
- **No scrolling content may ever be visible behind or below the footer**
  during the scroll lifecycle (scroll down, then back up past the sticky
  threshold).
- The fix must hold in **both light and dark themes**.
- The **Time Tracking** and **Activity** tabs of `TicketDetailModal` must
  render **NO footer** (those tabs have no form/save action; the footer is a
  Details-tab artifact only).

The root-cause fix is the removal of the `sticky bottom-0` pattern from the
modal footer. See **Automated post-fix sweep** below for the grep proof.

---

## Preconditions

A human QA engineer must satisfy these before running the manual checks.

### 1. Start the backend

```bash
cd backend
npm install
npm run dev          # default PORT=3000
```

Required backend env vars (set in `.env`, never committed):

```
PORT=3000
FRONTEND_URL=http://localhost:5173
DATABASE_URL=<your Postgres / Supabase URL>
GOOGLE_CLIENT_ID=<...>
GOOGLE_CLIENT_SECRET=<...>
GOOGLE_CALLBACK_URL=<...>
JWT_SECRET=<...>
ALLOWED_DOMAIN=<your G-Suite domain>
POLL_INTERVAL_SECONDS=30
```

### 2. Start the frontend

```bash
cd frontend
npm install
npm run dev          # Vite dev server on http://localhost:5173
```

Required frontend env vars (`.env`, `VITE_`-prefixed):

```
VITE_API_BASE_URL=http://localhost:3000
VITE_GOOGLE_CLIENT_ID=<...>
VITE_POLL_INTERVAL_SECONDS=30
```

### 3. Sample data

- A **sample project** with slug e.g. `slyk-demo`, owned by or shared with the
  signed-in user (Admin or Member role).
- At least **two tickets** in that project:
  - **Ticket A — long content:** a ticket whose **title and/or description** is
    long enough to make the modal body **scroll** (e.g. a description with
    30+ lines / multiple paragraphs, or a long checklist). This ticket is used
    for checks (1) and (4)/(5) where scroll behavior matters.
  - **Ticket B — short content:** a ticket with a **one-line title and an empty
    (or one-line) description**, so the modal body **does not scroll**. Used
    for check (2).
- Theme toggle reachable from the top nav (light ↔ dark).

### 4. Tooling

- A desktop browser with DevTools (Chrome/Edge/Firefox) — needed to inspect the
  footer element, toggle themes, and observe scroll behavior.
- Theme toggle set to **light** for checks (1)/(2)/(3)/(5a), then switched to
  **dark** for checks (4)/(5b).

---

## Automated post-fix sweep

The root cause was a `sticky bottom-0` pattern on the modal footer. The fix
removed it. Confirm no stale `sticky bottom-0` survives in the frontend source:

```bash
rg "sticky bottom-0" frontend/src
```

**Result recorded in CI/agent environment (this run, T5):**

- Command: `rg "sticky bottom-0" frontend/src`
- Exit code: `1` (ripgrep returns 1 when there are **no matches**)
- Matches found: **0 (zero)**
- **STATUS: PASS — zero `sticky bottom-0` matches in `frontend/src`.**

> Note: this sweep is automated/static and was actually executed in the build
> environment (unlike the manual checks below). It is included here for the
> reviewer's record. If the sweep is re-run by QA and returns any match,
> **stop** — the SLYK-15 fix has regressed.

---

## Manual checks

> All manual checks below are **STATUS: DEFERRED (no live browser in CI/agent
> environment)**. A human QA engineer must execute each one against the running
> app and fill in `Result: ____`. Do not pre-fill or fabricate.

### Check 1 — Long-content scroll (no footer bleed/overlap; footer flows with content)

**STATUS: DEFERRED (no live browser in CI/agent environment)**

Verifies that with long content, no scrolling content is visible behind or
below the footer, and that the footer flows with content (no gap on scroll-up
past the sticky threshold, no overlap).

**Steps to reproduce:**

1. Sign in, open the sample project, ensure **light theme** is active.
2. Open **Ticket A (long content)** — click its card to open `TicketDetailModal`.
   Confirm the **Details** tab is active.
3. Scroll the modal body **all the way down**, then **back up** to the top, then
   down/up repeatedly. Move slowly past the point where the footer would have
   "stuck".
4. Repeat steps 2–3 in the **Create modal**: click **New Ticket**
   (`CreateTicketModal`), paste the same long content into the Title and
   Description fields so the body scrolls, then scroll down/up through the body.

**Exact pass criterion:**

- The footer (save/cancel row) sits **flush at the bottom** of the modal content
  area.
- While scrolling, **no ticket content is ever visible behind or below the
  footer** (no bleed-through gap).
- The footer does **not overlap** or cover any input field at any scroll
  position.
- Scrolling down then back up produces **no flicker, no gap, no detached
  floating footer** — the footer moves with the content flow.

**Result: ____**

---

### Check 2 — Short content (clean layout, no gap/clip)

**STATUS: DEFERRED (no live browser in CI/agent environment)**

Verifies that when the modal body does not scroll, the layout is clean — no
excess gap between content and footer, no clipped footer.

**Steps to reproduce:**

1. With **light theme** active, open **Ticket B (short content)** —
   `TicketDetailModal`, Details tab.
2. Observe the modal as a whole without scrolling (body should not be
  scrollable).
3. Repeat in the **Create modal**: open `CreateTicketModal`, enter a one-line
   title and leave description empty/one line.

**Exact pass criterion:**

- Modal body does not scroll; the footer sits **immediately below the last
  field** with normal spacing.
- **No oversized gap** between the last field and the footer.
- The footer is **fully visible (not clipped)** inside the modal — no part of
  the save/cancel buttons is cut off.
- No horizontal scrollbar appears.

**Result: ____**

---

### Check 3 — Light theme (footer flush, no visual seam)

**STATUS: DEFERRED (no live browser in CI/agent environment)**

Verifies the footer is flush and fully opaque in light theme — no visual seam
between footer background and modal body.

**Steps to reproduce:**

1. Confirm **light theme** is active.
2. Open `TicketDetailModal` on Ticket A (Details tab) and scroll so the footer
   is visible at the bottom.
3. Open `CreateTicketModal` and observe its footer at the bottom.
4. (Optional but recommended) In DevTools, inspect the footer element and
   confirm it has a **solid (opaque) background** matching the modal surface —
   no `transparent` / partial-alpha background that would let content show
   through.

**Exact pass criterion:**

- The footer background is **fully opaque** (matches the modal surface color in
  light theme).
- There is **no visible seam, hairline, or color discontinuity** between the
  footer and the modal body/sides.
- No scrolling content shows through the footer from behind/below.

**Result: ____**

---

### Check 4 — Dark theme (footer flush, no visual seam)

**STATUS: DEFERRED (no live browser in CI/agent environment)**

Same as Check 3 but in dark theme — the gap/bleed was originally most visible
in dark theme, so this must be checked explicitly.

**Steps to reproduce:**

1. Toggle to **dark theme** via the top-nav theme toggle.
2. Open `TicketDetailModal` on Ticket A (Details tab) and scroll through the
   body, observing the footer at the bottom.
3. Repeat the long-content scroll test from Check 1 in dark theme (scroll down,
   then back up past the sticky threshold).
4. Open `CreateTicketModal` with long content in dark theme and repeat the
   scroll test.

**Exact pass criterion:**

- The footer background is **fully opaque** (matches the dark modal surface).
- There is **no visible seam, hairline, or color discontinuity** between footer
  and modal body/sides in dark theme.
- **No scrolling content shows through** behind or below the footer at any
  scroll position — particularly no light-on-dark bleed when scrolling up past
  the former sticky threshold.
- The footer does not overlap any field.

**Result: ____**

---

### Check 5 — Time Tracking & Activity tabs render NO footer

**STATUS: DEFERRED (no live browser in CI/agent environment)**

Verifies that the footer is a **Details-tab artifact only**. The **Time
Tracking** and **Activity** tabs of `TicketDetailModal` have no save action and
must render **no footer** (no orphaned/empty footer row, no floating buttons).

**Steps to reproduce (5a — light theme):**

1. Confirm **light theme**.
2. Open `TicketDetailModal` on Ticket A.
3. Click the **Time Tracking** tab. Scan the full modal height.
4. Click the **Activity** tab. Scan the full modal height.
5. Switch back to **Details** and confirm the footer **reappears** (save/cancel
   row is present) — proving the footer is conditionally rendered per-tab, not
   globally stuck to the modal.

**Steps to reproduce (5b — dark theme):**

6. Toggle to **dark theme**.
7. Repeat steps 3–5 (Time Tracking → Activity → back to Details) in dark theme.

**Exact pass criterion:**

- On the **Time Tracking** tab: **no footer** (no save/cancel row, no empty
  footer band, no floating buttons) is rendered at the bottom of the modal.
- On the **Activity** tab: **no footer** is rendered.
- On the **Details** tab: the footer **is** rendered (save/cancel row present).
- This holds in **both light and dark themes**.
- (Bonus) On a **soft-deleted** ticket, the Time Tracking trigger is disabled
  and the tab content is gated out — confirm no footer renders there either.

**Result: ____**

---

## AC Mapping (runbook check → SLYK-15 plan Acceptance Criterion)

| Runbook check | SLYK-15 plan Acceptance Criterion |
| ------------- | --------------------------------- |
| Check 1 | "No scrolling content is ever visible behind or below the footer." (long content, scroll lifecycle) |
| Check 2 | "The footer reads as flush with the modal bottom whenever it is sticky." (short content, no clip/gap) |
| Check 3 | Both ACs, in light theme. |
| Check 4 | Both ACs, in dark theme ("the fix holds … in both themes"). |
| Check 5 | No-footer invariant for non-Details tabs (regression guard; not a literal SLYK-15 AC but required so the fix did not push the footer globally). |

---

## Sign-off

> All `Result: ____` fields above must be filled in by a human QA engineer on a
> real browser before this runbook is signed off. Until then, SLYK-15's visual
> acceptance is **unverified**.

| Role | Name | Date | Checks executed | Notes |
| ---- | ---- | ---- | --------------- | ----- |
| QA (executed runbook) |      |      |                 |       |
| Frontend review        |      |      |                 |       |
| Merge approver         |      |      |                 |       |
