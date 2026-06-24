# F26 — Board search & filter: Plan + Task Breakdown

> **Feature:** F26 — Board search & filter (Phase 7 — Admin & Polish)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F13 (DONE ✅), F14 (DONE ✅) · **PRD ref:** User Journey 1 (implied usability)
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), project rules (`.claude/rules/`)

---

## 1. F26 Recap

**Goal:** Find tickets fast on growing boards.

**Ships:** Filter board by assignee, priority, label; free-text search over title. Filters combine (assignee + priority + label). Search matches ticket title (and ID). Cleared filters restore full board.

**Acceptance (definition of done):**
- Filters combine (assignee + priority + label).
- Search matches ticket title (and display ID `SLUG-NNN`).
- Cleared filters restore full board.
- Filtering + polling interplay (don't lose active filters on refetch).

**Edge cases:**
- Empty result state.
- **DECISION: client-side filtering** (the board is already fully loaded via `getBoard`; no server round-trip needed). The board payload (F09) carries all tickets per project. Client-side filtering over the cached board is instant + avoids a new endpoint. Document.
- Filtering + polling interplay: filters are **UI state** (useState/Zustand), independent from the server data (TanStack Query). Polling refetches the board → the filtered view recomputes from the fresh data. No lost filters. Document.

---

## 2. Codebase Analysis Summary

- **State:** F09 (DONE ✅) ships `getBoard` (full board payload: columns + tickets with title, priority, assignee, labels). F13 (DONE ✅) ships priority enum. F14 (DONE ✅) ships labels. The board is fully client-side after the initial fetch + 30s poll (F10).
- **Existing structure (citations):**
  - `useBoard` hook (`frontend/src/hooks/useBoard.ts`) — `useQuery(boardKeys.detail(slug))` fetching the full board. Returns `BoardPayload` with `columns[].tickets[]`.
  - `BoardPage.tsx` — renders columns via `board.columns.map(...)`. The ticket data is all client-side.
  - `Ticket` type (`types/ticket.ts`) — has `title`, `ticketNumber`, `priority`, `assignee`, `labels`. All the fields F26 filters on.
  - `TicketCard.tsx` — renders the card (title, ID, priority, labels, assignee).
  - `useBoardUiStore` (`stores/useBoardUiStore.ts`) — existing Zustand store for board UI state (drag-in-progress). F26 extends with filter state.
- **Files F26 creates:** `frontend/src/components/BoardFilters.tsx` (the filter/search bar UI).
- **Files F26 modifies:** `frontend/src/stores/useBoardUiStore.ts` (add filter state), `frontend/src/pages/BoardPage.tsx` (apply filters to columns before rendering), `frontend/src/components/BoardColumn.tsx` (receive filtered tickets).
- **Schema delta: NONE.** Pure FE — no new endpoint, no schema change.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Client-side filtering | Filters apply to the cached board payload (no server round-trip). | Board is fully loaded (F09 `getBoard` returns all tickets). Client-side = instant + no new endpoint. Spec edge case: "server-side vs client-side — decide based on board size." Board is small (F09 soft cap 200 tickets); client-side is correct. |
| D2 | Filter state location | `useBoardUiStore` (Zustand) — existing board UI store. | Rules: "Zustand for client/global UI state." `useBoardUiStore` already exists for drag state; add filter fields. |
| D3 | Search scope | Title (substring, case-insensitive) + display ID (`SLUG-NNN` format). | Spec: "Search matches ticket title (and ID)." |
| D4 | Polling interplay | Filters are UI state (Zustand), independent from server data (TanStack Query). Poll refetches → filtered view recomputes. No lost filters. | Spec edge case: "don't lose active filters on refetch." |
| D5 | Empty state | "No tickets match your filters." + a "Clear filters" button. | Spec: "Empty result state." |
| D6 | No schema/migration | Pure FE. | No new endpoint, no schema change. |

---

## 4. Architecture Overview

```
frontend/src/stores/useBoardUiStore.ts    # MODIFY — add search + filter fields
frontend/src/components/BoardFilters.tsx    # NEW — search input + assignee/priority/label dropdowns
frontend/src/pages/BoardPage.tsx           # MODIFY — apply filters before rendering columns
frontend/src/components/BoardColumn.tsx     # MODIFY — receive filtered tickets (or BoardPage filters inline)
```

---

## 5. Tasks

### T1 — Filter state + BoardFilters component + BoardPage wiring

**Batch:** 1 · **Depends on:** F13/F14 (DONE)

**Description:**
1. Extend `useBoardUiStore` with filter state:
   ```typescript
   searchQuery: string;
   assigneeFilter: string | null;  // userId or null = all
   priorityFilter: Priority | null;  // null = all
   labelFilter: string | null;  // label id or null = all
   setSearchQuery, setAssigneeFilter, setPriorityFilter, setLabelFilter, clearFilters
   ```
2. Create `BoardFilters.tsx` — a bar above the board:
   - Search text input (bound to `searchQuery`).
   - Assignee dropdown (populated from the board's tickets' distinct assignees).
   - Priority dropdown (LOW/MEDIUM/HIGH/URGENT/CRITICAL).
   - Label dropdown (populated from the board's distinct labels).
   - "Clear" button (resets all filters).
3. In `BoardPage.tsx`, before rendering columns, **filter the board's tickets**:
   ```typescript
   const filteredBoard = useMemo(() => {
       if (!board) return board;
       const { searchQuery, assigneeFilter, priorityFilter, labelFilter } = useBoardUiStore.getState();
       const hasFilters = searchQuery || assigneeFilter || priorityFilter || labelFilter;
       if (!hasFilters) return board;
       const matches = (ticket: Ticket) => {
           if (searchQuery) {
               const q = searchQuery.toLowerCase();
               const id = `${slug}-${String(ticket.ticketNumber).padStart(3, '0')}`;
               if (!ticket.title.toLowerCase().includes(q) && !id.toLowerCase().includes(q)) return false;
           }
           if (assigneeFilter && ticket.assignee?.id !== assigneeFilter) return false;
           if (priorityFilter && ticket.priority !== priorityFilter) return false;
           if (labelFilter && !ticket.labels.some(l => l.id === labelFilter)) return false;
           return true;
       };
       return { ...board, columns: board.columns.map(col => ({ ...col, tickets: col.tickets.filter(matches) })) };
   }, [board, searchQuery, assigneeFilter, priorityFilter, labelFilter]);
   ```
   Render `<BoardFilters />` above the `DragDropContext`, then use `filteredBoard` instead of `board` for the column rendering.

**Acceptance:**
- [ ] Search filters by title + display ID (case-insensitive).
- [ ] Assignee/priority/label filters combine (AND).
- [ ] Clear button restores the full board.
- [ ] Filters survive a 30s poll refetch.
- [ ] Empty result state shown.
- [ ] `rtk tsc` (FE) passes.

### T2 — Verification

Typecheck/lint/format/test/build. Live smoke: type a search → board filters → clear → full board. Combine assignee + priority → fewer results. Wait 30s → poll refetches → filters still active.

---

## 6. Final F26 Acceptance Checklist

- [ ] Filters combine (assignee + priority + label).
- [ ] Search matches ticket title + display ID.
- [ ] Cleared filters restore full board.
- [ ] Filters survive polling refetch.
- [ ] Empty result state.
- [ ] No schema/migration (pure FE).
- [ ] All tests pass; typecheck/lint/format/build green.

---

## 7. Schema deltas owned by this feature

**F26 owns NONE.** Pure frontend — no new endpoint, no schema change.

---

## 8. Cross-cutting decisions — CONFIRMED (owner-approved 2026-06-25)

1. **Client-side filtering.** Board is fully loaded; no server round-trip. CONFIRMED.
2. **Filter state in useBoardUiStore (Zustand).** Survives polling. CONFIRMED.
3. **Search = title + display ID (substring, case-insensitive).** CONFIRMED.
4. **No schema/migration.** CONFIRMED.

---

**Sources:**
- PRD User Journey 1 (implied usability — finding tickets on a growing board).
- F09 task doc (board payload — full ticket set client-side).
- F13/F14 (priority enum + labels catalog — filter options source).
- Grounding: `frontend/src/hooks/useBoard.ts`; `frontend/src/pages/BoardPage.tsx`; `frontend/src/stores/useBoardUiStore.ts`; `frontend/src/types/ticket.ts`.
- Project rules: `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`.
