# F17 — Ticket permissions (admin-only delete): Plan + Task Breakdown

> **Feature:** F17 — Ticket permissions (admin-only delete) (Phase 2 — Permissions)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F16 (DONE ✅), F18 (DONE ✅) — also uses F06/F07 roles (DONE ✅), F12 counter (DONE ✅), F14 label links (DONE ✅) · **PRD ref:** REQ-3.3, PRD §4, PRD §8.3, REQ-1.3
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), the project rules discovered for this repo (`.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`), plus dependency feature task docs: [F16](../F16-ticket-detail-modal/F16-ticket-detail-modal-tasks.md), [F18](../F18-activity-log-capture/F18-activity-log-capture-tasks.md)

---

## 1. F17 Recap

**Goal:** Enforce role rules on ticket mutations — any authenticated user may create/edit tickets; only `ADMIN` may delete; the UI hides the delete control for members.

**Ships:** A new `DELETE /api/tickets/:ticketId` endpoint, server-gated by `requireRole('ADMIN')`. An admin opening a ticket detail modal sees a destructive "Delete ticket" button; clicking it opens a confirm dialog, and on confirm the ticket is removed (cascading its activity logs + label links via existing FK `ON DELETE CASCADE`). A member never sees the button, and a crafted `DELETE` request from a member account returns `403 FORBIDDEN`. Members retain full create/edit/move ability.

**Acceptance (definition of done):**
- `DELETE /api/tickets/:ticketId` returns `403 FORBIDDEN` for a non-admin (MEMBER) and `200 success({ id })` for an ADMIN; `404 NOT_FOUND` for a missing ticket; `401` for an unauthenticated request.
- The permission check is server-side via `requireRole('ADMIN')` middleware — NOT just UI-hidden. The UI hiding is cosmetic/convenience.
- A confirmation dialog is shown before the destructive delete executes.
- Deleting a ticket cascades: its `ActivityLogs` rows (F18) and `TicketLabels` rows (F14) are removed by the existing FK `ON DELETE CASCADE`. `ticket_number` is never reused (F12 monotonic counter untouched).
- The delete button is rendered in `TicketDetailModal` only for admins (`useRequireRole('ADMIN')`).

**Edge cases to resolve up front:**
- **Permission check must be server-side, not just UI-hidden** → **Decision:** mount `requireRole('ADMIN')` on the `DELETE` route (`backend/src/middleware/requireRole.ts:9-23`). The FE `useRequireRole('ADMIN')` gate is cosmetic only. Cite `requireRole.ts:8` docstring (its example IS the F17 route).
- **Soft vs hard delete** → **Decision:** HARD DELETE (`db.delete(tickets)`; no `deletedAt` column; no `DELETED` enum value). Consistent with F18's `activityLogs.ticketId` `ON DELETE CASCADE` by design (the audit trail for the ticket is being deleted with it). PRD §4 mandates no complex RBAC and no soft-delete semantics; adding `WHERE deleted_at IS NULL` filtering everywhere would be scope creep with no PRD mandate. Cite `schema.ts:201-208` (F18 cascade) + PRD §4.
- **Cascade time entries + activity logs** → **Decision:** rely on FK `ON DELETE CASCADE` for `activityLogs` (F18, `schema.ts:205-207`) and `ticketLabels` (F14, `schema.ts:173-178`). **The `TimeEntries` table does NOT exist yet (F20 not built)** — the time-entries cascade is DEFERRED to F20. F17 ships hard-delete that cascades activity logs + label links today. When F20 lands, its `timeEntries.ticketId` FK MUST be `ON DELETE CASCADE`. Document. Cite `schema.ts:173-178,205-207`; no `timeEntries` in `schema.ts`.
- **Running timer on a deleted ticket** → **Decision:** OUT OF SCOPE (F20). No timer/`TimeEntries` model exists in the schema today. When F20 adds it, the `ON DELETE CASCADE` FK + the F20 "stop/forbid/auto-stop" decision will govern. Document.

---

## 2. Codebase Analysis Summary

- **State:** **Greenfield for the delete path; all dependencies DONE ✅ in code.** F16 (ticket detail modal) ships the `TicketDetailModal.tsx` with a reserved F17 seam at `:121`. F18 (activity logs) ships the `activityLogs` table with `ON DELETE CASCADE` at `schema.ts:205-207`. F06 (roles) ships `roleEnum` (`schema.ts:22`). F07 ships the hardened `requireRole` middleware + `authenticate`. F12 ships the monotonic ticket-number counter. F14 ships `ticketLabels` with `ON DELETE CASCADE` (`schema.ts:173-178`). No DELETE endpoint, no `deleteTicket` service, no `useDeleteTicket` hook, no `DeleteTicketConfirm` component exist yet.

- **Existing structure this feature builds on (with path citations):**
  - **DELETE endpoint ABSENT.** `backend/src/routes/tickets.routes.ts` has only `GET /:ticketId` + `PATCH /:ticketId`; router mounted at `backend/src/index.ts:54` (`/api/tickets`). A placeholder `TODO(F17)` sits at `tickets.routes.ts:11`. Existing imports (`authenticate`, `validateRequest`, `AppError`, `ErrorCode`, `success`, `ticketIdParam`, `ticketService`) are reusable. No new import except `requireRole` + `deleteTicket`.
  - **`requireRole('ADMIN')` ready** — `backend/src/middleware/requireRole.ts:9-23`; throws `AppError(ErrorCode.FORBIDDEN, …)` (403) when `req.user.role` not in the allowed set; defensively throws `UNAUTHENTICATED` if `req.user` is missing. Requires `authenticate` first. Its docstring example at `:8` IS the F17 route: `router.delete('/tickets/:id', authenticate, requireRole('ADMIN'), handler)`. Already mounted for project create (`projects.routes.ts:72`) + label mutations incl. `DELETE /api/labels/:id` (`labels.routes.ts:58-66` — the closest 1:1 precedent).
  - **Role trusted server-side** — `authenticate` (`backend/src/middleware/auth.ts:9-43`) sets `req.user = { id, email, role }` from the JWT claim (narrowed `'ADMIN'|'MEMBER'` in `utils/jwt.ts`), hardened by the F07 token-version check. `AuthenticatedUser` type at `backend/src/types/express.d.ts:1-11`. **The server is the real gate; the FE store is cosmetic.**
  - **`ticketIdParam` Zod schema** — `backend/src/routes/tickets.schema.ts` exports the uuid param validator reused by GET/PATCH. DELETE reuses it (`validateRequest({ params: ticketIdParam })`).
  - **`deleteTicket` service ABSENT** — natural home: `backend/src/services/ticketService.ts` after `updateTicket`. Mirror `deleteLabel` (`backend/src/services/labelService.ts:86-94`): `db.delete(tickets).where(eq(tickets.id, ticketId)).returning({ id: tickets.id })`; throw `NOT_FOUND` on miss. No transaction, no child cleanup (CASCADE handles it), no activity log (the audit trail is being deleted with the ticket).
  - **403/envelope ready** — `ErrorCode.FORBIDDEN` (`backend/src/utils/envelope.ts:11`) → 403 via `codeToStatus`; `NOT_FOUND` → 404 for a missing ticket. `errorMiddleware` maps code→status. No new error codes.
  - **`tickets.routes.test.ts` ALREADY EXISTS** — supertest + `tokenFor('ADMIN'|'MEMBER')` helper + mocked `ticketService` (`moveTicket`, `getTicket`, `updateTicket`) + mocked `tokenVersion`. T1 extends it with a delete suite + adds `deleteTicket` to the `vi.mock('../services/ticketService', …)` map. The exact `403 FORBIDDEN for MEMBER` / `200` / `404` pattern is established in `labels.routes.test.ts:255-284`.
  - **TicketDetailModal F17 seam** — `frontend/src/components/TicketDetailModal.tsx:121` reserved `{/* F17 will render the admin-only delete button here. */}` (modal prop shape `{ slug, ticketId, onClose, onSubmit }` at `:21-26`). The modal uses `ticketId` for its `useQuery` detail fetch + wires `Modal` + `ConfirmDiscardDialog`.
  - **Client role gate** — `useRequireRole('ADMIN')` hook (`frontend/src/hooks/useRequireRole.ts:8-11`) reads `useAuthStore` role (`stores/useAuthStore.ts:11` `AuthUser.role`, persisted + refreshed via `useAuthSync`). Returns `boolean`; docstring explicitly states "The server-side requireRole middleware is the real gate; this hook is for UX."
  - **Cascade — FKs already wired:** `activityLogs.ticketId → tickets` **ON DELETE CASCADE** (`schema.ts:205-207`, F18); `ticketLabels.ticketId → tickets` **ON DELETE CASCADE** (`schema.ts:173-178`, F14). Deleting a ticket auto-removes its activity logs + label links. `checklist` is a `jsonb` column on `tickets` — deleted with the row. `projectSequences` is a per-project counter (FK→projects, NOT tickets) — untouched; `ticket_number` never reused (F12 monotonic `allocateTicketNumber`; unique `(projectId, ticketNumber)` backstop).
  - **`TimeEntries` table ABSENT** — no `timeEntries`/`TimeEntries` anywhere in `schema.ts` (F20 not built). So "cascade time entries" is **moot/deferred to F20**; the running-timer-on-deleted-ticket edge case is wholly F20. When F20 adds the table, its `ticketId` FK MUST be `ON DELETE CASCADE`. Document.
  - **Confirm-dialog reuse** — `Modal` (`frontend/src/components/Modal.tsx`) + `useModalA11y` (focus trap/Esc/scroll-lock/focus-restore) reusable; `ConfirmDiscardDialog` (`ConfirmDiscardDialog.tsx`) is too discard-specific (hardcoded "Discard changes?" copy). F17 adds a sibling `DeleteTicketConfirm` wrapping `<Modal>` — mirrors `ConfirmDiscardDialog`'s structure.
  - **Delete mutation precedent** — no `useDeleteTicket` exists; follow `useCreateTicket`/`useUpdateTicket`: invalidate `boardKeys.all` + remove `ticketKeys.detail(ticketId)` in `onSettled` (`frontend/src/api/queryKeys.ts:7-14`). `ApiClientError` (`frontend/src/api/client.ts:5-29`) surfaces `.status`/`.code` (403 → `'FORBIDDEN'`) for toast/onError wiring.

- **Files F17 creates:** `frontend/src/hooks/useDeleteTicket.ts` (+ test), `frontend/src/components/DeleteTicketConfirm.tsx` (+ test). **Files F17 modifies:** `backend/src/services/ticketService.ts` (add `deleteTicket`), `backend/src/routes/tickets.routes.ts` (add DELETE route), `backend/src/routes/tickets.routes.test.ts` (delete suite + mock), `frontend/src/api/tickets.ts` (add `deleteTicket` fn), `frontend/src/components/TicketDetailModal.tsx` (delete button + gate + confirm), `frontend/src/components/TicketDetailModal.test.tsx` (admin/member gate).

- **Schema delta: F17 owns NONE.** Delete reuses existing tables + FK cascades (`activityLogs` F18, `ticketLabels` F14). **No migration, no `schema.ts` change.**

- **Project rules this plan must satisfy:** `.claude/rules/git-guidelines.md` (branch `feature/SLYK-F17-admin-only-delete`, single-line commits `SLYK-F17: <msg>`, rebase-merge only, never `--squash`, never `git merge`, sacred rule: never git without explicit approval); `.claude/rules/js-development-rules.md` (RESTful `DELETE /api/tickets/:ticketId`; route→service→drizzle db; **never string-concat SQL**; `db.delete(...).where(eq(...))` ORM only; consistent `success(...)` envelope; no invented error codes; server-enforced auth); `.claude/rules/js-style-guide.md` (2-space JS / 4-space JSX, no `any`, import order external→internal→types→relative, functions <50 lines, early returns, Tailwind no inline styles); `.claude/rules/js-testing-rules.md` (Vitest co-located, table-driven, `>80% business logic`, assert 403-member/200-admin/404-missing); `.claude/rules/persona.md` (Node 24+ / Express 5 / Drizzle / Postgres / React 19 / Vite / Tailwind).

- **Hidden coupling to plan for:**
  - **Server is the gate, FE is cosmetic.** The route MUST mount `requireRole('ADMIN')` — the FE `useRequireRole('ADMIN')` hide is UX-only and trivially bypassed.
  - **`ticketService` mock map in `tickets.routes.test.ts`** — currently mocks `{ moveTicket, getTicket, updateTicket }`. T1 MUST add `deleteTicket: vi.fn()` or the delete tests hit the real DB.
  - **CASCADE means no child cleanup needed in `deleteTicket`.** The service is a one-liner delete + 404 guard. Do NOT add manual `db.delete(activityLogs)` / `db.delete(ticketLabels)` — that duplicates the FK and races the cascade.
  - **`TimeEntries` cascade is F20's contract.** When F20 adds the table, its `ticketId` FK MUST be `ON DELETE CASCADE` or deletes will fail on FK violation. Document for F20.
  - **`useUpdateTicket` does optimistic board writes; `useDeleteTicket` does NOT.** Delete invalidates-only (F10 board poll reconciles within 30s) — simplest and avoids optimistic-removal rollback complexity.
  - **Confirm-dialog sibling vs generic primitive.** `ConfirmDiscardDialog` is discard-specific. A generic `ConfirmDialog` would be a nice refactor but is scope creep — F17 adds a focused `DeleteTicketConfirm`. (Owner sign-off §9b.)

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale (cite source) |
|---|----------|--------|-----------|
| D1 | Hard vs soft delete | **HARD DELETE** — `db.delete(tickets)`; no `deletedAt`, no `DELETED` enum, no deletion audit row. | F18's `activityLogs.ticketId` is `ON DELETE CASCADE` by design (`schema.ts:205-207`) — the audit trail is deleted with the ticket; soft-delete would orphan the cascade + require `WHERE deleted_at IS NULL` everywhere with no PRD mandate (PRD §4). `deleteLabel` (`labelService.ts:86-94`) hard-deletes the same way. |
| D2 | DELETE route middleware chain | **`authenticate` → `requireRole('ADMIN')` → `validateRequest({ params: ticketIdParam })` → handler.** Member → `403 FORBIDDEN`; unauthenticated → `401 UNAUTHENTICATED`; missing ticket → `404 NOT_FOUND`; admin success → `200 success({ id })`. | `requireRole.ts:8-9` docstring IS the F17 route example; `requireRole.ts:15-19` throws `FORBIDDEN`. Exact precedent: `labels.routes.ts:58-66`. `requireRole` requires `authenticate` first. |
| D3 | `deleteTicket` service | **`deleteTicket(ticketId): Promise<{ id: string }>`** in `ticketService.ts` after `updateTicket`. `db.delete(tickets).where(eq(tickets.id, ticketId)).returning({ id: tickets.id })`; throw `AppError(ErrorCode.NOT_FOUND, …)` on miss. No txn, no child cleanup. | Mirrors `deleteLabel` (`labelService.ts:86-94`) line-for-line. CASCADE removes children (`activityLogs`, `ticketLabels`); no audit row (the trail is being deleted). |
| D4 | Cascade strategy | **Rely on FK `ON DELETE CASCADE`** — `activityLogs` (F18 `schema.ts:205-207`) + `ticketLabels` (F14 `schema.ts:173-178`) auto-removed. **`TimeEntries` table does NOT exist (F20)** — its cascade is DEFERRED. | DB-level cascade is atomic + authoritative. Adding manual child deletes would duplicate the FK and race the cascade. F20 must add `timeEntries.ticketId` FK as `ON DELETE CASCADE` or deletes break. |
| D5 | Confirm dialog | **New `DeleteTicketConfirm` component wrapping `<Modal>`** (reuse `useModalA11y` via `Modal`); `blockBackdropClose`; destructive styling. NOT a generic `ConfirmDialog` primitive. | `ConfirmDiscardDialog` is discard-specific (copy/semantics). A generic primitive is a nice refactor but scope creep (§9b). `Modal` + `useModalA11y` give focus-trap/Esc/scroll-lock/focus-restore for free. |
| D6 | FE role gate | **`useRequireRole('ADMIN')`** hides the delete button in `TicketDetailModal`. The server `requireRole('ADMIN')` is the real security boundary. | `useRequireRole.ts:6-11` docstring: "server-side requireRole middleware is the real gate; this hook is for UX." Cosmetic only — a member crafting a `DELETE` gets 403. |
| D7 | `useDeleteTicket` mutation | **`invalidate boardKeys.all` + `removeQueries ticketKeys.detail(ticketId)`** in `onSettled`. NO optimistic board card removal. `onError` surfaces `FORBIDDEN` (403) for toast. | `useUpdateTicket.ts` invalidates `boardKeys.all` + `ticketKeys.detail`. Delete invalidates-only — F10's 30s board poll reconciles; avoids optimistic-rollback complexity (§9d). |
| D8 | `ticket_number` reuse | **Never reused.** F12's monotonic `allocateTicketNumber` (`projectSequences`) is untouched by delete. | `projectSequences` is per-project (FK→projects), NOT per-ticket. `ticket_number` uniqueness is `(projectId, ticketNumber)`. Deleting a ticket frees nothing in the counter. |
| D9 | New deps / migration | **NONE.** No new npm deps; no schema change; no migration. FKs already cascade. | F18 + F14 already shipped the CASCADEs F17 relies on. |

> **Out of F17 scope (explicitly deferred):**
> - **`TimeEntries` cascade + running-timer-on-delete behavior** → **F20** (table does not exist yet; `ticketId` FK must be `ON DELETE CASCADE` when F20 adds it).
> - **Per-column / membership-based permissions** (e.g. only the assignee may edit) → NOT in REQ-3.3; PRD §4 mandates Admin/Member only. The `TODO(F17)` note at `tickets.routes.ts:11` mentions "membership-based permissions" — explicitly OUT of scope; F17 is admin-only-delete only.
> - **Generic `ConfirmDialog` primitive refactor** → scope creep (§9b); F17 ships a focused `DeleteTicketConfirm`.
> - **Soft delete / trash / restore** → no PRD mandate (§4); hard delete is consistent with F18 cascade-by-design.

> **Owner sign-off needed (see §9):** (a) hard vs soft delete; (b) dedicated `DeleteTicketConfirm` vs generic `ConfirmDialog`; (c) confirm `TimeEntries` cascade deferred to F20; (d) optimistic card removal vs invalidate-only; (e) DELETE response shape `200 success({id})` vs `204`; (f) toast-on-403 for a member who crafts a DELETE.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/                                                  # repo root
├── backend/
│   └── src/
│       ├── services/
│       │   └── ticketService.ts                             # MODIFY (T1) — add deleteTicket(ticketId) after updateTicket
│       └── routes/
│           ├── tickets.routes.ts                            # MODIFY (T1) — add DELETE /:ticketId route (authenticate + requireRole('ADMIN') + validateRequest)
│           └── tickets.routes.test.ts                       # MODIFY (T1) — add deleteTicket to vi.mock map + 401/403/200/404 suite
└── frontend/
    └── src/
        ├── api/
        │   └── tickets.ts                                   # MODIFY (T2) — add deleteTicket(ticketId) api fn
        ├── hooks/
        │   ├── useDeleteTicket.ts                           # NEW (T2) — useMutation; invalidate boardKeys.all + remove ticketKeys.detail; onError surfaces FORBIDDEN
        │   └── useDeleteTicket.test.ts                      # NEW (T4) — mutation success/error/cache assertions
        └── components/
            ├── DeleteTicketConfirm.tsx                      # NEW (T3) — Modal-wrapped destructive confirm
            ├── DeleteTicketConfirm.test.tsx                 # NEW (T4) — renders, confirm/cancel wiring
            └── TicketDetailModal.tsx                        # MODIFY (T3) — render admin-only delete button at :121 seam + wire DeleteTicketConfirm + useRequireRole('ADMIN') gate
```

**Delete request lifecycle (post-F17):**

1. Admin clicks "Delete ticket" in `TicketDetailModal` (member never sees it — `useRequireRole('ADMIN')`).
2. `DeleteTicketConfirm` opens (a `<Modal>` with `blockBackdropClose` + destructive copy + Cancel/Delete buttons).
3. On confirm, `useDeleteTicket` calls `deleteTicket(ticketId)` → `DELETE /api/tickets/:ticketId`.
4. Route: `authenticate` sets `req.user`; `requireRole('ADMIN')` checks role (member → 403 `FORBIDDEN`); `validateRequest({ params: ticketIdParam })` validates the uuid.
5. Handler calls `ticketService.deleteTicket(ticketId)` → `db.delete(tickets).where(eq(...)).returning({ id })`; 404 `NOT_FOUND` on miss; else returns `{ id }`.
6. Postgres FK cascade auto-removes the ticket's `ActivityLogs` (F18) + `TicketLabels` (F14) rows. (`TimeEntries` cascade deferred to F20.)
7. Response: `200 success({ id })`.
8. FE `onSettled`: `invalidateQueries(boardKeys.all)` + `removeQueries(ticketKeys.detail(ticketId))`; modal closes; F10 board poll reconciles the card removal within 30s.

---

## 5. Parallelization Strategy

Tasks grouped into **4 batches** by dependency order. The BE (T1) is independent of the FE; FE api+hook (T2) is independent of the UI (T3); FE tests (T4) run against the integrated feature; T5 is the verification gate.

### Batch dependency diagram

```
 ┌─ Batch 1 (backend delete path) ─────────────────────────────────────────┐
 │  T1  deleteTicket service + DELETE /:ticketId route (requireRole ADMIN)  │
 │      + extend tickets.routes.test.ts (401/403/200/404)                   │
 │      [backend/src/services/ticketService.ts,                            │
 │       backend/src/routes/tickets.routes.ts,                             │
 │       backend/src/routes/tickets.routes.test.ts]                        │
 └────────────────────────┬────────────────────────────────────────────────┘
                          │ (DELETE endpoint + service exist; FE can build against it)
                          ▼
 ┌─ Batch 2 (FE api + mutation) ───────────────────────────────────────────┐
 │  T2  deleteTicket api fn + useDeleteTicket hook                         │
 │      [frontend/src/api/tickets.ts,                                      │
 │       frontend/src/hooks/useDeleteTicket.ts]                            │
 └────────────────────────┬────────────────────────────────────────────────┘
                          │ (mutation + api fn available)
                          ▼
 ┌─ Batch 3 (FE UI) ───────────────────────────────────────────────────────┐
 │  T3  DeleteTicketConfirm component + wire into TicketDetailModal        │
 │      (replace :121 seam; gate via useRequireRole('ADMIN'))              │
 │      [frontend/src/components/DeleteTicketConfirm.tsx,                  │
 │       frontend/src/components/TicketDetailModal.tsx]                    │
 └────────────────────────┬────────────────────────────────────────────────┘
                          │ (UI integrated)
                          ▼
 ┌─ Batch 4 (FE tests + verification) ─────────────────────────────────────┐
 │  T4  FE tests — useDeleteTicket + DeleteTicketConfirm +                 │
 │      TicketDetailModal admin/member button gate                         │
 │      [frontend/src/hooks/useDeleteTicket.test.ts,                       │
 │       frontend/src/components/DeleteTicketConfirm.test.tsx]             │
 │      ↓ then                                                             │
 │  T5  integration verification — typecheck/lint/format/test/build +      │
 │      live smoke (admin deletes → card gone + activityLogs/labelLinks    │
 │      removed via psql; member → 403 + button hidden)                    │
 │      [(verification record only)]                                       │
 └─────────────────────────────────────────────────────────────────────────┘
```

- **B1 → B2 hard barrier:** `useDeleteTicket` calls `deleteTicket` against `DELETE /api/tickets/:ticketId`. The route must exist (T1).
- **B2 → B3 hard barrier:** `DeleteTicketConfirm` + modal wiring invoke `useDeleteTicket().mutate`. The hook must exist (T2).
- **B3 → B4 hard barrier:** FE tests assert the integrated UI + hook behavior.
- **No within-batch serialization.** Each batch is a single task touching disjoint files.

### Merge order rules

1. **B1 (T1) merges first.** The DELETE endpoint + service + route tests are the foundation (and the security boundary).
2. **B2 (T2) merges second.** api fn + hook.
3. **B3 (T3) merges third.** `DeleteTicketConfirm` + modal wiring.
4. **B4 (T4 → T5) merges last.** FE tests, then the verification record.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | 1 | `backend/src/services/ticketService.ts`, `backend/src/routes/tickets.routes.ts`, `backend/src/routes/tickets.routes.test.ts` | F16/F18/F06/F07 (DONE) | — |
| **T2** | 2 | `frontend/src/api/tickets.ts`, `frontend/src/hooks/useDeleteTicket.ts` | T1 | — |
| **T3** | 3 | `frontend/src/components/DeleteTicketConfirm.tsx`, `frontend/src/components/TicketDetailModal.tsx` | T2 | — |
| **T4** | 4 | `frontend/src/hooks/useDeleteTicket.test.ts`, `frontend/src/components/DeleteTicketConfirm.test.tsx` | T3 | — |
| **T5** | 4 | (verification record only) | T4 | — |

### Developer assignment tracks

- **Solo (recommended):** T1 → T2 → T3 → T4 → T5. ~0.5-1 day. F17 is small: one DELETE route, a one-liner service, a hook, a confirm dialog, a modal wiring, and tests.
- **2 devs:** Dev-A: T1 (backend). Dev-B: waits for T1, then T2 → T3 → T4 → T5. The backend (T1) and frontend (T2-T4) are disjoint file sets.

---

## 6. Tasks

> **Code-snippet note:** the snippets below are illustrative of the shape and seams; the implementer MUST read the actual current code (`ticketService.ts`, `tickets.routes.ts`, `tickets.routes.test.ts`, `useUpdateTicket.ts`, `ConfirmDiscardDialog.tsx`, `TicketDetailModal.tsx`) before editing — verify exact signatures (e.g. `deleteLabel` returns `{ id }`; the test file's `tokenFor` helper; `ApiClientError` exposes `.status`/`.code`) and adapt.

### T1 — Backend: `deleteTicket` service + `DELETE /:ticketId` route (`requireRole('ADMIN')`) + route tests

**Batch:** 1 · **Depends on:** F16/F18/F06/F07 (DONE) · **Parallel with:** —

**Description:** The security boundary + data path. (1) Add `deleteTicket(ticketId)` to `backend/src/services/ticketService.ts` mirroring `deleteLabel` (`labelService.ts:86-94`). (2) Add a `DELETE /:ticketId` route to `backend/src/routes/tickets.routes.ts` chained `authenticate → requireRole('ADMIN') → validateRequest({ params: ticketIdParam }) → handler`, returning `200 success({ id })`. (3) Extend `backend/src/routes/tickets.routes.test.ts` with a delete suite (401 / 403-member / 200-admin / 404-missing / 400-bad-uuid), adding `deleteTicket: vi.fn()` to the existing `vi.mock('../services/ticketService', …)` map.

Modify `backend/src/services/ticketService.ts` — append after `updateTicket` (mirrors `labelService.ts:86-94`):

```typescript
// F17 — hard delete. CASCADE removes activityLogs (F18) + ticketLabels (F14).
// TimeEntries cascade deferred to F20 (table absent). ticket_number never reused (F12).
export async function deleteTicket(ticketId: string): Promise<{ id: string }> {
    const deleted = await db
        .delete(tickets)
        .where(eq(tickets.id, ticketId))
        .returning({ id: tickets.id });
    if (!deleted[0]) {
        throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${ticketId}' not found`, {
            details: { ticketId },
        });
    }
    return deleted[0];
}
```

Notes: reuse existing `db`, `tickets`, `eq`, `AppError`, `ErrorCode` imports. NO transaction (single delete; cascade is atomic). NO manual child cleanup — CASCADE handles `activityLogs` + `ticketLabels`. NO activity-log row.

Modify `backend/src/routes/tickets.routes.ts` — add the import + the route after the PATCH block:

```typescript
import { requireRole } from '../middleware/requireRole';
// ...
// F17 — admin-only delete. requireRole('ADMIN') is the security boundary;
// the FE hide is cosmetic. CASCADE removes activityLogs (F18) + ticketLabels (F14).
ticketsRouter.delete(
    '/:ticketId',
    authenticate,
    requireRole('ADMIN'),
    validateRequest({ params: ticketIdParam }),
    async (req, res) => {
        const { ticketId } = req.params as TicketIdParam;
        const removed = await ticketService.deleteTicket(ticketId);
        res.json(success(removed));
    },
);
```

Remove the `TODO(F17)` comment at `:11` (or update it to note membership-based perms are explicitly out of scope). The route does NOT thread `req.user` — `requireRole('ADMIN')` already proved the actor is admin.

Modify `backend/src/routes/tickets.routes.test.ts` — add `deleteTicket: vi.fn()` to the mock map + a `describe('DELETE /api/tickets/:ticketId', …)` suite mirroring `labels.routes.test.ts:255-284`:

```typescript
// add to vi.mock('../services/ticketService', () => ({ …, deleteTicket: vi.fn() }))
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

    it('returns 200 success({id}) for ADMIN and calls deleteTicket', async () => {
        mockedDeleteTicket.mockResolvedValueOnce({ id: VALID_TICKET_ID });
        const res = await request(app)
            .delete(`/api/tickets/${VALID_TICKET_ID}`)
            .set('Authorization', `Bearer ${tokenFor('ADMIN')}`);
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ id: VALID_TICKET_ID });
        expect(mockedDeleteTicket).toHaveBeenCalledWith(VALID_TICKET_ID);
    });

    it('returns 404 NOT_FOUND when deleteTicket throws NOT_FOUND', async () => {
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
- [ ] `deleteTicket(ticketId): Promise<{ id: string }>` exists in `ticketService.ts`; uses `db.delete(tickets).where(eq(...)).returning({ id })`; throws `AppError(ErrorCode.NOT_FOUND, …)` on miss.
- [ ] `DELETE /api/tickets/:ticketId` route registered with `authenticate → requireRole('ADMIN') → validateRequest({ params: ticketIdParam })`.
- [ ] Route returns `200 success({ id })`; relies on `requireRole` for 403 + `validateRequest` for 400.
- [ ] `tickets.routes.test.ts` adds `deleteTicket: vi.fn()` + a delete suite asserting 401 / 403-member (service NOT called) / 200-admin (service called with `ticketId`) / 404-missing / 400-bad-uuid.
- [ ] NO manual child-row cleanup in `deleteTicket` (FK CASCADE).
- [ ] NO `deletedAt`, NO `DELETED` enum, NO activity-log row.
- [ ] NO string-concatenated SQL (`db.delete(...).where(eq(...))` ORM only).
- [ ] `TODO(F17)` removed/updated.
- [ ] `rtk tsc` (BE) + `rtk vitest run` (BE) pass.

**Dependencies:** F16/F18/F06/F07 (DONE). Decisions D1, D2, D3, D4, D9.

---

### T2 — FE: `deleteTicket` api fn + `useDeleteTicket` mutation

**Batch:** 2 · **Depends on:** T1 · **Parallel with:** —

**Description:** The FE data layer. (1) Add `deleteTicket(ticketId)` to `frontend/src/api/tickets.ts`. (2) Add `useDeleteTicket` hook (`frontend/src/hooks/useDeleteTicket.ts`) following `useUpdateTicket.ts` but **invalidate-only** (no optimistic card removal — D7). `onError` surfaces `FORBIDDEN` for toast wiring.

Modify `frontend/src/api/tickets.ts` — append after `updateTicket`:

```typescript
// F17 T2: DELETE /tickets/:id — admin-only delete. apiFetch unwraps {data} → {id}.
export async function deleteTicket(ticketId: string): Promise<{ id: string }> {
    return apiFetch<{ id: string }>(`/tickets/${ticketId}`, {
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

// F17 T2: admin-only delete. INVALIDATE-ONLY (no optimistic board card removal):
// F10's 30s board poll + the invalidate-forced refetch reconcile the card removal.
export function useDeleteTicket() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (vars: DeleteTicketVariables) => deleteTicket(vars.ticketId),
        onSuccess: (_data, vars) => {
            queryClient.removeQueries({ queryKey: ticketKeys.detail(vars.ticketId) });
            queryClient.invalidateQueries({ queryKey: boardKeys.all });
        },
        onError: (error: unknown) => {
            // Surface the server's 403 if the role check failed (e.g. role changed
            // mid-session). The caller decides whether to toast.
            if (error instanceof ApiClientError && error.code === 'FORBIDDEN') {
                // surfaced via the returned mutation's .error
            }
        },
    });
}
```

Notes: `ApiClientError` (`frontend/src/api/client.ts:5-29`) exposes `.status` (403) + `.code` (`'FORBIDDEN'`). NO `onMutate`/optimistic board write (contrast `useUpdateTicket.ts:19-50` — deliberately NOT followed; D7). `removeQueries` (not invalidate) on the detail key — the ticket is gone. `DeleteTicketVariables` carries `slug` for the caller.

**Acceptance Criteria:**
- [ ] `deleteTicket(ticketId)` api fn exists; calls `apiFetch<{ id: string }>('/tickets/:id', { method: 'DELETE' })`.
- [ ] `useDeleteTicket` hook exists; `mutationFn` calls `deleteTicket`; `DeleteTicketVariables = { ticketId, slug }`.
- [ ] `onSuccess` does `removeQueries(ticketKeys.detail(ticketId))` + `invalidateQueries(boardKeys.all)` — NO optimistic board card removal.
- [ ] `onError` recognizes `ApiClientError` with `code === 'FORBIDDEN'`.
- [ ] No `any`; `import type` where appropriate.
- [ ] `rtk tsc` (FE) passes.

**Dependencies:** T1. Decisions D6, D7, D9.

---

### T3 — FE: `DeleteTicketConfirm` component + wire into `TicketDetailModal`

**Batch:** 3 · **Depends on:** T2 · **Parallel with:** —

**Description:** The UI. (1) Create `frontend/src/components/DeleteTicketConfirm.tsx` — a `<Modal>`-wrapped destructive confirm (mirrors `ConfirmDiscardDialog`'s structure). (2) Wire it into `TicketDetailModal.tsx`, replacing the `:121` seam: render a destructive "Delete ticket" button **only when `useRequireRole('ADMIN')`**; clicking opens the confirm; on confirm, call `useDeleteTicket().mutate`, then `onClose`.

Create `frontend/src/components/DeleteTicketConfirm.tsx`:

```tsx
import { Modal } from './Modal';

// F17 T3: destructive confirm shown before a hard ticket delete. Wraps the
// reusable Modal (useModalA11y → focus trap/Esc/scroll-lock/focus-restore).
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
                This permanently deletes the ticket, its activity history, and its label
                links. This cannot be undone.
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

Modify `frontend/src/components/TicketDetailModal.tsx` — replace the `:121` seam. Add imports + state + the button + the confirm dialog:

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

Notes: the delete button is gated by `isAdmin` — members never see it. The server `requireRole('ADMIN')` is the real gate. `mutateAsync` so `handleConfirmDelete` can `await` before `onClose` (so the modal doesn't close on a 403 without feedback). `DeleteTicketConfirm` renders as a sibling portal'd dialog (mirroring `ConfirmDiscardDialog`).

**Acceptance Criteria:**
- [ ] `DeleteTicketConfirm` exists; wraps `<Modal>` with `blockBackdropClose`; Cancel + destructive Delete buttons; `isDeleting` disables buttons.
- [ ] `TicketDetailModal` renders "Delete ticket" ONLY when `useRequireRole('ADMIN')` is true (member → button absent).
- [ ] Clicking opens `DeleteTicketConfirm`; Cancel closes; confirm calls `useDeleteTicket().mutate({ ticketId, slug })` then `onClose`.
- [ ] The `:121` seam comment is replaced by the live button.
- [ ] No `any`; no inline styles (Tailwind only).
- [ ] `rtk tsc` (FE) passes.

**Dependencies:** T2. Decisions D5, D6.

---

### T4 — FE tests: `useDeleteTicket` + `DeleteTicketConfirm` + `TicketDetailModal` admin/member gate

**Batch:** 4 · **Depends on:** T3 · **Parallel with:** —

**Description:** Co-located Vitest + Testing Library coverage. (1) `useDeleteTicket.test.ts` — success calls `deleteTicket` + invalidates `boardKeys.all` + removes `ticketKeys.detail`; surfaces a `FORBIDDEN` `ApiClientError` on 403. (2) `DeleteTicketConfirm.test.tsx` — renders, Cancel closes, Delete fires `onConfirm`, `isDeleting` disables. (3) Extend `TicketDetailModal.test.tsx` — admin renders the delete button + opens confirm on click; member does NOT render the button.

Create `frontend/src/hooks/useDeleteTicket.test.ts` (follow `useUpdateTicket.test.ts` mocking — mock `../api/tickets` + a `queryClient`):
- **Success:** `mutate({ ticketId, slug })` → `deleteTicket` called with `ticketId`; `queryClient.removeQueries` called with `ticketKeys.detail(ticketId)`; `queryClient.invalidateQueries` called with `boardKeys.all`.
- **403 FORBIDDEN:** mock `deleteTicket` to reject with `new ApiClientError('forbidden', 403, 'FORBIDDEN')`; assert the mutation surfaces the error.

Create `frontend/src/components/DeleteTicketConfirm.test.tsx`:
- Renders title "Delete ticket?" when `isOpen`.
- Cancel → `onCancel`; Delete → `onConfirm`.
- `isDeleting` → both buttons `disabled`, Delete shows "Deleting…".

Extend `frontend/src/components/TicketDetailModal.test.tsx` (mock `useRequireRole` + `useDeleteTicket` + `useQuery`):
- **ADMIN:** delete button in document; clicking opens the confirm dialog.
- **MEMBER:** delete button NOT in document.

**Acceptance Criteria:**
- [ ] `useDeleteTicket.test.ts` asserts success invalidation/removal + 403 `FORBIDDEN` surfacing.
- [ ] `DeleteTicketConfirm.test.tsx` asserts render + Cancel/Delete wiring + `isDeleting` disabled state.
- [ ] `TicketDetailModal` test asserts admin renders the button + member does not.
- [ ] Uses `getByRole`/`getByText` priority.
- [ ] Coverage of `useDeleteTicket.ts` + `DeleteTicketConfirm.tsx` > 80%.
- [ ] `rtk vitest run` (FE) passes.

**Dependencies:** T3.

---

### T5 — Integration verification & sign-off

**Batch:** 4 (terminal) · **Depends on:** all prior · **Parallel with:** —

**Description:** The final definition-of-done gate. Run every tool against the as-merged feature, fix gaps, record proof. Do NOT check the box — the owner does.

Steps:
1. **Typecheck:** `rtk tsc` (BE + FE) — zero new errors.
2. **Lint:** `rtk lint` — zero new violations.
3. **Format:** `rtk prettier --check` — zero unformatted files.
4. **Tests:** `rtk vitest run` (BE + FE) — all green. Coverage on `deleteTicket` + `useDeleteTicket` + `DeleteTicketConfirm` > 80%.
5. **Build:** FE `npm run build` succeeds; BE boots.
6. **No schema change:** confirm NO migration file added; `schema.ts` unchanged.
7. **Live smoke (manual):**
   - Start BE + FE locally.
   - **Admin deletes:** open a ticket detail modal as ADMIN → "Delete ticket" visible → click → confirm → card gone from board (refetch); `SELECT * FROM "ActivityLogs" WHERE ticket_id='<id>';` → 0 rows (cascade); `SELECT * FROM "TicketLabels" WHERE ticket_id='<id>';` → 0 rows (cascade); `SELECT * FROM "Tickets" WHERE id='<id>';` → 0 rows.
   - **Member cannot delete:** as MEMBER, open a ticket detail modal → "Delete ticket" absent. Craft a raw `curl -X DELETE -H "Authorization: Bearer <member-token>" /api/tickets/<id>` → `403 { error: { code: 'FORBIDDEN' } }`.
   - **Unauthenticated:** `curl -X DELETE /api/tickets/<id>` (no token) → `401`.
   - **Missing ticket:** `curl -X DELETE -H "Authorization: Bearer <admin-token>" /api/tickets/<random-uuid>` → `404 NOT_FOUND`.
   - **ticket_number not reused:** create a new ticket in the same project → its `ticket_number` is the NEXT counter value, NOT the deleted ticket's number.
8. **Record proof** in the integration record below.

**Acceptance Criteria:**
- [ ] `rtk tsc` BE + FE exit 0.
- [ ] `rtk lint` exit 0, no new violations.
- [ ] `rtk prettier --check` exit 0.
- [ ] `rtk vitest run` BE + FE exit 0; coverage > 80% on delete paths.
- [ ] FE build + BE boot succeed.
- [ ] NO migration file added; `schema.ts` unchanged.
- [ ] Live smoke: admin delete → card gone + activityLogs 0 + ticketLabels 0 + tickets 0; member → button hidden + crafted DELETE → 403; unauth → 401; missing → 404; ticket_number not reused.

**Dependencies:** all prior tasks merged.

---

## 7. Final F17 Acceptance Checklist

- [ ] `DELETE /api/tickets/:ticketId` returns `403 FORBIDDEN` for a non-admin (MEMBER); `200 success({ id })` for an ADMIN; `404 NOT_FOUND` for a missing ticket; `401` for an unauthenticated request.
- [ ] The permission check is **server-side** via `requireRole('ADMIN')` middleware; the FE `useRequireRole('ADMIN')` hide is cosmetic only.
- [ ] A confirmation dialog (`DeleteTicketConfirm`) is shown before the destructive delete executes.
- [ ] Deleting a ticket cascades its `ActivityLogs` (F18, `ON DELETE CASCADE`) and `TicketLabels` (F14, `ON DELETE CASCADE`) via FK.
- [ ] `ticket_number` is never reused (F12 `projectSequences` counter untouched).
- [ ] The delete button is rendered in `TicketDetailModal` only for admins (`useRequireRole('ADMIN')`).
- [ ] **Hard delete** (no `deletedAt`, no `DELETED` enum, no deletion audit row) — consistent with F18 cascade-by-design.
- [ ] `deleteTicket` uses ORM `db.delete(...).where(eq(...))` — no string-concat SQL.
- [ ] **`TimeEntries` cascade deferred to F20** (table absent); documented for F20's `ticketId` FK to be `ON DELETE CASCADE`.
- [ ] **Running-timer-on-delete deferred to F20** (no timer model exists).
- [ ] No new npm deps; no schema change; no migration.
- [ ] All tests pass (Vitest BE + FE); coverage on delete paths > 80%.
- [ ] Typecheck / lint / format / build all green.

**Integration record (fill during T5):**
- Feature commit SHA: `________`
- Admin DELETE response: `200 { data: { id: '<id>' } }` — `________`
- Member DELETE response: `403 { error: { code: 'FORBIDDEN' } }` — `________`
- Cascade confirmed (psql): activityLogs=`0` ticketLabels=`0` tickets=`0` — `________`
- Member UI: delete button `absent` — `________`
- ticket_number reuse check: new ticket number = `________` (NOT the deleted one)
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0`

---

## 8. Schema deltas owned by this feature

**F17 owns NONE.** Delete reuses existing tables + FK cascades — no schema change, no migration, no `schema.ts` edit.

| Table | F17 touches? | Why not |
| --- | --- | --- |
| `tickets` | DELETE rows only | `db.delete(tickets)` — no column change |
| `ActivityLogs` (F18) | cascade-removed | FK `ticketId → tickets` `ON DELETE CASCADE` (`schema.ts:205-207`) already ships |
| `TicketLabels` (F14) | cascade-removed | FK `ticketId → tickets` `ON DELETE CASCADE` (`schema.ts:173-178`) already ships |
| `projectSequences` (F12) | untouched | Per-project counter (FK→projects); `ticket_number` not freed by delete |
| `TimeEntries` (F20) | DOES NOT EXIST | F20 not built; cascade deferred — F20's `ticketId` FK MUST be `ON DELETE CASCADE` |

> **F20 contract (forward note):** when F20 adds the `TimeEntries` table, its `ticketId` FK MUST reference `tickets.id` with `ON DELETE CASCADE`. Otherwise a ticket delete with linked time entries will fail on a FK violation. F17's hard-delete path is otherwise F20-blind.

---

## 9. Cross-cutting decisions — owner sign-off needed

1. **Hard vs soft delete.** **Recommend HARD** — `db.delete(tickets)`; no `deletedAt`; no `DELETED` enum; no deletion audit row. Hard delete is consistent with F18's `activityLogs.ticketId` `ON DELETE CASCADE` by design (the audit trail is deleted with the ticket; soft-delete would orphan the cascade + require `WHERE deleted_at IS NULL` filtering across every read path with no PRD mandate — PRD §4). Precedent: `deleteLabel` (`labelService.ts:86-94`) hard-deletes identically.
2. **Dedicated `DeleteTicketConfirm` vs a generic `ConfirmDialog` primitive.** **Recommend DEDICATED** — mirrors `ConfirmDiscardDialog` (a focused sibling wrapping `<Modal>`). A generic `ConfirmDialog` primitive would be a nice cross-cutting refactor but is scope creep for F17.
3. **`TimeEntries` cascade deferred to F20.** **Confirm OUT of F17 scope.** The `TimeEntries` table does not exist (F20 not built). F17 ships hard-delete that cascades `activityLogs` + `ticketLabels` today; the time-entries cascade is F20's responsibility (its `ticketId` FK MUST be `ON DELETE CASCADE`). The running-timer-on-deleted-ticket edge case is wholly F20.
4. **Optimistic card removal vs invalidate-only on delete.** **Recommend INVALIDATE-ONLY** — `useDeleteTicket.onSuccess` does `removeQueries(ticketKeys.detail)` + `invalidateQueries(boardKeys.all)`. F10's 30s board poll + the invalidate-forced refetch reconcile the card removal. Optimistic removal adds rollback complexity for no UX gain. Contrast `useUpdateTicket.ts:19-50` (optimistic) — deliberately NOT followed here.
5. **DELETE response shape: `200 success({ id })` vs `204`.** **Recommend `200 success({ id })`** — matches `labels.routes.ts:58-66` + the project's consistent `{ data }` envelope convention.
6. **Toast-on-403 for a member who crafts a DELETE request.** **Recommend NICE-TO-HAVE / out of core scope.** A member never sees the delete button; a crafted 403 is an edge case. `useDeleteTicket.onError` surfaces the `FORBIDDEN` `ApiClientError` so a caller CAN toast, but F17 does not mandate a global 403 toast. The `TODO(F17)` note at `tickets.routes.ts:11` mentions "toast-on-deny" — confirm whether in or out of F17.

---

**Sources:**
- PRD REQ-3.3 ("Any authenticated user can create or edit tickets. Only `Admins` can delete tickets.").
- PRD REQ-1.3 (Admin: manage settings, delete tickets; Member: create/edit/move).
- PRD §4 (no complex RBAC beyond Admin/Member).
- PRD §8.3 (`TimeEntries.ticket_id` + `ActivityLogs.ticket_id` FK→Tickets; `ON DELETE` a design decision).
- Grounding evidence file:line citations: `backend/src/routes/tickets.routes.ts:2-7,11,15-27,34-88`; `backend/src/middleware/requireRole.ts:8-23`; `backend/src/middleware/auth.ts:9-43`; `backend/src/services/labelService.ts:86-94`; `backend/src/services/ticketService.ts:163-178`; `backend/src/db/schema.ts:22,108,162-164,173-178,201-208`; `backend/src/utils/envelope.ts:9,11,22,28`; `backend/src/routes/labels.routes.ts:58-66`; `backend/src/routes/labels.routes.test.ts:255-284`; `backend/src/index.ts:54`; `frontend/src/components/TicketDetailModal.tsx:21-26,121`; `frontend/src/hooks/useRequireRole.ts:6-11`; `frontend/src/stores/useAuthStore.ts:11`; `frontend/src/hooks/useUpdateTicket.ts:14-73`; `frontend/src/api/queryKeys.ts:7-14`; `frontend/src/api/tickets.ts:36-49`; `frontend/src/api/client.ts:5-29`; `frontend/src/components/Modal.tsx`; `frontend/src/components/ConfirmDiscardDialog.tsx`.
- Project rules: `.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`.
