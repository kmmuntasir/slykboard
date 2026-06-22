# F11 — Drag-and-drop with order persistence: Plan + Task Breakdown

> **Feature:** F11 — Drag-and-drop with order persistence (Phase 2 — Board)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F09 (DONE ✅) · **PRD ref:** REQ-2.3, §5
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), the project rules discovered for this repo (`.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`), plus dependency feature task docs: [F09](../F09-board-read-columns-cards/F09-board-read-columns-cards-tasks.md), [F10](../F10-board-auto-polling/F10-board-auto-polling-tasks.md)

---

## 1. F11 Recap

**Goal:** Reorder cards within a column and move them across columns; positions persist.

**Ships:** `@hello-pangea/dnd` drag — vertical within a column, horizontal across columns; on drop, the moved ticket's new `statusColumn` + `position` persist via a backend endpoint; the UI updates optimistically and rolls back on failure.

**Acceptance (definition of done):**
- Moving a card calls an endpoint that updates `status_column` + position atomically (single transaction).
- Reordering within a column updates neighbor positions without full rewrites where possible (midpoint insertion = 1 row/drop typically; rebalance only on precision exhaustion).
- Drag is smooth (optimistic) and rolls back on failure (`onError` restores the prior board snapshot).

**Edge cases to resolve up front:**
- **PRD schema has no `position`/`sort_order` field on `Tickets`** → **Decision:** PRE-SATISFIED by F09. `Tickets.position: doublePrecision(...).notNull().default(0)` shipped in `backend/src/db/schema.ts:88` + migration `0004_dazzling_mariko_yashida.sql`. F11 adds NO migration, NO new column. Read path already `ORDER BY position ASC` (`boardService.ts:77`). F11 owns the reorder WRITE endpoint + UI only.
- **Concurrent reorders can collide** → **Decision:** last-write-wins, no ETag/If-Match (MVP). On persist error, `onError` rolls back the optimistic update; `onSettled` invalidates `boardKeys.all`; the next 30s poll reconciles. **Owner question Q4** — confirm LWW acceptable.
- **Dropping into a column the user lacks permission for** → **Decision:** NOT BUILT in F11. Membership / per-column permissions are F17/F25 scope. F11 wires `authenticate` only and leaves an explicit `TODO(F17)` seam + no per-column denial path. **Owner question Q3** (unsorted drag direction is the adjacent decision).
- **Moving the only card out of a column → column stays** → **Decision:** Columns are project config (`projects.columns` JSONB, set by F08), never derived from or collapsed by tickets. An empty column renders with `tickets: []` and remains a `<Droppable>`. No special handling required — confirmed by `boardService.ts:114-143` which always emits every configured column.
- **Unsorted bucket drag direction** → **Owner question Q3:** confirm unsorted is drag-OUT-only (cards render `<Draggable>` so they can be rescued into a real column; the unsorted `<Droppable>` passes `isDropDisabled` so nothing can be dropped INTO it).
- **Generic ticket-patch route ownership** → **Owner question Q1:** confirm F11 may create `PATCH /api/tickets/:ticketId` (generic, extensible) rather than a scoped `POST /api/tickets/:ticketId/move`. F13 widens the Zod schema later.

---

## 2. Codebase Analysis Summary

- **State:** Backend greenfield for ticket mutations; frontend greenfield for DnD. Both deps (F09, F10) satisfied in code. The `position` column, read-side sort, `dragInProgress` polling seam, query keys, and API client envelope all exist and are locked.
- **Existing structure this feature builds on:**
    - **Backend:** Express 5 router layering (`backend/src/routes/projects.routes.ts:48-62` — `router.METHOD('/', authenticate, [requireRole,] validateRequest, handler)`); Drizzle ORM over `pg.Pool` singleton (`backend/src/db/client.ts:13-25`, `export const db`); services query `db` directly — NO repository layer (`projectService.ts:59-68`, `boardService.ts:57-77`); `success`/`AppError`/`ErrorCode` envelope (`backend/src/utils/envelope.ts`); `validateRequest` factory (`backend/src/middleware/validateRequest.ts:33-66`); `slugParamSchema` pattern (`backend/src/routes/projects.schema.ts`); `authenticate` MW setting `req.user={id,email,role}` (`backend/src/middleware/auth.ts:9-43`); `requireRole` MW (`backend/src/middleware/requireRole.ts`); routers mounted at `backend/src/index.ts:48-50` under `/api`. **Tickets schema:** `backend/src/db/schema.ts:79-101` — `id uuid PK :80`, `projectId uuid FK→projects :81-83`, `ticketNumber int :84`, `title :85`, `description :86`, `statusColumn text :87` (text Column.id, NO FK — integrity read-time), **`position: doublePrecision('position').notNull().default(0) :88`** (schema comment :78 literally reads "F11 will write-reorder"; `doublePrecision` chosen for fractional midpoints), `priority :93`, `labels :95`, timestamps `:96-100`. `projects.columns` JSONB shape `[{id,name}]`.
    - **Frontend:** Board render `frontend/src/pages/BoardPage.tsx:7-67` — horizontal flex of columns at `:45-64`; `isUnsorted` branch → `<UnsortedBucket>` else `<BoardColumn>`. `BoardColumn` (`frontend/src/components/BoardColumn.tsx:15-44`) — root `<section data-column-id={id} aria-label>`; ticket list is `<ul>` of `<li key={ticket.id}><TicketCard/></li>` at `:34-40`; props `{ id; name; tickets: Ticket[]; projectSlug; isUnsorted? }` (`isUnsorted` currently destructured-out/unused). `TicketCard` (`frontend/src/components/TicketCard.tsx:10-39`) — root `<article aria-label>`; props `{ ticket: Ticket; projectSlug }`. `UnsortedBucket` (`frontend/src/components/UnsortedBucket.tsx`) — thin wrapper over `<BoardColumn isUnsorted>`. `useBoard` (`frontend/src/hooks/useBoard.ts:11-20`) — `useQuery({ queryKey: boardKeys.detail(slug), queryFn: ()=>fetchBoard(slug!), enabled: !!slug, refetchInterval: ()=>useBoardUiStore.getState().dragInProgress?false:POLL_INTERVAL_MS, refetchIntervalInBackground:false })`. **F10 drag seam (DONE):** `frontend/src/stores/useBoardUiStore.ts:1-14` — `{ dragInProgress, setDragInProgress }`; store comment `:3-5` names F11 as consumer wiring `onDragStart`/`onDragEnd`; test contract codified at `frontend/src/hooks/useBoard.test.tsx:193-202` (onDragEnd must `setDragInProgress(false)` to resume polling). Mutation precedent (only one in repo): `useCreateProject` (`frontend/src/hooks/useProjects.ts:21-29`) — **NO optimistic precedent exists** (`onMutate`/`setQueryData`/`cancelQueries` grep empty); F11 establishes the canonical optimistic pattern. Query keys locked by F10 (`frontend/src/api/queryKeys.ts:7-10`): `boardKeys.all=['boards']`, `boardKeys.detail(slug)=['boards','detail',slug]`. API client `apiFetch<T>` (`frontend/src/api/client.ts:45-131`) — Bearer from `useAuthStore`, `Accept`/`Content-Type`, unwraps `{data}` `:121-130`, throws `ApiClientError{status,code,details}` `:105-129`, 401 coalesced-refresh interceptor `:76-103`; sibling call shape `frontend/src/api/projects.ts:12-17` (`apiFetch(path,{method,body:JSON.stringify(dto)})`). Types: `BoardPayload` (`frontend/src/types/board.ts:9-19`, mirrored `boardService.ts:43-46`); `Ticket` (`frontend/src/types/ticket.ts:21-33`) — **`position:number` already in FE type**; `UNSORTED_BUCKET_ID='__unsorted__'` (`frontend/src/types/board.ts:7` + `boardService.ts:10` — MUST match).
- **Prior art / partial work:** F09 (DONE, 205 BE + 117 FE tests, DB smoke 2026-06-23) ships the board read path + schema + migration. F10 `[~]` PARTIAL — T1-T4 ✅, T5 automated ✅ (129 tests); only live browser smoke is manual/deferred and does NOT block F11. The `dragInProgress` seam is fully implemented in code today.
- **File paths the plan references that do NOT exist yet (will be created):**
    - `backend/src/routes/tickets.schema.ts`
    - `backend/src/routes/tickets.routes.ts`
    - `backend/src/routes/tickets.routes.test.ts`
    - `backend/src/services/ticketService.ts`
    - `backend/src/services/ticketService.test.ts`
    - `frontend/src/utils/boardReorder.ts`
    - `frontend/src/utils/boardReorder.test.ts`
    - `frontend/src/api/tickets.ts`
    - `frontend/src/hooks/useMoveTicket.ts`
    - `frontend/src/hooks/useMoveTicket.test.ts`
- **File paths this plan CHANGES:**
    - `backend/src/index.ts` (mount `ticketsRouter`)
    - `frontend/package.json` (add `@hello-pangea/dnd@^18`)
    - `frontend/src/components/TicketCard.tsx` (wrap in `<Draggable>`)
    - `frontend/src/components/BoardColumn.tsx` (wrap `<ul>` in `<Droppable>`)
    - `frontend/src/components/UnsortedBucket.tsx` (drag-OUT-only semantics)
    - `frontend/src/pages/BoardPage.tsx` (`<DragDropContext>` + `onDragStart`/`onDragEnd`)
- **Project rules this plan must satisfy:** `.claude/rules/git-guidelines.md` (branch `type/SLYK-TICKET-desc`, single-line commit `SLYK-TICKET: msg`, rebase-only, slug SLYK, sacred rule: never git without explicit approval); `.claude/rules/js-development-rules.md` (React Query server state + Zustand UI + useState local; RESTful JSON envelope; auth MW; Zod at edge; parameterized queries; permission MW for roles; Vercel/Render deploy); `.claude/rules/js-style-guide.md` (Prettier; 100 chars; 4-space JSX / 2-space JS; trailing commas; PascalCase components, camelCase hooks/vars, SCREAMING_SNAKE_CASE constants; explicit prop interfaces; import order external→internal→type→relative; no `any`/`console.log`/inline-styles/magic-numbers/prop-drilling); `.claude/rules/js-testing-rules.md` (Vitest; co-located `*.test.ts`; table-driven preferred; `vi.fn()`; RTL priority `getByRole`>`getByLabelText`>`getByText`>`getByTestId`; coverage business logic >80%, components >70%).
- **Hidden coupling to plan for:**
    - `statusColumn` stores Column **id** (text), NOT name — move endpoint validates id against `projects.columns` JSONB, never a column name.
    - `UNSORTED_BUCKET_ID='__unsorted__'` is a sentinel shared FE+BE; the move endpoint must REJECT it as an invalid `statusColumn` (you cannot persist a card into the unsorted sentinel — it only exists for orphan display).
    - `doublePrecision` midpoint precision exhausts after ~50 mid-inserts between the same neighbors → rebalance branch is mandatory, not optional.
    - `refetchInterval` returning `false` DEFERS (not discards) the next poll; drag-end poll-resume needs a re-render (satisfied by the `setDragInProgress(false)` state change) — do NOT assume an instant poll at drag-end.
    - `@hello-pangea/dnd@18` declares React 18 as peer; React 19 works (maintainer commit + community confirm) but install needs `--legacy-peer-deps` or an npm `overrides` entry.
    - jsdom cannot drive pangea's pointer sensor — DnD interaction is tested via pure `onDragEnd` + reducer functions (table-driven), NOT RTL pointer simulation.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Position strategy | **Keep existing `doublePrecision` column + midpoint insertion + per-column rebalance.** Constants `POSITION_GAP=65536`, `POSITION_EPSILON=1e-6`. New `position` = midpoint of new neighbors `(prev+next)/2`; prepend `first-GAP`; append `last+GAP`; into-empty `0`. Typical drop = 1 row updated. Rebalance column ONLY when `next.position-prev.position < EPSILON` → re-assign `index*GAP` in one txn. | Column already shipped by F09 (`schema.ts:88`, migration 0004); read path already sorts ASC (`boardService.ts:77`). NO migration. Research: float midpoint = 1 row/drop with bounded precision exhaustion covered by rebalance (LexoRanks, Steve Ruiz fractional-indexing, hollos.dev). Rejected: integer-gap migration (no MVP gain), linked-list (bad ORDER BY), full-array rewrite (amplifies LWW contention under 30s polling). |
| D2 | Move endpoint shape | **`PATCH /api/tickets/:ticketId` body `{ statusColumn: string, position: number }`.** Single Drizzle transaction updates both fields atomically. `ticketId` = uuid path param. Service validates `statusColumn` is a real Column.id in the ticket's project (reject `UNSORTED_BUCKET_ID`). | Atomicity acceptance criterion. Uses stable ticket uuid (future-proof vs F12 historical-id edge). Generic PATCH is RESTful + extensible — F13 widens the Zod schema for title/description/assignee/priority. **Owner Q1.** |
| D3 | Authorization | **`authenticate` only.** Any authenticated user may move. NO `requireRole`. Explicit `TODO(F17)` seam for future per-column permission check + toast-on-deny. | `accessControl.ts` exists but unused for moves; PRD has no move-permission rule; PRD says any member creates/edits tickets. Membership + per-column permissions are F17/F25. **Owner Q2.** |
| D4 | Unsorted bucket direction | **Cards Draggable OUT; bucket `isDropDisabled` IN.** Orphan cards in `UNSORTED_BUCKET_ID` render as `<Draggable>` so a user can rescue them into a real column (sets `statusColumn` to a real Column.id). The unsorted `<Droppable>` passes `isDropDisabled` so nothing drops INTO it. | Resolves "moving only card out → column stays" (columns are project config, never ticket-derived). Prevents deliberately orphaning a card. **Owner Q3.** |
| D5 | Drag/poll seam wiring | **`onDragStart` → `setDragInProgress(true)`. `onDragEnd` → compute move, fire `mutate`, THEN `setDragInProgress(false)`.** Order: kick off persist first, then release the poll-pause; `onSettled` invalidate + resumed `refetchInterval` reconcile. | Contract enforced by `useBoard.test.tsx:193-202`. F10 seam (`useBoardUiStore.ts:1-14`) is fully implemented. |
| D6 | Optimistic update pattern | **Canonical TanStack v5.** `useMoveTicket` `useMutation` against `boardKeys.detail(slug)`: `onMutate` = `await cancelQueries({boardKeys.all})` → snapshot `getQueryData(boardKeys.detail(slug))` → `setQueryData(applyMoveToBoard(...))`; return `{previousBoard}`. `onError` = `setQueryData(previousBoard)`. `onSettled` = `invalidateQueries({boardKeys.all})`. | TanStack Query v5 optimistic-updates docs (Context7 `/tanstack/query`). Repo's FIRST optimistic mutation — sets the precedent. F10 forward-contract documented this exact shape. |
| D7 | Conflict policy | **Last-write-wins, no ETag/If-Match (MVP).** Persist error → `onError` rollback + `onSettled` invalidate → board re-reads → next 30s poll reconciles. | F10 D5; PRD §4 rules out WebSocket/ETag for MVP. Per-ticket `updatedAt` is the only versioning signal (no `project.updatedAt`). **Owner Q4.** |
| D8 | Dependency install | **Add `@hello-pangea/dnd@^18`.** React 19 peer mismatch → install via `--legacy-peer-deps` OR npm `overrides` pinning react/react-dom (document chosen mechanism in task notes). Keep `<StrictMode>` (pangea fork fixes the rbd StrictMode breakage). | `@hello-pangea/dnd` v18.0.1 latest; maintainer commit "add support for react v19" + Discussion #810 confirm React 19 works. Sources: Context7 `/hello-pangea/dnd`, pangea Issue #864. |
| D9 | Schema delta | **NONE (PRE-SATISFIED by F09).** F11 adds NO migration, NO new column, NO unique constraint. | `Tickets.position` shipped in F09 (`schema.ts:88`, migration 0004). Optional `(projectId,statusColumn,position)` unique index is OUT of scope — position is non-unique by design to allow rebalance. |

> **Out of F11 scope (explicitly deferred):**
> - Per-column / membership-based move permissions + toast-on-deny → **F17** (and F25 per-column config).
> - Column reordering (dragging columns themselves) → future feature. F11 is CARD-only (`type="CARD"`; no `type="COLUMN"` droppable ⇒ columns immovable).
> - ETag / `If-Match` optimistic concurrency → explicitly deferred per PRD §4 (MVP = HTTP polling, LWW).
> - `(projectId,statusColumn,position)` unique index → OUT of scope (position non-unique by design).
> - Ticket title/description/assignee/priority edits → **F13** (widens the `PATCH /api/tickets/:ticketId` Zod schema F11 creates).

> **Owner sign-off needed (4 questions):**
> - **Q1 (route ownership):** Confirm F11 may create the generic `PATCH /api/tickets/:ticketId` and F13 extends its Zod schema (vs. F11 using a scoped `POST /api/tickets/:ticketId/move`). Recommend generic PATCH.
> - **Q2 (authz model):** Confirm "any authenticated user may move" acceptable until F17/F25 wire membership + per-column permissions.
> - **Q3 (unsorted direction):** Confirm unsorted bucket is drag-OUT-only (`isDropDisabled` IN).
> - **Q4 (LWW acceptable):** Confirm last-write-wins acceptable for concurrent reorders (reconciled on next 30s poll) and ETag escalation explicitly deferred.

---

## 4. Architecture Overview (Target Tree)

```
backend/
└── src/
    ├── db/
    │   └── schema.ts                      # EXISTING — position column already present (F09); F11 touches NOTHING here
    ├── services/
    │   ├── ticketService.ts               # NEW — moveTicket({ticketId,statusColumn,position}) Drizzle txn + rebalance
    │   └── ticketService.test.ts          # NEW — unit tests if logic warrants
    ├── routes/
    │   ├── tickets.schema.ts              # NEW — Zod v4: ticketIdParam(uuid) + moveTicketBody
    │   ├── tickets.routes.ts              # NEW — router.patch('/:ticketId', authenticate, validateRequest, handler)
    │   └── tickets.routes.test.ts         # NEW — supertest: 200/200/404/400/400/401/rebalance
    └── index.ts                           # CHANGE — mount ticketsRouter under /api (near :50)

frontend/
├── package.json                           # CHANGE — add @hello-pangea/dnd@^18 (+ overrides note)
└── src/
    ├── utils/
    │   ├── boardReorder.ts                # NEW — PURE: computeDestinationPosition / applyMoveToBoard / needsRebalance + POSITION_GAP/EPSILON
    │   └── boardReorder.test.ts           # NEW — table-driven: prepend/append/mid/cross/no-op/rebalance
    ├── api/
    │   └── tickets.ts                     # NEW — moveTicket(ticketId,{statusColumn,position}) → apiFetch PATCH
    ├── hooks/
    │   ├── useMoveTicket.ts               # NEW — useMutation optimistic (onMutate/onError/onSettled)
    │   └── useMoveTicket.test.ts          # NEW — optimistic set / rollback / invalidate (mock queryClient)
    ├── components/
    │   ├── TicketCard.tsx                 # CHANGE — wrap <article> in <Draggable draggableId={ticket.id} index={index}>; +index prop
    │   ├── BoardColumn.tsx                # CHANGE — wrap <ul> in <Droppable droppableId={id} type="CARD" direction="vertical">; +placeholder; pass index
    │   └── UnsortedBucket.tsx             # CHANGE — cards Draggable OUT; Droppable isDropDisabled IN
    └── pages/
        └── BoardPage.tsx                  # CHANGE — <DragDropContext onDragStart/onDragEnd>; onDragEnd→mutate→setDragInProgress(false)
```

**Request lifecycle (non-obvious flow):** User drops a card → `BoardPage.onDragEnd` builds `{ticketId, srcColumnId, srcIndex, dstColumnId, dstIndex}` from the pangea `result` → no-op guards (no `destination`; same slot) → `computeDestinationPosition` (T2 pure fn) yields the new `position` → `useMoveTicket(slug).mutate({ticketId, statusColumn: dstColumnId, position})` fires → `onMutate` cancels in-flight board queries, snapshots the cache, applies `applyMoveToBoard` optimistically → `PATCH /api/tickets/:ticketId` hits the backend → `ticketService.moveTicket` loads the ticket (404 if missing), validates `statusColumn` against `projects.columns` JSONB (400 if unknown / if it's `UNSORTED_BUCKET_ID`), opens a Drizzle txn, writes `{statusColumn, position, updatedAt}` atomically (rebalance branch if gap<EPSILON), commits → `{data: ticket}` returned → `onSettled` invalidates `boardKeys.all` → resumed `refetchInterval` reconciles → `setDragInProgress(false)` already released the poll-pause at drag-end. On any error → `onError` restores the snapshot → `onSettled` invalidates → next poll reconciles.

---

## 5. Parallelization Strategy

Tasks are grouped into **4 batches** by dependency order. Within a batch, tasks touch **disjoint file sets** → zero merge conflicts → safe to run in parallel and merge independently.

### Batch dependency diagram

```
 ┌─ Batch 1 (parallel, disjoint) ─────────────────────────┐
 │  T1  Backend ticket move endpoint   [backend/* only]   │
 │  T2  FE DnD dep + pure reorder util [frontend dep+util]│
 └────────────────────────────────────────────────────────┘
              │                       │
              ▼                       ▼
 ┌─ Batch 2 (parallel, disjoint; both depend only on B1) ─┐
 │  T3  FE API client + optimistic hook  [api+hooks]      │
 │  T4  Draggable card + unsorted disable [components]    │
 └────────────────────────────────────────────────────────┘
              │                       │
              └────────┬──────────────┘
                       ▼
        ┌─ Batch 3 ──────────────────────────────────┐
        │  T5  DragDropContext + Droppable columns   │
        │      + onDragEnd wiring  [pages+components]│
        └────────────────────────────────────────────┘
                       │
                       ▼
        ┌─ Batch 4 (terminal) ───────────────────────┐
        │  T6  Verification gate (no new feature files)│
        └─────────────────────────────────────────────┘
```

- **Batch 1 → Batch 2** is a hard barrier: T3 needs T1's route contract (`PATCH /api/tickets/:ticketId` shape) AND T2's `applyMoveToBoard`; T4 needs T2's installed `@hello-pangea/dnd` dep.
- **Batch 2 → Batch 3** is a hard barrier: T5 needs T3's `useMoveTicket` hook AND T4's draggable cards to wire the `<DragDropContext>`.
- **Batch 3 → Batch 4** is a hard barrier: T6 verifies the as-merged feature end-to-end.

### Merge order rules

1. **Batch 1 merges first.** T1 and T2 touch disjoint file sets (backend vs frontend) — either order is safe; both must be on `main` before Batch 2 branches. Rebase-only (no merge/squash commits).
2. **Batch 2 merges second.** T3 (`frontend/src/api/tickets.ts`, `frontend/src/hooks/useMoveTicket.*`) and T4 (`frontend/src/components/TicketCard.tsx`, `UnsortedBucket.tsx`) are disjoint — either order.
3. **Batch 3 (T5) merges third.** Touches `BoardPage.tsx` + `BoardColumn.tsx` — depends on T3+T4 being on `main`.
4. **Batch 4 (T6) merges last.** Verification record only — no feature files; may be a doc commit on `main` after T5.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | 1 | `backend/src/routes/tickets.{schema,routes,routes.test}.ts`, `backend/src/services/ticketService.{ts,test}.ts`, `backend/src/index.ts` | F09 (DONE) | T2 |
| **T2** | 1 | `frontend/package.json`, `frontend/src/utils/boardReorder.{ts,test.ts}` | F09/F10 (DONE) | T1 |
| **T3** | 2 | `frontend/src/api/tickets.ts`, `frontend/src/hooks/useMoveTicket.{ts,test.ts}` | T1, T2 | T4 |
| **T4** | 2 | `frontend/src/components/TicketCard.tsx`, `frontend/src/components/UnsortedBucket.tsx` | T2 | T3 |
| **T5** | 3 | `frontend/src/pages/BoardPage.tsx`, `frontend/src/components/BoardColumn.tsx` | T3, T4 | — |
| **T6** | 4 | (verification record only) | T1-T5 | — |

### Developer assignment tracks

- **Solo:** T1 → T2 → (T3 ‖ T4) → T5 → T6.
- **2 devs:** Dev-A (backend) T1 → (free / review); Dev-B (frontend) T2 → T3 → T5 → T6; T4 folded into Dev-B after T2, or picked up by Dev-A post-T1.
- **3 devs:** Dev-A backend T1; Dev-B frontend-core T2 → T3 → T5; Dev-C frontend-ui T4 → (free / T6 assist).

---

## 6. Tasks

### T1 — Backend ticket move endpoint

**Batch:** 1 · **Depends on:** F09 (DONE) · **Parallel with:** T2

**Description:** Create the generic ticket-patch route + service that atomically persists a moved card's `statusColumn` + `position`. Validates the column id against the project's `projects.columns` JSONB; rejects the `UNSORTED_BUCKET_ID` sentinel; opens a Drizzle transaction; supports a per-column rebalance branch when neighbor gap < EPSILON.

Create / Modify:

- **NEW `backend/src/routes/tickets.schema.ts`** — Zod v4 schemas (note: repo uses Zod v4.4.3 — `flattenError` API per `validateRequest.ts`):
    ```typescript
    import { z } from 'zod'

    export const ticketIdParam = z.object({
        ticketId: z.uuid(),
    })

    export const moveTicketBody = z.object({
        statusColumn: z.string().min(1),
        position: z.number().finite(),
    })
    ```
- **NEW `backend/src/services/ticketService.ts`** — Drizzle transactional service. Key export `moveTicket({ ticketId, statusColumn, position })`. Steps: (1) load ticket by `id` from `tickets` — throw `AppError(NOT_FOUND, ...)` if missing; derive `projectId` from the row; (2) load `projects.columns` JSONB for that `projectId`, assert `statusColumn` is one of the configured Column.ids AND !== `UNSORTED_BUCKET_ID` — else throw `AppError(VALIDATION_FAILED, { details: { statusColumn: 'Unknown column' } })`; (3) open `db.transaction(async (tx) => { ... })`; (4) `await tx.update(tickets).set({ statusColumn, position, updatedAt: new Date() }).where(eq(tickets.id, ticketId))`; (5) **rebalance branch** — re-read the destination column's tickets ordered by `position ASC`; if any adjacent pair has `next.position - prev.position < POSITION_EPSILON`, re-assign every ticket in that column `position = index * POSITION_GAP` via a batch update inside the same txn; (6) return the updated ticket row. Constants `POSITION_GAP = 65536`, `POSITION_EPSILON = 1e-6` exported (SCREAMING_SNAKE_CASE, no magic numbers). Reuse `db` from `backend/src/db/client.ts`, `tickets`/`projects` from `backend/src/db/schema.ts`, `eq`/`asc` from `drizzle-orm`. Throw via `AppError` + `ErrorCode` from `backend/src/utils/envelope.ts`. Leave `// TODO(F17): per-column permission check + toast-on-deny` above the auth seam.
- **NEW `backend/src/routes/tickets.routes.ts`** — Express 5 router mirroring `projects.routes.ts:48-62` layering:
    ```typescript
    import { Router } from 'express'
    import { authenticate } from '../middleware/auth'
    import { validateRequest } from '../middleware/validateRequest'
    import { ticketIdParam, moveTicketBody } from './tickets.schema'
    import * as ticketService from '../services/ticketService'
    import { success } from '../utils/envelope'

    const router = Router()
    // TODO(F17): add requireRole / per-column permission middleware
    router.patch(
        '/:ticketId',
        authenticate,
        validateRequest({ params: ticketIdParam, body: moveTicketBody }),
        async (req, res) => {
            const { ticketId } = req.params as z.infer<typeof ticketIdParam>
            const { statusColumn, position } = req.body as z.infer<typeof moveTicketBody>
            const ticket = await ticketService.moveTicket({ ticketId, statusColumn, position })
            res.json(success({ data: ticket }))
        },
    )
    export default router
    ```
- **NEW `backend/src/routes/tickets.routes.test.ts`** — supertest suite covering: 200 cross-column move (assert `statusColumn` + `position` updated atomically); 200 same-column reorder; 404 unknown ticket id; 400 `statusColumn` not in project's columns; 400 `statusColumn === UNSORTED_BUCKET_ID`; 400 non-finite `position`; 400 missing `position`; 401 no Bearer token; rebalance-trigger case (construct two tickets with gap < EPSILON, move between them, assert column re-numbered). Mock `authenticate`'s JWT path or seed a real user/token per the existing `projects.routes.test.ts` pattern.
- **NEW `backend/src/services/ticketService.test.ts`** — if rebalance / column-validation logic warrants direct unit coverage beyond the route suite (e.g. transactional rebalance assertions against a test DB), add it here; otherwise rely on the route suite.
- **CHANGE `backend/src/index.ts`** — import `ticketsRouter` and mount under `/api` near the existing `projects.router` mount (`:48-50`): `app.use('/api/tickets', ticketsRouter)`.

**Acceptance Criteria:**
- [ ] `PATCH /api/tickets/:ticketId` with `{statusColumn, position}` updates both fields in a single Drizzle transaction (assert via test that a forced mid-txn failure rolls back both).
- [ ] Unknown ticket id → 404 `NOT_FOUND`.
- [ ] `statusColumn` not in the project's `columns` JSONB → 400 `VALIDATION_FAILED`.
- [ ] `statusColumn === UNSORTED_BUCKET_ID` → 400 `VALIDATION_FAILED` (cannot persist into the sentinel).
- [ ] Non-finite / missing `position` → 400 `VALIDATION_FAILED`.
- [ ] Missing Bearer token → 401 `UNAUTHENTICATED`.
- [ ] Rebalance branch triggers when neighbor gap < `POSITION_EPSILON` and re-assigns the whole column `index * POSITION_GAP` in one txn.
- [ ] `POSITION_GAP` / `POSITION_EPSILON` exported as named constants (no magic numbers).
- [ ] `// TODO(F17)` seam present above the auth/permission line.
- [ ] Route mounted at `/api/tickets` in `backend/src/index.ts`.
- [ ] `ticketService` business-logic coverage >80% (`rtk vitest`).
- [ ] Envelope shape `{data: ticket}` on success; `{error:{code,message,details?}}` on error.

**Dependencies:** F09 (DONE — schema, migration, board read path, envelope, validateRequest, authenticate all shipped).

---

### T2 — Frontend DnD dep + pure reorder util

**Batch:** 1 · **Depends on:** F09/F10 (DONE) · **Parallel with:** T1

**Description:** Install `@hello-pangea/dnd@^18` (documenting the React 19 peer override) and author the pure, side-effect-free reorder utilities that both the optimistic mutation (T3) and the `onDragEnd` handler (T5) will call. These functions are the unit-testable core since jsdom cannot drive pangea's pointer sensor.

Create / Modify:

- **CHANGE `frontend/package.json`** — add `"@hello-pangea/dnd": "^18.0.1"` to `dependencies`. Document the React 19 peer-dep resolution in the task/PR notes: either (a) install with `npm install @hello-pangea/dnd --legacy-peer-deps`, or (b) add an `overrides` block pinning react/react-dom:
    ```json
    "overrides": {
        "@hello-pangea/dnd": { "react": "^19.0.0", "react-dom": "^19.0.0" }
    }
    ```
    Chosen mechanism MUST be recorded in the PR description. Keep `<StrictMode>` (pangea fork fixes the rbd StrictMode breakage).
- **NEW `frontend/src/utils/boardReorder.ts`** — PURE functions, no React, no network:
    ```typescript
    import type { BoardPayload } from '../types/board'
    import type { Ticket } from '../types/ticket'

    export const POSITION_GAP = 65536
    export const POSITION_EPSILON = 1e-6

    export interface MoveDescriptor {
        ticketId: string
        srcColumnId: string
        srcIndex: number
        dstColumnId: string
        dstIndex: number
    }

    // Compute the moved ticket's new position via midpoint / GAP rules.
    export function computeDestinationPosition(
        board: BoardPayload,
        move: MoveDescriptor,
    ): number { /* prepend: first.position - GAP; append: last.position + GAP;
                  mid: (prev.position + next.position) / 2;
                  into-empty column: 0 */ }

    // Immutable: returns a NEW BoardPayload with the ticket relocated + position mutated.
    export function applyMoveToBoard(
        board: BoardPayload,
        move: MoveDescriptor,
    ): BoardPayload { /* splice out of src column, insert into dst column at dstIndex,
                         set ticket.position = computeDestinationPosition(...) */ }

    // True when any adjacent pair in the column has gap < EPSILON → backend rebalances.
    export function needsRebalance(
        positions: number[],
    ): boolean { /* scan adjacent deltas */ }
    ```
    Constants at top (SCREAMING_SNAKE_CASE). No `any` — use `BoardPayload`/`Ticket`/`MoveDescriptor`. No magic numbers.
- **NEW `frontend/src/utils/boardReorder.test.ts`** — table-driven per `js-testing-rules.md`:
    ```typescript
    const cases = [
        { name: 'prepend → first.position - GAP', ... },
        { name: 'append → last.position + GAP', ... },
        { name: 'mid-insert → midpoint', ... },
        { name: 'cross-column move relocates ticket', ... },
        { name: 'no-op when src===dst slot (guard at caller, util still idempotent)', ... },
        { name: 'into-empty column → 0', ... },
        { name: 'needsRebalance true when gap < EPSILON', ... },
        { name: 'needsRebalance false on healthy gap', ... },
    ]
    ```
    Assert `applyMoveToBoard` does NOT mutate the input board (deep-equal check on the original).

**Acceptance Criteria:**
- [ ] `@hello-pangea/dnd@^18` resolves under React 19 (install mechanism documented in PR).
- [ ] `computeDestinationPosition` correct for prepend/append/mid/empty per D1 rules.
- [ ] `applyMoveToBoard` returns a new `BoardPayload` (input immutable — asserted in test).
- [ ] `needsRebalance` detects gap < `POSITION_EPSILON`.
- [ ] `POSITION_GAP` / `POSITION_EPSILON` exported as named constants.
- [ ] No `any`; explicit `MoveDescriptor` interface; types imported via `import type`.
- [ ] Table-driven tests co-located (`boardReorder.test.ts`); business-logic coverage >80% (`rtk vitest`).
- [ ] 2-space JS indent, trailing commas, 100-char lines, import order external→internal→type→relative.

**Dependencies:** F09/F10 (DONE — `BoardPayload`/`Ticket` types and `UNSORTED_BUCKET_ID` already shipped).

---

### T3 — Frontend API client + optimistic mutation hook

**Batch:** 2 · **Depends on:** T1, T2 · **Parallel with:** T4

**Description:** Thin API client wrapper for the move endpoint and the canonical TanStack v5 optimistic `useMutation` against `boardKeys.detail(slug)`. This is the repo's first optimistic mutation — it sets the precedent F10 forward-documented.

Create / Modify:

- **NEW `frontend/src/api/tickets.ts`** — mirrors `frontend/src/api/projects.ts:12-17` shape:
    ```typescript
    import { apiFetch } from './client'

    export interface MoveTicketRequest {
        statusColumn: string
        position: number
    }

    export function moveTicket(ticketId: string, dto: MoveTicketRequest): Promise<Ticket> {
        return apiFetch<Ticket>(`/tickets/${ticketId}`, {
            method: 'PATCH',
            body: JSON.stringify(dto),
        })
    }
    ```
    Reuse `apiFetch` (Bearer + envelope unwrap + `ApiClientError` already handled). `Ticket` type from `frontend/src/types/ticket.ts`.
- **NEW `frontend/src/hooks/useMoveTicket.ts`** — canonical optimistic mutation (D6):
    ```typescript
    import { useMutation, useQueryClient } from '@tanstack/react-query'
    import { moveTicket } from '../api/tickets'
    import { boardKeys } from '../api/queryKeys'
    import { applyMoveToBoard, type MoveDescriptor } from '../utils/boardReorder'
    import type { BoardPayload } from '../types/board'

    export function useMoveTicket(slug: string | undefined) {
        const queryClient = useQueryClient()
        return useMutation({
            mutationFn: (vars: { ticketId: string } & MoveDescriptor) =>
                moveTicket(vars.ticketId, {
                    statusColumn: vars.dstColumnId,
                    position: /* computed via computeDestinationPosition before mutate */ vars.position,
                }),
            onMutate: async (vars) => {
                await queryClient.cancelQueries({ queryKey: boardKeys.all })
                const previousBoard = queryClient.getQueryData<BoardPayload>(boardKeys.detail(slug!))
                queryClient.setQueryData<BoardPayload>(
                    boardKeys.detail(slug!),
                    (curr) => curr ? applyMoveToBoard(curr, vars) : curr,
                )
                return { previousBoard }
            },
            onError: (_err, _vars, ctx) => {
                if (ctx?.previousBoard) {
                    queryClient.setQueryData(boardKeys.detail(slug!), ctx.previousBoard)
                }
            },
            onSettled: () => {
                queryClient.invalidateQueries({ queryKey: boardKeys.all })
            },
        })
    }
    ```
    The caller (T5 `onDragEnd`) computes `position` via `computeDestinationPosition` and passes the full `MoveDescriptor` + `position`.
- **NEW `frontend/src/hooks/useMoveTicket.test.ts`** — mock `queryClient` (use `QueryClient` with `{ defaultOptions: { queries: { retry: false } } }`); assert: (1) `onMutate` cancels board queries + applies `applyMoveToBoard` to the cache (snapshot the set value); (2) `onError` restores the previous board snapshot; (3) `onSettled` invalidates `boardKeys.all`. Mock `moveTicket` with `vi.fn()` — resolve for success case, reject for rollback case.

**Acceptance Criteria:**
- [ ] `moveTicket` calls `apiFetch` with `PATCH` + JSON body matching T1's `moveTicketBody` schema.
- [ ] `useMoveTicket` implements `onMutate` (cancel + snapshot + optimistic set) / `onError` (rollback) / `onSettled` (invalidate) per D6.
- [ ] Optimistic cache write uses `applyMoveToBoard` (immutability preserved).
- [ ] Rollback restores the exact prior `BoardPayload` snapshot on error.
- [ ] `boardKeys.all` / `boardKeys.detail(slug)` reused (F10-locked keys — no new keys).
- [ ] `vi.fn()` mocks; co-located `useMoveTicket.test.ts`; coverage >80%.
- [ ] No `any`; explicit interfaces; 2-space indent; import order correct.

**Dependencies:** T1 (`PATCH /api/tickets/:ticketId` contract); T2 (`applyMoveToBoard`, `computeDestinationPosition`, `MoveDescriptor`).

---

### T4 — Draggable card + unsorted-bucket drop-disable

**Batch:** 2 · **Depends on:** T2 · **Parallel with:** T3

**Description:** Wrap each `<TicketCard>` in a pangea `<Draggable>` and make the unsorted bucket drag-OUT-only. This task touches only the leaf card components — the `<DragDropContext>` / `<Droppable>` wrappers come in T5.

Create / Modify:

- **CHANGE `frontend/src/components/TicketCard.tsx`** — accept a new `index: number` prop; wrap the existing `<article>` in a `<Draggable draggableId={ticket.id} index={index}>` render-prop. Spread `provided.draggableProps`, `provided.dragHandleProps`, and `provided.draggableProps.style` LAST (per pangea API — style last so it overrides). Keep the existing `aria-label={\`Ticket ${ticketId}: ${title}\`}`. Updated interface:
    ```typescript
    interface TicketCardProps {
        ticket: Ticket
        projectSlug: string
        index: number
    }
    ```
    Render-prop body:
    ```tsx
    <Draggable draggableId={ticket.id} index={index}>
        {(provided) => (
            <article
                ref={provided.innerRef}
                {...provided.draggableProps}
                {...provided.dragHandleProps}
                style={provided.draggableProps.style}
                aria-label={`Ticket ${ticket.ticketNumber}: ${ticket.title}`}
                className="..."
            >
                {/* existing card body */}
            </article>
        )}
    </Draggable>
    ```
    Import order: react → `@hello-pangea/dnd` → internal types → relative.
- **CHANGE `frontend/src/components/UnsortedBucket.tsx`** — ensure orphan cards render as `<Draggable>` (they already route through `<BoardColumn isUnsorted>` → `<TicketCard index=...>`, so once T4 + T5 land they're draggable OUT). Add a prop/branch so that IF the unsorted column hosts a `<Droppable>` (T5 wiring), it passes `isDropDisabled={true}` to prevent drops INTO the sentinel bucket. Keep the muted opacity styling. If the `<Droppable>` lives entirely in `BoardColumn` (T5), then `UnsortedBucket` just forwards `isDropDisabled` via the existing `isUnsorted` prop — keep the change minimal.

**Acceptance Criteria:**
- [ ] Every `<TicketCard>` renders inside a `<Draggable draggableId={ticket.id} index={index}>`.
- [ ] `provided.draggableProps.style` spread LAST (pangea requirement).
- [ ] Existing `aria-label` preserved (a11y — screen-reader label unchanged).
- [ ] `TicketCardProps.index` typed `number`; no `any`.
- [ ] Unsorted bucket cards are draggable OUT (rescue into a real column).
- [ ] Unsorted bucket `<Droppable>` is `isDropDisabled` (cannot drop INTO sentinel).
- [ ] 4-space JSX indent; trailing commas; import order correct.
- [ ] Component coverage >70% (existing `TicketCard` tests updated for the new `index` prop).

**Dependencies:** T2 (`@hello-pangea/dnd` installed). NOTE: cards won't actually drag until T5 wraps the board in `<DragDropContext>` + `<Droppable>` — that's expected; this task only makes the leaf draggable.

---

### T5 — DragDropContext + Droppable columns + onDragEnd wiring

**Batch:** 3 · **Depends on:** T3, T4 · **Parallel with:** —

**Description:** Single `<DragDropContext>` wrapping the column row; each `<BoardColumn>` wraps its `<ul>` in a vertical `<Droppable type="CARD">`; `onDragStart` engages the F10 poll-pause seam; `onDragEnd` computes the move, fires the optimistic mutation, then releases the seam — in that order (D5).

Create / Modify:

- **CHANGE `frontend/src/pages/BoardPage.tsx`** — import `DragDropContext` from `@hello-pangea/dnd`; import `useMoveTicket` + `computeDestinationPosition` + `useBoardUiStore`. Wrap the horizontal column flex (`:45-64`) in a single `<DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>`. Handlers:
    ```typescript
    const { mutate } = useMoveTicket(slug)
    const setDragInProgress = useBoardUiStore((s) => s.setDragInProgress)

    const onDragStart = () => setDragInProgress(true)

    const onDragEnd = (result: DropResult) => {
        // No-op guards (research idiom)
        if (!result.destination) return
        const { source, destination, draggableId } = result
        if (source.droppableId === destination.droppableId && source.index === destination.index) return

        const move: MoveDescriptor = {
            ticketId: draggableId,
            srcColumnId: source.droppableId,
            srcIndex: source.index,
            dstColumnId: destination.droppableId,
            dstIndex: destination.index,
        }
        const board = queryClient.getQueryData<BoardPayload>(boardKeys.detail(slug!))  // or boardData from useBoard
        const position = computeDestinationPosition(board, move)
        mutate({ ...move, position })

        // Release poll-pause AFTER kicking off persist (D5 order)
        setDragInProgress(false)
    }
    ```
    Single `type="CARD"` only — do NOT add a `type="COLUMN"` droppable (columns immovable in MVP).
- **CHANGE `frontend/src/components/BoardColumn.tsx`** — import `Droppable` from `@hello-pangea/dnd`; wrap the existing `<ul>` (`:34-40`) in `<Droppable droppableId={id} type="CARD" direction="vertical" isDropDisabled={isUnsorted}>` render-prop. Render `provided.placeholder` inside the `<ul>` (keeps drop space during drag). Pass each `<TicketCard>` its `index` (the array index of the ticket in the column). Keep `data-column-id={id}` + `aria-label` on the root `<section>`. Spread `provided.droppableProps` + `ref={provided.innerRef}` on the `<ul>`. When `isUnsorted` is true, `isDropDisabled` prevents drops INTO the sentinel (cards still draggable OUT via T4).
    ```tsx
    <Droppable droppableId={id} type="CARD" direction="vertical" isDropDisabled={isUnsorted}>
        {(provided) => (
            <ul ref={provided.innerRef} {...provided.droppableProps}>
                {tickets.map((ticket, index) => (
                    <li key={ticket.id}>
                        <TicketCard ticket={ticket} projectSlug={projectSlug} index={index} />
                    </li>
                ))}
                {provided.placeholder}
            </ul>
        )}
    </Droppable>
    ```

**Acceptance Criteria:**
- [ ] Exactly ONE `<DragDropContext>` wraps the column row (pangea requirement).
- [ ] Each `<BoardColumn>` hosts a `<Droppable droppableId={id} type="CARD" direction="vertical">`.
- [ ] `provided.placeholder` rendered (drop space stable during drag).
- [ ] `onDragStart` calls `setDragInProgress(true)` (F10 seam — poll pauses).
- [ ] `onDragEnd` calls `setDragInProgress(false)` AFTER `mutate` (D5 order — enforced by `useBoard.test.tsx:193-202`).
- [ ] No-op guards: missing `destination` → return; same slot → return.
- [ ] `computeDestinationPosition` called before `mutate` to yield the persisted `position`.
- [ ] Cross-column drag works (shared `type="CARD"`).
- [ ] Columns are NOT draggable (no `type="COLUMN"`).
- [ ] `data-column-id` + `aria-label` preserved on `<BoardColumn>` root.
- [ ] Unsorted column `isDropDisabled` (drop-in prevented); its cards still draggable OUT.
- [ ] `useBoard.test.tsx` drag-seam contract still green (onDragEnd → `setDragInProgress(false)`).

**Dependencies:** T3 (`useMoveTicket`); T4 (draggable cards).

---

### T6 — Integration verification & sign-off

**Batch:** 4 (terminal) · **Depends on:** T1-T5 · **Parallel with:** —

**Description:** The final definition-of-done gate. Run every tool against the as-merged feature, fix gaps, record proof. Produces the verification record only — NO new feature files.

Steps:
1. **Backend tests:** `rtk vitest --root backend` (or `npm test -- --root backend`) — expect `tickets.routes.test.ts` + `ticketService.test.ts` green; F09 suite still green (no regressions).
2. **Frontend tests:** `rtk vitest` — expect `boardReorder.test.ts`, `useMoveTicket.test.ts`, `TicketCard`/`BoardColumn`/`BoardPage` component suites, and the F10 `useBoard.test.tsx` drag-seam contract all green; F09/F10 suites still green.
3. **Typecheck:** `rtk tsc` (or `npx tsc --noEmit` in `frontend/` and `backend/`) — 0 errors. Confirm `@hello-pangea/dnd` types resolve under React 19.
4. **Frontend build:** `npm run build` in `frontend/` — 0 errors (Vite production build succeeds with the new dep).
5. **Lint / format:** NOTE — `frontend/package.json` has NO `lint`/`format:check` scripts and no eslint/prettier config (project-wide tooling gap, same as F10). Record "lint/format N/A — no scripts" in the verification record. Do NOT add config as part of F11.
6. **Manual browser smoke checklist** (record each as pass/fail with a screenshot or note):
    - Drag a card within a column → reorder persists on reload (position written).
    - Drag a card across columns → `statusColumn` + `position` persist on reload.
    - Drag to first position → prepend midpoint boundary correct.
    - Drag to last position → append midpoint boundary correct.
    - Two browser sessions, concurrent drag of different cards → last-write-wins reconciles on next 30s poll (D7).
    - Simulate a 500 from `PATCH /api/tickets/:ticketId` (e.g. stop backend mid-drag) → optimistic update rolls back, card snaps home.
    - During a drag, the 30s poll pauses (no yank); on drop it resumes (`dragInProgress` seam).
    - Keyboard reorder: focus a card, Space to lift, arrows to move, Space to drop, Esc to cancel (pangea a11y free).
    - Unsorted bucket: drag an orphan card OUT into a real column (rescue succeeds); attempt to drop a card INTO the unsorted bucket → rejected (`isDropDisabled`).
    - Empty column after moving its only card out → column remains rendered (project config, not ticket-derived).
7. **Record proof:** commit SHA, test exit codes, build exit code, manual-smoke results into the F11 verification record (doc commit on `main` after T5, per merge-order rules).

**Acceptance Criteria:**
- [ ] `rtk vitest` FE+BE green (boardReorder + moveTicket + tickets.routes + ticketService suites added; F09/F10 regression-free).
- [ ] `rtk tsc` / typecheck exit 0.
- [ ] `npm run build` (frontend) exit 0.
- [ ] Lint/format recorded N/A (tooling gap — no scripts).
- [ ] Every F11 acceptance bullet satisfied (see §7) — record commit SHA + observable per bullet.
- [ ] Manual smoke checklist above all pass (or failures filed as follow-ups with owner sign-off).
- [ ] `useBoard.test.tsx:193-202` drag-seam contract green.

**Dependencies:** T1, T2, T3, T4, T5.

---

## 7. Final F11 Acceptance Checklist

- [ ] **Moving a card calls an endpoint that updates `status_column` + position atomically.** — `PATCH /api/tickets/:ticketId` (T1) writes both fields in a single Drizzle transaction; transactional atomicity asserted in `tickets.routes.test.ts`.
- [ ] **Reordering within a column updates neighbor positions without full rewrites where possible.** — Midpoint insertion (D1) = 1 row/drop typical; rebalance only when `next.position - prev.position < POSITION_EPSILON`; `computeDestinationPosition` + `needsRebalance` unit-tested in `boardReorder.test.ts`.
- [ ] **Drag is smooth (optimistic) and rolls back on failure.** — `useMoveTicket` (T3) implements `onMutate` (optimistic set) / `onError` (rollback) / `onSettled` (invalidate); rollback asserted in `useMoveTicket.test.ts`; manual smoke confirms snap-home on simulated 500.
- [ ] **Edge: schema delta** — NONE; `position` PRE-SATISFIED by F09 (D9).
- [ ] **Edge: concurrent reorders** — last-write-wins (D7); rollback + invalidate + next 30s poll reconciles; manual smoke confirms.
- [ ] **Edge: per-column permission denial** — NOT BUILT; `TODO(F17)` seam left in `tickets.routes.ts`; deferred to F17/F25 (Owner Q2).
- [ ] **Edge: moving only card out of a column** — column stays (project config); manual smoke confirms.
- [ ] **Edge: unsorted bucket** — drag-OUT-only, `isDropDisabled` IN (D4); manual smoke confirms (Owner Q3).
- [ ] Lint + format checks pass on an empty change — **N/A** (no scripts; tooling gap recorded).
- [ ] Typecheck + test pass — exit `0 / 0`.
- [ ] Frontend production build pass — exit `0`.
- [ ] `useBoard.test.tsx:193-202` F10 drag-seam contract still green.
- [ ] a11y: keyboard reorder + screen-reader live region work (pangea free).

**Integration record (fill during T6):**
- Feature commit SHA: `________`
- `PATCH /api/tickets/:ticketId` sample response (200 cross-column): `________`
- Frontend build artifact path: `frontend/dist/`
- Lint/format/typecheck/test exit codes: `N/A / N/A / 0 / 0`
- Manual smoke results: `________` (per checklist in T6)

---

## 8. Schema deltas owned by this feature

**F11 adds NONE.** The `Tickets.position` column was already shipped by F09 (owner sign-off §9a) — `backend/src/db/schema.ts:88` (`position: doublePrecision('position').notNull().default(0)`), applied via migration `backend/src/db/migrations/0004_dazzling_mariko_yashida.sql:2-16` (`"position" double precision DEFAULT 0 NOT NULL`). The schema comment at `schema.ts:78` literally reads "F11 will write-reorder". F11 owns the reorder WRITE endpoint + UI only — NOT the column.

| Delta | Detail | Migration |
| --- | --- | --- |
| ~~`Tickets.position`~~ | ~~double precision, NOT NULL, default 0~~ | **PRE-SATISFIED by F09** — `0004_dazzling_mariko_yashida.sql`. F11 adds NO migration. |
| ~~`(projectId, statusColumn, position)` unique index~~ | — | **OUT of scope.** `position` is non-unique by design (allows rebalance). Do NOT add. |

---

## 9. Owner sign-off needed (cross-cutting decisions)

Surface these in chat before/as Batch 1 merges:

- **Q1 — Route ownership (D2):** Confirm F11 may create the generic `PATCH /api/tickets/:ticketId` and F13 extends its Zod schema later (vs. F11 using a scoped `POST /api/tickets/:ticketId/move`). **Recommend the generic PATCH** (RESTful, extensible — F13 widens for title/description/assignee/priority without a new route).
- **Q2 — Authorization model (D3):** Confirm "any authenticated user may move" is acceptable until F17/F25 wire membership + per-column permissions. F11 wires `authenticate` only and leaves a `TODO(F17)` seam.
- **Q3 — Unsorted bucket direction (D4):** Confirm the unsorted bucket is drag-OUT-only (`isDropDisabled` IN; cards Draggable OUT so they can be rescued into a real column).
- **Q4 — Last-write-wins acceptable (D7):** Confirm LWW (no ETag/If-Match) is acceptable for MVP — concurrent reorders reconcile on the next 30s poll; ETag escalation explicitly deferred per PRD §4.
