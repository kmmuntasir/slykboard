# Ticket: Move the "Delete ticket" button into the Activity tab

**Type:** feature / UI refactor
**Component:** `frontend/src/components/TicketDetailModal.tsx`
**Ticket ID:** (unidentifiable — no SLYK number)

## Requirement

In the ticket detail modal, the **"Delete ticket"** button currently sits in the
modal footer. **Move it inside the "Activity" tab content, at the bottom, in a new
dedicated (visually distinct) section.** Remove it from the footer.

- Keep the exact same button: `<Button variant="destructive-outline" onClick={() => setDeleteConfirmOpen(true)}>Delete ticket</Button>`.
- Keep the exact same gate: `canDelete && !ticket.deletedAt`.
- Keep the confirmation flow (`setDeleteConfirmOpen`, `handleConfirmDelete`,
  `<DeleteTicketConfirm>`) at **modal-root scope** — do NOT move confirmation logic.
- Ensure the footer still looks reasonable without the Delete button (Save changes /
  Cancel must keep working).

## Pre-investigation findings (verified, path:line-cited)

**File:** `frontend/src/components/TicketDetailModal.tsx`

- **Delete button — current location is `modalFooter`:**
  - `modalFooter` JSX block: roughly `:427-460`.
  - Delete button JSX (`:435-441`):
    ```tsx
    {canDelete && !ticket.deletedAt && (
        <Button variant="destructive-outline" onClick={() => setDeleteConfirmOpen(true)}>
            Delete ticket
        </Button>
    )}
    ```
  - Gate: `canDelete = isPlatformAdmin || isProjectAdmin` (`:94`) AND `!ticket.deletedAt`.
  - `modalFooter` is passed to Modal via `footer={modalFooter}` (`:476`).

- **Confirmation flow (stays at modal-root scope):**
  - `const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);` (`:75`).
  - `handleConfirmDelete` (`:216-220`).
  - `<DeleteTicketConfirm .../>` (`:483-488`, gated on `deleteConfirmOpen`).

- **Tab system (Radix Tabs via `ui/Tabs.tsx`):**
  - `type DetailTab = 'metadata' | 'time-tracking' | 'activity';` (`:70`).
  - `const [activeTab, setActiveTab] = useState<DetailTab>('metadata');` (`:84`) —
    **default tab is `metadata`, NOT `activity`.**
  - Every `TabsContent` uses `forceMount` + `hidden={activeTab !== '<tab>'}`.

- **Activity tab content (THE MOVE TARGET)** — `:405-412`:
  ```tsx
  <TabsContent value="activity" forceMount hidden={activeTab !== 'activity'} className="mt-4">
      <ActivityFeed ticketId={ticket.id} />
  </TabsContent>
  ```

## CRITICAL test-visibility risk

`frontend/src/components/TicketDetailModal.test.tsx` is co-located and has **5**
tests touching the Delete button. All of them use
`screen.getByRole('button', { name: 'Delete ticket' })` (or `.queryByRole`) which
**ignores hidden elements**. Because the tabs use `forceMount` + `hidden`, the
button will be in the DOM but hidden when the Activity tab is not active
(default = metadata). **These tests MUST be updated** to first switch to the
Activity tab (the existing pattern at test `:571` is
`fireEvent.mouseDown(screen.getByRole('tab', { name: /activity/i }))` then
`findByRole('tabpanel', { name: /activity/i })`), or the assertions will fail.

Affected test cases (line numbers in `TicketDetailModal.test.tsx`):
- `:450` — F17 ADMIN renders the Delete ticket button.
- `:458` — F17 ADMIN clicking Delete opens the DeleteTicketConfirm dialog.
- `:467` — F17 MEMBER does NOT render the Delete ticket button.
- `:474` — F17 ADMIN on a soft-deleted ticket hides the Delete button.
- `:931` — DEL-01 widened delete gate: project admin sees the Delete button.

## Verification

- `npm test -w frontend` must pass.
- `npm run typecheck -w frontend` must pass (or `npm run build -w frontend`).
- Delete button gone from footer; present in Activity tab bottom section; same gate
  + handler; confirmation dialog still works; no regressions.

## Git policy (user override)

- Work / commit / push directly on `main`. Do NOT create branches.
- Single-line commit message, NO `SLYK-<id>:` prefix — e.g. `Move delete button into activity tab`.
- npm ONLY.
