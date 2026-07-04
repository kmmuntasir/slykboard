# Task Breakdown — move-delete-to-activity
**Plan:** `docs/feature/move-delete-to-activity/move-delete-to-activity-plan.md`
**Generated:** 2026-07-04

---

## Parallelization Strategy

Tasks are grouped into batches by dependency order. Run batches sequentially;
within a batch, conflict-free tasks run in parallel.

### Batch / Dependency Diagram
```
Batch 1 (parallel)
  T1 (component) ──┐
                   ├──► Batch 2: [T3] (verify)
  T2 (tests)    ───┘
```

### Merge-order rules
- Merge lower-numbered batches first.
- Within a batch, merge in stable task-number order.
- T1 and T2 may be implemented/merged in either order (different files, zero merge-conflict surface).
- T3 must run AFTER both T1 and T2 are merged to `main`.

### Summary
| # | Batch | Target File | Dependencies | Can Parallel With |
|---|-------|-------------|--------------|-------------------|
| T1 | 1 | `frontend/src/components/TicketDetailModal.tsx` | None | T2 |
| T2 | 1 | `frontend/src/components/TicketDetailModal.test.tsx` | None | T1 |
| T3 | 2 | (no file edits — verification) | T1, T2 | None |

### Suggested developer tracks
- **Track A — Component:** T1 → T3 (the React component refactor)
- **Track B — Tests:** T2 → T3 (the co-located test updates)
- T3 is the shared convergence point.

---

## Tasks

### T1 — Move the "Delete ticket" button into a "Danger zone" section on the Activity tab
**Description:** Relocate the Delete button JSX from the modal footer (`modalFooter`, currently `TicketDetailModal.tsx:435-442`) into a new visually distinct "Danger zone" section appended inside the Activity tab's `TabsContent` (currently `TicketDetailModal.tsx:405-413`), as a sibling AFTER `<ActivityFeed ticketId={ticket.id} />` (line 412) and BEFORE `</TabsContent>` (line 413). The gate `canDelete && !ticket.deletedAt` and the `onClick={() => setDeleteConfirmOpen(true)}` MUST be preserved verbatim at the new location.

The confirmation flow is UNCHANGED: state at line 75, `handleConfirmDelete` at lines 216-220, `<DeleteTicketConfirm>` at lines 483-487 at modal-root scope. All destructive styling must use design tokens (`destructive`, `destructive-foreground`, `border-destructive`, `bg-destructive/10`, `muted-foreground`) — NO raw `red-*` Tailwind classes. The button's accessible name MUST remain exactly `Delete ticket`.

**Target file:** `frontend/src/components/TicketDetailModal.tsx`

**Subtasks:**
1. **Remove the Delete button block** from `modalFooter` — delete lines 435-442 (the entire `{canDelete && !ticket.deletedAt && (<Button variant="destructive-outline" onClick={() => setDeleteConfirmOpen(true)}>Delete ticket</Button>)}` block). After removal, the footer retains its `<div className="flex items-center justify-end gap-2">` wrapper (line 434), the edit-mode Cancel button (lines 443-447), and the Save changes button (lines 448-457). No structural change to the wrapper or the remaining buttons.
2. **Add the "Danger zone" section** inside the Activity `TabsContent`. Insert the following JSX AFTER `<ActivityFeed ticketId={ticket.id} />` (line 412) and BEFORE `</TabsContent>` (line 413), at the existing 4-space JSX indentation depth inside that panel:
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
   Note: `canDelete` derives from line 96 (`canDelete = isPlatformAdmin || isProjectAdmin`); `setDeleteConfirmOpen` from line 75. The `mt-6` top-margin mirrors the soft-deleted banner styling at lines 268-274. The implementer MAY alternatively wrap `<ActivityFeed>` + the new block in a parent `<div className="flex flex-col gap-4">` (consistent with the metadata tab layout at line 370) — either approach is acceptable.
3. **Trim now-stale comments** that document the footer Delete button:
   - File-header comment block at lines 49-50 (remove the "+ Delete ticket" reference).
   - Footer composition comment block at lines 422-432 (remove the "• Delete ticket" bullet lines ~428-431; update the "Save/Delete are gated on a live (non-soft-deleted) ticket." comment at line 432 to "Save are gated on a live (non-soft-deleted) ticket.").
   (Exact line numbers may drift by a few lines in the working tree — verify against the current file before editing.)

**Acceptance criteria:**
- [ ] The "Delete ticket" button no longer appears anywhere in the modal footer (`modalFooter`).
- [ ] A visually distinct "Danger zone" section (destructive-tinted border + surface) appears at the bottom of the Activity tab content, containing the "Delete ticket" button with the exact accessible name `Delete ticket`.
- [ ] The new section + button are gated on `canDelete && !ticket.deletedAt` (admins only; hidden on soft-deleted tickets).
- [ ] The button keeps `variant="destructive-outline"` and `onClick={() => setDeleteConfirmOpen(true)}` verbatim; the confirmation dialog opens exactly as before.
- [ ] Only design tokens are used — no raw `red-*` classes.
- [ ] No stale comments reference the footer Delete button.
- [ ] Confirmation logic and dialog location are unchanged (state, `handleConfirmDelete`, `<DeleteTicketConfirm>` untouched).

**Dependencies:** None
**Can parallel with:** T2

---

### T2 — Update 5 co-located tests to switch to the Activity tab before querying the Delete button
**Description:** Once the Delete button moves into the Activity `TabsContent` (which Radix keeps mounted via `forceMount` but hides with `hidden={activeTab !== 'activity'}` when inactive), `getByRole`/`queryByRole` will skip it. All 5 tests below currently query the Delete button WITHOUT first activating the Activity tab. Insert the file's canonical tab-switch idiom (verbatim from `TicketDetailModal.test.tsx:743-749`) immediately after each test's modal-open await and immediately before the Delete-button query line. NO new imports are required — `fireEvent`, `screen`, and `waitFor` are already imported at line 4. Do NOT introduce `userEvent` (the file uses `fireEvent` exclusively for tab activation via `fireEvent.mouseDown` on the Radix `TabsTrigger`).

**Target file:** `frontend/src/components/TicketDetailModal.test.tsx`

**Canonical tab-switch idiom to insert (copy verbatim from lines 743-749):**
```js
fireEvent.mouseDown(screen.getByRole('tab', { name: /activity/i }));
await waitFor(() =>
    expect(screen.getByRole('tab', { name: /activity/i })).toHaveAttribute(
        'data-state',
        'active',
    ),
);
```

**Per-test insertion points** (insert the idiom between the `await screen.findByRole('dialog', { name: 'SLYK-101' });` line and the Delete-query line in each):

| # | Test name | Test line range | Delete query line (insert BEFORE this) | Query kind |
|---|-----------|-----------------|----------------------------------------|------------|
| 1 | `'F17 ADMIN: renders the "Delete ticket" button'` | 450-456 | **455** — `expect(screen.getByRole('button', { name: 'Delete ticket' })).toBeInTheDocument();` | positive `getByRole` |
| 2 | `'F17 ADMIN: clicking "Delete ticket" opens the DeleteTicketConfirm dialog'` | 458-465 | **463** — `fireEvent.click(screen.getByRole('button', { name: 'Delete ticket' }));` (the confirm-dialog assertion at line 464 needs NO change — it renders at modal-root scope) | click + `findByRole('dialog',{name:'Delete ticket?'})` |
| 3 | `'F17 MEMBER: does NOT render the "Delete ticket" button'` | 467-472 | **471** — `expect(screen.queryByRole('button', { name: 'Delete ticket' })).not.toBeInTheDocument();` | negative `queryByRole` (false-pass risk — tab-switch REQUIRED so the negative assertion is meaningful) |
| 4 | `'F17 ADMIN on a soft-deleted ticket: shows the Deleted badge + hides the Delete button'` | 474-482 | **481** — `expect(screen.queryByRole('button', { name: 'Delete ticket' })).not.toBeInTheDocument();` (the badge assertion at line 479 needs NO change) | negative `queryByRole` (false-pass risk) |
| 5 | `'DEL-01 widened delete gate: a PROJECT ADMIN (not platform admin) sees the Delete ticket button'` | 931-945 | **944** — `expect(screen.getByRole('button', { name: 'Delete ticket' })).toBeInTheDocument();` | positive `getByRole` |

**Subtasks:**
1. Test 1 (lines 450-456): insert tab-switch idiom before line 455.
2. Test 2 (lines 458-465): insert tab-switch idiom before line 463 (before the `fireEvent.click`).
3. Test 3 (lines 467-472): insert tab-switch idiom before line 471.
4. Test 4 (lines 474-482): insert tab-switch idiom before line 481.
5. Test 5 (lines 931-945): insert tab-switch idiom before line 944.
6. (Line numbers may drift by a few lines in the working tree — verify the test name + query before editing.)

**Acceptance criteria:**
- [ ] All 5 tests activate the Activity tab (via `fireEvent.mouseDown` + `waitFor` `data-state="active"`) BEFORE querying/clicking the Delete button.
- [ ] No new imports added (`fireEvent`, `screen`, `waitFor` already present at line 4); no `userEvent` introduced.
- [ ] The negative assertions in tests 3 and 4 genuinely verify absence on the now-active Activity tab (no false-pass).
- [ ] Existing confirm-dialog assertions (test 2 line 464) and badge assertions (test 4 line 479) are unchanged.

**Dependencies:** None
**Can parallel with:** T1

---

### T3 — Run typecheck and the full frontend Vitest suite to confirm green
**Description:** Pure verification — no file edits. Run from the repo root (`/home/munna/speedo/localhost/slykboard`). Confirms T1 introduced no type errors and T2's 5 updated tests (plus the rest of the suite) pass. This guards against the risk that another test elsewhere references the Delete button in the footer (analysis found only these 5, but the full run confirms it).

**Subtasks:**
1. Run typecheck: `npm run typecheck -w frontend` — expect exit 0, no errors.
2. Run the frontend test suite: `npm test -w frontend` — expect all green, in particular the 5 updated tests in `TicketDetailModal.test.tsx` and the existing Activity-tab tests (e.g. lines 570-573, 743-749) remain unaffected.
3. (Optional sanity, only if either of the above is inconclusive): `npm run build -w frontend`.

**Acceptance criteria:**
- [ ] `npm run typecheck -w frontend` exits 0 with no errors.
- [ ] `npm test -w frontend` is fully green, including the 5 updated tests in `TicketDetailModal.test.tsx`.

**Dependencies:** T1, T2
**Can parallel with:** None

---

## Notes for implementer
- **Package manager:** npm only; workspace form `npm <cmd> -w frontend`. Never pnpm/yarn/bun.
- **Style:** Prettier, 100-col max, 4-space indent in JSX / 2-space in JS, trailing commas.
- **Styling tokens:** destructive UI must use design tokens (`destructive`, `bg-destructive/10`, `border-destructive`, `muted-foreground`); NO raw `red-*`.
- **Tests:** Vitest + Testing Library; query priority `getByRole` > `getByLabelText` > `getByText` > `getByTestId`. Use `fireEvent` (not `userEvent`) to match this file's idiom.
- **Git (per the ticket's explicit override of AGENTS.md):** work/commit/push directly on `main`; SINGLE-LINE commit message; NO `SLYK-<id>:` prefix. NEVER run git without explicit user approval.
