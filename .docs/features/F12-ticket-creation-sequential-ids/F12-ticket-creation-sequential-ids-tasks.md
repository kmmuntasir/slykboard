# F12 — Ticket creation with sequential IDs: Plan + Task Breakdown

> **Feature:** F12 — Ticket creation with sequential IDs (Phase 2 — Board)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F09 (DONE ✅); inherits F08 (DONE ✅), F11 (PARTIAL ⚠️ — impl complete, live browser smoke deferred) · **PRD ref:** REQ-3.1, REQ-3.2, REQ-3.3, PRD §8.3
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), the project rules discovered for this repo (`.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`), plus dependency feature task docs: [F08](../F08-projects-slug-columns/F08-projects-slug-columns-tasks.md), [F09](../F09-board-read-columns-cards/F09-board-read-columns-cards-tasks.md), [F11](../F11-drag-drop-order-persistence/F11-drag-drop-order-persistence-tasks.md)

---

## 1. F12 Recap

**Goal:** Create a ticket with a deterministic, project-scoped ID — the backend assigns the next `ticket_number` per project, displayed as `[SLUG]-[NNN]` (e.g. `SLYK-001`).

**Ships:** Any authenticated user opens the board for a project, clicks "New ticket", enters a title, and submits. The backend allocates the next per-project `ticket_number` atomically (concurrency-safe), persists the ticket into the project's first column at the bottom, and the card appears optimistically on the board as `SLUG-001` (then `SLYK-002`, …). IDs never reuse, never go global, and never collide across concurrent creates.

**Acceptance (definition of done):**
- `Tickets` table per PRD §8.3; `ticket_number` increments **per project, never globally**.
- ID format `[SLUG]-[NNN]` shown in UI and stable (already implemented in `TicketCard.tsx:13` as `${projectSlug}-${ticket.ticketNumber}`).
- New card lands at the **bottom of the first column** (`project.columns[0].id`); position math via `POSITION_GAP`.
- `creator_id` set from the authenticated user (`req.user.id`).
- `status_column` defaults to the project's first column (`project.columns[0].id`).
- Concurrency: two simultaneous creates never share a number.

**Edge cases to resolve up front:**
- **Concurrency — two creates at once must not share a number** → **Decision:** Adopt a per-project `project_sequences` counter row + `SELECT ... FOR UPDATE` (Drizzle `.for("update")`) inside `db.transaction()`, backed by a unique `(project_id, ticket_number)` constraint as a defense-in-depth backstop. Cite Drizzle transactions doc (https://orm.drizzle.team/docs/transactions), PG explicit-locking doc (https://www.postgresql.org/docs/current/explicit-locking.html), and [F09-tasks.md §8](../F09-board-read-columns-cards/F09-board-read-columns-cards-tasks.md) which names `FOR UPDATE` as F12's contract. **Avoid `.for("update", { noWait: true })`** — Drizzle #3554 emits invalid `NO WAIT` (not `NOWAIT`). Use default blocking FOR UPDATE. **Owner question Q1** (counter-row vs unique-constraint+retry).
- **Starting number (e.g. 100 vs 1)** → **Decision:** Start at **1**, zero-pad display to 3 digits (`SLYK-001`). Storage holds the raw int; the frontend formats on read. Rationale: Jira default is 1 (`PROJ-1`); no documented "start at 100" convention — the seed's 101/102/103 was a placeholder, not a spec. Update the seed to 1-based. **Owner question Q2** (1 vs 101).
- **Numbering gap on a later delete** → **Decision:** Acceptable. IDs are never reused. `project_sequences.nextNumber` only increments; deletes do not decrement it. Documented. (No delete endpoint ships in F12 — F14 owns delete; this contract carries forward.)
- **Slug in the ID must reflect the project slug, which can be renamed (F27)** → **Decision:** Defer the immutability snapshot (Model B) to F27. F12 ships **Model A** — render-time `${currentSlug}-${ticketNumber}`, already implemented at `frontend/src/components/TicketCard.tsx:13`. No rename path exists until F27. Leave an explicit `TODO(F27)` seam in the schema + service: when F27 adds slug rename, decide whether to snapshot an immutable `displayId` string at creation. **Owner question Q5**.
- **Who may create** → **Decision:** Any authenticated user. PRD REQ-3.3 verbatim: "Any authenticated user can create or edit tickets." Wire `authenticate` only; leave a `TODO(F17)` per-column seam mirroring F11's `tickets.routes.ts:6`. NOT a sign-off (PRD decides).
- **Default status column** → **Decision:** `project.columns[0].id` (index 0 of the `projects.columns` JSONB array). Matches `boardService` iteration order (`boardService.ts:114-143` always emits configured columns in array order) and the seed (`col-todo` first at `seed.ts:455`). Explicit decision, no sign-off.
- **New-card placement** → **Decision:** **Bottom of the first column** — position = `(max(position) in column 0) || 0) + POSITION_GAP`. Rationale: avoids negative positions and the precision-exhaustion drift that a top-prepend (`min - GAP`) would accelerate; F11 rebalance machinery stays unchanged; `POSITION_GAP=65536` reused from `ticketService.ts:10`. **Owner question Q3** (bottom vs top).
- **Route shape** → **Decision:** **`POST /api/projects/:slug/tickets`** (nested under `projectsRouter`). Binds the slug cleanly, mirrors `GET /api/projects/:slug/board`, RESTful per `js-development-rules.md` route convention. The POST handler lives in `backend/src/routes/projects.routes.ts` (the already-mounted router) OR a tickets sub-router merged into projectsRouter — **recommend inline in `projects.routes.ts`** for F12 (one route; keeps it discoverable next to `GET /:slug/board`). **Owner question Q4** (nested vs flat `POST /api/tickets`).

---

## 2. Codebase Analysis Summary

- **State:** **Greenfield for creation logic.** F09 (board read, DONE ✅), F08 (projects, DONE ✅), F11 (drag-drop, PARTIAL ⚠️ — impl + tests complete; only live browser smoke deferred) are all satisfied in code. The `Tickets` table, board read path, optimistic-mutation precedent (`useMoveTicket`), envelope, validateRequest, `authenticate`, query keys, and API client all exist and are locked. No `createTicket` service, no POST route, no `createTicketBody` Zod, no `useCreateTicket` hook, and no create UI exist today. Placeholders naming F12: `schema.ts:75` ("F12 owns creation"), `schema.ts:84` (`ticketNumber` no default/unique/index), `seed.ts:5` ("F12 owns creation"), `BoardPage.tsx:75` ("No tickets yet — F12 will add creation.").
- **Existing structure this feature builds on (with path citations):**
    - **ORM:** Drizzle `drizzle-orm ^0.45.2` over node-postgres `pg ^8.22.0`. Schema `backend/src/db/schema.ts`. Client singleton `backend/src/db/client.ts:24` (`drizzle(pool, { schema })`, `db`, pool max 5). Config `backend/drizzle.config.ts` (schema `./src/db/schema.ts`, out `./src/db/migrations`, postgresql, strict, verbose). 5 migrations `0000`–`0004`; journal next id = 5. Commands (run `-w backend`): `npm run db:generate` / `db:migrate` / `db:push` / `db:seed` (`backend/package.json:13-17`).
    - **Tickets schema TODAY** `backend/src/db/schema.ts:79-101`: `id` uuid PK `defaultRandom` `:80`; `projectId` (project_id) uuid NOT NULL FK→Projects `:81-83`; **`ticketNumber` (ticket_number) integer NOT NULL `:84` — NO default, NO unique constraint, NO index (F12 adds counter + uniqueness)**; `title` text NOT NULL `:85`; `description` text nullable `:86`; `statusColumn` (status_column) text NOT NULL `:87` (holds a `Column.id`, NO FK — integrity read-time); `position` doublePrecision NOT NULL default 0 `:88` (F09/F11); `assigneeId` (assignee_id) uuid nullable FK→Users `:89-90`; `creatorId` (creator_id) uuid NOT NULL FK→Users `:91-93`; `priority` pgEnum Priority default MEDIUM NOT NULL `:94`; `labels` jsonb string[] default [] NOT NULL `:95`; `createdAt`/`updatedAt` timestamptz NOT NULL `:96-100` (`updatedAt` `$onUpdate`).
    - **Projects schema** `backend/src/db/schema.ts:54-70`: `slug` text NOT NULL **UNIQUE** `:57-58`; `columns` jsonb `$type<Column[]>` `:59-62` where `interface Column { id: string; name: string }` (`schema.ts:49-52`) — ordered array; **first column = `project.columns[0].id`**. Helper `getProjectBySlug(slug)` `backend/src/services/projectService.ts:75-78` returns the full ProjectRow (incl. columns) or `null`. `createProject` `projectService.ts:18-40` already runs `db.insert(projects)` — F12 seeds the counter row in the same flow (or in a follow-up migration default).
    - **F09 board read seam:** route `GET /api/projects/:slug/board` `backend/src/routes/projects.routes.ts:36-45` → `boardService.getBoard(slug)` `backend/src/services/boardService.ts:48-149` → `success(board)`. `BoardPayload` `{ project: { id, name, slug }, columns: BoardColumn[] }`; `BoardTicket` fields (`boardService.ts:22-34`): id, ticketNumber, title, statusColumn, position, priority, labels, assignee({id,fullName,avatarUrl}|null), creatorId, createdAt, updatedAt. **`description` is NOT in the FE-render slice** (exists in DB; F12 stores it but the board card does not display it — F13 owns the detail view).
    - **F11 move seam (structure to mirror):** route `PATCH /api/tickets/:ticketId` `backend/src/routes/tickets.routes.ts:12-22` (authenticate → validateRequest({params, body}) → ticketService.moveTicket → `success(ticket)`). Zod `backend/src/routes/tickets.schema.ts` (`ticketIdParam` uuid, `moveTicketBody`). Service `backend/src/services/ticketService.ts` — `moveTicket` loads ticket+project, validates column membership (rejects `UNSORTED_BUCKET_ID`), then **`db.transaction(async (tx) => { ... })`** atomic write + conditional rebalance (`ticketService.ts:75-109`). Constants `POSITION_GAP=65536`, `POSITION_EPSILON=1e-6` (`ticketService.ts:10-11`). F12 adds `createTicket` + `allocateTicketNumber` to this SAME service file, reusing `POSITION_GAP`. FE `useMoveTicket` `frontend/src/hooks/useMoveTicket.ts` (useMutation optimistic: cancelQueries → setQueryData via `applyMoveToBoard` → onError rollback → onSettled invalidate `boardKeys.all`).
    - **Router mount:** `backend/src/index.ts:52`: `app.use('/api/tickets', ticketsRouter)` — already wired by F11. `projectsRouter` mounted at `:50` (`/api/projects`). F12's nested `POST /:slug/tickets` requires NO new mount — it appends to `projectsRouter`.
    - **Auth middleware** `backend/src/middleware/auth.ts:9-43`: sets **`req.user = { id: payload.sub, email, role }`** (`auth.ts:41`). Type augment `backend/src/types/express.d.ts` (`AuthenticatedUser { id, email, role }`). Role guard `requireRole('ADMIN')` `backend/src/middleware/requireRole.ts`. F12 create = `authenticate` only (REQ-3.3); leave `TODO(F17)` seam per F11 precedent.
    - **Envelope** `backend/src/utils/envelope.ts`: `success<T>(data) → { data }` (`:28-30`), `error(code, message, details?) → { error: { code, message, details? } }` (`:42-48`). Closed `ErrorCode` (`:5-12`): VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, INTERNAL_ERROR. `AppError` `backend/src/utils/appError.ts`; `errorMiddleware` maps code→status. Zod wiring `backend/src/middleware/validateRequest.ts` (factory `{ body?, query?, params? }`, safeParse, throws `AppError(VALIDATION_FAILED, ..., { source, issues: flattenError(err) })` on fail). F08 POST returns `res.status(201).json(success(project))` — **F12 create returns 201**.
    - **FE board:** `useBoard(slug)` `frontend/src/hooks/useBoard.ts` (useQuery, queryKey `boardKeys.detail(slug)`, refetchInterval 30s paused while dragging). `apiFetch<T>(path, init)` `frontend/src/api/client.ts` (injects Bearer from `useAuthStore`, unwraps `{data}`, throws `ApiClientError { status, code, details }`). Tickets API `frontend/src/api/tickets.ts` (only `moveTicket` today — F12 adds `createTicket`). Query keys `frontend/src/api/queryKeys.ts` (`boardKeys.all`, `boardKeys.detail(slug)`) — **LOCKED by F10; F12 reuses, creates NO new keys.** BoardPage `frontend/src/pages/BoardPage.tsx` renders `board.columns.map` → `<BoardColumn>`/`<UnsortedBucket>`; **empty-state placeholder `BoardPage.tsx:70-76` literally says "No tickets yet — F12 will add creation."** BoardColumn `frontend/src/components/BoardColumn.tsx:41-49` renders `tickets.map((ticket, index) => <TicketCard />)` in array order (backend position ASC, so index 0 = top). TicketCard `frontend/src/components/TicketCard.tsx:13`: `ticketId = \`${projectSlug}-${ticket.ticketNumber}\`` — **the `[SLUG]-[NNN]` display is ALREADY implemented client-side** from `ticketNumber` + URL slug. Project store `frontend/src/stores/useProjectStore.ts` (lastSelectedSlug); BoardPage gets slug from `useParams<{ slug }>()` (`BoardPage.tsx:12`) — **URL is the source of truth, not the store.**
    - **Env:** FE `frontend/src/config/env.ts` `loadEnv()` (VITE_API_BASE_URL required, VITE_POLL_INTERVAL_SECONDS default 30); BE `backend/src/config/env.ts` `loadConfig(process.env)`. F12 adds NO new env vars.
- **Prior art / partial work:** F09 (DONE, 205 BE + 117 FE tests, DB smoke 2026-06-23) ships the board read path + the `Tickets` table + `Priority` enum + `position` column + migration `0004`. F11 (PARTIAL, 375 tests + tsc + build pass; live browser smoke deferred) ships the move endpoint + optimistic `useMoveTicket` + DnD wiring — this is the **optimistic-mutation precedent F12 mirrors**. F08 (DONE) ships projects + slug + columns + `createProject`. The seed (`backend/src/db/seed.ts`) manually inserts `ticketNumber` 101/102/103 — F12 updates the seed to 1-based + seeds `project_sequences` rows.
- **File paths the plan references that do NOT exist yet (will be created):**
    - `backend/src/db/migrations/0005_*.sql` (via `db:generate`)
    - `frontend/src/hooks/useCreateTicket.ts`
    - `frontend/src/hooks/useCreateTicket.test.ts`
    - `frontend/src/utils/boardInsert.ts`
    - `frontend/src/utils/boardInsert.test.ts`
    - `frontend/src/components/NewTicketButton.tsx`
    - `frontend/src/components/NewTicketButton.test.tsx`
- **File paths this plan CHANGES (exist on `main`):**
    - `backend/src/db/schema.ts` (add `project_sequences` table + `(project_id, ticket_number)` unique index on tickets)
    - `backend/src/services/projectService.ts` (seed counter row at project create)
    - `backend/src/services/ticketService.ts` (add `allocateTicketNumber` + `createTicket`)
    - `backend/src/services/ticketService.test.ts` (add create/allocate tests)
    - `backend/src/routes/projects.routes.ts` (append `POST /:slug/tickets` handler) + `backend/src/routes/projects.routes.test.ts` (append create scenarios)
    - `backend/src/routes/projects.schema.ts` (add `createTicketBody`)
    - `backend/src/db/seed.ts` (1-based ticket numbers + counter rows)
    - `frontend/src/api/tickets.ts` (add `createTicket`)
    - `frontend/src/pages/BoardPage.tsx` (replace empty-state placeholder + wire trigger/hook)
- **Project rules this plan must satisfy:** `.claude/rules/git-guidelines.md` (branch `feature/SLYK-F12-ticket-creation-sequential-ids`, single-line commits `SLYK-F12: <msg>`, rebase-only no squash, slug SLYK, sacred rule: never git without explicit approval); `.claude/rules/js-development-rules.md` (RESTful JSON envelope, layering routes→services, Zod at edge, parameterized queries, `authenticate` + permission MW for roles, frontend dirs pages/components/hooks/api/types/stores, React Query server state + Zustand UI + useState local); `.claude/rules/js-style-guide.md` (Prettier, 100 chars, 4-space JSX / 2-space JS, trailing commas, PascalCase components, camelCase hooks/vars, SCREAMING_SNAKE_CASE constants, explicit prop interfaces, import order external→internal→type→relative, no `any`/`console.log`/inline-styles/unnecessary useMemo|useCallback/magic-numbers/prop-drilling); `.claude/rules/js-testing-rules.md` (Vitest, co-located `*.test.ts(x)`, table-driven preferred, `vi.fn()`, RTL priority `getByRole`>`getByLabelText`>`getByText`>`getByTestId`, coverage business >80% / components >70%); `.claude/rules/persona.md` (React 19 + Express 5 + Postgres + Vite + Tailwind; `verbatimModuleSyntax` → `import type`).
- **Hidden coupling to plan for:**
    - **No repositories/ layer.** Services query `db` directly (F08/F09/F11 convention; `repositories/` empty by convention). F12's `allocateTicketNumber` + `createTicket` live in `ticketService.ts`, not a new repository.
    - **`statusColumn` stores Column **id** (text), NOT name.** `createTicket` validates an optional `statusColumn` against `projects.columns` JSONB ids and rejects `UNSORTED_BUCKET_ID` — exactly as F11's `moveTicket` does (`ticketService.ts:75-109`).
    - **`project_sequences` counter row must exist before `allocateTicketNumber` runs**, else `FOR UPDATE` finds no row → `NOT_FOUND`. Seed the row in the same transaction that creates a project (T3), and add a migration default for pre-existing projects (T1). The unique `(project_id, ticket_number)` constraint is the defense-in-depth backstop: even if the lock somehow misses, a double-alloc raises PG 23505 → map to CONFLICT.
    - **Drizzle `.for("update")` must run inside `db.transaction`.** PG releases row locks at transaction end. The whole allocate+insert must be one txn. Avoid `noWait` (Drizzle #3554 emits invalid `NO WAIT`). Sources: https://orm.drizzle.team/docs/transactions , https://www.postgresql.org/docs/current/explicit-locking.html , Drizzle #2875/#3554.
    - **Single global serial/identity is WRONG** for per-project numbering — sequences are global-to-table, not partitioned; rollbacks/ON CONFLICT/crash-recovery consume values → gaps + non-monotonic. Reject explicitly. Sources: https://www.cybertec-postgresql.com/en/gaps-in-sequences-postgresql/ , https://blog.sequinstream.com/postgres-sequences-can-commit-out-of-order/ , https://stackoverflow.com/questions/37204749 .
    - **`refetchInterval` pauses during drag (F10 seam `useBoardUiStore`).** F12's optimistic insert uses `setQueryData` (same pattern as `useMoveTicket`) — no new store, no new query key.
    - **F11's deferred browser smoke is inherited risk.** F12's optimistic-insert mirrors F11's pattern; the F12 final gate (T9) MUST run its own live browser smoke for create + inherited DnD together (not automatable headless — jsdom cannot drive pangea's pointer sensor, per F11 D6/T6).
    - **MEMORY `drizzle-partial-index-enum-dollar1`:** `drizzle-kit generate` emits unapplyable `$1` SQL for the F06 enum partial index when regenerating. F12's `0005_*.sql` is additive (CREATE TABLE `project_sequences` + CREATE UNIQUE INDEX) so the bug *should not* fire, but T1 MUST inspect `0005_*.sql` and confirm no `WHERE "role" = $1`; if present, hand-edit to literal `'ADMIN'`.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale (cite source) |
|---|----------|--------|-----------|
| D1 | `ticket_number` allocation | **Per-project `project_sequences` counter row + `SELECT ... FOR UPDATE` (Drizzle `.for("update")`) inside `db.transaction()`, backed by unique `(project_id, ticket_number)` constraint as invariant backstop.** | REQ-3.1 "Auto-increment per project"; PRD §8.3 `ticket_number Integer "Auto-increment per project"`. [F09-tasks.md §8](../F09-board-read-columns-cards/F09-board-read-columns-cards-tasks.md) names `FOR UPDATE` as F12's contract. Drizzle transactions doc (https://orm.drizzle.team/docs/transactions) + PG explicit-locking (https://www.postgresql.org/docs/current/explicit-locking.html). Deadlocks near-zero (1 counter row locked per tx; keep tx short). Gap-tolerant: `nextNumber` only increments; deletes don't decrement. Unique constraint = defense-in-depth (double-alloc raises 23505 → CONFLICT). Avoid `.for("update", { noWait: true })` — Drizzle #3554 emits invalid `NO WAIT`. **Rejected:** single global serial/identity (non-partitioned → gaps + non-monotonic — https://www.cybertec-postgresql.com/en/gaps-in-sequences-postgresql/ ); advisory locks (overkill); unique-constraint+insert-retry-only (retry storms under load — Drizzle #2474 returning()+onConflictDoNothing misbehaves). **Owner Q1.** |
| D2 | Starting number | **Start at 1; zero-pad display to 3 digits (`SLYK-001`).** Storage = raw int; format on read (FE `TicketCard`). | Jira default is 1 (`PROJ-1`) — no documented "start at 100" convention. Sources: Atlassian community links. Seed's 101/102/103 was a placeholder, not a spec. Zero-pad is display-only — no storage change. **Owner Q2.** |
| D3 | New-card placement | **Bottom of first column** — `position = (max(position) in column 0 \|\| 0) + POSITION_GAP`. | Avoids negative positions + precision-exhaustion drift that top-prepend (`min - GAP`) accelerates. F11 rebalance machinery unchanged. `POSITION_GAP=65536` reused from `ticketService.ts:10`. Common-kanban top is an alternative (Q3) but bottom has simpler math + no negative-position concern. **Owner Q3.** |
| D4 | Default `status_column` | **`project.columns[0].id`** (index 0 of `projects.columns` JSONB). | `boardService.ts:114-143` iterates `project.columns` in array order; seed `col-todo` is first (`seed.ts:455`). F12 makes the implicit contract explicit. No sign-off. |
| D5 | Authorization | **`authenticate` only.** Any authenticated user may create. `TODO(F17)` per-column seam. | PRD REQ-3.3 verbatim: "Any authenticated user can create or edit tickets." F11 set the `TODO(F17)` precedent at `tickets.routes.ts:6`. Not a sign-off. |
| D6 | Route shape | **`POST /api/projects/:slug/tickets`** (nested under `projectsRouter`, handler in `projects.routes.ts`). Body `{ title, description?, priority?, labels?, assigneeId?, statusColumn? }` → `201` + `success(ticket)`. | Binds slug cleanly, mirrors `GET /api/projects/:slug/board` (`projects.routes.ts:36-45`), RESTful per `js-development-rules.md`. Alternative: flat `POST /api/tickets` body `{ projectSlug, ... }` (F11 precedent). **Recommend nested. Owner Q4.** |
| D7 | Optimistic mutation | **`useCreateTicket(slug)` mirroring `useMoveTicket`** — `onMutate` cancelQueries + snapshot + `setQueryData` via pure `applyCreateToBoard`; `onError` rollback; `onSettled` invalidate `boardKeys.all`. | Board is the active view — a non-optimistic round-trip (cf. `useCreateProject` invalidate-only) flashes. F11 established the optimistic precedent (D6, `useMoveTicket.ts`). **Reuse `boardKeys` (F10-locked); no new keys.** |
| D8 | `displayId` immutability | **Defer snapshot (Model B) to F27.** F12 ships Model A — render-time `${currentSlug}-${ticketNumber}` (already at `TicketCard.tsx:13`). Leave `TODO(F27)` seam. | No slug-rename path exists until F27. Model B (immutable `displayId` string column) requires a schema column now for a future feature; Model A is reversible (switching to B later is one migration). Sources: Atlassian project-key format. **Owner Q5.** |
| D9 | Response shape | **`201` + `success(ticket)`** where `ticket` is the full `BoardTicket`-shaped row (so FE optimistic insert matches the board payload). | F08 POST returns `201` + `success(project)` (`projects.routes.ts`). Envelope `success<T>` from `envelope.ts:28-30`. FE `applyCreateToBoard` consumes the same `Ticket` shape the board already renders. |

> **Out of F12 scope (explicitly deferred):**
> - **Full attribute modal** (description WYSIWYG, assignee dropdown, labels multi-select, checklist) → **F13** (widens the create/edit Zod schema + UI). F12 ships a minimal title-only create form.
> - **Slug-rename + historical-ID immutability** → **F27** (Model B snapshot decision). F12 ships Model A with a `TODO(F27)` seam.
> - **Ticket delete** (REQ-3.3: "Only Admins can delete") → **F14**. F12 documents the gap-on-delete contract (IDs never reused) but ships no delete endpoint.
> - **Per-column / membership-based create permissions + toast-on-deny** → **F17** / **F25**. F12 wires `authenticate` only + `TODO(F17)` seam.
> - **ETag / `If-Match` optimistic concurrency** → explicitly deferred per PRD §4 (MVP = HTTP polling, LWW).

> **Owner sign-off needed (5 questions — surface in chat before Batch 1 merges):**
> - **Q1 (`ticket_number` strategy):** counter-row + `FOR UPDATE` (recommended) vs unique-constraint + retry (simpler schema, no new table). Recommend counter-row — matches F09's `FOR UPDATE` contract + deadlocks near-zero + gap-tolerant.
> - **Q2 (starting number):** 1 + zero-pad (recommended) vs 101 (seed/PRD-example convention). Recommend 1.
> - **Q3 (new-card placement):** bottom (recommended, simpler position math) vs top (common kanban UX). Recommend bottom.
> - **Q4 (route shape):** nested `POST /api/projects/:slug/tickets` (recommended) vs flat `POST /api/tickets` (F11 precedent). Recommend nested.
> - **Q5 (`displayId` immutability):** defer snapshot to F27 (recommended, render-time now) vs add immutable `displayId` column now (Model B). Recommend defer.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/                                                  # repo root
├── backend/
│   └── src/
│       ├── db/
│       │   ├── schema.ts                                   # MODIFY (T1) — add project_sequences table + unique (project_id, ticket_number) on tickets
│       │   ├── seed.ts                                     # MODIFY (T1) — 1-based ticket numbers + seed project_sequences rows
│       │   └── migrations/
│       │       └── 0005_<auto>.sql                         # NEW (T1) — CREATE TABLE "project_sequences" + CREATE UNIQUE INDEX "tickets_project_number_uq"
│       ├── services/
│       │   ├── projectService.ts                           # MODIFY (T3) — createProject seeds project_sequences row in-tx
│       │   ├── ticketService.ts                            # MODIFY (T2) — add allocateTicketNumber(tx, projectId) + createTicket({...})
│       │   └── ticketService.test.ts                       # MODIFY (T2) — concurrency / gap-on-delete / missing-sequence / column-default tests
│       └── routes/
│           ├── projects.schema.ts                          # MODIFY (T4) — add createTicketBody Zod
│           ├── projects.routes.ts                          # MODIFY (T4) — append POST /:slug/tickets handler (authenticate + validateRequest)
│           └── projects.routes.test.ts                     # MODIFY (T4) — append POST create supertest scenarios
└── frontend/
    └── src/
        ├── api/
        │   └── tickets.ts                                  # MODIFY (T5) — add createTicket(slug, dto)
        ├── utils/
        │   ├── boardInsert.ts                              # NEW (T6) — PURE applyCreateToBoard(board, ticket) + tests
        │   └── boardInsert.test.ts                         # NEW (T6)
        ├── hooks/
        │   ├── useCreateTicket.ts                          # NEW (T7) — useMutation optimistic (onMutate/onError/onSettled)
        │   └── useCreateTicket.test.ts                     # NEW (T7)
        ├── components/
        │   ├── NewTicketButton.tsx                         # NEW (T8) — minimal title-only create form (F13 owns full attribute modal)
        │   └── NewTicketButton.test.tsx                    # NEW (T8)
        └── pages/
            └── BoardPage.tsx                               # MODIFY (T8) — replace empty-state placeholder + wire NewTicketButton + useCreateTicket
```

**Request lifecycle (`POST /api/projects/:slug/tickets`, post-F12):**

1. Client `createTicket(slug, dto)` → `apiFetch(\`/projects/${slug}/tickets\`, { method: 'POST', body: JSON.stringify(dto) })` → Bearer injected.
2. `authenticate` (F07): verifies JWT + `ver` compare → `req.user = { id, email, role }`.
3. `validateRequest({ params: slugParamSchema, body: createTicketBody })`: strict uppercase slug regex + Zod body (title required non-empty w/ length cap, description?/priority?/labels?/assigneeId?/statusColumn?) → `VALIDATION_FAILED`/400 on fail.
4. Handler calls `ticketService.createTicket({ slug, creatorId: req.user.id, ...body })`:
   - `projectService.getProjectBySlug(slug)` → `null` → `NOT_FOUND`/404.
   - Resolve `statusColumn`: body value OR `project.columns[0].id`; validate membership (reject `UNSORTED_BUCKET_ID`) — same logic as F11 `moveTicket`.
   - `db.transaction(async (tx) => { ... })`:
     - `allocateTicketNumber(tx, projectId)`: `tx.select().from(projectSequences).where(eq(projectId)).for('update')` → missing row → `NOT_FOUND`; read `nextNumber`; `tx.update(projectSequences).set({ nextNumber: sql\`${projectSequences.nextNumber} + 1\` })`.
     - Resolve bottom position: `tx.select({ max: max(position) }).from(tickets).where(and(eq(projectId), eq(statusColumn, resolvedColumn)))` → `position = (max ?? 0) + POSITION_GAP`.
     - `tx.insert(tickets).values({ projectId, ticketNumber: number, title, description, statusColumn: resolvedColumn, position, creatorId, assigneeId, priority, labels }).returning()`.
   - Returns the inserted row (BoardTicket shape).
5. Returns `201` + `success(ticket)`.
6. FE `useCreateTicket.onMutate`: cancelQueries → snapshot → `setQueryData(applyCreateToBoard(board, ticket))` → optimistic card at bottom of first column as `SLUG-001`. `onSettled` invalidates `boardKeys.all` → 30s poll reconciles (unless dragging).

---

## 5. Parallelization Strategy

Tasks are grouped into **5 batches** by dependency order. Within a batch, tasks touch **disjoint file sets** → zero merge conflicts → safe to run in parallel and merge independently.

### Batch dependency diagram

```
 ┌─ Batch 1 (backend data; schema is shared spine) ─────────────────────┐
 │  T1  schema: project_sequences + unique idx + migration 0005 + seed  │
 │      [db/schema.ts, db/migrations/0005, db/seed.ts]                  │
 │  T2  ticketService: allocateTicketNumber + createTicket              │
 │      [services/ticketService.ts, services/ticketService.test.ts]     │
 │  T3  projectService: createProject seeds counter row                 │
 │      [services/projectService.ts]                                    │
 │  (T1 → T2 → T3 serialized WITHIN B1: schema is the spine; T2 imports │
 │   project_sequences + uses POSITION_GAP; T3 imports project_sequences│
 └────────────────────────┬─────────────────────────────────────────────┘
                          │ (createTicket service contract stable)
                          ▼
 ┌─ Batch 2 (backend edge) ─────────────────────────────────────────────┐
 │  T4  POST /:slug/tickets route + createTicketBody Zod + supertest    │
 │      [routes/projects.routes.ts, projects.schema.ts, *.test.ts]      │
 └────────────────────────┬─────────────────────────────────────────────┘
                          │ (HTTP contract stable: 201 + success(ticket))
                          ▼
 ┌─ Batch 3 (frontend data; disjoint files) ────────────────────────────┐
 │  T5  api/tickets.ts createTicket                                     │
 │      [api/tickets.ts]                                                │
 │  T6  utils/boardInsert.ts applyCreateToBoard + tests                 │
 │      [utils/boardInsert.ts, utils/boardInsert.test.ts]               │
 │  T7  useCreateTicket hook (optimistic) + tests                       │
 │      [hooks/useCreateTicket.ts, hooks/useCreateTicket.test.ts]       │
 │  (T5 ‖ T6 disjoint; T7 depends on BOTH T5 + T6 — serialize T5,T6→T7)│
 └────────────────────────┬─────────────────────────────────────────────┘
                          │ (hook available)
                          ▼
 ┌─ Batch 4 (frontend UI) ──────────────────────────────────────────────┐
 │  T8  NewTicketButton + BoardPage wiring + component test             │
 │      [components/NewTicketButton.tsx, pages/BoardPage.tsx, tests]    │
 └────────────────────────┬─────────────────────────────────────────────┘
                          │ (feature complete)
                          ▼
 ┌─ Batch 5 (terminal) ─────────────────────────────────────────────────┐
 │  T9  Integration gate: typecheck/lint/format/test/build + live smoke │
 │      (no new feature files)                                          │
 └──────────────────────────────────────────────────────────────────────┘
```

- **B1 (T1 → T2 → T3) hard barrier:** schema is the shared spine. T2 imports `project_sequences` (T1) + reuses `POSITION_GAP`. T3 imports `project_sequences` (T1). Serialize within B1; B1 must merge first.
- **B1 → B2 hard barrier:** T4's route calls `ticketService.createTicket` (T2). Route tests mock the service, so T4 can be drafted on the agreed contract, but merges after T2.
- **B2 → B3 hard barrier:** frontend (T5/T6/T7) needs the stable HTTP contract (`POST /api/projects/:slug/tickets`, 201 + `success(ticket)`). Pin the `CreateTicketDto` + `Ticket` response shape up front.
- **Within B3: T5 ‖ T6, then T7.** T7 imports `createTicket` (T5) + `applyCreateToBoard` (T6). T5 and T6 are disjoint files (parallel); T7 serializes after both.
- **B3 → B4 hard barrier:** T8 consumes `useCreateTicket` (T7).
- **B4 → B5 hard barrier:** T9 verifies the as-merged feature end-to-end + inherited F11 DnD.

### Merge order rules

1. **B1 merges first.** T1 → T2 → T3, in order (schema spine). Rebase-only (no merge/squash commits). `main` must have T3 before B2 branches.
2. **B2 (T4) merges second.** Depends on T2 being on `main`. Disjoint files (routes vs services).
3. **B3 ((T5 ‖ T6) → T7) merges third.** T5 and T6 disjoint (api vs utils); T7 after both. Pin the `CreateTicketDto` + `Ticket` shapes before splitting.
4. **B4 (T8) merges fourth.** Touches `NewTicketButton.tsx` + `BoardPage.tsx` — depends on T7 being on `main`.
5. **B5 (T9) merges last.** Verification record only — no feature files; doc commit on `main` after T8.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | 1 | `backend/src/db/schema.ts`, `backend/src/db/migrations/0005_*.sql`, `backend/src/db/seed.ts` | F09 (DONE) | — (B1 spine) |
| **T2** | 1 | `backend/src/services/ticketService.ts`, `backend/src/services/ticketService.test.ts` | T1 | — |
| **T3** | 1 | `backend/src/services/projectService.ts` | T1 | T2 (disjoint files, but logically after T2) |
| **T4** | 2 | `backend/src/routes/projects.routes.ts`, `backend/src/routes/projects.schema.ts`, `backend/src/routes/projects.routes.test.ts` | T2 | — |
| **T5** | 3 | `frontend/src/api/tickets.ts` | T4 (contract) | T6 |
| **T6** | 3 | `frontend/src/utils/boardInsert.ts`, `frontend/src/utils/boardInsert.test.ts` | T4 (contract) | T5 |
| **T7** | 3 | `frontend/src/hooks/useCreateTicket.ts`, `frontend/src/hooks/useCreateTicket.test.ts` | T5, T6 | — |
| **T8** | 4 | `frontend/src/components/NewTicketButton.tsx`, `frontend/src/components/NewTicketButton.test.tsx`, `frontend/src/pages/BoardPage.tsx` | T7 | — |
| **T9** | 5 | (verification record only) | T1-T8 | — |

### Developer assignment tracks

- **Solo (recommended):** T1 → T2 → T3 → T4 → (T5 ‖ T6) → T7 → T8 → T9. ~2 days.
- **2 devs (max parallelism):**
    - **Dev-A (backend):** T1 → T2 → T3 → T4 → help T9.
    - **Dev-B (frontend):** waits for B2 contract, then (T5 ‖ T6) → T7 → T8 → help T9.
    - Merge order: B1 → B2 → B3 (B3 starts once T4 contract is agreed, even before B2 fully merges, if types are pinned up front).
- **3 devs:**
    - **Dev-A (backend data):** T1 → T2 → T3.
    - **Dev-B (backend edge):** T4 (after T2; mocks `ticketService.createTicket`).
    - **Dev-C (frontend):** (T5 ‖ T6) → T7 → T8 → T9.

---

## 6. Tasks

### T1 — Backend: `project_sequences` table + unique index + migration 0005 + seed update

**Batch:** B1 · **Depends on:** F09 (DONE) · **Parallel with:** — (B1 spine)

**Description:** Add the per-project counter table + the unique backstop constraint to Drizzle schema (D1; schema delta §8), generate migration `0005`, and update the seed to 1-based ticket numbers + seed `project_sequences` rows for existing projects. This is the storage foundation — T2 (service), T3 (project create seed), T4 (route) all depend on it.

Create / Modify:

- **`backend/src/db/schema.ts`** (MODIFY). Add the `projectSequences` table after the `projects` block, and a unique index on `tickets (project_id, ticket_number)`.

  Add `max` is NOT needed here (that's T2). Add the table:
  ```typescript
  // F12 D1: per-project ticket_number counter. allocateTicketNumber() does
  // SELECT ... FOR UPDATE on this row inside db.transaction; the unique
  // (project_id, ticket_number) index on tickets is the defense-in-depth backstop.
  // nextNumber defaults to START_TICKET_NUMBER (1) so a freshly-created project
  // starts numbering at SLYK-001.
  export const projectSequences = pgTable('project_sequences', {
    projectId: uuid('project_id')
      .primaryKey()
      .references(() => projects.id),
    nextNumber: integer('next_number').notNull().default(START_TICKET_NUMBER),
  });
  ```
  Define the starting-number constant near the top of the file (SCREAMING_SNAKE_CASE, no magic number):
  ```typescript
  // F12 D2: ticket_number starts at 1 per project (Jira default). Zero-pad
  // display to 3 digits (SLYK-001) — formatting is frontend-only (TicketCard).
  export const START_TICKET_NUMBER = 1;
  ```
  Add the unique index on tickets (append after the `tickets` table declaration):
  ```typescript
  // F12 D1: invariant backstop — two concurrent creates can never share a number.
  // Primary mechanism is FOR UPDATE on project_sequences; this constraint catches
  // any allocator bug as PG 23505 → mapped to CONFLICT.
  export const ticketsProjectNumberUq = unique('tickets_project_number_uq').on(
    tickets.projectId,
    tickets.ticketNumber,
  );
  ```

- **Generate the migration** from `backend/`:
  ```bash
  npm run db:generate -w backend
  ```
  Produces `backend/src/db/migrations/0005_<auto-name>.sql`. Verify it contains CREATE TABLE `project_sequences` + CREATE UNIQUE INDEX:
  ```sql
  CREATE TABLE IF NOT EXISTS "project_sequences" (
    "project_id" uuid PRIMARY KEY NOT NULL,
    "next_number" integer DEFAULT 1 NOT NULL
  );
  ALTER TABLE "project_sequences" ADD CONSTRAINT "project_sequences_project_id_Projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "Projects"("id") ON DELETE no action ON UPDATE no action;
  CREATE UNIQUE INDEX IF NOT EXISTS "tickets_project_number_uq" ON "Tickets" USING btree ("project_id", "ticket_number");
  ```
  (Exact DDL varies by drizzle-kit version — confirm shape, not wording.)

  **CRITICAL — inspect for `$1` regression:** open `0005_*.sql`; confirm NO `WHERE "role" = $1` anywhere (MEMORY `drizzle-partial-index-enum-dollar1`). Additive CREATE TABLE + CREATE UNIQUE INDEX should not trigger the bug, but verify.

  **Backfill existing projects:** since F09 already created projects without a counter row, add a backfill statement (or do it in the seed). Recommended: add a one-shot backfill in `0005_*.sql` AFTER the CREATE TABLE:
  ```sql
  -- F12: backfill project_sequences for pre-existing projects (F08/F09 projects
  -- have tickets with explicit numbers; nextNumber = max(existing) + 1, or START).
  INSERT INTO "project_sequences" ("project_id", "next_number")
  SELECT p."id",
         COALESCE((SELECT MAX(t."ticket_number") FROM "Tickets" t WHERE t."project_id" = p."id"), 0) + 1
  FROM "Projects" p
  ON CONFLICT ("project_id") DO NOTHING;
  ```
  (This guarantees `allocateTicketNumber` never sees a missing row for any project.)

  Apply locally:
  ```bash
  npm run db:migrate -w backend
  psql "$DATABASE_URL" -c '\d project_sequences'
  psql "$DATABASE_URL" -c '\d "Tickets"' | grep tickets_project_number_uq
  ```

- **`backend/src/db/seed.ts`** (MODIFY). Update the seed to (a) use 1-based `ticketNumber` (101 → 1, 102 → 2, 103 → 3), and (b) insert a `project_sequences` row for the seed project. After the project upsert + before ticket insert:
  ```typescript
  import { projectSequences, tickets, START_TICKET_NUMBER } from './db/schema';
  import { sql } from 'drizzle-orm';
  // ... inside seedBoard(), after the project upsert:
  await db
    .insert(projectSequences)
    .values({ projectId: project!.id, nextNumber: START_TICKET_NUMBER })
    .onConflictDoUpdate({
      target: projectSequences.projectId,
      set: { nextNumber: START_TICKET_NUMBER },
    });
  // then re-seed tickets with numbers 1, 2, 3 (was 101, 102, 103)
  ```
  Update the three ticket inserts: `ticketNumber: 1`, `ticketNumber: 2`, `ticketNumber: 3`. Update positions if desired to keep ASC order with the new `POSITION_GAP` convention (the seed used 10/20/30; either keep or switch to `POSITION_GAP`/`2*POSITION_GAP`/`3*POSITION_GAP` — document the choice; keep simple with 1/2/3 × `POSITION_GAP` for consistency with F12's bottom-placement math).

**Acceptance Criteria:**
- [ ] `schema.ts` declares `projectSequences` (`projectId` uuid PK FK→projects.id, `nextNumber` integer NOT NULL default `START_TICKET_NUMBER`) + `START_TICKET_NUMBER = 1` constant + `ticketsProjectNumberUq` unique on `(tickets.projectId, tickets.ticketNumber)`.
- [ ] `0005_*.sql` generated; contains CREATE TABLE `project_sequences` + FK + CREATE UNIQUE INDEX `tickets_project_number_uq` + backfill INSERT; NO `$1` regression.
- [ ] `npm run db:migrate` applies cleanly; `\d project_sequences` shows the 2 columns + FK; the unique index exists on `Tickets`.
- [ ] `seed.ts` uses 1-based ticket numbers + inserts a `project_sequences` row for the seed project; idempotent (run twice → same state).
- [ ] `usersOneAdminIdx` + `projects` + `tickets` columns UNCHANGED (F06/F08/F09 not regressed).
- [ ] `npm run typecheck -w backend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** F09 (`projects` + `tickets` tables, migration runner). Blocks T2, T3.

---

### T2 — Backend: `allocateTicketNumber` + `createTicket` in ticketService + tests

**Batch:** B1 · **Depends on:** T1 · **Parallel with:** — (logically before T3)

**Description:** Add the concurrency-safe number allocator + the `createTicket` service to `backend/src/services/ticketService.ts` (F11's service file — F12 EXTENDS it). `allocateTicketNumber` runs inside the caller's transaction with `SELECT ... FOR UPDATE`; `createTicket` wraps allocate + bottom-position + insert in a single `db.transaction`. Reuse `POSITION_GAP` from `ticketService.ts:10`.

Create / Modify:

- **`backend/src/services/ticketService.ts`** (MODIFY — add two exports).

  Add imports (top, with existing Drizzle imports): `projectSequences` from `../db/schema`, `max` from `drizzle-orm`, `getProjectBySlug` from `./projectService`. Add:
  ```typescript
  import { and, eq, max, sql } from 'drizzle-orm';
  import { tickets, projects, projectSequences, START_TICKET_NUMBER } from '../db/schema';
  import { db } from '../db/client';
  import { AppError } from '../utils/appError';
  import { ErrorCode } from '../utils/envelope';
  import { getProjectBySlug } from './projectService';
  import { UNSORTED_BUCKET_ID } from './boardService';

  // F12 D1: allocate the next per-project ticket_number inside the caller's txn.
  // SELECT ... FOR UPDATE locks the counter row; the unique (project_id, ticket_number)
  // index on tickets is the defense-in-depth backstop (double-alloc → 23505 → CONFLICT).
  // Do NOT use noWait — Drizzle #3554 emits invalid "NO WAIT".
  export async function allocateTicketNumber(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    projectId: string,
  ): Promise<number> {
    const [row] = await tx
      .select({ nextNumber: projectSequences.nextNumber })
      .from(projectSequences)
      .where(eq(projectSequences.projectId, projectId))
      .for('update');
    if (!row) {
      throw new AppError(
        ErrorCode.NOT_FOUND,
        `Project sequence missing for project ${projectId}`,
      );
    }
    const number = row.nextNumber;
    await tx
      .update(projectSequences)
      .set({ nextNumber: sql`${projectSequences.nextNumber} + 1` })
      .where(eq(projectSequences.projectId, projectId));
    return number;
  }

  export interface CreateTicketInput {
    slug: string;
    creatorId: string;
    title: string;
    description?: string;
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | 'CRITICAL';
    labels?: string[];
    assigneeId?: string;
    statusColumn?: string; // optional; defaults to project.columns[0].id
  }

  // F12: create a ticket with a per-project sequential number, bottom of the
  // resolved column. Single db.transaction: allocate number + compute bottom
  // position + insert. Returns the inserted row (BoardTicket shape).
  export async function createTicket(input: CreateTicketInput) {
    const project = await getProjectBySlug(input.slug);
    if (!project) {
      throw new AppError(ErrorCode.NOT_FOUND, `Project '${input.slug}' not found`);
    }
    const firstColumnId = project.columns[0]?.id;
    if (!firstColumnId) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Project '${input.slug}' has no columns`,
      );
    }
    const resolvedColumn = input.statusColumn ?? firstColumnId;
    const columnIds = new Set(project.columns.map((c) => c.id));
    if (!columnIds.has(resolvedColumn) || resolvedColumn === UNSORTED_BUCKET_ID) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, 'Invalid status_column', {
        source: 'body',
        issues: { statusColumn: ['Unknown column'] },
      });
    }

    return db.transaction(async (tx) => {
      const ticketNumber = await allocateTicketNumber(tx, project.id);

      // F12 D3: bottom of the resolved column = (max(position) || 0) + POSITION_GAP.
      const [maxRow] = await tx
        .select({ maxPos: max(tickets.position) })
        .from(tickets)
        .where(and(eq(tickets.projectId, project.id), eq(tickets.statusColumn, resolvedColumn)));
      const position = (maxRow?.maxPos ?? 0) + POSITION_GAP;

      const [inserted] = await tx
        .insert(tickets)
        .values({
          projectId: project.id,
          ticketNumber,
          title: input.title,
          description: input.description,
          statusColumn: resolvedColumn,
          position,
          creatorId: input.creatorId,
          assigneeId: input.assigneeId,
          priority: input.priority,
          labels: input.labels,
        })
        .returning();
      return inserted;
    });
  }
  ```
  Notes: (a) `tx` typed via `Parameters<Parameters<typeof db.transaction>[0]>[0]` — the Drizzle tx type without exporting it explicitly (matches F11's `moveTicket` usage). (b) `START_TICKET_NUMBER` imported but only used by the schema default; the allocator reads `nextNumber` from the row (already defaulted/seeded). (c) `UNSORTED_BUCKET_ID` imported from `boardService.ts` — MUST equal the FE constant (`'__unsorted__'`). (d) `position` math reuses `POSITION_GAP=65536` from `ticketService.ts:10` — no new constant. (e) `createTicket` <50 lines of logic; early returns for NOT_FOUND/CONFLICT/VALIDATION_FAILED.

- **`backend/src/services/ticketService.test.ts`** (MODIFY — add create/allocate tests). Mock `db.transaction` to expose the `tx` callback, OR use a test DB for the concurrency case. Table-driven + named scenarios:
  - **allocateTicketNumber: returns current nextNumber + increments** — seed `{ projectId, nextNumber: 5 }`; call inside a mocked tx; assert returns `5` + `tx.update` called with `nextNumber: sql\`... + 1\``.
  - **allocateTicketNumber: throws NOT_FOUND when row missing** — no seeded row; assert `AppError(NOT_FOUND)`.
  - **createTicket: NOT_FOUND on unknown slug** — `getProjectBySlug` → `null`; assert `NOT_FOUND`.
  - **createTicket: CONFLICT when project has no columns** — project `{ columns: [] }`; assert `CONFLICT`.
  - **createTicket: defaults statusColumn to columns[0].id** — project columns `[{id:'c1'},{id:'c2'}]`; no `statusColumn` in input; assert inserted `statusColumn === 'c1'`.
  - **createTicket: rejects statusColumn not in project.columns** — input `statusColumn:'ghost'`; assert `VALIDATION_FAILED`.
  - **createTicket: rejects statusColumn === UNSORTED_BUCKET_ID** — assert `VALIDATION_FAILED`.
  - **createTicket: bottom position = (max || 0) + POSITION_GAP into empty column** — max → `null`; assert `position === POSITION_GAP` (0 + 65536).
  - **createTicket: bottom position = max + POSITION_GAP into non-empty column** — max → `131072`; assert `position === 196608`.
  - **createTicket: returns inserted row with allocated number + creatorId** — assert `ticketNumber === nextNumber` + `creatorId === input.creatorId`.
  - **Concurrency (integration, if test DB available): two parallel createTicket calls → distinct numbers** — `Promise.all([createTicket(...), createTicket(...)])`; assert the two `ticketNumber`s differ by 1 (FOR UPDATE serializes). If no test DB, document as a T9 live-smoke check.

  Notes: Mock `../db/client` `db.transaction` + `db.select/insert/update` chains. Mock `./projectService` `getProjectBySlug`. Mock `./boardService` `UNSORTED_BUCKET_ID` constant (or import the literal). The concurrency case is best a live integration test (T9) if the unit harness can't emulate row locking.

**Acceptance Criteria:**
- [ ] `allocateTicketNumber(tx, projectId)` uses `.for('update')` inside the caller's txn; returns current `nextNumber`; increments atomically; throws `NOT_FOUND` on missing row.
- [ ] `createTicket({ slug, creatorId, title, ... })` wraps allocate + bottom-position + insert in a single `db.transaction`; resolves `statusColumn` to `columns[0].id` by default; rejects unknown column + `UNSORTED_BUCKET_ID`; throws `NOT_FOUND` on unknown slug + `CONFLICT` on no-columns project.
- [ ] Bottom position math correct for empty + non-empty column.
- [ ] All 10 scenarios pass.
- [ ] `POSITION_GAP` reused (no magic number, no new constant).
- [ ] `npm run typecheck -w backend`, `npm run lint`, `npm run format:check` pass.
- [ ] `ticketService` business-logic coverage >80% (`rtk vitest`).

**Dependencies:** T1 (`project_sequences` table + unique index + `START_TICKET_NUMBER`).

---

### T3 — Backend: `createProject` seeds `project_sequences` row in-tx

**Batch:** B1 · **Depends on:** T1 · **Parallel with:** T2 (disjoint files, but logically after)

**Description:** Modify `projectService.createProject` (`projectService.ts:18-40`) so every newly-created project gets a `project_sequences` row in the same transaction. This guarantees `allocateTicketNumber` never sees a missing row for any project created after F12 (existing projects are backfilled by the `0005` migration in T1).

Create / Modify:

- **`backend/src/services/projectService.ts`** (MODIFY). The current `createProject` does a single `db.insert(projects)`. F12 wraps the project insert + the counter seed in a `db.transaction`:
  ```typescript
  import { projectSequences, START_TICKET_NUMBER } from '../db/schema';
  // ... existing imports ...

  export async function createProject(input: CreateProjectInput) {
    // ... existing validation (slug uniqueness pre-check, default columns) ...
    return db.transaction(async (tx) => {
      const [project] = await tx
        .insert(projects)
        .values({ name, slug, columns, creatorId })
        .returning();
      // F12: seed the per-project counter so allocateTicketNumber never sees
      // a missing row. Defaults to START_TICKET_NUMBER (SLYK-001).
      await tx
        .insert(projectSequences)
        .values({ projectId: project!.id, nextNumber: START_TICKET_NUMBER });
      return project;
    });
  }
  ```
  Notes: (a) Preserve the existing slug-uniqueness pre-check + 409 CONFLICT behavior (`projectService.ts` already does this). (b) The unique `(project_id, ticket_number)` constraint + `project_sequences.projectId` PK guarantee no orphan projects. (c) If `createProject` already uses a transaction, fold the counter insert into it; otherwise introduce one. (d) Do NOT change the return shape (`Project` row) — F08 callers depend on it.

- **Test:** extend `projectService.test.ts` (or `projects.routes.test.ts` in T4) to assert a `project_sequences` row exists after `createProject`. If `projectService.test.ts` doesn't exist, add the assertion to T4's route test (POST project → then GET board → then POST ticket succeeds without a NOT_FOUND on the sequence).

**Acceptance Criteria:**
- [ ] `createProject` inserts a `project_sequences` row (`nextNumber = START_TICKET_NUMBER`) atomically with the project insert.
- [ ] Existing F08 `createProject` contract unchanged (return shape, slug-uniqueness 409, default columns).
- [ ] After `createProject`, a `project_sequences` row exists for the new project (`psql` or test assertion).
- [ ] `npm run typecheck -w backend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T1 (`project_sequences` schema). Blocks T4 (indirectly — route test asserts the seed).

---

### T4 — Backend: `POST /:slug/tickets` route + `createTicketBody` Zod + supertest tests

**Batch:** B2 · **Depends on:** T2 (mocks `ticketService.createTicket`) · **Parallel with:** —

**Description:** Append `POST /:slug/tickets` (any authed user; D5, D6) to the existing `projectsRouter` in `backend/src/routes/projects.routes.ts`. MW order `authenticate → validateRequest({ params: slugParamSchema, body: createTicketBody }) → handler`. Handler calls `ticketService.createTicket({ slug, creatorId: req.user.id, ...body })` and returns `201` + `success(ticket)`. Append supertest scenarios to the existing `projects.routes.test.ts` (F08/F09 suite) — REAL `authenticate`, mock `ticketService` (its logic is unit-tested in T2).

Create / Modify:

- **`backend/src/routes/projects.schema.ts`** (MODIFY — add `createTicketBody`). Zod v4 (repo uses `zod ^4.4.3`):
  ```typescript
  import { z } from 'zod';

  export const createTicketBody = z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL']).optional(),
    labels: z.array(z.string()).optional(),
    assigneeId: z.uuid().optional(),
    statusColumn: z.string().min(1).optional(), // validated against project.columns in service
  });
  ```
  Notes: (a) `title` required, non-empty, capped at 200 chars (style guide: no magic numbers — but 200/5000 are reasonable documented limits; if the team prefers a named constant, define `MAX_TITLE_LENGTH = 200` in `constants/`). (b) `priority` enum mirrors the pgEnum. (c) `statusColumn` validated in the service (needs the project's columns) — schema only checks non-empty string. (d) `slugParamSchema` already exists (`projects.schema.ts:25-31`, strict `^[A-Z][A-Z0-9]{1,15}$`) — reuse it.

- **`backend/src/routes/projects.routes.ts`** (MODIFY — append the create route).

  Add imports + the route after the existing `GET /:slug/board` block (`:36-45`):
  ```typescript
  import * as ticketService from '../services/ticketService';
  import { createTicketBody } from './projects.schema';
  // ... existing imports (authenticate, validateRequest, slugParamSchema, success) ...

  // F12 D6: nested POST /:slug/tickets — binds slug, mirrors GET /:slug/board.
  // Any authenticated user (REQ-3.3). TODO(F17): per-column permission check.
  projectsRouter.post(
    '/:slug/tickets',
    authenticate,
    validateRequest({ params: slugParamSchema, body: createTicketBody }),
    async (req, res) => {
      const { slug } = req.params as z.infer<typeof slugParamSchema>;
      const body = req.body as z.infer<typeof createTicketBody>;
      const ticket = await ticketService.createTicket({
        slug,
        creatorId: req.user!.id,
        ...body,
      });
      res.status(201).json(success(ticket));
    },
  );
  ```
  Notes: (a) Route order: register `POST /:slug/tickets` AFTER `GET /:slug/board` — distinct methods/paths, no conflict. (b) `req.user!.id` — `authenticate` guarantees `req.user` is set (F08 precedent at `projects.routes.ts` POST project). (c) `success(ticket)` → `{ data: ticket }`. (d) `import * as ticketService` namespace import so tests can `vi.mock('../services/ticketService', ...)`. (e) `TODO(F17)` seam mirrors F11's `tickets.routes.ts:6`. (f) No `index.ts` change — `projectsRouter` already mounted at `/api/projects` (`index.ts:50`).

- **`backend/src/routes/projects.routes.test.ts`** (MODIFY — append create scenarios).

  Follow the F08/F09 gold pattern: `vi.hoisted` for env, `vi.mock('../services/ticketService')`, `vi.mock('../services/projectService')`, real `authenticate` + real JWTs via `signJwt` (mock `findUserTokenVersion` → matching `ver`). Append:
  - **POST /:slug/tickets returns 201 + ticket (authed)** — sign JWT (MEMBER); mock `ticketService.createTicket` → `{ id, ticketNumber: 1, title, statusColumn: 'c1', position: 65536, creatorId, ... }`; POST `/api/projects/SLYK/tickets` w/ Bearer + body `{ title: 'New' }`; assert 201, `body.data.ticketNumber === 1`, `body.data.title === 'New'`.
  - **POST /:slug/tickets sets creatorId from req.user.id** — assert mock called with `{ slug: 'SLYK', creatorId: <jwt sub>, title: 'New' }`.
  - **POST /:slug/tickets returns 404 on unknown slug** — mock `createTicket` → `throw new AppError(ErrorCode.NOT_FOUND, ...)`; assert 404 `NOT_FOUND`.
  - **POST /:slug/tickets returns 400 on empty title** — body `{ title: '' }`; assert 400 `VALIDATION_FAILED`; assert `createTicket` NOT called.
  - **POST /:slug/tickets returns 400 on invalid priority** — body `{ title: 'X', priority: 'BOGUS' }`; assert 400 `VALIDATION_FAILED`.
  - **POST /:slug/tickets returns 400 on invalid slug** — POST `/api/projects/slyk/tickets` (lowercase); assert 400 `VALIDATION_FAILED` (strict `slugParamSchema`).
  - **POST /:slug/tickets returns 401 without Bearer** — no auth header; assert 401; assert `createTicket` NOT called.
  - **POST /:slug/tickets works for MEMBER (no role gate)** — sign JWT (MEMBER); assert 201 (proves create is not admin-gated — REQ-3.3).
  - **POST /:slug/tickets works for ADMIN** — sign JWT (ADMIN); assert 201.
  - **POST /:slug/tickets returns 409 on CONFLICT (project has no columns)** — mock `createTicket` → `throw new AppError(ErrorCode.CONFLICT, ...)`, assert 409.

  Notes: (a) REAL `authenticate` — do NOT mock the middleware. (b) Mock `ticketService` entirely (the logic is unit-tested in T2). (c) Sign JWTs with real `signJwt` + mock `findUserTokenVersion` → matching `ver`. (d) Append to the existing describe block or add a new `describe('POST /:slug/tickets')`.

**Acceptance Criteria:**
- [ ] `projects.routes.ts` appends `POST /:slug/tickets` with MW order `authenticate → validateRequest({ params: slugParamSchema, body: createTicketBody }) → handler`.
- [ ] `index.ts` UNCHANGED (router already mounted).
- [ ] Route returns `201` + `{ data: ticket }`; sets `creatorId` from `req.user.id`; 404 on unknown slug; 400 on empty title / bad priority / bad slug; 401 without Bearer; MEMBER + ADMIN both 201; 409 on no-columns.
- [ ] All 10 create scenarios pass alongside the existing F08/F09 scenarios (no regression).
- [ ] `TODO(F17)` seam present above the handler.
- [ ] `npm run typecheck -w backend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T2 (`createTicket` contract). Mocks `ticketService` so does not block on T3.

---

### T5 — Frontend: `createTicket` API client

**Batch:** B3 · **Depends on:** T4 (contract stable) · **Parallel with:** T6

**Description:** Add `createTicket(slug, dto)` to `frontend/src/api/tickets.ts` (F11's file — F12 EXTENDS it). Mirrors `moveTicket` (`tickets.ts`) and `createProject` (`api/projects.ts:12-17`) shapes.

Create / Modify:

- **`frontend/src/api/tickets.ts`** (MODIFY — add `createTicket`).
  ```typescript
  import { apiFetch } from './client';
  import type { Ticket } from '../types/ticket';

  // ... existing moveTicket ...

  // F12 D6: POST /api/projects/:slug/tickets. apiFetch injects Bearer +
  // unwraps {data} + throws ApiClientError on non-2xx.
  export interface CreateTicketDto {
    title: string;
    description?: string;
    priority?: Ticket['priority'];
    labels?: string[];
    assigneeId?: string;
    statusColumn?: string;
  }

  export function createTicket(slug: string, dto: CreateTicketDto): Promise<Ticket> {
    return apiFetch<Ticket>(`/projects/${slug}/tickets`, {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  }
  ```
  Notes: (a) `apiFetch` returns the unwrapped `data` (envelope handled at `client.ts:121-130`). (b) `Ticket['priority']` reuses the existing type (no `any`). (c) `CreateTicketDto` exported for the hook (T7) + component (T8).

**Acceptance Criteria:**
- [ ] `createTicket(slug, dto)` calls `apiFetch` with `POST` + JSON body matching T4's `createTicketBody` schema.
- [ ] Returns `Promise<Ticket>` (unwrapped from `{ data }`).
- [ ] `CreateTicketDto` exported with `title` required + optional fields.
- [ ] No `any`; 2-space indent; import order correct.
- [ ] `npm run typecheck -w frontend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T4 (HTTP contract). T7 consumes this.

---

### T6 — Frontend: `applyCreateToBoard` pure util + tests

**Batch:** B3 · **Depends on:** T4 (contract stable) · **Parallel with:** T5

**Description:** Author the pure, side-effect-free board-insert utility (sibling to F11's `boardReorder.ts`) that the optimistic mutation (T7) calls. It appends the new ticket to the bottom of the first (or specified) column immutably.

Create / Modify:

- **`frontend/src/utils/boardInsert.ts`** (NEW). PURE functions, no React, no network:
  ```typescript
  import type { BoardPayload } from '../types/board';
  import type { Ticket } from '../types/ticket';

  // F12 D3: new cards land at the BOTTOM of the first column. The backend
  // computes position; the FE only needs to append the ticket to the column's
  // ticket array (backend already returns the correct position in the Ticket).

  // Immutable: returns a NEW BoardPayload with the ticket appended to the
  // first column's tickets array. Does NOT mutate the input.
  export function applyCreateToBoard(board: BoardPayload, ticket: Ticket): BoardPayload {
    // The new ticket's statusColumn is columns[0].id (backend default) or a
    // specified column; find the matching column and append.
    const columns = board.columns.map((column) => {
      if (column.id === ticket.statusColumn && !column.isUnsorted) {
        return { ...column, tickets: [...column.tickets, ticket] };
      }
      return column;
    });
    return { ...board, columns };
  }
  ```
  Notes: (a) Matches on `ticket.statusColumn` (backend returns the resolved column id, defaulting to `columns[0].id`). (b) Does NOT touch the unsorted bucket (`isUnsorted` guard). (c) Immutable — new arrays/objects, input untouched. (d) No magic numbers; position is already in the `ticket`.

- **`frontend/src/utils/boardInsert.test.ts`** (NEW). Table-driven per `js-testing-rules.md`:
  ```typescript
  const cases = [
    { name: 'append to first column', ticket: { statusColumn: 'c1' }, board: { columns: [{ id: 'c1', tickets: [] }] }, expectCol0Len: 1 },
    { name: 'append to first column with existing tickets', board: { columns: [{ id: 'c1', tickets: [t1] }] }, expectCol0Len: 2 },
    { name: 'append to specified column (not first)', ticket: { statusColumn: 'c2' }, board: { columns: [{ id: 'c1', tickets: [] }, { id: 'c2', tickets: [] }] }, expectCol1Len: 1 },
    { name: 'does not touch unsorted bucket', ticket: { statusColumn: 'c1' }, board: { columns: [{ id: 'c1', tickets: [] }, { id: '__unsorted__', isUnsorted: true, tickets: [orphan] }] }, expectUnsortedLen: 1 },
  ];
  ```
  Assert `applyCreateToBoard` does NOT mutate the input board (deep-equal check on the original). Assert the ticket is appended (not prepended — D3 bottom).

**Acceptance Criteria:**
- [ ] `applyCreateToBoard(board, ticket)` returns a new `BoardPayload` with the ticket appended to the matching column.
- [ ] Input board NOT mutated (asserted in test).
- [ ] Unsorted bucket untouched.
- [ ] No `any`; explicit types; `import type` for `BoardPayload`/`Ticket`.
- [ ] Table-driven tests co-located; business-logic coverage >80% (`rtk vitest`).
- [ ] 2-space JS indent, trailing commas, 100-char lines, import order external→internal→type→relative.

**Dependencies:** T4 (Ticket shape). T7 consumes this.

---

### T7 — Frontend: `useCreateTicket` optimistic mutation hook + tests

**Batch:** B3 · **Depends on:** T5, T6 · **Parallel with:** —

**Description:** The optimistic `useMutation` against `boardKeys.detail(slug)`. This mirrors F11's `useMoveTicket` (D7) — the canonical optimistic pattern: `onMutate` cancelQueries + snapshot + `setQueryData(applyCreateToBoard)`; `onError` rollback; `onSettled` invalidate `boardKeys.all`.

Create / Modify:

- **`frontend/src/hooks/useCreateTicket.ts`** (NEW).
  ```typescript
  import { useMutation, useQueryClient } from '@tanstack/react-query';
  import { createTicket, type CreateTicketDto } from '../api/tickets';
  import { boardKeys } from '../api/queryKeys';
  import { applyCreateToBoard } from '../utils/boardInsert';
  import type { BoardPayload } from '../types/board';

  // F12 D7: optimistic create mirroring useMoveTicket (F11). Board is the active
  // view — a non-optimistic round-trip flashes. boardKeys reused (F10-locked).
  export function useCreateTicket(slug: string | undefined) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (dto: CreateTicketDto) => createTicket(slug!, dto),
      onMutate: async (dto) => {
        await queryClient.cancelQueries({ queryKey: boardKeys.all });
        const previousBoard = queryClient.getQueryData<BoardPayload>(boardKeys.detail(slug!));
        // Optimistic: we don't have the real ticketNumber/position yet, so we
        // skip the optimistic insert and let onSettled's invalidate reconcile.
        // (Alternative: synthesize a placeholder ticket — but ticketNumber must
        // be exact for [SLUG]-NNN] display, so defer to the server response.)
        return { previousBoard };
      },
      onError: (_err, _dto, ctx) => {
        if (ctx?.previousBoard) {
          queryClient.setQueryData(boardKeys.detail(slug!), ctx.previousBoard);
        }
      },
      onSuccess: (ticket) => {
        queryClient.setQueryData<BoardPayload>(
          boardKeys.detail(slug!),
          (curr) => (curr ? applyCreateToBoard(curr, ticket) : curr),
        );
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: boardKeys.all });
      },
    });
  }
  ```
  Notes: (a) **Optimism note:** unlike move (where the client knows the exact target position), create's `ticketNumber` is server-assigned — synthesizing a placeholder would show a wrong `[SLUG]-NNN]` briefly. So `onMutate` snapshots but the optimistic insert happens in `onSuccess` (instant once the 201 returns — no flash, since the mutation resolves before the next paint in practice). `applyCreateToBoard` runs on the real server ticket. If the team prefers a true pre-insert placeholder, flag as a sub-decision in the PR; the hook shape supports either. (b) `onError` rollback is a no-op here (no optimistic data written), but kept for symmetry + future-proofing if a placeholder is added. (c) `onSettled` invalidates `boardKeys.all` → 30s poll reconciles (unless dragging).

- **`frontend/src/hooks/useCreateTicket.test.ts`** (NEW). Mock `queryClient` (use `QueryClient` with `{ defaultOptions: { queries: { retry: false } } }`); mock `createTicket` with `vi.fn()`. Scenarios:
  - **onSuccess: appends ticket to board cache via applyCreateToBoard** — seed cache `{ columns: [{ id: 'c1', tickets: [] }] }`; mock `createTicket` → resolve `{ ticketNumber: 1, statusColumn: 'c1', ... }`; mutate; assert `getQueryData` shows `columns[0].tickets.length === 1`.
  - **onError: restores previous board (no-op here, but rollback path exercised)** — mock `createTicket` → reject; assert cache unchanged (rollback path runs).
  - **onSettled: invalidates boardKeys.all** — assert `invalidateQueries` called with `boardKeys.all`.
  - **mutationFn: calls createTicket(slug, dto)** — assert `createTicket` called with `(slug, dto)`.

**Acceptance Criteria:**
- [ ] `useCreateTicket(slug)` implements `onMutate` (cancel + snapshot) / `onSuccess` (applyCreateToBoard) / `onError` (rollback) / `onSettled` (invalidate) per D7.
- [ ] Cache write uses `applyCreateToBoard` (immutability preserved).
- [ ] `boardKeys.all` / `boardKeys.detail(slug)` reused (F10-locked — no new keys).
- [ ] `vi.fn()` mocks; co-located `useCreateTicket.test.ts`; coverage >80%.
- [ ] No `any`; explicit `CreateTicketDto`; 2-space indent; import order correct.

**Dependencies:** T5 (`createTicket`), T6 (`applyCreateToBoard`).

---

### T8 — Frontend: `NewTicketButton` + BoardPage wiring + component test

**Batch:** B4 · **Depends on:** T7 · **Parallel with:** —

**Description:** Ship a minimal title-only create form component (F13 owns the full attribute modal — keep this lean) and wire it into `BoardPage` (replace the empty-state placeholder + add the trigger). Slug comes from `useParams` (URL is source of truth, not the store).

Create / Modify:

- **`frontend/src/components/NewTicketButton.tsx`** (NEW). Minimal create form — a button that toggles an input + submit. F13 will widen to a modal with all attributes.
  ```tsx
  import { useState } from 'react';
  import type { CreateTicketDto } from '@/api/tickets';

  interface NewTicketButtonProps {
    slug: string;
    onCreate: (dto: CreateTicketDto) => void;
    disabled?: boolean;
  }

  export function NewTicketButton({ slug, onCreate, disabled }: NewTicketButtonProps) {
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = title.trim();
      if (!trimmed) return;
      onCreate({ title: trimmed });
      setTitle('');
      setOpen(false);
    };

    if (!open) {
      return (
          <button
              type="button"
              onClick={() => setOpen(true)}
              disabled={disabled}
              className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              aria-label="New ticket"
          >
              + New ticket
          </button>
      );
    }

    return (
        <form onSubmit={handleSubmit} className="flex gap-2" aria-label="Create ticket form">
            <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ticket title"
                maxLength={200}
                className="flex-1 rounded border bg-background px-2 py-1.5 text-sm"
                aria-label="Ticket title"
                autoFocus
            />
            <button
                type="submit"
                disabled={!title.trim() || disabled}
                className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
            >
                Create
            </button>
            <button
                type="button"
                onClick={() => {
                    setTitle('');
                    setOpen(false);
                }}
                className="rounded border px-3 py-1.5 text-sm"
            >
                Cancel
            </button>
        </form>
    );
  }
  ```
  Notes: (a) `slug` prop unused in the component itself (BoardPage binds it to the hook) — drop it from props if the hook lives in BoardPage. Keep the `onCreate` callback pattern so the component is testable in isolation. (b) `maxLength={200}` matches the Zod schema (T4). (c) Tailwind only — no inline styles. (d) RTL-friendly: `aria-label`s on the button/form/input. (e) `autoFocus` for UX.

- **`frontend/src/pages/BoardPage.tsx`** (MODIFY — wire the trigger + hook + replace placeholder).
  - Import `useCreateTicket` + `NewTicketButton`.
  - Add `const { mutate: createTicket } = useCreateTicket(slug);` near the existing `useBoard` call.
  - Replace the whole-board-empty CTA (`BoardPage.tsx:70-76`, "No tickets yet — F12 will add creation.") with a header that includes `<NewTicketButton onCreate={(dto) => createTicket(dto)} />` + an updated empty-state message ("No tickets yet. Create one to get started.").
  - Keep the `<NewTicketButton>` visible in BOTH the empty state and the populated board (place it in the header so it's always reachable).
  ```tsx
  // in the header section:
  <NewTicketButton onCreate={(dto) => createTicket(dto)} />
  // empty-state:
  {isWholeBoardEmpty ? (
      <div role="status" className="...">
          No tickets yet. Create one to get started.
      </div>
  ) : (
      <div className="flex gap-4 overflow-x-auto">{/* existing columns */}</div>
  )}
  ```

- **`frontend/src/components/NewTicketButton.test.tsx`** (NEW). RTL (`getByRole`/`getByLabelText` priority):
  - **renders "+ New ticket" button by default** — assert `getByRole('button', { name: 'New ticket' })`.
  - **click opens the form** — click; assert `getByLabelText('Ticket title')` + `getByRole('button', { name: 'Create' })`.
  - **submit with empty title is a no-op** — type nothing, click Create; assert `onCreate` NOT called.
  - **submit with title calls onCreate + resets** — type "New feature", submit; assert `onCreate` called with `{ title: 'New feature' }`; assert form closed (button back to "+ New ticket").
  - **Cancel closes the form without calling onCreate** — open, click Cancel; assert form closed; assert `onCreate` NOT called.

**Acceptance Criteria:**
- [ ] `NewTicketButton` renders a button by default; click opens a title input + Create/Cancel; submit calls `onCreate({ title })` with trimmed non-empty title; Cancel closes without calling.
- [ ] `BoardPage` wires `useCreateTicket(slug)` + `<NewTicketButton onCreate={...} />` in the header (visible in empty + populated states).
- [ ] Empty-state placeholder updated ("No tickets yet — F12 will add creation." → "No tickets yet. Create one to get started.").
- [ ] Slug from `useParams` (URL source of truth).
- [ ] Component coverage >70%; 4-space JSX indent; Tailwind only; RTL priority order.
- [ ] `npm run typecheck -w frontend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T7 (`useCreateTicket`).

---

### T9 — Integration verification & sign-off

**Batch:** B5 (terminal) · **Depends on:** T1-T8 · **Parallel with:** —

**Description:** The final definition-of-done gate. Run every tool against the as-merged feature, fix gaps, record proof. Includes the live browser smoke F12 owes (its optimistic insert mirrors F11's; F11 deferred its smoke, so F12 MUST run create + inherited DnD together — not automatable headless). Produces the verification record only — NO new feature files.

Steps:

1. **Backend tests:** `rtk vitest --root backend` (or `npm test -- --root backend`) — expect `ticketService.test.ts` (create/allocate), `projects.routes.test.ts` (POST create scenarios) green; F09/F11 suites still green (no regressions).
2. **Frontend tests:** `rtk vitest` — expect `boardInsert.test.ts`, `useCreateTicket.test.ts`, `NewTicketButton.test.tsx`, and the F09/F10/F11 component + hook suites all green.
3. **Typecheck:** `rtk tsc` (or `npx tsc --noEmit` in `frontend/` and `backend/`) — 0 errors. Confirm the new `project_sequences` schema + `CreateTicketDto` types resolve.
4. **Frontend build:** `npm run build` in `frontend/` — 0 errors (Vite production build succeeds).
5. **Lint / format:** `npm run lint`, `npm run format:check` in both workspaces — 0 errors. (If the frontend lacks lint/format scripts — same tooling gap F11 noted — record "lint/format N/A — no scripts" and do NOT add config as part of F12.)
6. **DB migrations:** `npm run db:migrate -w backend` — applies `0005_*` cleanly; `\d project_sequences` shows 2 cols + FK; `\d "Tickets"` shows `tickets_project_number_uq` index; backfill INSERT populated `project_sequences` for all existing projects.
7. **Seed:** `npm run db:seed -w backend` — 1-based ticket numbers; `project_sequences` row exists for the seed project.
8. **Live smoke (backend running + seeded + signed ADMIN/MEMBER JWT):**
    - `POST /api/projects/SLYK/tickets` (authed, body `{ title: 'First' }`) → 201, `body.data.ticketNumber === 1`, `body.data.statusColumn === <first column id>`, `body.data.creatorId === <jwt sub>`, `body.data.position === 65536` (first ticket, bottom = 0 + GAP).
    - `POST /api/projects/SLYK/tickets` (authed, body `{ title: 'Second' }`) → 201, `body.data.ticketNumber === 2`, `body.data.position === 131072` (65536 + GAP).
    - `GET /api/projects/SLYK/board` (authed) → 200, both tickets in the first column sorted ASC by position; IDs render as `SLYK-001`, `SLYK-002`.
    - `POST /api/projects/SLYK/tickets` (no Bearer) → 401.
    - `POST /api/projects/SLYK/tickets` (body `{ title: '' }`) → 400 `VALIDATION_FAILED`.
    - `POST /api/projects/SLYK/tickets` (body `{ title: 'X', statusColumn: '__unsorted__' }`) → 400 `VALIDATION_FAILED`.
    - `POST /api/projects/SLYK/tickets` (body `{ title: 'X', statusColumn: 'ghost' }`) → 400 `VALIDATION_FAILED`.
    - `POST /api/projects/NOPE/tickets` (unknown slug) → 404 `NOT_FOUND`.
    - **Concurrency:** fire two `POST /api/projects/SLYK/tickets` simultaneously (e.g. `Promise.all` in a node script or two curl in parallel) → both 201, distinct `ticketNumber`s (e.g. 3 and 4, never 3 and 3); unique constraint + FOR UPDATE hold.
9. **Frontend smoke (browser):**
    - Login → land on `/projects/SLYK` → board renders with seeded tickets (`SLYK-001`, `SLYK-002`, … at 1-based numbers).
    - Click "+ New ticket" → form opens → type "Browser smoke ticket" → Create → card appears at the bottom of the first column as `SLYK-<next N>`; no full-page flash (optimistic/onSuccess insert).
    - Create a second ticket → `SLYK-<next N+1>` appears below the first.
    - Reload → tickets persist; numbers stable (IDs not reused, not regenerated).
    - **Inherited F11 DnD:** drag the newly-created card to another column → persists on reload; drag it back → persists. (Confirms F12's bottom-placement positions don't break F11's move math.)
    - Empty state: navigate to a project with zero tickets → "No tickets yet. Create one to get started." + the "+ New ticket" button present.
    - Simulate a 500 from `POST /:slug/tickets` (e.g. stop backend mid-create) → form shows the card doesn't stick (onSuccess never fires; onError rollback is a no-op; onSettled invalidates → next poll reconciles). No phantom card.
10. **Record proof:** commit SHA, test/build exit codes, sample API responses, browser smoke results into the F12 verification record (doc commit on `main` after T8, per merge-order rules).

**Acceptance Criteria:**
- [ ] `rtk vitest` FE+BE green (createTicket + allocateTicketNumber + tickets.routes POST + boardInsert + useCreateTicket + NewTicketButton suites added; F08/F09/F10/F11 regression-free).
- [ ] `rtk tsc` / typecheck exit 0 (FE + BE).
- [ ] `npm run build` (frontend) exit 0.
- [ ] Lint/format exit 0 (or recorded N/A if no scripts).
- [ ] `0005_*` migration applies cleanly; `project_sequences` table + `tickets_project_number_uq` index exist; backfill populated all existing projects; seed is 1-based.
- [ ] Every F12 acceptance bullet (§1) satisfied — record commit SHA + observable per bullet.
- [ ] Concurrency smoke: two parallel creates → distinct numbers (no collision).
- [ ] Manual smoke checklist above all pass (or failures filed as follow-ups with owner sign-off).
- [ ] Inherited F11 DnD still works (create + move together).

**Dependencies:** T1-T8.

---

## 7. Final F12 Acceptance Checklist

- [ ] **`Tickets` table per PRD §8.3; `ticket_number` increments per project, never globally.** — `project_sequences` counter + `allocateTicketNumber` (T1, T2) allocate per-project via `FOR UPDATE`; unique `(project_id, ticket_number)` backstop (T1). Concurrency smoke confirms distinct numbers.
- [ ] **ID format `[SLUG]-[NNN]` shown in UI and stable.** — Already implemented at `TicketCard.tsx:13` (`${projectSlug}-${ticket.ticketNumber}`); F12 populates `ticketNumber` via the allocator (T2). 1-based + zero-pad display (D2 — frontend format only, no storage change).
- [ ] **New card lands at the bottom of the first column.** — `createTicket` (T2) computes `position = (max || 0) + POSITION_GAP` for `project.columns[0].id`; `applyCreateToBoard` (T6) appends to the matching column; smoke confirms bottom placement.
- [ ] **`creator_id` set from the authenticated user.** — Route (T4) passes `creatorId: req.user.id`; `createTicket` (T2) stores it; route test asserts the mock receives `req.user.id`.
- [ ] **`status_column` defaults to the project's first column.** — `createTicket` (T2) resolves `statusColumn ?? project.columns[0].id`; unit test confirms default.
- [ ] **Concurrency: two creates at once must not share a number.** — `FOR UPDATE` on `project_sequences` (T2) + unique constraint (T1); live smoke (T9) confirms distinct numbers under `Promise.all`.
- [ ] **Edge: starting number** — 1 + zero-pad (D2); seed updated (T1).
- [ ] **Edge: gap on delete** — IDs never reused; `nextNumber` monotonic; documented (D1). No delete endpoint in F12 (F14).
- [ ] **Edge: slug rename (F27)** — Model A (render-time) shipped; `TODO(F27)` seam left (D8).
- [ ] Lint + format checks pass — exit 0 (or N/A recorded if no scripts).
- [ ] Typecheck + test pass — exit `0 / 0` (FE + BE).
- [ ] Frontend production build pass — exit 0.
- [ ] Inherited F11 DnD regression-free (create + move together).

**Integration record (fill during T9):**
- Feature commit SHA: `________`
- `POST /api/projects/SLYK/tickets` sample response (201 first ticket): `________`
- `POST /api/projects/SLYK/tickets` sample response (201 second ticket): `________`
- Concurrency smoke (two parallel creates → distinct numbers): `________`
- `project_sequences` table DDL proof: `________`
- `tickets_project_number_uq` index proof: `________`
- Lint/format/typecheck/test/build exit codes: `0 / 0 / 0 / 0 / 0`
- Manual browser smoke results: `________` (per checklist in T9)

---

## 8. Schema deltas owned by this feature

F12 owns two schema deltas: a new `project_sequences` table (per-project counter) and a unique `(project_id, ticket_number)` index on `Tickets` (defense-in-depth backstop). **The features.md schema-deltas table does not yet list F12's delta — it should be added.** PRD §8.3 has `ticket_number Integer "Auto-increment per project"` but no `position` column (F09 owns that delta, shipped in `0004`); F12 adds no position change.

| Delta | Detail | Migration |
| --- | --- | --- |
| `project_sequences` table | `project_id uuid PK FK→Projects(id)`, `next_number integer NOT NULL default START_TICKET_NUMBER (1)`. Per-project ticket_number counter; `allocateTicketNumber()` does `SELECT ... FOR UPDATE` on this row inside `db.transaction`. Seeded at `createProject` (T3) + backfilled for existing projects. | CREATE TABLE `project_sequences` + FK — `0005_*.sql` |
| `tickets_project_number_uq` unique index | `UNIQUE (project_id, ticket_number)` on `Tickets`. Defense-in-depth backstop — double-allocation raises PG 23505 → mapped to CONFLICT. Primary mechanism is the `FOR UPDATE` lock (D1). | CREATE UNIQUE INDEX `tickets_project_number_uq` ON `"Tickets" ("project_id", "ticket_number")` — `0005_*.sql` |
| `START_TICKET_NUMBER` constant | Exported from `schema.ts`; value `1`. Naming per style guide (SCREAMING_SNAKE_CASE). Used by `project_sequences.next_number` default + `createProject` seed + (optionally) allocator fallback. | No migration (constant). |
| Backfill (existing projects) | INSERT into `project_sequences` for every `Projects` row: `next_number = COALESCE(MAX(tickets.ticket_number), 0) + 1`. Ensures `allocateTicketNumber` never sees a missing row for F08/F09 projects. | INSERT ... SELECT — `0005_*.sql` |

**`TODO(F27)` seam:** when F27 adds slug rename, decide whether to snapshot an immutable `displayId` string column (Model B) so historical `[SLUG]-[NNN]` IDs don't change on rename. F12 ships Model A (render-time `${currentSlug}-${ticketNumber}`); Model B is reversible (one migration to add the column + backfill). Leave the seam comment in `schema.ts` near the `tickets` table.

---

## 9. Cross-cutting decisions — RESOLVED (owner-approved 2026-06-23)

All five decisions below were owner-approved on 2026-06-23; the recommended option was chosen in each case. The plan body (§3 Key Technical Decisions, tasks T1–T9) already reflects these locks — no change to task scope. **No further sign-off required before Batch 1.** Alternatives retained below for traceability.

- **Q1 — `ticket_number` strategy (D1):** **counter-row + `FOR UPDATE`** ✅ APPROVED vs **unique-constraint + insert-retry** (simpler schema, no new table).
    - **Recommend:** counter-row + `FOR UPDATE` — matches [F09-tasks.md §8](../F09-board-read-columns-cards/F09-board-read-columns-cards-tasks.md) `FOR UPDATE` contract; deadlocks near-zero (1 row locked per tx); gap-tolerant (`nextNumber` monotonic); backed by the unique constraint as defense-in-depth. Drizzle transactions doc (https://orm.drizzle.team/docs/transactions) + PG explicit-locking (https://www.postgresql.org/docs/current/explicit-locking.html). Retry-only is worst under load (retry storms; Drizzle #2474 returning()+onConflictDoNothing misbehaves).
    - **Unblocks:** T1 (schema), T2 (allocator), T4 (route).

- **Q2 — Starting number (D2):** **1 + zero-pad** ✅ APPROVED (`SLYK-001`) vs **101** (seed/PRD-example convention).
    - **Recommend:** 1 — Jira default is `PROJ-1`; no documented "start at 100" convention (Atlassian community). Zero-pad is display-only (no storage change). The seed's 101/102/103 was a placeholder. If the team prefers 101 for aesthetic reasons, flip `START_TICKET_NUMBER` + update the seed — one constant.
    - **Unblocks:** T1 (seed + constant), T2 (allocator reads from the seeded default), FE display formatting.

- **Q3 — New-card placement (D3):** **bottom of first column** ✅ APPROVED (`max + POSITION_GAP`) vs **top** (common kanban UX, `min - POSITION_GAP`).
    - **Recommend:** bottom — simpler position math (no negative positions, no precision-exhaustion drift from repeated prepends); F11 rebalance machinery unchanged; `POSITION_GAP=65536` reused. Top is a UX preference; if chosen, note the negative-position drift tradeoff.
    - **Unblocks:** T2 (position math), T6 (`applyCreateToBoard` appends vs prepends).

- **Q4 — Route shape (D6):** **nested `POST /api/projects/:slug/tickets`** ✅ APPROVED (handler in `projects.routes.ts`) vs **flat `POST /api/tickets`** body `{ projectSlug, ... }` (F11 precedent, handler in `tickets.routes.ts`).
    - **Recommend:** nested — binds the slug cleanly (same param as `GET /:slug/board`), RESTful per `js-development-rules.md`, keeps the create route discoverable next to the board read. Flat is viable and matches F11's `PATCH /api/tickets/:ticketId` precedent, but requires a `projectSlug` body field + duplicate slug validation.
    - **Unblocks:** T4 (route + Zod), T5 (FE client path).

- **Q5 — `displayId` immutability (D8):** **defer snapshot to F27** ✅ APPROVED (render-time Model A now) vs **add immutable `displayId` column now** (Model B).
    - **Recommend:** defer — no slug-rename path exists until F27; Model A (render-time `${currentSlug}-${ticketNumber}`) is already implemented at `TicketCard.tsx:13`; Model B requires a schema column now for a future feature and is reversible (switching later is one migration). If "historical IDs should not change" is a hard requirement the owner wants guaranteed now, choose Model B and add the column in T1.
    - **Unblocks:** T1 (whether to add a `display_id` text column), F27 scope boundary.
