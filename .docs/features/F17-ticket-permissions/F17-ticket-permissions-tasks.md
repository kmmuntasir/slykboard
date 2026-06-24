# F17 — Ticket permissions (admin-only delete): Plan + Task Breakdown

> **Feature:** F17 — Ticket permissions (admin-only delete) (Phase 2 — Permissions)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F16 (DONE ✅), F18 (DONE ✅) — also uses F06/F07 roles (DONE ✅), F12 counter (DONE ✅), F14 label links (DONE ✅) · **PRD ref:** REQ-3.3, PRD §4, PRD §8.3, REQ-1.3
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), the project rules discovered for this repo (`.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`), plus dependency feature task docs: [F16](../F16-ticket-detail-modal/F16-ticket-detail-modal-tasks.md), [F18](../F18-activity-log-capture/F18-activity-log-capture-tasks.md)

---

## 1. F17 Recap

**Goal:** Enforce role rules on ticket mutations — any authenticated user may create/edit/move tickets; only `ADMIN` may delete; the UI hides the delete control for members. Deletion is **soft**: the ticket row is retained with `deleted_at` stamped, every ticket read filters `deleted_at IS NULL`, and the ticket's activity history + label links are **archived (retained)** rather than destroyed.

**Ships:** A new `DELETE /api/tickets/:ticketId` endpoint, server-gated by `requireRole('ADMIN')`. An admin opening a ticket detail modal sees a destructive "Delete ticket" button; clicking it opens a confirm dialog; on confirm the ticket's `deleted_at` is set to `now()` (the row is NOT removed) and the ticket disappears from the board + detail reads (404). Its `ActivityLogs` (F18) and `TicketLabels` (F14) rows **persist unchanged** — the FK `ON DELETE CASCADE` never fires because there is no DELETE; this is the spec's "removed or archived" resolved to **archived** (history preserved). A member never sees the delete button, and a crafted `DELETE` request from a member returns `403 FORBIDDEN`. A successful admin delete returns **`204 No Content`** (empty body). Members retain full create/edit/move ability.

**Acceptance (definition of done):**
- `DELETE /api/tickets/:ticketId` returns `403 FORBIDDEN` for a non-admin (MEMBER); **`204 No Content`** (empty body) for an ADMIN success; `404 NOT_FOUND` for a missing OR already-soft-deleted ticket; `401` for an unauthenticated request; `400` for a bad uuid.
- The permission check is server-side via `requireRole('ADMIN')` middleware — NOT just UI-hidden. The FE `useRequireRole('ADMIN')` hide is cosmetic/convenience.
- A confirmation dialog (`DeleteTicketConfirm`) is shown before the delete executes.
- Deleting a ticket sets `deleted_at = now()`; its `ActivityLogs` (F18) and `TicketLabels` (F14) rows are **retained (archived)** — NOT cascade-removed (no row DELETE occurs). The FK `ON DELETE CASCADE` remains on the schema for future hard-purge safety but is inert under soft delete.
- A soft-deleted ticket is filtered out of every ticket read: `getBoard` (never renders), `getTicket` (returns null → route 404), `updateTicket` (NOT_FOUND — can't edit a deleted ticket), `moveTicket` (NOT_FOUND — can't move a deleted ticket).
- `ticket_number` is never reused (F12 monotonic counter untouched by soft delete).
- The delete button is rendered in `TicketDetailModal` only for admins (`useRequireRole('ADMIN')`).
- Re-deleting an already-soft-deleted ticket → `404 NOT_FOUND` (idempotent-safe via `and(eq(id), isNull(deletedAt))`).

**Edge cases to resolve up front:**
- **Permission check must be server-side, not just UI-hidden** → **Decision:** mount `requireRole('ADMIN')` on the `DELETE` route (`backend/src/middleware/requireRole.ts:9-23`). The FE `useRequireRole('ADMIN')` gate is cosmetic only. Cite `requireRole.ts:8` docstring (its example IS the F17 route).
- **Soft vs hard delete** → **Decision (OWNER OVERRIDE): SOFT DELETE.** The prior hard-delete recommendation is overridden. Add `tickets.deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' })` (nullable, no default — null = live); `deleteTicket` sets `deletedAt = now()` (NOT `db.delete`); filter `deleted_at IS NULL` on every ticket read. ActivityLogs (F18) + TicketLabels (F14) are **RETAINED** — the F18 `ON DELETE CASCADE` never fires (no DELETE). History preserved (the reason the owner chose soft).
- **Cascade time entries + activity logs** → **Decision:** under soft delete NOTHING cascades (no row removal) — logs + label links persist (archived). The `TimeEntries` table does NOT exist yet (F20 not built); its cascade is **DEFERRED to F20**. When F20 lands, its `timeEntries.ticketId` FK MUST be `ON DELETE CASCADE` (for a future hard-purge path). The running-timer-on-a-soft-deleted-ticket nuance (a timer could still be running on a "deleted" ticket) is owned by F20.
- **Running timer on a deleted ticket** → **Decision:** OUT OF SCOPE (F20). No timer/`TimeEntries` model exists in the schema today. Note: soft delete means a timer COULD still be running on a "deleted" ticket — F20 owns the stop/forbid/auto-stop call.

---

## 2. Codebase Analysis Summary

- **State:** **Greenfield for the delete path; all dependencies DONE ✅ in code.** F16 (ticket detail modal) ships `TicketDetailModal.tsx` with a reserved F17 seam at `:121`. F18 (activity logs) ships the `activityLogs` table with `ON DELETE CASCADE` at `schema.ts:205-207`. F06 (roles) ships `roleEnum` (`schema.ts:22`). F07 ships the hardened `requireRole` middleware + `authenticate`. F12 ships the monotonic ticket-number counter. F14 ships `ticketLabels` with `ON DELETE CASCADE` (`schema.ts:173-178`). No DELETE endpoint, no `deleteTicket` service, no `deletedAt` column, no `useDeleteTicket` hook, no `DeleteTicketConfirm` component exist yet.

- **Existing structure this feature builds on (with path citations):**
  - **DELETE endpoint ABSENT.** `backend/src/routes/tickets.routes.ts` has only `GET /:ticketId` + `PATCH /:ticketId`; router mounted at `backend/src/index.ts:54` (`/api/tickets`). A placeholder `TODO(F17)` sits at `tickets.routes.ts:11`. Existing imports (`authenticate`, `validateRequest`, `AppError`, `ErrorCode`, `success`, `ticketIdParam`, `ticketService`) are reusable. New imports: `requireRole` + `deleteTicket`.
  - **`requireRole('ADMIN')` ready** — `backend/src/middleware/requireRole.ts:9-23`; throws `AppError(ErrorCode.FORBIDDEN, …)` (403) when `req.user.role` not in the allowed set; defensively throws `UNAUTHENTICATED` if `req.user` is missing. Requires `authenticate` first. Its docstring example at `:8` IS the F17 route: `router.delete('/tickets/:id', authenticate, requireRole('ADMIN'), handler)`. Already mounted for project create (`projects.routes.ts:72`) + label mutations incl. `DELETE /api/labels/:id` (`labels.routes.ts:58-66` — the closest 1:1 precedent, except F17 returns **204** not `200 success({id})`).
  - **Role trusted server-side** — `authenticate` (`backend/src/middleware/auth.ts:9-43`) sets `req.user = { id, email, role }` from the JWT claim (narrowed `'ADMIN'|'MEMBER'` in `utils/jwt.ts`), hardened by the F07 token-version check. `AuthenticatedUser` type at `backend/src/types/express.d.ts:1-11`. **The server is the real gate; the FE store is cosmetic.**
  - **`ticketIdParam` Zod schema** — `backend/src/routes/tickets.schema.ts` exports the uuid param validator reused by GET/PATCH. DELETE reuses it (`validateRequest({ params: ticketIdParam })`).
  - **`deleteTicket` service ABSENT** — natural home: `backend/src/services/ticketService.ts` after `updateTicket` (~:420). Soft-delete shape: `db.update(tickets).set({ deletedAt: new Date() }).where(and(eq(tickets.id, ticketId), isNull(tickets.deletedAt))).returning({ id: tickets.id })`; throw `NOT_FOUND` if the returning is empty (ticket missing OR already deleted). Import `isNull` from `drizzle-orm`.
  - **403/404/envelope ready** — `ErrorCode.FORBIDDEN` (`backend/src/utils/envelope.ts:11`) → 403; `NOT_FOUND` → 404 for a missing/already-deleted ticket. `errorMiddleware` maps code→status. No new error codes.
  - **`tickets.routes.test.ts` ALREADY EXISTS** — supertest + `tokenFor('ADMIN'|'MEMBER')` helper + mocked `ticketService` (`moveTicket`, `getTicket`, `updateTicket`) + mocked `tokenVersion`. T2 extends it with a delete suite + adds `deleteTicket` to the `vi.mock('../services/ticketService', …)` map.
  - **TicketDetailModal F17 seam** — `frontend/src/components/TicketDetailModal.tsx:121` reserved `{/* F17 will render the admin-only delete button here. */}` (modal prop shape `{ slug, ticketId, onClose, onSubmit }` at `:21-26`). The modal uses `ticketId` for its `useQuery` detail fetch + wires `Modal` + `ConfirmDiscardDialog`.
  - **Client role gate** — `useRequireRole('ADMIN')` hook (`frontend/src/hooks/useRequireRole.ts:8-11`) reads `useAuthStore` role (`stores/useAuthStore.ts:11` `AuthUser.role`, persisted + refreshed via `useAuthSync`). Returns `boolean`; docstring explicitly states "The server-side requireRole middleware is the real gate; this hook is for UX."
  - **Read-filter points (soft-delete specific — every ticket read MUST exclude `deleted_at IS NOT NULL`):**
    - `boardService.getBoard` (`backend/src/services/boardService.ts:80`): the tickets select where clause is currently `.where(and(eq(tickets.projectId, project.id)))` → becomes `.where(and(eq(tickets.projectId, project.id), isNull(tickets.deletedAt)))`. Deleted tickets never render on the board.
    - `ticketService.getTicket` (`backend/src/services/ticketService.ts:283`): where clause is `.where(eq(tickets.id, ticketId))` → add `isNull(tickets.deletedAt)`. A soft-deleted ticket returns null → route 404 (so the F16 detail modal/deep-link to a deleted ticket 404s).
    - `ticketService.updateTicket` (now in a txn, `:327`): the old-row load `where(eq(tickets.id, ticketId))` → add `isNull(tickets.deletedAt)`; a soft-deleted ticket → NOT_FOUND (can't edit a deleted ticket).
    - `ticketService.moveTicket` (`:83`, old row load): `where(eq(tickets.id, ticketId))` → add `isNull(tickets.deletedAt)`; can't move a deleted ticket → NOT_FOUND.
    - `createTicket` / `allocateTicketNumber` (`:163-178`): **unaffected** — the counter is project-scoped (`projectSequences`), not ticket-scoped; a soft-deleted ticket's number stays consumed.
    - Consider a shared `notDeleted = isNull(tickets.deletedAt)` condition to avoid repetition (optional — the four call sites are distinct enough that a shared const is a nice-to-have, not required).
  - **FK cascades (inert under soft delete):** `activityLogs.ticketId → tickets` **ON DELETE CASCADE** (`schema.ts:205-207`, F18); `ticketLabels.ticketId → tickets` **ON DELETE CASCADE** (`schema.ts:173-178`, F14). These **remain on the schema** (hard-purge safety) but **never fire** because `deleteTicket` issues an `UPDATE ... SET deleted_at`, not a `DELETE`. Logs + label links persist (archived). `checklist` is a `jsonb` column on `tickets` — retained with the row. `projectSequences` is a per-project counter (FK→projects, NOT tickets) — untouched.
  - **`TimeEntries` table ABSENT** — no `timeEntries`/`TimeEntries` anywhere in `schema.ts` (F20 not built). The time-entries cascade is **DEFERRED to F20**; the running-timer-on-a-soft-deleted-ticket edge case is wholly F20 (note: soft delete means a timer could still be running on a "deleted" ticket). When F20 adds the table, its `ticketId` FK MUST be `ON DELETE CASCADE`. Document.
  - **Confirm-dialog reuse** — `Modal` (`frontend/src/components/Modal.tsx`) + `useModalA11y` (focus trap/Esc/scroll-lock/focus-restore) reusable; `ConfirmDiscardDialog` (`ConfirmDiscardDialog.tsx`) is too discard-specific (hardcoded "Discard changes?" copy). F17 adds a sibling `DeleteTicketConfirm` wrapping `<Modal>` — mirrors `ConfirmDiscardDialog`'s structure.
  - **Delete mutation precedent** — no `useDeleteTicket` exists; follow `useCreateTicket`/`useUpdateTicket`: invalidate `boardKeys.all` + remove `ticketKeys.detail(ticketId)` in `onSuccess` (`frontend/src/api/queryKeys.ts:7-14`). `ApiClientError` (`frontend/src/api/client.ts:5-22`) surfaces `.status`/`.code` (403 → `'FORBIDDEN'`) for toast/onError wiring.

  - **204 + apiFetch nuance (CRITICAL — soft-delete-specific):** the DELETE route returns **`204 No Content`** (empty body, owner decision #5). The FE `apiFetch<T>` (`frontend/src/api/client.ts:45-131`) **unconditionally** calls `await response.json()` on success at `:121` (`const body = (await response.json()) as Envelope<T> | ApiErrorBody;`). A 204 response has an empty body → `response.json()` throws `SyntaxError` ("Unexpected end of JSON input"). **The 204 path MUST short-circuit before parsing.** T3 adds a guard in `apiFetch`: after the `!response.ok` block and before the `response.json()` call, `if (response.status === 204) return null as T;`. This is an explicit T3 step and flagged as a load-bearing change to a shared FE client.

- **Files F17 creates:** `frontend/src/hooks/useDeleteTicket.ts` (+ test), `frontend/src/components/DeleteTicketConfirm.tsx` (+ test), `backend/src/db/migrations/0009_add_tickets_deleted_at.sql`. **Files F17 modifies:** `backend/src/db/schema.ts` (add `deletedAt` to `tickets`), `backend/src/services/ticketService.ts` (add `deleteTicket` + filter reads), `backend/src/services/boardService.ts` (filter `getBoard`), `backend/src/routes/tickets.routes.ts` (add DELETE route), `backend/src/routes/tickets.routes.test.ts` (delete suite + mock), `frontend/src/api/client.ts` (204 guard), `frontend/src/api/tickets.ts` (add `deleteTicket` fn), `frontend/src/components/TicketDetailModal.tsx` (delete button + gate + confirm), `frontend/src/components/TicketDetailModal.test.tsx` (admin/member gate).

- **Schema delta: F17 OWNS ONE — `tickets.deletedAt`.** This is a **NEW** delta NOT present in the features.md schema-deltas table. The plan carries it forward; **the owner should add the row to features.md** (see §8). Migration `0009_*.sql`: `ALTER TABLE "Tickets" ADD COLUMN "deleted_at" timestamptz` (nullable — no default; all existing rows: `deleted_at NULL` = live; **no data backfill**).

- **Project rules this plan must satisfy:** `.claude/rules/git-guidelines.md` (branch `feature/SLYK-F17-admin-only-delete`, single-line commits `SLYK-F17: <msg>`, rebase-merge only, never `--squash`, never `git merge`, sacred rule: never git without explicit approval); `.claude/rules/js-development-rules.md` (RESTful `DELETE /api/tickets/:ticketId`; route→service→drizzle db; **never string-concat SQL**; `db.update(...).set(...).where(eq(...))` ORM only; consistent envelope (204 is envelope-exempt by REST convention); no invented error codes; server-enforced auth; **UTC timestamptz** for `deleted_at`); `.claude/rules/js-style-guide.md` (2-space JS / 4-space JSX, no `any`, import order external→internal→types→relative, functions <50 lines, early returns, Tailwind no inline styles); `.claude/rules/js-testing-rules.md` (Vitest co-located, table-driven, `>80% business logic`, assert 403-member/204-admin/404-missing/401-unauth/400-bad-uuid); `.claude/rules/persona.md` (Node 24+ / Express 5 / Drizzle / Postgres / React 19 / Vite / Tailwind).

- **Hidden coupling to plan for:**
  - **Server is the gate, FE is cosmetic.** The route MUST mount `requireRole('ADMIN')` — the FE `useRequireRole('ADMIN')` hide is UX-only and trivially bypassed.
  - **`apiFetch` unconditionally JSON-parses on success** (`client.ts:121`). The 204 DELETE response has an empty body → `response.json()` throws. T3 MUST add a `if (response.status === 204) return null as T` guard before the parse. This is the load-bearing FE change.
  - **Read-filter coverage.** Soft delete only works if EVERY ticket read excludes `deleted_at IS NULL`. Four call sites must be patched: `boardService.getBoard:80`, `ticketService.getTicket:283`, `ticketService.updateTicket:327`, `ticketService.moveTicket:83`. Missing any one → deleted tickets leak. T2 is the spine.
  - **`ticketService` mock map in `tickets.routes.test.ts`** — currently mocks `{ moveTicket, getTicket, updateTicket }`. T2 MUST add `deleteTicket: vi.fn()` or the delete tests hit the real DB.
  - **No child cleanup needed in `deleteTicket` (soft delete).** The service is an UPDATE + 404 guard. Do NOT add `db.delete(activityLogs)` / `db.delete(ticketLabels)` — that would destroy the audit history the owner explicitly chose to preserve.
  - **`TimeEntries` cascade + running-timer is F20's contract.** When F20 adds the table, its `ticketId` FK MUST be `ON DELETE CASCADE` (for a future hard-purge path). F20 also decides stop/forbid/auto-stop on a running timer for a soft-deleted ticket. Document for F20.
  - **`useUpdateTicket` does optimistic board writes; `useDeleteTicket` does NOT.** Delete invalidates-only (F10 board poll reconciles within 30s) — simplest and avoids optimistic-removal rollback complexity.
  - **Idempotency.** `deleteTicket` uses `and(eq(id), isNull(deletedAt))` so re-deleting an already-soft-deleted ticket returns an empty `returning()` → 404. Safe under retries.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale (cite source) |
|---|----------|--------|-----------|
| D1 | Hard vs soft delete | **SOFT DELETE** (owner override). `tickets.deletedAt: timestamptz` nullable (null = live); `deleteTicket` sets `deletedAt = now()`; filter `deleted_at IS NULL` on every ticket read. | Owner decision §9.1 — soft delete preserves history: ActivityLogs (F18) + TicketLabels (F14) persist (archived), which the spec's "removed or archived" resolves to **archived**. The F18 `ON DELETE CASCADE` (`schema.ts:205-207`) never fires (no DELETE). `deleted_at` is UTC timestamptz per project rule. |
| D2 | DELETE route middleware chain + response | **`authenticate` → `requireRole('ADMIN')` → `validateRequest({ params: ticketIdParam })` → handler → `res.status(204).end()`.** Member → `403 FORBIDDEN`; unauthenticated → `401 UNAUTHENTICATED`; missing/already-deleted → `404 NOT_FOUND`; bad uuid → `400 VALIDATION_FAILED`; admin success → **`204 No Content`** (empty body). | Owner decision §9.5 (204 not 200). `requireRole.ts:8-9` docstring IS the F17 route example; `requireRole.ts:15-19` throws `FORBIDDEN`. 204 matches REST convention for "delete succeeded, nothing to return" and avoids the `apiFetch` envelope-unwrap path (see D10). |
| D3 | `deleteTicket` service | **`deleteTicket(ticketId): Promise<void>`** in `ticketService.ts` after `updateTicket`. `db.update(tickets).set({ deletedAt: new Date() }).where(and(eq(tickets.id, ticketId), isNull(tickets.deletedAt))).returning({ id: tickets.id })`; throw `AppError(ErrorCode.NOT_FOUND, …)` on empty returning (ticket missing OR already deleted). No txn (single update); no child cleanup. | Soft-delete D1. `and(eq(id), isNull(deletedAt))` makes re-delete idempotent-safe (→ 404). No child cleanup — soft delete preserves logs + label links (the owner's reason for choosing soft). |
| D4 | Filter all ticket reads | **Add `isNull(tickets.deletedAt)` to every ticket read:** `boardService.getBoard:80`, `ticketService.getTicket:283`, `ticketService.updateTicket:327` (old-row load), `ticketService.moveTicket:83` (old-row load). | Soft delete only holds if deleted rows never surface. `createTicket`/`allocateTicketNumber` are project-scoped (counter-based) — unaffected. A shared `notDeleted = isNull(tickets.deletedAt)` const is optional. |
| D5 | Confirm dialog | **New `DeleteTicketConfirm` component wrapping `<Modal>`** (reuse `useModalA11y` via `Modal`); `blockBackdropClose`; destructive styling. NOT a generic `ConfirmDialog` primitive. | Owner decision §9.2 (dedicated, not generic). `ConfirmDiscardDialog` is discard-specific (copy/semantics). `Modal` + `useModalA11y` give focus-trap/Esc/scroll-lock/focus-restore for free. |
| D6 | FE role gate | **`useRequireRole('ADMIN')`** hides the delete button in `TicketDetailModal`. The server `requireRole('ADMIN')` is the real security boundary. | `useRequireRole.ts:6-11` docstring: "server-side requireRole middleware is the real gate; this hook is for UX." Cosmetic only — a member crafting a `DELETE` gets 403. |
| D7 | `useDeleteTicket` mutation | **`invalidate boardKeys.all` + `removeQueries ticketKeys.detail(ticketId)`** in `onSuccess`. NO optimistic board card removal. `onError` surfaces `FORBIDDEN` (403) for optional caller toast. | Owner decisions §9.4 (invalidate-only) + §9.6 (toast nice-to-have). `useUpdateTicket.ts` invalidates `boardKeys.all` + `ticketKeys.detail`. Delete invalidates-only — F10's 30s board poll reconciles. |
| D8 | `ticket_number` reuse | **Never reused.** F12's monotonic `allocateTicketNumber` (`projectSequences`) is untouched by soft delete too. | `projectSequences` is per-project (FK→projects), NOT per-ticket. Soft-deleting a ticket frees nothing in the counter. |
| D9 | F18 logs + F14 label links on delete | **RETAINED (archived).** Soft delete issues an UPDATE, not a DELETE → the `activityLogs`/`ticketLabels` `ON DELETE CASCADE` FKs never fire. History + label links persist on the soft-deleted row. | Owner decision §9.1 — the spec's "removed or archived" resolves to **archived**. The FKs remain on the schema for a future hard-purge admin feature (separate scope). |
| D10 | `apiFetch` 204 handling | **Add a `if (response.status === 204) return null as T` guard in `apiFetch` before the `response.json()` call** (`client.ts:121`). The success path currently does `await response.json()` unconditionally → a 204 empty body throws `SyntaxError`. | `client.ts:121` parses on every success. The DELETE route returns 204 (D2). The guard must precede the parse. Load-bearing FE change; touches the shared client but is a narrow, safe early-return. |

> **Out of F17 scope (explicitly deferred):**
> - **`TimeEntries` cascade + running-timer-on-a-soft-deleted-ticket behavior** → **F20** (table does not exist yet; `ticketId` FK must be `ON DELETE CASCADE` when F20 adds it). Note: soft delete means a timer COULD still be running on a "deleted" ticket — F20 owns stop/forbid/auto-stop.
> - **Hard-purge / restore / trash UI** → soft delete preserves the row + history; a future admin "permanently delete" or "restore" feature is separate scope (would exercise the existing CASCADE FKs).
> - **Per-column / membership-based permissions** (e.g. only the assignee may edit) → NOT in REQ-3.3; PRD §4 mandates Admin/Member only. The `TODO(F17)` note at `tickets.routes.ts:11` is resolved as out of scope.
> - **Generic `ConfirmDialog` primitive refactor** → scope creep (§9.2); F17 ships a focused `DeleteTicketConfirm`.
> - **Global toast-on-403** → out of core scope (§9.6); `useDeleteTicket.onError` surfaces `FORBIDDEN` so a caller CAN toast, but F17 mandates no global 403 toast.

> **Owner sign-off CONFIRMED 2026-06-24 (see §9):** (a) SOFT delete; (b) dedicated `DeleteTicketConfirm`; (c) `TimeEntries` cascade deferred to F20; (d) invalidate-only mutation; (e) **`204 No Content`** response; (f) toast-on-403 = nice-to-have / out of core scope.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/                                                  # repo root
├── backend/
│   └── src/
│       ├── db/
│       │   ├── schema.ts                                   # MODIFY (T1) — add deletedAt to tickets table (after updatedAt :130)
│       │   └── migrations/
│       │       └── 0009_add_tickets_deleted_at.sql          # NEW (T1) — ALTER TABLE "Tickets" ADD COLUMN "deleted_at" timestamptz (nullable; no backfill)
│       ├── services/
│       │   ├── ticketService.ts                             # MODIFY (T2) — add deleteTicket(ticketId) after updateTicket + filter getTicket:283 / updateTicket:327 / moveTicket:83 (isNull(deletedAt))
│       │   └── boardService.ts                              # MODIFY (T2) — filter getBoard:80 (isNull(deletedAt))
│       └── routes/
│           ├── tickets.routes.ts                            # MODIFY (T2) — add DELETE /:ticketId route (authenticate + requireRole('ADMIN') + validateRequest → 204)
│           └── tickets.routes.test.ts                       # MODIFY (T2) — add deleteTicket to vi.mock map + 401/403/204/404/400 suite
└── frontend/
    └── src/
        ├── api/
        │   ├── client.ts                                    # MODIFY (T3) — apiFetch: if (response.status === 204) return null as T (before response.json())
        │   └── tickets.ts                                   # MODIFY (T3) — add deleteTicket(ticketId) api fn (apiFetch handles 204)
        ├── hooks/
        │   ├── useDeleteTicket.ts                           # NEW (T3) — useMutation; invalidate boardKeys.all + remove ticketKeys.detail; onError surfaces FORBIDDEN
        │   └── useDeleteTicket.test.ts                      # NEW (T5) — mutation success/error/cache assertions
        └── components/
            ├── DeleteTicketConfirm.tsx                      # NEW (T4) — Modal-wrapped destructive confirm
            ├── DeleteTicketConfirm.test.tsx                 # NEW (T5) — renders, confirm/cancel wiring
            └── TicketDetailModal.tsx                        # MODIFY (T4) — render admin-only delete button at :121 seam + wire DeleteTicketConfirm + useRequireRole('ADMIN') gate
```

**Delete request lifecycle (post-F17):**

1. Admin clicks "Delete ticket" in `TicketDetailModal` (member never sees it — `useRequireRole('ADMIN')`).
2. `DeleteTicketConfirm` opens (a `<Modal>` with `blockBackdropClose` + destructive copy + Cancel/Delete buttons).
3. On confirm, `useDeleteTicket` calls `deleteTicket(ticketId)` → `DELETE /api/tickets/:ticketId`.
4. Route: `authenticate` sets `req.user`; `requireRole('ADMIN')` checks role (member → 403 `FORBIDDEN`); `validateRequest({ params: ticketIdParam })` validates the uuid.
5. Handler calls `ticketService.deleteTicket(ticketId)` → `db.update(tickets).set({ deletedAt: new Date() }).where(and(eq(id), isNull(deletedAt))).returning({ id })`; empty returning → 404 `NOT_FOUND`; else the ticket is soft-deleted (row retained, `deleted_at` stamped).
6. **No cascade fires** — `ActivityLogs` (F18) + `TicketLabels` (F14) rows persist unchanged (archived).
7. Response: **`204 No Content`** (empty body — `res.status(204).end()`).
8. FE `apiFetch`: `response.status === 204` → `return null as T` (no JSON parse — D10 guard).
9. FE `onSuccess`: `invalidateQueries(boardKeys.all)` + `removeQueries(ticketKeys.detail(ticketId))`; modal closes; F10 board poll reconciles the card removal within 30s (the soft-deleted row is filtered out by `getBoard`'s `isNull(deletedAt)`).

---

## 5. Parallelization Strategy

Tasks grouped into **4 batches** by dependency order. The schema+migration (T1) is the spine; then the BE delete path + read filters (T2); then the FE api+client+hook (T3); then the FE UI (T4); then FE tests (T5); then verification (T6).

### Batch dependency diagram

```
 ┌─ Batch 1 (schema spine) ──────────────────────────────────────────────┐
 │  T1  tickets.deletedAt column + migration 0009 (generate + psql pipe)  │
 │      [backend/src/db/schema.ts,                                         │
 │       backend/src/db/migrations/0009_add_tickets_deleted_at.sql]        │
 └────────────────────────┬────────────────────────────────────────────────┘
                          │ (deletedAt column exists)
                          ▼
 ┌─ Batch 2 (backend delete path + read filters) ─────────────────────────┐
 │  T2  deleteTicket service (soft-delete) + read-path filters             │
 │      (getBoard / getTicket / updateTicket / moveTicket) + DELETE /:id   │
 │      route (204) + route tests (401/403/204/404/400)                    │
 │      [backend/src/services/ticketService.ts,                            │
 │       backend/src/services/boardService.ts,                             │
 │       backend/src/routes/tickets.routes.ts,                             │
 │       backend/src/routes/tickets.routes.test.ts]                        │
 └────────────────────────┬────────────────────────────────────────────────┘
                          │ (DELETE endpoint + read filters exist)
                          ▼
 ┌─ Batch 3 (FE data layer) ──────────────────────────────────────────────┐
 │  T3  apiFetch 204 guard + deleteTicket api fn + useDeleteTicket hook    │
 │      [frontend/src/api/client.ts,                                       │
 │       frontend/src/api/tickets.ts,                                      │
 │       frontend/src/hooks/useDeleteTicket.ts]                            │
 └────────────────────────┬────────────────────────────────────────────────┘
                          │ (mutation + api fn + 204-safe client available)
                          ▼
 ┌─ Batch 4 (FE UI + tests + verification) ───────────────────────────────┐
 │  T4  DeleteTicketConfirm component + wire into TicketDetailModal        │
 │      (replace :121 seam; gate via useRequireRole('ADMIN'))              │
 │      [frontend/src/components/DeleteTicketConfirm.tsx,                  │
 │       frontend/src/components/TicketDetailModal.tsx]                    │
 │      ↓ then                                                             │
 │  T5  FE tests — useDeleteTicket + DeleteTicketConfirm +                 │
 │      TicketDetailModal admin/member button gate + apiFetch 204          │
 │      [frontend/src/hooks/useDeleteTicket.test.ts,                       │
 │       frontend/src/components/DeleteTicketConfirm.test.tsx]             │
 │      ↓ then                                                             │
 │  T6  integration verification — typecheck/lint/format/test/build +      │
 │      live smoke (admin soft-deletes → card gone + logs/links RETAINED;  │
 │      member → 403 + button hidden; 204 empty body; re-delete → 404)     │
 │      [(verification record only)]                                       │
 └─────────────────────────────────────────────────────────────────────────┘
```

- **B1 → B2 hard barrier:** `deleteTicket` + the read filters reference `tickets.deletedAt` (T1). No column → no filter.
- **B2 → B3 hard barrier:** `useDeleteTicket` calls `deleteTicket` against `DELETE /api/tickets/:ticketId` (204). The route must exist (T2).
- **B3 → B4 hard barrier:** `DeleteTicketConfirm` + modal wiring invoke `useDeleteTicket().mutate`. The hook must exist (T3).
- **B4 within-batch: T4 → T5 → T6 serialized.** FE tests (T5) assert the integrated UI + hook behavior (T4). Verification (T6) runs last.

### Merge order rules

1. **B1 (T1) merges first.** Schema + migration are the foundation.
2. **B2 (T2) merges second.** DELETE endpoint + service + read filters + route tests.
3. **B3 (T3) merges third.** api fn + hook + 204-safe client.
4. **B4 (T4 → T5 → T6) merges last.** UI, then FE tests, then the verification record.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | 1 | `backend/src/db/schema.ts`, `backend/src/db/migrations/0009_add_tickets_deleted_at.sql` | F16/F18/F06/F07 (DONE) | — |
| **T2** | 2 | `backend/src/services/ticketService.ts`, `backend/src/services/boardService.ts`, `backend/src/routes/tickets.routes.ts`, `backend/src/routes/tickets.routes.test.ts` | T1 | — |
| **T3** | 3 | `frontend/src/api/client.ts`, `frontend/src/api/tickets.ts`, `frontend/src/hooks/useDeleteTicket.ts` | T2 | — |
| **T4** | 4 | `frontend/src/components/DeleteTicketConfirm.tsx`, `frontend/src/components/TicketDetailModal.tsx` | T3 | — |
| **T5** | 4 | `frontend/src/hooks/useDeleteTicket.test.ts`, `frontend/src/components/DeleteTicketConfirm.test.tsx` | T4 | — |
| **T6** | 4 | (verification record only) | T5 | — |

### Developer assignment tracks

- **Solo (recommended):** T1 → T2 → T3 → T4 → T5 → T6. ~1 day. F17 is medium: a schema delta + migration, a soft-delete service, four read-filter edits, a 204 route, a shared-client guard, a hook, a confirm dialog, a modal wiring, and tests.
- **2 devs:** Dev-A: T1 → T2 (backend). Dev-B: waits for T2, then T3 → T4 → T5 → T6. The backend (T1-T2) and frontend (T3-T5) are disjoint file sets.

---

## 6. Tasks

> **Code-snippet note:** the snippets below are illustrative; the implementer MUST read the actual current code (`ticketService.ts`, `boardService.ts`, `tickets.routes.ts`, `tickets.routes.test.ts`, `client.ts`, `useUpdateTicket.ts`, `ConfirmDiscardDialog.tsx`, `TicketDetailModal.tsx`) before editing — verify exact signatures and adapt.

### T1 — Schema: `tickets.deletedAt` column + migration 0009

**Batch:** 1 · **Depends on:** F16/F18/F06/F07 (DONE) · **Parallel with:** —

**Description:** The schema spine for soft delete. Add a nullable `deletedAt` timestamp to the `tickets` table in `backend/src/db/schema.ts` (after `updatedAt`, ~`:130`). Generate migration `0009_*.sql` via `drizzle-kit generate`; apply to the dev DB via `psql` pipe (NOT `db:migrate` — project memory `dev-db-push-based-no-migration-journal`). The migration is an `ALTER TABLE "Tickets" ADD COLUMN "deleted_at" timestamptz` (nullable); **no data backfill** (all existing rows: `deleted_at NULL` = live).

Modify `backend/src/db/schema.ts` — inside the `tickets` table, after `updatedAt`:

```typescript
// F17 D1: soft-delete tombstone. NULL = live; set to now() by deleteTicket.
// Nullable, no default (null = live). UTC timestamptz per project rule.
deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
```

Generate the migration:

```bash
npm --prefix backend run db:generate   # drizzle-kit generate → 0009_<tag>.sql
```

The generated `0009_*.sql` should be a single statement (no enum, so no `$1` bug risk — but verify):

```sql
ALTER TABLE "Tickets" ADD COLUMN "deleted_at" timestamptz;
```

Apply to the dev DB (push-based, NOT `db:migrate`):

```bash
docker exec -i slykboard-db psql -U slyk -d slykboard -v ON_ERROR_STOP=1 \
    < backend/src/db/migrations/0009_*.sql
```

Notes: **No default, nullable** — null = live; `deleteTicket` writes `new Date()` explicitly. No index required for F17 (filters ride existing indexed lookups; a partial `WHERE deleted_at IS NULL` index is premature). No backfill — every existing row defaults to `deleted_at NULL` = live.

**Acceptance Criteria:**
- [ ] `tickets` table in `schema.ts` has `deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' })` (nullable, no default).
- [ ] `0009_*.sql` exists; contains `ALTER TABLE "Tickets" ADD COLUMN "deleted_at" timestamptz;` (literal; no `$1`).
- [ ] Migration applies cleanly to dev DB via `psql` pipe (`ON_ERROR_STOP=1`).
- [ ] `\d "Tickets"` in psql confirms `deleted_at timestamptz` (nullable).
- [ ] Existing rows have `deleted_at IS NULL` (no backfill needed).
- [ ] `rtk tsc` (BE) passes.
- [ ] No `any`; PascalCase table / camelCase key.

**Dependencies:** F16/F18/F06/F07 (DONE). Decision D1.

---

### T2 — Backend: `deleteTicket` service (soft-delete) + read-path filters + `DELETE /:ticketId` route (204) + route tests

**Batch:** 2 · **Depends on:** T1 · **Parallel with:** —

**Description:** The data-correctness spine + security boundary. (1) Add `deleteTicket(ticketId)` to `backend/src/services/ticketService.ts` (soft-delete: `UPDATE ... SET deleted_at`). (2) Filter every ticket read with `isNull(tickets.deletedAt)`: `getTicket:283`, `updateTicket:327`, `moveTicket:83` (in `ticketService.ts`) + `getBoard:80` (in `boardService.ts`). (3) Add a `DELETE /:ticketId` route to `backend/src/routes/tickets.routes.ts` chained `authenticate → requireRole('ADMIN') → validateRequest({ params: ticketIdParam }) → handler`, returning **`204 No Content`**. (4) Extend `tickets.routes.test.ts` with a delete suite (401 / 403-member / 204-admin / 404-missing-or-already-deleted / 400-bad-uuid), adding `deleteTicket: vi.fn()` to the existing `vi.mock('../services/ticketService', …)` map.

Modify `backend/src/services/ticketService.ts` — append `deleteTicket` after `updateTicket`:

```typescript
// F17 D1/D3: SOFT DELETE — set deleted_at = now(); the row is retained so its
// ActivityLogs (F18) + TicketLabels (F14) persist (archived). The FK CASCADEs
// never fire (no DELETE). Every ticket read filters isNull(deletedAt) (D4).
// and(eq(id), isNull(deletedAt)) makes re-delete idempotent-safe → empty
// returning → 404 (missing OR already deleted). TimeEntries cascade is F20.
export async function deleteTicket(ticketId: string): Promise<void> {
    const softDeleted = await db
        .update(tickets)
        .set({ deletedAt: new Date() })
        .where(and(eq(tickets.id, ticketId), isNull(tickets.deletedAt)))
        .returning({ id: tickets.id });
    if (!softDeleted[0]) {
        throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${ticketId}' not found`, {
            details: { ticketId },
        });
    }
}
```

Add `isNull` to the existing `drizzle-orm` import (`import { and, asc, eq, inArray, isNull, max, sql } from 'drizzle-orm';`).

Read filters in `ticketService.ts`:
- `getTicket` (`:283`): `.where(eq(tickets.id, ticketId))` → `.where(and(eq(tickets.id, ticketId), isNull(tickets.deletedAt)))`.
- `updateTicket` (`:327`, old-row load): same filter addition.
- `moveTicket` (`:83`, old-row load): same filter addition.

Modify `backend/src/services/boardService.ts` — add `isNull` to the `drizzle-orm` import + filter `getBoard`:
- `getBoard` (`:80`): `.where(and(eq(tickets.projectId, project.id)))` → `.where(and(eq(tickets.projectId, project.id), isNull(tickets.deletedAt)))`.

Modify `backend/src/routes/tickets.routes.ts` — add import + route after PATCH:

```typescript
import { requireRole } from '../middleware/requireRole';
// ...
// F17 D2: admin-only SOFT delete. requireRole('ADMIN') is the security boundary;
// the FE hide is cosmetic. Returns 204 No Content (empty body) on success.
ticketsRouter.delete(
    '/:ticketId',
    authenticate,
    requireRole('ADMIN'),
    validateRequest({ params: ticketIdParam }),
    async (req, res) => {
        const { ticketId } = req.params as TicketIdParam;
        await ticketService.deleteTicket(ticketId);
        res.status(204).end();
    },
);
```

Remove the `TODO(F17)` comment at `:11`. **`res.status(204).end()` — NO body.**

Modify `backend/src/routes/tickets.routes.test.ts` — add `deleteTicket: vi.fn()` to the mock map + a delete suite (mirrors `labels.routes.test.ts:255-284` but asserts **204**):

```typescript
const mockedDeleteTicket = vi.mocked(ticketService.deleteTicket);

describe('DELETE /api/tickets/:ticketId', () => {
    beforeEach(() => {
        mockedDeleteTicket.mockReset();
        mockedFindVersion.mockResolvedValue(0);
    });

    it('returns 401 without a token', async () => {
        const res = await request(app).delete(`/api/tickets/${VALID_TICKET_ID}`);
        expect(res.status).toBe(401);
        expect(mockedDeleteTicket).not.toHaveBeenCalled();
    });

    it('returns 403 FORBIDDEN for MEMBER (service not called)', async () => {
        const res = await request(app)
            .delete(`/api/tickets/${VALID_TICKET_ID}`)
            .set('Authorization', `Bearer ${tokenFor('MEMBER')}`);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect(mockedDeleteTicket).not.toHaveBeenCalled();
    });

    it('returns 204 No Content for ADMIN and calls deleteTicket (empty body)', async () => {
        mockedDeleteTicket.mockResolvedValueOnce(undefined);
        const res = await request(app)
            .delete(`/api/tickets/${VALID_TICKET_ID}`)
            .set('Authorization', `Bearer ${tokenFor('ADMIN')}`);
        expect(res.status).toBe(204);
        expect(res.body).toEqual({});
        expect(mockedDeleteTicket).toHaveBeenCalledWith(VALID_TICKET_ID);
    });

    it('returns 404 NOT_FOUND when deleteTicket throws (missing OR already deleted)', async () => {
        mockedDeleteTicket.mockRejectedValueOnce(
            new AppError(ErrorCode.NOT_FOUND, `Ticket '${VALID_TICKET_ID}' not found`),
        );
        const res = await request(app)
            .delete(`/api/tickets/${VALID_TICKET_ID}`)
            .set('Authorization', `Bearer ${tokenFor('ADMIN')}`);
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('rejects an invalid uuid param with 400 VALIDATION_FAILED', async () => {
        const res = await request(app)
            .delete('/api/tickets/not-a-uuid')
            .set('Authorization', `Bearer ${tokenFor('ADMIN')}`);
        expect(res.status).toBe(400);
        expect(mockedDeleteTicket).not.toHaveBeenCalled();
    });
});
```

**Acceptance Criteria:**
- [ ] `deleteTicket(ticketId): Promise<void>` exists; uses `db.update(tickets).set({ deletedAt: new Date() }).where(and(eq(id), isNull(deletedAt))).returning({ id })`; throws `AppError(ErrorCode.NOT_FOUND, …)` on empty returning.
- [ ] `isNull` imported from `drizzle-orm` in both `ticketService.ts` and `boardService.ts`.
- [ ] `getTicket:283`, `updateTicket:327`, `moveTicket:83` filter `isNull(tickets.deletedAt)`.
- [ ] `boardService.getBoard:80` filters `isNull(tickets.deletedAt)`.
- [ ] `DELETE /api/tickets/:ticketId` route registered with `authenticate → requireRole('ADMIN') → validateRequest({ params: ticketIdParam })`.
- [ ] Route returns **`204 No Content`** (empty body) on success.
- [ ] `tickets.routes.test.ts` adds `deleteTicket: vi.fn()` + a delete suite asserting 401 / 403-member (service NOT called) / **204-admin** (empty body) / 404-missing-or-already-deleted / 400-bad-uuid.
- [ ] NO manual child-row cleanup in `deleteTicket` (soft delete — logs + links retained).
- [ ] NO `db.delete`; NO `DELETED` enum; NO activity-log row.
- [ ] NO string-concatenated SQL (`db.update(...).where(eq(...))` ORM only).
- [ ] `TODO(F17)` removed/updated.
- [ ] `rtk tsc` (BE) + `rtk vitest run` (BE) pass.

**Dependencies:** T1. Decisions D1, D2, D3, D4, D9.

---

### T3 — FE: `apiFetch` 204 guard + `deleteTicket` api fn + `useDeleteTicket` mutation

**Batch:** 3 · **Depends on:** T2 · **Parallel with:** —

**Description:** The FE data layer. (1) Add a 204 short-circuit guard to `apiFetch` in `frontend/src/api/client.ts` (the DELETE route returns 204 with an empty body; `apiFetch` currently calls `response.json()` unconditionally at `:121` → throws on the empty body). (2) Add `deleteTicket(ticketId)` to `frontend/src/api/tickets.ts`. (3) Add `useDeleteTicket` hook following `useUpdateTicket.ts` but **invalidate-only** (no optimistic card removal — D7). `onError` surfaces `FORBIDDEN` for optional caller toast.

Modify `frontend/src/api/client.ts` — add the 204 guard in `apiFetch`, after the `!response.ok` block and BEFORE the `const body = (await response.json())` call (`:121`):

```typescript
  // F17 D10: 204 No Content has an empty body — do NOT JSON-parse. Short-circuit
  // before the Envelope unwrap below (which assumes a JSON body). Used by DELETE.
  if (response.status === 204) {
    return null as T;
  }

  const body = (await response.json()) as Envelope<T> | ApiErrorBody;
```

Modify `frontend/src/api/tickets.ts` — append `deleteTicket`:

```typescript
// F17 D2/D10: DELETE /tickets/:id — admin-only SOFT delete. Returns 204 (empty
// body); apiFetch short-circuits on 204 (client.ts) → resolves to null.
export async function deleteTicket(ticketId: string): Promise<void> {
    await apiFetch<void>(`/tickets/${ticketId}`, {
        method: 'DELETE',
    });
}
```

Create `frontend/src/hooks/useDeleteTicket.ts`:

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteTicket } from '@/api/tickets';
import { boardKeys, ticketKeys } from '@/api/queryKeys';
import { ApiClientError } from '@/api/client';

export interface DeleteTicketVariables {
    ticketId: string;
    slug: string;
}

// F17 D7: admin-only SOFT delete. INVALIDATE-ONLY (no optimistic board card
// removal): F10's 30s board poll + the invalidate-forced refetch reconcile the
// card removal (the soft-deleted row is filtered out by getBoard's isNull filter).
export function useDeleteTicket() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: DeleteTicketVariables) => deleteTicket(vars.ticketId),
        onSuccess: (_data, vars) => {
            queryClient.removeQueries({ queryKey: ticketKeys.detail(vars.ticketId) });
            queryClient.invalidateQueries({ queryKey: boardKeys.all });
        },
        onError: (error: unknown) => {
            if (error instanceof ApiClientError && error.code === 'FORBIDDEN') {
                // surfaced via the returned mutation's .error (caller may toast)
            }
        },
    });
}
```

**Acceptance Criteria:**
- [ ] `apiFetch` returns `null as T` early when `response.status === 204`, BEFORE the `response.json()` call (D10).
- [ ] `deleteTicket(ticketId)` api fn exists; calls `apiFetch<void>('/tickets/:id', { method: 'DELETE' })`.
- [ ] `useDeleteTicket` hook exists; `mutationFn` calls `deleteTicket`; `DeleteTicketVariables = { ticketId, slug }`.
- [ ] `onSuccess` does `removeQueries(ticketKeys.detail(ticketId))` + `invalidateQueries(boardKeys.all)` — NO optimistic board card removal.
- [ ] `onError` recognizes `ApiClientError` with `code === 'FORBIDDEN'`.
- [ ] No `any`; `import type` where appropriate.
- [ ] `rtk tsc` (FE) passes.

**Dependencies:** T2. Decisions D2, D7, D10.

---

### T4 — FE: `DeleteTicketConfirm` component + wire into `TicketDetailModal`

**Batch:** 4 · **Depends on:** T3 · **Parallel with:** —

**Description:** The UI. (1) Create `frontend/src/components/DeleteTicketConfirm.tsx` — a `<Modal>`-wrapped destructive confirm (mirrors `ConfirmDiscardDialog`). (2) Wire it into `TicketDetailModal.tsx`, replacing the `:121` seam: render a destructive "Delete ticket" button **only when `useRequireRole('ADMIN')`**; clicking opens the confirm; on confirm, call `useDeleteTicket().mutate`, then `onClose`.

Create `frontend/src/components/DeleteTicketConfirm.tsx`:

```tsx
import { Modal } from './Modal';

// F17 D5: destructive confirm shown before a SOFT ticket delete. Wraps the
// reusable Modal (useModalA11y → focus trap/Esc/scroll-lock/focus-restore).
// Copy reflects soft delete: history is archived, not destroyed.
interface DeleteTicketConfirmProps {
    isOpen: boolean;
    /** Caller disables the button while the delete mutation is in-flight. */
    isDeleting?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export function DeleteTicketConfirm({
    isOpen,
    isDeleting = false,
    onConfirm,
    onCancel,
}: DeleteTicketConfirmProps) {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onCancel}
            titleId="delete-ticket-dialog-title"
            title="Delete ticket?"
            blockBackdropClose
        >
            <p className="mb-4 text-sm text-gray-600">
                This removes the ticket from the board. Its activity history and label
                links are archived and the ticket number is not reused. This cannot be
                undone from the UI.
            </p>
            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    onClick={onCancel}
                    disabled={isDeleting}
                    className="rounded px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={onConfirm}
                    disabled={isDeleting}
                    className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                >
                    {isDeleting ? 'Deleting…' : 'Delete'}
                </button>
            </div>
        </Modal>
    );
}
```

Modify `frontend/src/components/TicketDetailModal.tsx` — replace the `:121` seam:

```tsx
import { useRequireRole } from '@/hooks/useRequireRole';
import { useDeleteTicket } from '@/hooks/useDeleteTicket';
import { DeleteTicketConfirm } from './DeleteTicketConfirm';

// inside the component:
const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false); // F17
const isAdmin = useRequireRole('ADMIN'); // F17 (cosmetic gate)
const deleteTicketMutation = useDeleteTicket(); // F17

const handleConfirmDelete = async () => {
    await deleteTicketMutation.mutateAsync({ ticketId, slug });
    setDeleteConfirmOpen(false);
    onClose();
};

// inside the <Modal>, replacing the :121 seam:
{isAdmin && (
    <div className="mt-4 border-t border-gray-200 pt-4">
        <button
            type="button"
            onClick={() => setDeleteConfirmOpen(true)}
            className="text-sm text-red-600 hover:underline"
        >
            Delete ticket
        </button>
    </div>
)}

// as a sibling (like ConfirmDiscardDialog):
<DeleteTicketConfirm
    isOpen={deleteConfirmOpen}
    isDeleting={deleteTicketMutation.isPending}
    onConfirm={handleConfirmDelete}
    onCancel={() => setDeleteConfirmOpen(false)}
/>
```

**Acceptance Criteria:**
- [ ] `DeleteTicketConfirm` exists; wraps `<Modal>` with `blockBackdropClose`; Cancel + destructive Delete buttons; `isDeleting` disables buttons.
- [ ] `TicketDetailModal` renders "Delete ticket" ONLY when `useRequireRole('ADMIN')` is true (member → button absent).
- [ ] Clicking opens `DeleteTicketConfirm`; Cancel closes; confirm calls `useDeleteTicket().mutate({ ticketId, slug })` then `onClose`.
- [ ] The `:121` seam comment is replaced by the live button.
- [ ] No `any`; no inline styles (Tailwind only).
- [ ] `rtk tsc` (FE) passes.

**Dependencies:** T3. Decisions D5, D6.

---

### T5 — FE tests: `useDeleteTicket` + `DeleteTicketConfirm` + `TicketDetailModal` gate + `apiFetch` 204

**Batch:** 4 · **Depends on:** T4 · **Parallel with:** —

**Description:** Co-located Vitest + Testing Library coverage. (1) `useDeleteTicket.test.ts` — success calls `deleteTicket` + invalidates `boardKeys.all` + removes `ticketKeys.detail`; surfaces `FORBIDDEN` on 403. (2) `DeleteTicketConfirm.test.tsx` — renders, Cancel/Delete wiring, `isDeleting` disables. (3) Extend `TicketDetailModal.test.tsx` — admin renders the button; member does not. (4) `apiFetch` 204 test — returns `null`, no `response.json` call.

- `useDeleteTicket.test.ts`: success → `deleteTicket` called + `removeQueries` + `invalidateQueries`; 403 → `ApiClientError` FORBIDDEN surfaced.
- `DeleteTicketConfirm.test.tsx`: title "Delete ticket?"; Cancel → `onCancel`; Delete → `onConfirm`; `isDeleting` → disabled + "Deleting…".
- `TicketDetailModal.test.tsx`: ADMIN → button present + opens confirm; MEMBER → button absent.
- `client.test.ts` (apiFetch): mock 204 → returns `null`, `response.json` NOT called.

**Acceptance Criteria:**
- [ ] `useDeleteTicket.test.ts` asserts success invalidation/removal + 403 `FORBIDDEN` surfacing.
- [ ] `DeleteTicketConfirm.test.tsx` asserts render + Cancel/Delete wiring + `isDeleting` disabled.
- [ ] `TicketDetailModal` test asserts admin renders the button + member does not.
- [ ] `apiFetch` 204 test asserts `null` return + no `response.json` call.
- [ ] Uses `getByRole`/`getByText` priority.
- [ ] Coverage of `useDeleteTicket.ts` + `DeleteTicketConfirm.tsx` + the 204 path > 80%.
- [ ] `rtk vitest run` (FE) passes.

**Dependencies:** T4.

---

### T6 — Integration verification & sign-off

**Batch:** 4 (terminal) · **Depends on:** all prior · **Parallel with:** —

**Description:** The final definition-of-done gate. Run every tool against the as-merged feature, fix gaps, record proof. Do NOT check the box — the owner does.

Steps:
1. **Typecheck:** `rtk tsc` (BE + FE) — zero new errors.
2. **Lint:** `rtk lint` — zero new violations.
3. **Format:** `rtk prettier --check` — zero unformatted files.
4. **Tests:** `rtk vitest run` (BE + FE) — all green. Coverage on delete paths + 204 path > 80%.
5. **Build:** FE `npm run build` succeeds; BE boots.
6. **Migration applied:** confirm `0009_*.sql` ran on dev DB; `\d "Tickets"` shows `deleted_at timestamptz` (nullable); existing rows `deleted_at IS NULL`.
7. **Read-filter coverage:** confirm `getBoard`, `getTicket`, `updateTicket`, `moveTicket` all exclude soft-deleted tickets.
8. **Live smoke (manual):**
   - Start BE + FE locally.
   - **Admin soft-deletes:** open a ticket detail modal as ADMIN → "Delete ticket" → confirm → **204 No Content** (empty body); card gone from board; `SELECT id, deleted_at FROM "Tickets" WHERE id='<id>';` → row PRESENT, `deleted_at` set (NOT removed).
   - **Logs + label links RETAINED:** `SELECT count(*) FROM "ActivityLogs" WHERE ticket_id='<id>';` → unchanged; `SELECT count(*) FROM "TicketLabels" WHERE ticket_id='<id>';` → unchanged.
   - **Deleted ticket filtered everywhere:** board → absent; `GET /api/tickets/<id>` → 404; `PATCH /api/tickets/<id>` → 404; move → 404.
   - **Re-delete → 404:** `curl -X DELETE -H "Authorization: Bearer <admin-token>" /api/tickets/<already-deleted-id>` → `404 NOT_FOUND`.
   - **Member:** button absent; crafted `curl -X DELETE … <member-token>` → `403 FORBIDDEN`.
   - **Unauthenticated:** `curl -X DELETE /api/tickets/<id>` → `401`.
   - **Missing:** admin DELETE random uuid → `404`.
   - **ticket_number not reused:** create a new ticket → NEXT counter value.
   - **204 empty body:** DELETE response Content-Length: 0; `apiFetch` returned `null` without throwing.

**Acceptance Criteria:**
- [ ] `rtk tsc` BE + FE exit 0.
- [ ] `rtk lint` exit 0, no new violations.
- [ ] `rtk prettier --check` exit 0.
- [ ] `rtk vitest run` BE + FE exit 0; coverage > 80% on delete paths + 204 path.
- [ ] FE build + BE boot succeed.
- [ ] Migration applied; `\d "Tickets"` confirms `deleted_at timestamptz` nullable; existing rows `deleted_at IS NULL`.
- [ ] Live smoke: admin soft-delete → **204 empty body** + card gone + ticket row PRESENT (`deleted_at` set) + activityLogs UNCHANGED + ticketLabels UNCHANGED; deleted ticket filtered (board absent / detail 404 / edit 404 / move 404); re-delete → 404; member → button hidden + crafted DELETE → 403; unauth → 401; missing → 404; ticket_number not reused.

**Dependencies:** all prior tasks merged.

---

## 7. Final F17 Acceptance Checklist

- [ ] `DELETE /api/tickets/:ticketId` returns `403 FORBIDDEN` for a non-admin (MEMBER); **`204 No Content`** (empty body) for an ADMIN success; `404 NOT_FOUND` for a missing OR already-soft-deleted ticket; `401` for an unauthenticated request; `400` for a bad uuid.
- [ ] The permission check is **server-side** via `requireRole('ADMIN')` middleware; the FE `useRequireRole('ADMIN')` hide is cosmetic only.
- [ ] A confirmation dialog (`DeleteTicketConfirm`) is shown before the delete executes.
- [ ] Deleting a ticket sets `deleted_at = now()` (SOFT delete); the row is RETAINED. `ActivityLogs` (F18) + `TicketLabels` (F14) rows are **RETAINED (archived)** — the `ON DELETE CASCADE` FKs never fire (no DELETE).
- [ ] Every ticket read excludes soft-deleted tickets: `getBoard` (filtered), `getTicket` (→ null → 404), `updateTicket` (→ NOT_FOUND), `moveTicket` (→ NOT_FOUND).
- [ ] Re-deleting an already-soft-deleted ticket → `404 NOT_FOUND` (idempotent-safe).
- [ ] `ticket_number` is never reused (F12 `projectSequences` counter untouched).
- [ ] The delete button is rendered in `TicketDetailModal` only for admins (`useRequireRole('ADMIN')`).
- [ ] `apiFetch` short-circuits on 204 (`return null as T`) before JSON parsing.
- [ ] `deleteTicket` uses ORM `db.update(...).set(...).where(eq(...))` — no string-concat SQL; no `db.delete`.
- [ ] **`TimeEntries` cascade deferred to F20** (table absent); F20 owns the running-timer-on-a-soft-deleted-ticket nuance.
- [ ] All tests pass (Vitest BE + FE); coverage on delete paths + 204 path > 80%.
- [ ] Typecheck / lint / format / build all green.

**Integration record (fill during T6):**
- Feature commit SHA: `________`
- Admin DELETE response: `204 No Content` (empty body) — `________`
- Member DELETE response: `403 { error: { code: 'FORBIDDEN' } }` — `________`
- Soft-delete confirmed (psql): tickets row `PRESENT` with `deleted_at=<ts>` — `________`
- Archive confirmed (psql): activityLogs=`<unchanged>` ticketLabels=`<unchanged>` — `________`
- Deleted ticket filtered: board=`absent` / detail=`404` / edit=`404` / move=`404` — `________`
- Re-delete → `404` — `________`
- Member UI: delete button `absent` — `________`
- ticket_number reuse check: new ticket number = `________` (NOT the soft-deleted one)
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0`

---

## 8. Schema deltas owned by this feature

**F17 owns ONE schema delta — `tickets.deletedAt`.** This is a **NEW** delta NOT present in the features.md schema-deltas table. **The owner should add the row to `features.md`** (the plan carries it forward; the table update is an owner action alongside landing the plan). No data backfill.

| Delta | Detail | Migration |
| --- | --- | --- |
| `tickets.deletedAt` (NEW) | `timestamp('deleted_at', { withTimezone: true, mode: 'date' })` — **nullable, no default** (null = live). Set to `now()` by `deleteTicket` (soft delete). Every ticket read filters `isNull(deleted_at)`. UTC timestamptz. **No index** for F17 (filters ride existing indexed lookups). | `0009_add_tickets_deleted_at.sql` — `ALTER TABLE "Tickets" ADD COLUMN "deleted_at" timestamptz;` Applied via `psql` pipe (dev DB is push-based; NOT `db:migrate`). No enum → no `$1` bug risk. |

> **features.md deltas-table note (owner action):** the `tickets.deletedAt` row is NOT in the features.md schema-deltas table today. As part of landing F17, **add the row** so the deltas table stays the source of truth.

> **No child-table deltas.** `ActivityLogs` (F18) and `TicketLabels` (F14) are UNCHANGED — their `ON DELETE CASCADE` FKs remain (hard-purge safety) but are inert under soft delete (no DELETE → no cascade). Logs + label links persist (archived).

> **F20 forward contract:** when F20 adds the `TimeEntries` table, its `ticketId` FK MUST reference `tickets.id` with `ON DELETE CASCADE` (future hard-purge path). **Soft delete means a timer could still be running on a "deleted" ticket** — F20 owns the stop/forbid/auto-stop decision.

---

## 9. Cross-cutting decisions — CONFIRMED (owner-approved 2026-06-24)

1. **Hard vs soft delete.** **CONFIRMED: SOFT DELETE** (owner override of the prior hard-delete recommendation). `tickets.deletedAt: timestamptz` nullable (null = live); `deleteTicket` sets `deletedAt = now()`; every ticket read filters `deleted_at IS NULL`. ActivityLogs (F18) + TicketLabels (F14) are **RETAINED (archived)** — the FK `ON DELETE CASCADE` never fires (no DELETE). Resolves the spec's "removed or archived" to **archived** (history preserved). Migration `0009`; no backfill. A future hard-purge / restore admin feature is separate scope.
2. **Dedicated `DeleteTicketConfirm` vs a generic `ConfirmDialog` primitive.** **CONFIRMED: DEDICATED.** Mirrors `ConfirmDiscardDialog`. A generic primitive is scope creep for F17.
3. **`TimeEntries` cascade deferred to F20.** **CONFIRMED: OUT of F17 scope.** `TimeEntries` table does not exist (F20 not built). F17 retains `activityLogs` + `ticketLabels` today; the time-entries cascade is F20's responsibility (`ticketId` FK MUST be `ON DELETE CASCADE`). The running-timer-on-a-soft-deleted-ticket nuance is wholly F20.
4. **Optimistic card removal vs invalidate-only on delete.** **CONFIRMED: INVALIDATE-ONLY.** `removeQueries(ticketKeys.detail)` + `invalidateQueries(boardKeys.all)`. F10's 30s board poll reconciles. Optimistic removal adds rollback complexity for no UX gain.
5. **DELETE response shape.** **CONFIRMED: `204 No Content`** (empty body). The FE `apiFetch` MUST handle the empty 204 body — `client.ts:121` `.json()`s unconditionally; T3 adds a `if (response.status === 204) return null as T` guard. 204 matches REST convention for a successful delete.
6. **Toast-on-403 for a member who crafts a DELETE request.** **CONFIRMED: NICE-TO-HAVE / out of core scope.** `useDeleteTicket.onError` surfaces `FORBIDDEN` so a caller CAN toast, but F17 mandates no global 403 toast.

---

**Sources:**
- PRD REQ-3.3 ("Any authenticated user can create or edit tickets. Only `Admins` can delete tickets.").
- PRD REQ-1.3 (Admin: manage settings, delete tickets; Member: create/edit/move).
- PRD §4 (no complex RBAC beyond Admin/Member).
- PRD §8.3 (`TimeEntries.ticket_id` + `ActivityLogs.ticket_id` FK→Tickets; `ON DELETE` a design decision — resolved to soft/archived).
- Grounding evidence file:line citations: `backend/src/db/schema.ts:22,108-144,130-133,173-178,201-208`; `backend/src/services/ticketService.ts:1,76-157,83,163-178,261-308,283,316-420,327`; `backend/src/services/boardService.ts:1,52-161,80`; `backend/src/middleware/requireRole.ts:8-23`; `backend/src/middleware/auth.ts:9-43`; `backend/src/utils/envelope.ts:11`; `backend/src/routes/tickets.routes.ts:2-7,11,15-27,34-88`; `backend/src/routes/labels.routes.ts:58-66`; `backend/src/routes/labels.routes.test.ts:255-284`; `backend/src/index.ts:54`; `frontend/src/api/client.ts:5-29,45-131,76-103,105-119,121`; `frontend/src/api/queryKeys.ts:7-14`; `frontend/src/hooks/useRequireRole.ts:6-11`; `frontend/src/hooks/useUpdateTicket.ts:14-73`; `frontend/src/stores/useAuthStore.ts:11`; `frontend/src/components/TicketDetailModal.tsx:21-26,121`; `frontend/src/components/Modal.tsx`; `frontend/src/components/ConfirmDiscardDialog.tsx`.
- Project memory: `dev-db-push-based-no-migration-journal` (apply via psql pipe, not `db:migrate`).
- Project rules: `.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`.
