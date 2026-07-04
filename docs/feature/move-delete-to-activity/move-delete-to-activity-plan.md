# Implementation Plan — move-delete-to-activity
**Ticket:** `docs/feature/move-delete-to-activity/move-delete-to-activity.md`
**Type:** Feature
**Title:** Move "Delete ticket" button from modal footer into a dedicated "Danger zone" section on the Activity tab
**Generated:** 2026-07-04

---

## Summary
Move the "Delete ticket" button out of the TicketDetailModal footer (`modalFooter`) and into a new visually distinct "Danger zone" section appended at the bottom of the Activity tab's `TabsContent`. The button's gate (`canDelete && !ticket.deletedAt`), its `onClick` (`() => setDeleteConfirmOpen(true)`), and the confirmation flow (state + handler + `<DeleteTicketConfirm>`) all stay exactly as-is — the confirmation already lives at modal-root scope, so it is unaffected by the active tab. This is a pure JSX relocation + a new presentational wrapper; no logic, no API, no types change. Five co-located tests in `TicketDetailModal.test.tsx` must be updated to switch to the Activity tab before querying/clicking the button, because Radix `TabsContent` uses `forceMount` + `hidden={activeTab !== 'activity'}` and the default tab is `'metadata'`, so `getByRole`/`queryByRole` (which skip hidden elements) will break.

## Affected Components
| Layer | File | Why |
|-------|------|-----|
| Frontend | `frontend/src/components/TicketDetailModal.tsx` | Remove Delete button from `modalFooter`; add Danger Zone section inside Activity `TabsContent`. |
| Frontend test | `frontend/src/components/TicketDetailModal.test.tsx` | Update 5 tests to switch to Activity tab before querying/clicking Delete. |

No other files touched. No backend, no new components, no types, no new dependencies.

## Current State *(confirmed path:line evidence)*
- Delete button JSX: `TicketDetailModal.tsx:435-441`, inside `modalFooter`:
  ```tsx
  {canDelete && !ticket.deletedAt && (
      <Button
          variant="destructive-outline"
          onClick={() => setDeleteConfirmOpen(true)}
      >
          Delete ticket
      </Button>
  )}
  ```
- `modalFooter` composition: `TicketDetailModal.tsx:433-457` — a `flex items-center justify-end gap-2` row containing Delete (first), then an edit-mode `Cancel` button (`:442`), then `Save changes` (`:448`). Passed to `<Modal footer={modalFooter}>` at `:472`.
- Activity `TabsContent`: `TicketDetailModal.tsx:405-413`:
  ```tsx
  <TabsContent
      value="activity"
      forceMount                                  // keeps panel in DOM when inactive
      hidden={activeTab !== 'activity'}           // hides it via hidden attr
      className="mt-4"
  >
      <ActivityFeed ticketId={ticket.id} />
  </TabsContent>
  ```
- Default tab: `TicketDetailModal.tsx:84` — `const [activeTab, setActiveTab] = useState<DetailTab>('metadata');` (also force-reset to `'metadata'` on ticket change at `:88`).
- `canDelete` definition: `TicketDetailModal.tsx:94` — `const canDelete = isPlatformAdmin || isProjectAdmin;` (DEL-01 widened gate).
- Confirmation state: `TicketDetailModal.tsx:75` — `const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);`
- Confirmation handler: `TicketDetailModal.tsx:216-220` — `handleConfirmDelete` (calls `deleteTicketMutation.mutateAsync`, closes confirm, calls `onClose`).
- Confirmation UI: `<DeleteTicketConfirm>` rendered at modal-root scope as a sibling of `<Modal>` in the top-level fragment return (`TicketDetailModal.tsx:481-486`), gated by `isOpen={deleteConfirmOpen}` — NOT inside the footer or any tab. Unaffected by this change.

## Styling Conventions *(confirmed)*
- Button primitive rule: "Tokens from F32 (no raw colors)" — `frontend/src/components/ui/Button.tsx:3`. DO NOT use raw `red-*` Tailwind classes. Use design tokens: `destructive`, `destructive-foreground`, `border`, `background`, `muted-foreground`.
- Current Delete button uses `variant="destructive-outline"` which resolves to `border border-destructive bg-background text-destructive hover:bg-destructive/10` (`Button.tsx:27-28`). KEEP this variant for the moved button — it needs zero new classes.
- No existing "Danger zone" component/pattern exists anywhere in `frontend/src` (grep confirmed). We establish the convention here.
- Canonical destructive-tinted surface in this very file = the soft-deleted banner `TicketDetailModal.tsx:268-274`:
  ```tsx
  <div className="mb-4 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2">
      <span className="inline-flex items-center rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-destructive-foreground">Deleted</span>
      <span className="text-sm text-destructive">This ticket was removed from the board…</span>
  </div>
  ```
  → reuse `bg-destructive/10` + `border-destructive` + `text-destructive`.
- Settings section card pattern: `ProjectSettingsPage.tsx:132/200/229/276` uses `<section className="space-y-2 rounded border border-border p-4">` with `<h2 className="text-lg font-semibold">`. Tab-internal headings use `text-sm font-semibold text-foreground` (`ActivityFeed.tsx:27`).
- Muted secondary description text token: `text-muted-foreground` (used throughout, e.g. `DeleteTicketConfirm.tsx:23`, `ProjectSettingsPage.tsx:288`).
- DO NOT copy the legacy `TimerControls.tsx:62` raw `bg-destructive` — it predates the Button primitive and is off-convention.

## Proposed Implementation

### Change 1 — Remove the Delete button from `modalFooter` (TicketDetailModal.tsx)
- **File:** `frontend/src/components/TicketDetailModal.tsx`
- **What:** Delete the entire `{canDelete && !ticket.deletedAt && (<Button variant="destructive-outline" ...>Delete ticket</Button>)}` block from `modalFooter` (currently `:435-441`). After removal, the footer retains the `Cancel` (edit-mode) and `Save changes` buttons and the `flex items-center justify-end gap-2` wrapper — no structural change needed. `modalFooter` continues to be passed via `footer={modalFooter}`.
- **Why:** The destructive action is being relocated to a dedicated Activity-tab section so it is not a persistent footer affordance.
- **Code reference:** `TicketDetailModal.tsx:435-441`, `:433-457`, `:472`.

### Change 2 — Add a "Danger zone" section at the bottom of the Activity `TabsContent` (TicketDetailModal.tsx)
- **File:** `frontend/src/components/TicketDetailModal.tsx`
- **What:** Append a new section as a sibling AFTER `<ActivityFeed ticketId={ticket.id} />` (currently `:412`), INSIDE the Activity `TabsContent` (before its closing `</TabsContent>` at `:413`). Gate the WHOLE new section on the same `{canDelete && !ticket.deletedAt && (...)}` condition so non-admins and soft-deleted tickets see nothing. Recommended markup (composes only established classes cited above):
  ```tsx
  {canDelete && !ticket.deletedAt && (
      <div className="mt-6 rounded-md border border-destructive bg-destructive/10 p-4">
          <h3 className="mb-1 text-sm font-semibold text-destructive">Danger zone</h3>
          <p className="mb-3 text-sm text-muted-foreground">
              Permanently remove this ticket from the board. This cannot be undone.
          </p>
          <Button variant="destructive-outline" onClick={() => setDeleteConfirmOpen(true)}>
              Delete ticket
          </Button>
      </div>
  )}
  ```
- **Why:** Establishes a clear, visually distinct destructive-action surface consistent with the soft-deleted banner styling (`bg-destructive/10` + `border-destructive` + `text-destructive`), reusing established design tokens (no raw `red-*`).
- **Code reference:** `TicketDetailModal.tsx:405-413`, `:268-274`.

#### Notes on Change 2
- `mt-6` gives extra separation below `<ActivityFeed>` (which already has its own `mt-4 border-t`); if the implementer wraps `<ActivityFeed>` + the new block in a parent `<div className="flex flex-col gap-4">` inside the TabsContent, that's acceptable and consistent with how the metadata tab uses `mt-4 flex flex-col gap-4` (`:370`). Either approach is fine; choose whichever reads cleanest.
- The visible button label MUST remain exactly `Delete ticket` (the tests select on that accessible name).
- The button MUST keep `variant="destructive-outline"` and `onClick={() => setDeleteConfirmOpen(true)}` verbatim. Switching to filled `variant="destructive"` is optional/deferred — default to keeping `destructive-outline` to minimize visual churn unless reviewers prefer the stronger affordance.

### Change 3 — Keep gate + onClick identical
- **File:** `frontend/src/components/TicketDetailModal.tsx`
- **What:** The `{canDelete && !ticket.deletedAt}` gate and the inline `onClick={() => setDeleteConfirmOpen(true)}` are preserved verbatim at the new location. No named handler, no symbol rename.
- **Why:** Logic equivalence guarantees the confirmation flow is unchanged; only the JSX location moves.
- **Code reference:** `canDelete` from `:94`, `setDeleteConfirmOpen` from `:75`.

### Change 4 — Leave confirmation logic untouched
- **File:** `frontend/src/components/TicketDetailModal.tsx`
- **What:** Do NOT move or modify the confirmation flow. State (`:75`), `handleConfirmDelete` (`:216-220`), and `<DeleteTicketConfirm>` (`:481-486`, modal-root scope) stay exactly as-is.
- **Why:** Because the confirm dialog renders at modal-root scope (sibling of `<Modal>`, gated by `deleteConfirmOpen`), opening it from the Activity tab works identically to opening it from the old footer.
- **Code reference:** `TicketDetailModal.tsx:75`, `:216-220`, `:481-486`.

### Change 5 — Update the 5 tests in TicketDetailModal.test.tsx
- **File:** `frontend/src/components/TicketDetailModal.test.tsx`
- **What:** CRITICAL — the ticket cited the `it(...)` declaration lines (450/458/467/474/931), but the ACTUAL query/assertion lines where the button is selected are different. Both are listed in the table below; the implementer must update the query/assertion line in each block. Every one of these tests currently queries the Delete button WITHOUT first switching to the Activity tab, so they break (or silently false-pass) once the button moves into the hidden-by-default Activity panel. Insert the established two-line Activity-tab switch (from `TicketDetailModal.test.tsx:571-572`) before each query/click. `fireEvent` and `screen` are already imported at the top of the file (`:3`), so NO new imports are required.
- **Why:** Radix `TabsContent` keeps inactive panels in the DOM but sets `hidden`; Testing Library `getByRole`/`queryByRole` skip hidden elements, so tests must explicitly activate the Activity tab.
- **Code reference:** `TicketDetailModal.test.tsx:450`, `:458`, `:467`, `:474`, `:931`, `:571-572`, `:3`.

#### Established tab-switch snippet (verbatim from `:571-572`)
```ts
fireEvent.mouseDown(screen.getByRole('tab', { name: /activity/i }));
await screen.findByRole('tabpanel', { name: /activity/i });
```
*(Mechanism: Radix Tabs activate on mouseDown, hence `fireEvent.mouseDown`; the `findByRole('tabpanel')` await lets activation settle and `hidden` clear so the now-visible Delete button becomes queryable.)*

#### Per-test updates

| # | `it(...)` decl line | Actual query/assert line | Current code at the query line | Outcome without fix | Required fix |
|---|---|---|---|---|---|
| 1 | `:450` "F17 ADMIN: renders the 'Delete ticket' button" | `:455` | `expect(screen.getByRole('button', { name: 'Delete ticket' })).toBeInTheDocument();` | getByRole skips hidden → throws → HARD FAIL | Insert tab-switch snippet before `:455` |
| 2 | `:458` "F17 ADMIN: clicking 'Delete ticket' opens the DeleteTicketConfirm dialog" | `:463` | `fireEvent.click(screen.getByRole('button', { name: 'Delete ticket' }));` (then `:464` asserts the confirm dialog) | getByRole skips hidden → throws → HARD FAIL (can't click) | Insert tab-switch snippet before `:463`. The confirm-dialog assertion at `:464` needs NO change (it renders at modal-root scope) |
| 3 | `:467` "F17 MEMBER: does NOT render the 'Delete ticket' button" | `:471` | `expect(screen.queryByRole('button', { name: 'Delete ticket' })).not.toBeInTheDocument();` | Currently passes (gate keeps button out of DOM), but is a FALSE-PASS risk: queryByRole returns null for both "not in DOM" and "in DOM but hidden" | Insert tab-switch snippet before `:471` so the assertion genuinely verifies absence on the Activity tab |
| 4 | `:474` "F17 ADMIN on a soft-deleted ticket: hides the 'Delete ticket' button" | `:481` | `expect(screen.queryByRole('button', { name: 'Delete ticket' })).not.toBeInTheDocument();` | Same false-pass risk as #3 | Insert tab-switch snippet before `:481` |
| 5 | `:931` "DEL-01 widened delete gate: a PROJECT ADMIN sees the Delete ticket button" | `:944` | `expect(screen.getByRole('button', { name: 'Delete ticket' })).toBeInTheDocument();` | getByRole skips hidden → throws → HARD FAIL | Insert tab-switch snippet before `:944` |

Insertion point for each: right after the modal-finishes-rendering await in each test (e.g. after `await screen.findByRole('dialog', { name: 'SLYK-101' })` or equivalent), and immediately before the Delete-button query/click line. *(Line numbers above are current verified positions as of investigation; verify against the working tree before editing, since the file may drift by a few lines.)*

## Edge Cases & Risks
- Non-admin members (`canDelete` false): the new section is gated out → renders nothing. Test #3 covers this.
- Soft-deleted tickets (`ticket.deletedAt` set): the new section is gated out → renders nothing; the soft-deleted banner (`:268-274`) still shows. Test #4 covers this.
- Edit-mode footer (`isEditingDescription`): the footer loses the Delete button but keeps Cancel + Save. No layout regression because the footer was already a `flex justify-end` row.
- Dark mode: `destructive` / `bg-destructive/10` / `border-destructive` tokens resolve correctly in dark mode (they're the same tokens used by the soft-deleted banner). No dark-mode-specific classes needed.
- The confirm dialog opening from the Activity tab: works because `<DeleteTicketConfirm>` is at modal-root scope, independent of active tab.
- Accessible name stability: the button text MUST remain exactly "Delete ticket" — do not change it, or the tests (and any other selectors) break.

## Testing
- Backend: N/A — no backend changes.
- Frontend: Vitest + Testing Library; co-located `*.test.tsx`.
  - All 5 updated tests must pass.
  - Run the full frontend Vitest suite to confirm no other test references the Delete button in the footer (investigation found only these 5).
  - The existing Activity-tab tests (e.g. the `:570-573` child-content test) remain valid and unaffected.
  - Type-check passes (no new types).

### Verification commands
Run from the repo root (`/home/munna/speedo/localhost/slykboard`):
- Tests: `npm test -w frontend`
- Type-check: `npm run typecheck -w frontend`
- (Optional full build sanity): `npm run build -w frontend`

## Acceptance Criteria
- [ ] The "Delete ticket" button no longer appears in the TicketDetailModal footer.
- [ ] A visually distinct "Danger zone" section (destructive-tinted, token-based, consistent with the soft-deleted banner styling) appears at the bottom of the Activity tab content, containing the "Delete ticket" button.
- [ ] The section + button are gated on `canDelete && !ticket.deletedAt` (admins only, not soft-deleted).
- [ ] Clicking "Delete ticket" opens the `<DeleteTicketConfirm>` dialog exactly as before (same handler, same state).
- [ ] Confirmation logic and dialog location are unchanged from before.
- [ ] All 5 co-located tests updated with the Activity-tab switch; `npm test -w frontend` is green; `npm run typecheck -w frontend` is green.
- [ ] No raw `red-*` Tailwind classes introduced; only design tokens used.

## Out of Scope
- No backend / API / mutation changes.
- No new reusable `DangerZone` component extracted into `ui/` (this is a one-off inline section; can be refactored to a shared component later if a second use case appears).
- No change to the confirmation dialog component (`DeleteTicketConfirm.tsx`) or its copy.
- No change to the soft-deleted banner or its copy.
- No change to footer behavior for non-delete actions (Save / Cancel).
- No accessibility/i18n changes beyond what the move implies (button label unchanged).

## Open Questions *(optional)*
1. Filled vs outline destructive button in the new section: keep `variant="destructive-outline"` (minimal churn, matches current button) or switch to filled `variant="destructive"` for a stronger affordance? Default recommendation: keep `destructive-outline`.
2. Wrap `<ActivityFeed>` + the new block in a parent `<div className="flex flex-col gap-4">` for cleaner spacing, or rely on `mt-6` top margin on the new block alone? Either is acceptable; pick the cleaner reading.
3. Confirm copy for the Danger-zone helper paragraph — the suggested text ("Permanently remove this ticket from the board. This cannot be undone.") should be reviewed for consistency with `DeleteTicketConfirm.tsx` wording; adjust if the team prefers exact parity.

## Conventions / Commit Notes *(from AGENTS.md + ticket override)*
- npm only (workspaces); run via `-w frontend`.
- Indentation: 4 spaces in JSX, 2 spaces in JS; trailing commas; Prettier, 100-col max.
- One component per file; co-located `*.test.tsx`.
- Query priority: `getByRole` > `getByLabelText` > `getByText` > `getByTestId`.
- Git: per the ticket's explicit override, work/commit/push directly on `main`; SINGLE-LINE commit message; NO `SLYK-<id>:` prefix (this overrides AGENTS.md's normal commit-message rule). Ticket slug: `move-delete-to-activity`.
