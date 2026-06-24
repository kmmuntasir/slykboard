# F26 — Board search & filter: Plan + Task Breakdown

> **Feature:** F26 — Board search & filter (Phase 7 — Admin & Polish)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F13 (DONE ✅), F14 (DONE ✅) · **PRD ref:** User Journey 1 (implied usability)
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), project rules (`.claude/rules/`)

---

## 1. F26 Recap

**Goal:** Find tickets fast on growing boards.

**Ships:** Server-side filtered board via query params on `GET /api/projects/:slug/board`. Search by title (ILIKE) + ticket_number (integer match). Filters: assignee (userId), priority (enum), label (labelId) — selectable individually or combined. Empty result state + Clear button.

**Acceptance (definition of done):**
- Filters combine (assignee + priority + label).
- Search matches ticket title (ILIKE) + ticket_number.
- Cleared filters restore full board.
- Filtering + polling interplay (don't lose active filters on refetch).

**Edge cases:**
- Empty result state.
- **DECISION: SERVER-SIDE filtering.** `GET /api/projects/:slug/board?search=...&assignee=...&priority=...&label=...` filters at the DB query level. Large page size (owner: "set page size to a really big number — modern hardware handles it"). Board is NOT fully client-side loaded when filters are active; the server returns only matching tickets.
- Filtering + polling interplay: filters are **UI state** (useBoardUiStore Zustand), passed as query params to `useBoard`. Poll refetches WITH the current filter params → filters preserved. No lost filters.

---

## 2. Codebase Analysis Summary

- **State:** F09 (DONE ✅) ships `boardService.getBoard(slug)` + the board route. F13/F14 ship priority + labels. The board payload carries all tickets per project; F26 extends `getBoard` to accept filter params.
- **Existing structure (citations):**
  - `boardService.getBoard(slug)` (`boardService.ts:50-157`) — queries tickets WHERE `projectId` + `isNull(deletedAt)`, groups by column. F26 adds optional `search`/`assignee`/`priority`/`label` WHERE clauses to the same query.
  - `projects.routes.ts:39-48` — `GET /:slug/board` → `boardService.getBoard(slug)`. F26 parses `req.query` filter params + passes them.
  - `useBoard` hook (`useBoard.ts`) — `useQuery(boardKeys.detail(slug))`. F26 extends the query key + queryFn to include filter params.
  - `useBoardUiStore` (`stores/useBoardUiStore.ts`) — Zustand for drag state. F26 adds filter fields.
  - `Ticket` type (`types/ticket.ts`) — has `title`, `ticketNumber`, `priority`, `assignee`, `labels`.
  - `labelService` (`labelService.ts`) — `listLabels(slug)` for the label dropdown options.
  - `userService` (`userService.ts`) — `listUsers()` for the assignee dropdown options.
- **Files F26 modifies:** `backend/src/services/boardService.ts`, `backend/src/routes/projects.routes.ts`, `frontend/src/stores/useBoardUiStore.ts`, `frontend/src/hooks/useBoard.ts`, `frontend/src/pages/BoardPage.tsx`.
- **Files F26 creates:** `frontend/src/components/BoardFilters.tsx`.
- **Schema delta: NONE.** Server-side query filtering; no new tables/columns.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Server-side filtering | **`getBoard(slug, filters?)` accepts `{ search?, assignee?, priority?, label? }`** — applies WHERE clauses at the DB level. Large page size (no pagination for MVP — owner confirmed). | Owner override: "Pure client side filtering is not a good idea. Board should be lazy-loaded or paginated." Server-side is correct; large page size works on modern hardware. |
| D2 | Search scope | **Title (ILIKE %search%) + ticket_number (exact integer match).** If search is numeric → match `ticket_number`; else ILIKE title. | Owner: "search with title and ticket number." |
| D3 | Filter state location | `useBoardUiStore` (Zustand) — existing board UI store. | Rules: Zustand for UI state. Filters passed to `useBoard` as query params. |
| D4 | Polling interplay | Filters in Zustand → `useBoard` reads them into the queryKey + queryFn. Poll (30s) refetches WITH current filters → preserved. | Spec: "don't lose active filters on refetch." |
| D5 | Empty state | "No tickets match." + Clear button. | Spec. |
| D6 | No schema/migration | Server-side query filter; no new endpoint (extends existing `getBoard`). | No schema change. |

---

## 4. Architecture Overview

```
backend/src/services/boardService.ts        # MODIFY — getBoard accepts filter params (search/assignee/priority/label WHERE clauses)
backend/src/routes/projects.routes.ts      # MODIFY — parse req.query filter params + pass to boardService
frontend/src/stores/useBoardUiStore.ts     # MODIFY — add searchQuery + assigneeFilter + priorityFilter + labelFilter + clearFilters
frontend/src/hooks/useBoard.ts             # MODIFY — read filter state into queryKey + queryFn params
frontend/src/components/BoardFilters.tsx    # NEW — search input + 3 dropdowns + Clear button
frontend/src/pages/BoardPage.tsx           # MODIFY — render BoardFilters above columns
```

---

## 5. Tasks

### T1 — BE + FE: server-side board filtering + BoardFilters UI + wiring

**Batch:** 1 · **Depends on:** F13/F14 (DONE)

**Description:**
1. **`backend/src/services/boardService.ts`** — READ first. Extend `getBoard` to accept optional filters:
   ```typescript
   export async function getBoard(slug: string, filters?: {
     search?: string; assignee?: string; priority?: string; label?: string;
   }): Promise<BoardPayload>
   ```
   In the tickets query (currently `where(and(eq(projectId), isNull(deletedAt))`), add filter conditions when present:
   - `search` → if numeric: `eq(tickets.ticketNumber, parseInt(search))`; else: `ilike(tickets.title, '%search%')`. Combine with OR.
   - `assignee` → `eq(tickets.assigneeId, assignee)`.
   - `priority` → `eq(tickets.priority, priority)`.
   - `label` → subquery: ticket IDs in `ticketLabels WHERE labelId = label`. Use `inArray(tickets.id, subquery)` or a join.
   Import `ilike, or, inArray` from drizzle-orm as needed.

2. **`backend/src/routes/projects.routes.ts`** — READ first. Parse query params:
   ```typescript
   const filters = {
     search: req.query.search as string | undefined,
     assignee: req.query.assignee as string | undefined,
     priority: req.query.priority as string | undefined,
     label: req.query.label as string | undefined,
   };
   const board = await boardService.getBoard(slug, filters);
   ```

3. **`frontend/src/stores/useBoardUiStore.ts`** — add filter fields: `searchQuery: string`, `assigneeFilter: string | null`, `priorityFilter: string | null`, `labelFilter: string | null` + setters + `clearFilters`.

4. **`frontend/src/hooks/useBoard.ts`** — READ first. Read filter state from `useBoardUiStore` + include in the `queryKey` + pass as query params to the `fetchBoard` call (so TanStack refetches when filters change). The FE API client `fetchBoard(slug, params)` sends `?search=...&assignee=...&priority=...&label=...`.

5. **`frontend/src/components/BoardFilters.tsx`** (NEW) — a bar above the board:
   - Search text input (bound to `searchQuery` in the store).
   - Assignee dropdown (options from `GET /api/users` — existing `listUsers`).
   - Priority dropdown (LOW/MEDIUM/HIGH/URGENT/CRITICAL).
   - Label dropdown (options from `GET /api/projects/:slug/labels` — existing `listLabels`).
   - "Clear" button (resets all filters to empty/null).
   - Each filter selectable individually.

6. **`frontend/src/pages/BoardPage.tsx`** — render `<BoardFilters />` above the `DragDropContext`. The board data is already filtered server-side (useBoard passes the params); no client-side post-filtering.

**Acceptance:**
- [ ] `getBoard` accepts filter params + applies WHERE clauses server-side.
- [ ] Search matches title (ILIKE) + ticket_number (integer).
- [ ] Filters combine (assignee + priority + label — AND).
- [ ] Each filter selectable individually.
- [ ] Clear button restores full board.
- [ ] Filters survive 30s poll (queryKey includes filter params).
- [ ] Empty result state.
- [ ] `rtk tsc` (BE + FE) passes.

### T2 — Verification

Typecheck/lint/format/test/build. Live smoke: type a search → board refetches filtered → clear → full board. Select assignee → fewer results. Combine assignee + priority → narrower. Wait 30s → poll refetches with same filters.

---

## 6. Final F26 Acceptance Checklist

- [ ] Filters combine (assignee + priority + label).
- [ ] Search matches ticket title + ticket_number.
- [ ] Cleared filters restore full board.
- [ ] Filters survive polling refetch.
- [ ] Empty result state.
- [ ] Server-side filtering (no client-side post-filtering).
- [ ] No schema/migration.
- [ ] All tests pass; typecheck/lint/format/build green.

---

## 7. Schema deltas owned by this feature

**F26 owns NONE.** Server-side query filtering; no new tables/columns.

---

## 8. Cross-cutting decisions — CONFIRMED (owner-approved 2026-06-25)

1. **Server-side filtering.** `getBoard` accepts filter params + applies WHERE clauses. Large page size. CONFIRMED (owner override).
2. **Search = title ILIKE + ticket_number integer match.** CONFIRMED.
3. **Filters individually selectable (assignee, priority, label).** CONFIRMED.
4. **No schema/migration.** CONFIRMED.

---

**Sources:**
- PRD User Journey 1 (implied usability — finding tickets on a growing board).
- F09 task doc (board payload + getBoard query).
- F13/F14 (priority enum + labels catalog).
- Grounding: `backend/src/services/boardService.ts:50-157`; `backend/src/routes/projects.routes.ts:39-48`; `frontend/src/hooks/useBoard.ts`; `frontend/src/stores/useBoardUiStore.ts`; `frontend/src/pages/BoardPage.tsx`.
- Project rules: `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`.
