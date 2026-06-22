# F09 — Board read (columns + cards): Plan + Task Breakdown

> **Feature:** F09 — Board read (columns + cards) (Phase 2 — Board Read)
> **Feature index:** [`features.md`](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F08 (merged ✓) · **PRD ref:** REQ-2.1, REQ-2.3, PRD §8.2/§8.3, REQ-3.1
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), `.claude/rules/{js-development-rules,js-style-guide,js-testing-rules,git-guidelines,persona}.md`, plus dependency task doc: [F08](../F08-projects-slug-columns/F08-projects-slug-columns-tasks.md)

---

## 1. F09 Recap

**Goal:** Render a project as a read-only Kanban board — one backend endpoint returns columns + tickets in a single payload, and the frontend `BoardPage` renders cards grouped by `status_column`, sorted by `position`.

**Ships:** Any authenticated user opens `/projects/:slug`, the app calls `GET /api/projects/:slug/board`, and the page renders the project's columns left-to-right (in definition order) with each column's tickets as vertically-sorted cards (ascending `position`). Each card shows the ticket ID (`SLUG-NNN`), title, assignee avatar, priority badge, and labels. Empty columns render an explicit empty state; a whole-board-empty state renders a project-level CTA. Orphaned tickets (whose `status_column` id no longer matches any column) render in a trailing "Unsorted" pseudo-column so nothing ever disappears.

**Acceptance (definition of done):**

1. `GET /api/projects/:slug/board` (the spec's `GET /projects/:id/board` — `:id` interpreted as the project's URL identifier, which is the **slug** in this codebase; see D-Slug-Route) returns columns + tickets in one payload.
2. Cards show title, ticket ID, assignee avatar, priority badge, labels.
3. Empty column renders an explicit empty state (not blank).
4. Board payload groups tickets by `Column.id`; tickets sorted ascending by `position`.
5. Orphaned `status_column` tickets (deleted-column) render under an "Unsorted" bucket and are present in the payload — never silently dropped.
6. Large-board soft cap is enforced + logged (warn at >200 tickets or >12 columns; full virtualization deferred).
7. Whole-board-empty (no tickets at all) renders a project-level empty CTA ("No tickets yet — F12 will add creation").
8. `Tickets` table created (F09 schema delta — see §8) with the PRD §8.3 read-render slice of columns. **F09 ships NO ticket-creation endpoint** (F12 owns creation); F09 delivers the table + a seed/test fixture so reads have data. The empty-board state is an explicitly-accepted outcome until F12 lands.
9. (Edge resolutions below are part of DoD.)

**Edge cases — resolved up front:**

- **Ticket whose `status_column` no longer exists (deleted column)** → **Decision:** the board payload carries a trailing "Unsorted" pseudo-column (`id: UNSORTED_BUCKET_ID`, `name: 'Unsorted'`, `isUnsorted: true`) containing every ticket whose `statusColumn` matches no current `Column.id`. The grouping logic (D-Unsorted-Bucket) is deterministic; the payload never filters orphans. Cards render normally inside it. Rationale: features.md:234 — "still render rather than disappear".
- **Large boards → paginate or virtualize columns; decide a soft cap and log it** → **Decision:** MVP caps are *soft* (warn-only, not truncate): if tickets >200 OR columns >12, `boardService.getBoard` emits `logger.warn({projectId, ticketCount, columnCount}, 'board exceeds soft cap')` and returns the full payload anyway. Full virtualization is OUT of scope (F10+ may revisit). The cap constant `BOARD_SOFT_CAP = { tickets: 200, columns: 12 }` is named (no magic numbers, style guide). Rationale: features.md:235 — "decide a soft cap and log it".
- **Empty column (zero tickets)** → **Decision:** `BoardColumn` renders an explicit empty state ("No tickets" placeholder, accessible `role="status"`). Rationale: features.md:231.
- **Whole-board empty (no tickets at all)** → **Decision:** `BoardPage` renders a project-level empty CTA ("No tickets yet — F12 will add creation"). Distinguished from the per-column empty state. Rationale: decision #7.
- **`position` column not yet introduced (features.md:263 attributes it to F11)** → **Decision:** F09 adds `position DOUBLE PRECISION NOT NULL DEFAULT 0` to `Tickets` and sorts ASC by it for the read render. F11 owns the reorder *write* (drag-persist). **Owner sign-off needed (§9a)** — ownership attribution deviation from features.md:263.
- **No `Tickets` table exists (F09 dep chain = F08 only, but acceptance needs tickets)** → **Decision:** F09 creates the `Tickets` table (Drizzle schema + migration `0004_*.sql`) with the PRD §8.3 read-render slice. **Owner sign-off needed (§9b)** — features.md:278 attributes `Tickets` to F12; no intervening feature owns it, so F09 pulls a slice forward. F09 ships NO ticket-creation endpoint.
- **Priority enum display vs storage** → **Decision:** define `priorityEnum` pgEnum `('LOW','MEDIUM','HIGH','URGENT','CRITICAL')` default `'MEDIUM'` (SCREAMING_SNAKE per style guide). PRD REQ-3.2 Title-Case ("Low", "Medium"...) is UI-display only — `TicketCard` maps the enum to a display label via a `PRIORITY_DISPLAY` constant. Rationale: decision #4.

**Scope boundary (explicit deferrals):**

- **Ticket creation (POST endpoint + "New ticket" UI)** → **F12.** F09 only reads + renders.
- **Drag-and-drop / reorder write / optimistic UI** → **F11.** F09 renders read-only; `position` is read-sorted only.
- **Board auto-polling (30s) + conflict handling** → **F10.** F09 uses the existing `QueryClient` defaults (`staleTime 30_000`, `refetchOnWindowFocus`); the explicit poll interval + hidden-tab pause is F10.
- **Ticket detail view / edit / checklist / comments** → later features.
- **Board virtualization** → F10+ if soft-cap warnings prove insufficient.

---

## 2. Codebase Analysis Summary

- **State:** **Greenfield for the board + tickets.** F08 (projects, slug, columns) is fully implemented and merged on `main`. The board endpoint, `Tickets` table, board service, frontend board client/hook/types, and `BoardPage` content do NOT exist. `BoardPage` is a stub (`frontend/src/pages/BoardPage.tsx:1-9` → `<h1>Board</h1>` + "Board content arrives in F09."; test `BoardPage.test.tsx` asserts the heading only).
- **Existing structure F09 builds on (with path citations):**
  - **Drizzle ORM (pg-core):** `backend/src/db/schema.ts`. Currently declares `roleEnum` (`:14`), `users` (`:18-43`), `Column` interface (`:48-51` `{id, name}`), and `projects` (`:53-69`: `id uuid PK defaultRandom`, `name`, `slug unique`, `columns jsonb .$type<Column[]>()`, `creatorId uuid FK→users`, `createdAt`/`updatedAt` timestamptz). **No `Tickets` table, no `priorityEnum`.** Migrations applied through `0003_curly_golden_guardian.sql`. Migration runner `backend/src/db/migrate.ts`; scripts `npm run db:generate`, `npm run db:migrate` (drizzle-kit). DB client `backend/src/db/client.ts` exports `db`, `pool`.
  - **App entry / MW order:** `backend/src/index.ts:16-54`. helmet → cors (origin `env.frontendUrl`, credentials true) → requestLogger → express.json → `/api/health` → `/api` (ping) → `/api/auth` → `/api/projects` (`:50`) → notFound → errorHandler. F09 adds `GET /:slug/board` to the existing `projectsRouter` (mounted already — no `index.ts` change needed).
  - **Project routes (existing, F08):** `backend/src/routes/projects.routes.ts:1-49` — `GET /`, `GET /:slug`, `POST /` (ADMIN). MW pattern `authenticate → [requireRole] → validateRequest → handler`. F09 appends `GET /:slug/board` (any authed user) reusing `authenticate` + `slugParamSchema`.
  - **Project service (existing, F08):** `backend/src/services/projectService.ts:1-79` — `createProject`, `listProjects`, `getProjectBySlug`. F09 adds `boardService.ts` as a sibling (D-Data-Access-Layer — `services/`, not `repositories/`).
  - **Validation:** `backend/src/middleware/validateRequest.ts` factory `validateRequest({params, body, query})`. Reuse the existing `slugParamSchema` (`backend/src/routes/projects.schema.ts:25-31`, strict `^[A-Z][A-Z0-9]{1,15}$`).
  - **Envelope:** `backend/src/utils/envelope.ts` — `success<T>(data)` (`:28-30`), closed `ErrorCode` vocab (`:5-12`: VALIDATION_FAILED/UNAUTHENTICATED/FORBIDDEN/NOT_FOUND/CONFLICT/INTERNAL_ERROR), `codeToStatus` map. F09 uses `success` + `NOT_FOUND`.
  - **`AppError`:** `backend/src/utils/appError.ts` (constructor takes `details`). Error MW `errorMiddleware.ts` sinks `AppError` → envelope + status (Express 5 auto-catches async throws).
  - **Auth MW:** `authenticate` `backend/src/middleware/auth.ts:9-43` sets `req.user={id,email,role}` (`AuthenticatedUser` `backend/src/types/express.d.ts`, role `'ADMIN'|'MEMBER'`); includes F07 `ver` compare. `requireRole(...roles)` `backend/src/middleware/requireRole.ts` (F08 first-mounted it on POST). Board read needs `authenticate` only (any authed user — D-ProjectMembers: no membership yet).
  - **Users table (for assignee avatar/name):** `backend/src/db/schema.ts:18-43` — `id`, `googleId`, `email`, `fullName`, `avatarUrl` (nullable), `role`, `tokenVersion`, timestamps. Cards expose assignee `fullName` + `avatarUrl` (camelCase; mirror `/auth/me` shape).
  - **JWT claims:** `backend/src/utils/jwt.ts:14-19` `{sub,email,role,ver}` HS256 iss/aud `'slykboard'`/`'slykboard-web'`. Test JWTs signed via `signJwt` (F07 pattern — do not mock the JWT layer in route tests).
  - **Frontend API client:** `frontend/src/api/client.ts:45-131` — `apiFetch<T>(path, init?)` injects Bearer from `useAuthStore`, has the F07 401 refresh-coalescing interceptor (`/auth/*` exempt), throws `ApiClientError` (`.status`/`.code`/`.details`), unwraps `Envelope<T>.data`. F09's `fetchBoard(slug)` builds on this per the js-development-rules `fetchBoard` pattern.
  - **TanStack Query:** `<QueryClientProvider>` at `frontend/src/main.tsx:21`; client `frontend/src/lib/queryClient.ts` `staleTime 30_000`, `refetchOnWindowFocus true`, retry 3 (401 suppressed). Existing hook pattern `frontend/src/hooks/useProjects.ts:6-19` (`useProjects()` + `useProject(slug)` with `enabled: !!slug`).
  - **Query keys:** `frontend/src/api/queryKeys.ts:1-6` `projectKeys={all, lists(), detail(slug)}`. F09 adds `boardKeys.detail(slug)` to the same file.
  - **Frontend routing:** `frontend/src/routes/index.tsx:33-63` — React Router v7 `createBrowserRouter`. Board route `path: '/projects/:slug'` element `<BoardPage />` (`:49`) ALREADY EXISTS. `IndexRedirect` (`:26-31`) `/` → `/projects/:lastSelectedSlug` or `/projects`. URL param = `:slug` (D-Slug-Route confirmed). F09 replaces the `BoardPage` stub content — **no router change needed**.
  - **TopNav picker:** `frontend/src/components/TopNav.tsx:88` → `ProjectPicker.tsx:1-40` (`<select>`; on change `setLastSelectedSlug` + `navigate('/projects/:slug')`). Store `frontend/src/stores/useProjectStore.ts:1-22` key `'slyk-project'`.
  - **Frontend types (hand-mirrored, no codegen):** `frontend/src/types/project.ts` — `Column` (`:2-5`), `Project` (`:7-15`), `CreateProjectDto`. `frontend/src/types/api.ts` — `Envelope<T>`/`ErrorCode`. F09 adds `types/ticket.ts` + extends `types/project.ts` (or a new `types/board.ts`) with `BoardPayload`, `BoardColumn`, `UnsortedBucket`.
  - **Config / env:** `frontend/src/config/env.ts` (`apiBaseUrl` via `VITE_API_BASE_URL`). F09 adds NO env var (polling interval is F10's `POLL_INTERVAL_SECONDS`).
- **Net-new logic F09 creates (no files yet):**
  - `backend/src/db/migrations/0004_*.sql` — `CREATE TYPE "Priority"`, `CREATE TABLE "Tickets"` (+ indexes).
  - `backend/src/db/seed.ts` (or `backend/src/db/seed/board.ts`) — a small board seed for local dev + integration tests (one project, 3 default columns, a few tickets across columns incl. one orphan).
  - `backend/src/services/boardService.ts` — `getBoard(slug)` (group + sort + unsorted bucket + soft-cap warn).
  - `backend/src/services/boardService.test.ts` — unit tests (mock `db` + `projectService`).
  - `backend/src/routes/projects.routes.test.ts` — APPEND `GET /:slug/board` supertest scenarios to the existing F08 suite (or extend in place).
  - `frontend/src/types/ticket.ts` — `Ticket`, `Priority`, `Assignee`, `PRIORITY_DISPLAY`.
  - `frontend/src/types/board.ts` — `BoardColumn`, `BoardPayload`, `UNSORTED_BUCKET_ID`.
  - `frontend/src/api/boards.ts` — `fetchBoard(slug)`.
  - `frontend/src/hooks/useBoard.ts` — `useBoard(slug)`.
  - `frontend/src/components/BoardColumn.tsx` (+ empty state), `frontend/src/components/TicketCard.tsx`, `frontend/src/components/UnsortedBucket.tsx`, `frontend/src/components/PriorityBadge.tsx`, `frontend/src/components/AssigneeAvatar.tsx`.
  - `frontend/src/pages/BoardPage.tsx` — REPLACE the stub with the real board render + whole-board-empty CTA.
- **File paths the plan MODIFIES (exist on `main`):**
  - `backend/src/db/schema.ts` (add `priorityEnum` + `tickets` table).
  - `backend/src/routes/projects.routes.ts` (append `GET /:slug/board`).
  - `frontend/src/api/queryKeys.ts` (add `boardKeys`).
  - `frontend/src/pages/BoardPage.tsx` (replace stub).
  - `frontend/src/pages/BoardPage.test.tsx` (replace heading-only assertion).
- **Project rules this plan must satisfy:** `js-development-rules.md` (RESTful `GET /api/projects/:slug/board`, JSON envelope, layering routes→services, parameterized queries via Drizzle, `fetchBoard(projectId)` client pattern, frontend dirs pages/components/hooks/api/types/stores, React Query server state + Zustand UI state), `js-style-guide.md` (PascalCase components `TicketCard`/`BoardColumn`, camelCase hooks `useBoard`, SCREAMING constants `PRIORITY_DISPLAY`/`BOARD_SOFT_CAP`/`UNSORTED_BUCKET_ID`, `type Priority='LOW'|...`, 4-space JSX / 2-space TS, 100 cols, trailing commas, Prettier, Tailwind NO inline styles, explicit prop interfaces, functions <50 lines early-return async/await, import order external→internal→type→relative, avoid `any`/`console.log`/magic-numbers/prop-drilling), `js-testing-rules.md` (Vitest, co-located `*.test.ts(x)`, table-driven preferred, `vi.fn()` mock, RTL priority getByRole>getByLabelText>getByText>getByTestId, coverage business >80% / components >70%), `git-guidelines.md` (branch `feature/SLYK-F09-board-read-columns-cards`, single-line commits `SLYK-F09: <msg>`, rebase-only no squash), `persona.md` (React 19 + Express 5 + Postgres + Vite + Tailwind).
- **Hidden coupling to plan for:**
  - **MEMORY `drizzle-partial-index-enum-dollar1`:** `drizzle-kit generate` emits unapplyable `$1` SQL for the F06 enum partial index when regenerating. F09's `0004_*.sql` is additive (CREATE TYPE + CREATE TABLE) so the bug *should not* fire, but T1 MUST inspect `0004_*.sql` and confirm no `WHERE "role" = $1`; if present, hand-edit to literal `'ADMIN'`.
  - **`statusColumn` references a `Column.id` (text, not FK).** Projects.columns is JSONB; there is no `Columns` table to FK against. `Tickets.statusColumn` is therefore a plain `text` column holding a column `id` string — integrity enforced at read time by the grouping logic (D-Unsorted-Bucket), not by a DB constraint. Document this.
  - **`position` type choice.** PRD §8.3 doesn't specify a type; features.md:263 suggests `DOUBLE PRECISION` or integer gap. F09 picks `doublePrecision` (F11 will use fractional positions for insert-between without rewriting neighbors). Default `0`.
  - **`labels` storage.** PRD §8.3 says `labels string[]`; F09 stores `jsonb` (`.$type<string[]>()`) for forward-compat with richer label objects later. Read-render treats each as a string badge.
  - **`ticketNumber` is per-project sequential (REQ-3.1).** F09 only reads it; F12 owns the per-project counter + `FOR UPDATE`. F09's seed sets explicit numbers (101, 102, …).
  - **Ticket ID display format `[SLUG]-[NNN]`** (REQ-3.1). `TicketCard` renders `${project.slug}-${ticket.ticketNumber}`. The backend does NOT serialize a preformatted `id` string — the frontend composes it (slug is already known from the URL/board payload).
  - **Assignee join.** `Tickets.assigneeId` nullable FK→`Users.id`. `boardService.getBoard` must join Users for `fullName`+`avatarUrl` on tickets that have an assignee; unassigned → `assignee: null`.
  - **`creatorId` not rendered on the card** (F09 acceptance lists title/ID/assignee/priority/labels). F09 still stores + returns `creatorId` for completeness; F12+ may surface it.
  - **Express 5 async.** Rejected promises in async MW/routes auto-caught by `errorHandler`. No try/catch wrapper for control-flow throws.
  - **`verbatimModuleSyntax`.** Type-only imports use `import type`.
  - **No env var added.** F09 needs no new env (`DATABASE_URL` present; polling interval is F10's). Document so reviewers don't expect one.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale (cite source) |
|---|----------|--------|-----------|
| D-Slug-Route | **Board route param** | **`GET /api/projects/:slug/board`** (spec's `:id` reinterpreted as slug) | features.md:229 says `:id`, but this codebase routes projects by slug everywhere (`projects.routes.ts:19-31`, `routes/index.tsx:49`). The project's URL identifier IS the slug. **Delta from features.md:229 — LOCKED §9c (owner: "slug routing is better").** |
| D-Tickets-Table | **`Tickets` table ownership** | **F09 creates `Tickets` (read-render slice of PRD §8.3)** | features.md:278 attributes `Tickets` to F12, but F09 acceptance requires rendering tickets and no intervening feature owns the table. F09 ships the table + a seed; NO creation endpoint. **Delta from features.md:278 — LOCKED §9b.** |
| D-Position-Column | **`Tickets.position`** | **`doublePrecision('position').notNull().default(0)`; sort ASC for read** | features.md:263 attributes `position` to F11, but F09 needs read-sort. F11 owns the reorder write; F09 adds the column + read-sort. **Delta from features.md:263 — LOCKED §9a.** |
| D-Priority-Enum | **Priority storage vs display** | **pgEnum `('LOW','MEDIUM','HIGH','URGENT','CRITICAL')` default `'MEDIUM'` (SCREAMING_SNAKE); Title-Case is UI-only via `PRIORITY_DISPLAY`** | Style guide mandates SCREAMING_SNAKE for enums/constants; PRD REQ-3.2 Title-Case is display formatting. decision #4. |
| D-Unsorted-Bucket | **Orphaned `status_column`** | **Trailing pseudo-column `{id: UNSORTED_BUCKET_ID, name: 'Unsorted', isUnsorted: true}` in the payload; grouping is deterministic; payload never drops orphans** | features.md:234 — "still render rather than disappear". Integrity is read-time (no Columns table to FK against — `statusColumn` is text). |
| D-Soft-Cap | **Large-board cap** | **Warn-only soft cap: `BOARD_SOFT_CAP = {tickets: 200, columns: 12}`; `logger.warn` + full payload returned; no truncate/virtualize in F09** | features.md:235 — "decide a soft cap and log it". Full virtualization deferred to F10+. |
| D-Empty-State | **Empty column vs empty board** | **Per-column: explicit "No tickets" empty state; whole-board: project-level CTA "No tickets yet — F12 will add creation"** | features.md:231 + decision #7. Distinguished so users see intent, not blank space. |
| D-Board-Payload | **Single-call payload shape** | **`{project: {id, name, slug}, columns: BoardColumn[], tickets: Ticket[]}` flat — frontend groups; OR `{project, columns: [{column, tickets: []}]}` nested. PICK: nested-by-column for render ergonomics, plus a flat `unsorted: Ticket[]`.** | features.md:229 — "columns + tickets in one payload". Nested shape maps 1:1 to `BoardColumn` components; unsorted is its own slot. See §4 payload contract. |
| D-Data-Access-Layer | **Board service module** | **`services/boardService.ts` (NOT `repositories/`)** | `repositories/` empty by convention; F08 established `services/`. Cite codebase convention. |
| D-Assignee-Shape | **Assignee serialization** | **`assignee: {id, fullName, avatarUrl} | null` (camelCase, mirrors `/auth/me`)** | Users table has `fullName` + nullable `avatarUrl` (`schema.ts:24-25`). Nullable → unassigned. |
| D-Polling | **Polling interval** | **None new — inherit QueryClient defaults (`staleTime 30_000`, `refetchOnWindowFocus`)** | F10 owns `POLL_INTERVAL_SECONDS` + hidden-tab pause. F09 is read-on-navigate + background refetch via defaults. |
| D-Auth-Scope | **Board read auth** | **`authenticate` only (any authed user); no `requireRole`** | D-ProjectMembers (F08 §9b): all authed users see all projects. Board read is not admin-gated. |

> **Out of F09 scope (explicitly deferred):**
> - **Ticket creation (POST + "New ticket" UI)** → F12.
> - **Drag-and-drop / reorder write / optimistic UI** → F11.
> - **Board auto-polling (30s) + conflict handling + hidden-tab pause** → F10.
> - **Ticket detail / edit / checklist / comments** → later features.
> - **Board virtualization** → F10+ if soft-cap warnings prove insufficient.

> **Owner decisions OBTAINED 2026-06-23 (3 deviations from features.md — all LOCKED):**
> - **(a) D-Position-Column** — F09 adds `Tickets.position` (features.md:263 attributes it to F11). Locked.
> - **(b) D-Tickets-Table** — F09 creates the `Tickets` table (features.md:278 attributes it to F12). Locked.
> - **(c) D-Slug-Route** — endpoint is `:slug` not `:id` (features.md:229). Locked.
> See §9 for the resolved sign-off block.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/                                                  # repo root
├── backend/
│   └── src/
│       ├── db/
│       │   ├── schema.ts                                   # MODIFY (T1) — add priorityEnum + tickets table
│       │   ├── seed.ts                                     # NEW (T2) — board seed (project + columns + tickets incl. orphan)
│       │   └── migrations/
│       │       └── 0004_<auto>.sql                         # NEW (T1) — CREATE TYPE "Priority" + CREATE TABLE "Tickets"
│       ├── services/
│       │   ├── boardService.ts                             # NEW (T3) — getBoard(slug): group + sort + unsorted + soft-cap warn
│       │   └── boardService.test.ts                        # NEW (T3)
│       └── routes/
│           └── projects.routes.ts                          # MODIFY (T4) — append GET /:slug/board
│           (projects.routes.test.ts                        # MODIFY (T4) — append board supertest scenarios)
└── frontend/
    └── src/
        ├── types/
        │   ├── ticket.ts                                   # NEW (T5) — Ticket, Priority, PRIORITY_DISPLAY, Assignee
        │   └── board.ts                                    # NEW (T5) — BoardColumn, BoardPayload, UNSORTED_BUCKET_ID
        ├── api/
        │   ├── boards.ts                                   # NEW (T6) — fetchBoard(slug)
        │   └── queryKeys.ts                                # MODIFY (T6) — add boardKeys
        ├── hooks/
        │   ├── useBoard.ts                                 # NEW (T6) — useBoard(slug)
        │   └── useBoard.test.ts                            # NEW (T6)
        ├── components/
        │   ├── BoardColumn.tsx                             # NEW (T7) — column + per-column empty state
        │   ├── TicketCard.tsx                              # NEW (T7) — title + ticketID + assignee + priority + labels
        │   ├── UnsortedBucket.tsx                          # NEW (T7) — trailing pseudo-column
        │   ├── PriorityBadge.tsx                           # NEW (T7)
        │   └── AssigneeAvatar.tsx                          # NEW (T7)
        └── pages/
            ├── BoardPage.tsx                               # MODIFY (T8) — replace stub; render columns + whole-board-empty CTA
            └── BoardPage.test.tsx                          # MODIFY (T8) — replace heading-only assertion
```

**Board payload contract (`GET /api/projects/:slug/board` → `success<BoardPayload>`):**

```typescript
// Frontend mirror — frontend/src/types/board.ts
interface BoardColumn {
  id: string;            // Column.id from project.columns, or UNSORTED_BUCKET_ID
  name: string;          // Column.name, or 'Unsorted'
  isUnsorted: boolean;   // false for real columns, true for the bucket
  tickets: Ticket[];     // sorted ASC by position
}
interface BoardPayload {
  project: { id: string; name: string; slug: string };
  columns: BoardColumn[]; // real columns in project.columns order, then unsorted bucket LAST (only if non-empty)
}
// Ticket shape — frontend/src/types/ticket.ts
interface Ticket {
  id: string;
  ticketNumber: number;
  title: string;
  statusColumn: string;      // Column.id (or orphan id)
  position: number;
  priority: Priority;
  labels: string[];
  assignee: { id: string; fullName: string; avatarUrl: string | null } | null;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
}
```

**Request lifecycle (`GET /api/projects/:slug/board`, post-F09):**

1. Client `fetchBoard(slug)` → `apiFetch('/projects/:slug/board')` → Bearer injected.
2. `authenticate` (F07): verifies JWT + `ver` compare → `req.user={id,email,role}`.
3. `validateRequest({params: slugParamSchema})`: strict uppercase regex → `VALIDATION_FAILED`/400 on bad slug.
4. Handler calls `boardService.getBoard(slug)`:
   - `projectService.getProjectBySlug(slug)` → `null` → `NOT_FOUND`/404.
   - Load tickets `WHERE projectId = project.id ORDER BY position ASC` (Drizzle parameterized — never string-concat SQL).
   - Join Users for assignee `fullName`+`avatarUrl` on non-null `assigneeId`.
   - Group: for each `column` in `project.columns`, collect tickets where `statusColumn === column.id`. Leftovers (orphan `statusColumn`) → unsorted bucket, appended last **only if non-empty**.
   - Soft-cap check: if `tickets.length > 200 || columns.length > 12` → `logger.warn`.
5. Returns `{data: {project, columns}}`.

**Render lifecycle (frontend, post-F09):**

1. `/projects/:slug` → `BoardPage` reads `:slug` → `useBoard(slug)` (TanStack Query, `enabled: !!slug`) → `fetchBoard(slug)`.
2. Loading → skeleton; error → error state (`ApiClientError`); success → render `columns.map(c => <BoardColumn>)`; if unsorted bucket present, render `<UnsortedBucket>` last.
3. `BoardColumn` renders header + `tickets.map(t => <TicketCard>)` OR the per-column empty state.
4. `TicketCard` renders `${project.slug}-${ticket.ticketNumber}`, title, `<AssigneeAvatar>`, `<PriorityBadge>`, labels.
5. If `columns` non-empty but every column has zero tickets → still render columns with per-column empty states. If `columns` empty OR all columns empty AND no unsorted → whole-board-empty CTA.

---

## 5. Parallelization Strategy

Tasks grouped into **4 batches** by dependency order. Within a batch, tasks touch **disjoint file sets** → zero merge conflicts. Backend (B1–B2) and frontend (B3) are disjoint trees → two developers, zero conflicts.

### Batch dependency diagram

```
              ┌─────────────────────────────────────────────────────────────┐
   Batch 1    │ T1  priorityEnum + Tickets table + migration 0004             │
   (foundation│     [db/schema.ts, db/migrations/0004_*.sql]                 │
   blocks all)│ T2  board seed (project + columns + tickets incl. orphan)     │
              │     [db/seed.ts] (T1 & T2 disjoint after T1 lands: schema vs  │
              │      seed — T2 imports the table T1 defines, so T2 depends on │
              │      T1; serialize T1→T2 within B1)                          │
              └──────────────┬──────────────────────────────────────────────┘
                             │ (table + seed exist)
                             ▼
              ┌─────────────────────────────────────────────────────────────┐
   Batch 2    │ T3  boardService (getBoard: group + sort + unsorted + cap)   │
   (backend,  │     [services/boardService.ts+test]                          │
   after B1)  │ T4  board route (append GET /:slug/board) + supertest        │
              │     [routes/projects.routes.ts + test]                       │
              │     (T3 & T4 disjoint: services vs routes — parallel ok;     │
              │      T4 mocks boardService so it need not be merged first)   │
              └──────────────┬──────────────────────────────────────────────┘
                             │ (board API contract stable)
                             ▼
              ┌─────────────────────────────────────────────────────────────┐
   Batch 3    │ T5  types/ticket.ts + types/board.ts                         │
   (frontend, │ T6  api/boards.ts + queryKeys boardKeys + hooks/useBoard.ts  │
   after API  │ T7  BoardColumn + TicketCard + Unsorted + PriorityBadge +    │
   stable)    │      AssigneeAvatar                                          │
              │ T8  BoardPage wiring (replace stub) + BoardPage.test.tsx     │
              │     (disjoint files — split across devs; T8 consumes T5/T6/  │
              │      T7 — agree type contracts up front)                    │
              └──────────────┬──────────────────────────────────────────────┘
                             │ (frontend complete)
                             ▼
              ┌─────────────────────────────────────────────────────────────┐
   Batch 4    │ T9 Acceptance gate (terminal)                                │
   (gate)     │     (no files; lint/typecheck/test/build/db:migrate + smoke) │
              └─────────────────────────────────────────────────────────────┘
```

- **B1 (T1 → T2) hard barrier:** the seed (T2) imports the `tickets` table T1 defines; serialize T1 then T2 within B1.
- **B2 (T3 ‖ T4) barrier after B1:** service + route both need the `Tickets` table. T4 mocks `boardService` so it can proceed in parallel with T3 (disjoint files).
- **B2 → B3 hard barrier:** frontend api/hooks/types need the stable payload contract (§4). Pin the `BoardPayload`/`Ticket` shapes up front if splitting across devs.
- **Within B3: T5 ‖ T6 ‖ T7 ‖ T8 (disjoint files)** with the type-contract caveat: T6/T7/T8 consume T5's types — agree shapes up front, then parallel.

### Merge order rules

1. **B1: T1 then T2 merge first, in order.** T2 depends on T1's table.
2. **B2: (T3 ‖ T4) merge second, any order.** Disjoint files (services vs routes). T4 branches off post-T1/T2 `main`; T4 mocks boardService so it doesn't block on T3.
3. **B3: (T5 ‖ T6 ‖ T7 ‖ T8) merge in parallel, any order after B2.** Disjoint frontend trees. Pin the `Ticket`/`BoardPayload`/`BoardColumn` shapes before splitting so T6/T7/T8 agree.
4. **B4 (T9) merges last.** Terminal verification; owns no files.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | B1 | `backend/src/db/schema.ts`, `backend/src/db/migrations/0004_*.sql` | F08 | — (B1 seed) |
| **T2** | B1 | `backend/src/db/seed.ts` (NEW) | T1 | — |
| **T3** | B2 | `backend/src/services/boardService.ts` (NEW), `backend/src/services/boardService.test.ts` (NEW) | T1, T2 | T4 |
| **T4** | B2 | `backend/src/routes/projects.routes.ts`, `backend/src/routes/projects.routes.test.ts` | T1 (mocks T3) | T3 |
| **T5** | B3 | `frontend/src/types/ticket.ts` (NEW), `frontend/src/types/board.ts` (NEW) | T4 (contract) | T6, T7, T8 |
| **T6** | B3 | `frontend/src/api/boards.ts` (NEW), `frontend/src/api/queryKeys.ts`, `frontend/src/hooks/useBoard.ts` (NEW), `frontend/src/hooks/useBoard.test.ts` (NEW) | T5 | T7, T8 |
| **T7** | B3 | `frontend/src/components/BoardColumn.tsx` (NEW), `TicketCard.tsx` (NEW), `UnsortedBucket.tsx` (NEW), `PriorityBadge.tsx` (NEW), `AssigneeAvatar.tsx` (NEW) | T5 | T6, T8 |
| **T8** | B3 | `frontend/src/pages/BoardPage.tsx`, `frontend/src/pages/BoardPage.test.tsx` | T5, T6, T7 | — (frontend terminal) |
| **T9** | B4 | (no files — terminal verification) | T4, T8 | — |

### Developer assignment tracks

- **Solo (recommended):** T1 → T2 → (T3 ‖ T4) → (T5 ‖ T6 ‖ T7 ‖ T8) → T9. ~1.5–2 days.
- **2 devs (max parallelism):**
  - **Dev-A (backend):** T1 → T2 → (T3 ‖ T4) → help T9.
  - **Dev-B (frontend):** waits for B2 contract, then (T5 ‖ T6 ‖ T7 ‖ T8) → help T9.
  - Merge order: B1 → B2 → B3 (B3 starts once T4 contract is agreed, even before B2 fully merges, if types are pinned up front).
- **3 devs:**
  - **Dev-A (backend core):** T1 → T2 → T3.
  - **Dev-B (backend route):** T4 (after T1; mocks T3).
  - **Dev-C (frontend):** (T5 ‖ T6 ‖ T7 ‖ T8) → T9.

---

## 6. Tasks

### T1 — Backend: Drizzle `priorityEnum` + `tickets` schema + migration 0004

**Batch:** B1 · **Depends on:** F08 (merged) · **Parallel with:** — (T2 follows)

**Description:** Add the `priorityEnum` pgEnum and the `tickets` table to Drizzle schema (D-Tickets-Table, D-Position-Column, D-Priority-Enum; schema delta §8) and generate migration `0004`. This is the storage foundation — T2 (seed), T3 (service), T4 (route) all depend on it. The `statusColumn` is a plain `text` (no Columns table to FK against — integrity is read-time via D-Unsorted-Bucket); `assigneeId`/`creatorId` are FK→`users.id`; `position` is `doublePrecision` (F09 read-sorts ASC; F11 will write-reorder).

Create / Modify:

- **`backend/src/db/schema.ts`** (MODIFY). Add `priorityEnum` + `tickets` table.

  Add `doublePrecision` to the `drizzle-orm/pg-core` import (keep the existing import list tidy). Add the enum + table after the `projects` block:

  ```typescript
  // F09 D-Priority-Enum: SCREAMING_SNAKE per style guide. PRD REQ-3.2 Title-Case is UI-only.
  export const priorityEnum = pgEnum('Priority', [
    'LOW',
    'MEDIUM',
    'HIGH',
    'URGENT',
    'CRITICAL',
  ]);

  // F09 D-Tickets-Table: PRD §8.3 read-render slice. F12 owns creation.
  // statusColumn is text (references a Column.id in Projects.columns JSONB) —
  // no Columns table exists, so integrity is enforced at read time (D-Unsorted-Bucket).
  // position is doublePrecision: F09 read-sorts ASC; F11 will write-reorder.
  export const tickets = pgTable('Tickets', {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id),
    ticketNumber: integer('ticket_number').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    statusColumn: text('status_column').notNull(),
    position: doublePrecision('position').notNull().default(0),
    assigneeId: uuid('assignee_id').references(() => users.id),
    creatorId: uuid('creator_id')
      .notNull()
      .references(() => users.id),
    priority: priorityEnum('priority').default('MEDIUM').notNull(),
    // F09: labels as jsonb string[] for forward-compat (richer label objects later).
    labels: jsonb('labels').$type<string[]>().default([]).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  });
  ```

  Notes: (a) `doublePrecision` is the Drizzle pg-core helper for `double precision`. (b) `statusColumn` camelCase access → `status_column` snake_case column. (c) `labels` `.$type<string[]>()` gives TS shape without runtime check; the seed + future F12 set valid arrays. (d) `assigneeId` nullable (unassigned tickets). (e) **DO NOT touch `usersOneAdminIdx`** (F06) or the existing `projects`/`users` blocks. (f) No partial enum index on `tickets` → MEMORY `drizzle-partial-index-enum-dollar1` should NOT fire on additive CREATE TYPE + CREATE TABLE, but T1 still inspects `0004_*.sql`.

- **Generate the migration** from `backend/`:
  ```bash
  npm run db:generate -w backend
  ```
  Produces `backend/src/db/migrations/0004_<auto-name>.sql`. Verify it contains CREATE TYPE + CREATE TABLE + indexes:
  ```sql
  CREATE TYPE "Priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL');
  CREATE TABLE IF NOT EXISTS "Tickets" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "project_id" uuid NOT NULL,
    "ticket_number" integer NOT NULL,
    "title" text NOT NULL,
    "description" text,
    "status_column" text NOT NULL,
    "position" double precision DEFAULT 0 NOT NULL,
    "assignee_id" uuid,
    "creator_id" uuid NOT NULL,
    "priority" "Priority" DEFAULT 'MEDIUM' NOT NULL,
    "labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
  );
  ALTER TABLE "Tickets" ADD CONSTRAINT "Tickets_project_id_Projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "Projects"("id") ON DELETE no action ON UPDATE no action;
  ALTER TABLE "Tickets" ADD CONSTRAINT "Tickets_assignee_id_Users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "Users"("id") ON DELETE no action ON UPDATE no action;
  ALTER TABLE "Tickets" ADD CONSTRAINT "Tickets_creator_id_Users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "Users"("id") ON DELETE no action ON UPDATE no action;
  ```
  (Exact DDL varies by drizzle-kit version — confirm shape, not wording.)

  **CRITICAL — inspect for `$1` regression:** open `0004_*.sql`; confirm NO `WHERE "role" = $1` anywhere. If present (unlikely on additive CREATE TYPE/TABLE), hand-edit to literal `'ADMIN'`. Cite MEMORY `drizzle-partial-index-enum-dollar1`.

  Apply locally:
  ```bash
  npm run db:migrate -w backend
  psql "$DATABASE_URL" -c '\d "Tickets"'
  ```
  Confirm all 13 columns + the 3 FKs appear and `"Priority"` type exists.

**Acceptance Criteria:**
- [ ] `schema.ts` declares `priorityEnum` (`LOW`..`CRITICAL`) + `tickets` table with `id`, `projectId` (FK→projects.id), `ticketNumber` int, `title`, `description` (nullable), `statusColumn` text, `position` doublePrecision default 0, `assigneeId` (nullable FK→users.id), `creatorId` (FK→users.id), `priority` (default `'MEDIUM'`), `labels` (`$type<string[]>` default `[]`), `createdAt`, `updatedAt`.
- [ ] `0004_*.sql` generated; contains CREATE TYPE `"Priority"` + CREATE TABLE `"Tickets"` + 3 FKs; NO `$1` regression (or hand-reconciled).
- [ ] `npm run db:migrate` applies cleanly; `\d "Tickets"` shows all columns + FKs; `\dT "Priority"` shows the enum.
- [ ] `usersOneAdminIdx` + `projects` UNCHANGED (F06/F08 not regressed).
- [ ] `npm run typecheck -w backend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** F08 (`projects` table, migration runner). Blocks T2.

---

### T2 — Backend: board seed (project + columns + tickets incl. orphan)

**Batch:** B1 · **Depends on:** T1 · **Parallel with:** —

**Description:** Ship `backend/src/db/seed.ts` — an idempotent board seed so local dev and integration tests have data to render (F09 ships no creation endpoint; the seed is the read-data source until F12). Seeds one project (reuse an existing project or create `SLYK` with default columns), a known user (assignee/creator), and a handful of tickets across columns — **including one orphan** whose `statusColumn` matches no column id (proves D-Unsorted-Bucket). Idempotent: truncate `Tickets` (and the seeded project if created) before inserting, or upsert by a stable key.

Create / Modify:

- **`backend/src/db/seed.ts`** (NEW).

  ```typescript
  import { randomUUID } from 'node:crypto';
  import { db } from './db/client';
  import { tickets, projects, users, type Column } from './db/schema';
  import { eq } from 'drizzle-orm';

  // F09: read-render seed. F12 owns creation; this gives the board endpoint data.
  // Idempotent: wipes seeded rows then re-inserts. Run via `npm run db:seed -w backend`.
  const SEED_PROJECT_SLUG = 'SLYK';
  const SEED_USER_EMAIL = 'seed@slykboard.local';
  const ORPHAN_COLUMN_ID = 'orphan-column-id-not-in-project'; // D-Unsorted-Bucket proof

  export async function seedBoard(): Promise<void> {
    // 1. Ensure seed user exists (assignee + creator).
    const [user] = await db
      .insert(users)
      .values({
        googleId: SEED_USER_EMAIL,
        email: SEED_USER_EMAIL,
        fullName: 'Seed User',
        role: 'MEMBER',
      })
      .onConflictDoUpdate({ target: users.email, set: { fullName: 'Seed User' } })
      .returning();

    // 2. Ensure seed project exists with default columns (D-Default-Columns from F08).
    const [project] = await db
      .insert(projects)
      .values({
        name: 'Slyk',
        slug: SEED_PROJECT_SLUG,
        columns: [
          { id: 'col-todo', name: 'To Do' },
          { id: 'col-doing', name: 'In Progress' },
          { id: 'col-done', name: 'Done' },
        ] satisfies Column[],
        creatorId: user!.id,
      })
      .onConflictDoUpdate({ target: projects.slug, set: { name: 'Slyk' } })
      .returning();

    // 3. Wipe + re-insert tickets for this project (idempotent).
    await db.delete(tickets).where(eq(tickets.projectId, project!.id));

    const now = new Date();
    await db.insert(tickets).values([
      {
        projectId: project!.id,
        ticketNumber: 101,
        title: 'Render board columns',
        statusColumn: 'col-todo',
        position: 10,
        assigneeId: user!.id,
        creatorId: user!.id,
        priority: 'HIGH',
        labels: ['frontend'],
        createdAt: now,
        updatedAt: now,
      },
      {
        projectId: project!.id,
        ticketNumber: 102,
        title: 'Group tickets by column',
        statusColumn: 'col-doing',
        position: 20,
        assigneeId: null,
        creatorId: user!.id,
        priority: 'MEDIUM',
        labels: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        projectId: project!.id,
        ticketNumber: 103,
        title: 'Orphan ticket (deleted column)',
        statusColumn: ORPHAN_COLUMN_ID, // matches no project column → Unsorted
        position: 30,
        assigneeId: user!.id,
        creatorId: user!.id,
        priority: 'LOW',
        labels: ['edge-case'],
        createdAt: now,
        updatedAt: now,
      },
    ]);
  }

  seedBoard()
    .then(() => {
      console.log('F09 board seed applied');
      process.exit(0);
    })
    .catch((err) => {
      console.error('F09 board seed failed', err);
      process.exit(1);
    });
  ```

  Notes: (a) Stable column ids (`col-todo` etc.) so tickets reference real ids and the orphan (`ORPHAN_COLUMN_ID`) is provably absent. (b) `onConflictDoUpdate` on `users.email` / `projects.slug` for idempotency. (c) `db.delete(tickets).where(projectId === project.id)` then re-insert — wipes only this project's tickets. (d) Add an npm script `db:seed` to `backend/package.json` (`"db:seed": "tsx src/db/seed.ts"` — match the existing `db:migrate` runner convention; if `tsx` isn't a dep, use the same loader `db/migrate.ts` uses). (e) `randomUUID` imported but unused above — remove it (style guide: no unused). (f) The `satisfies Column[]` keeps the JSONB typed. (g) **Do not seed via the API** — F09 has no creation endpoint; this is a direct DB seed.

**Acceptance Criteria:**
- [ ] `seed.ts` is idempotent (run twice → same final state, no duplicate-key errors).
- [ ] Seeds one project (`SLYK`, 3 columns with stable ids), one user, ≥3 tickets incl. one orphan (`statusColumn` not in `project.columns`).
- [ ] At least one ticket is unassigned (`assigneeId: null`) and at least one assigned.
- [ ] `npm run db:seed -w backend` runs cleanly; `psql -c 'select count(*) from "Tickets"'` reflects the seed.
- [ ] `npm run typecheck -w backend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T1 (`tickets` table). Blocks T3.

---

### T3 — Backend: `boardService` + unit tests

**Batch:** B2 · **Depends on:** T1, T2 · **Parallel with:** T4

**Description:** Ship the data-access + grouping layer (D-Data-Access-Layer): `backend/src/services/boardService.ts` exporting `getBoard(slug)`. It loads the project (via `projectService.getProjectBySlug`), loads the project's tickets ordered by `position ASC` (Drizzle parameterized), joins Users for assignee `fullName`+`avatarUrl`, groups tickets by `Column.id`, collects orphans into the unsorted bucket (appended last, only if non-empty), enforces the soft-cap warn (D-Soft-Cap), and returns the `BoardPayload`. Unit tests mock `db` + `projectService`.

Create / Modify:

- **`backend/src/services/boardService.ts`** (NEW).

  ```typescript
  import { and, asc, eq } from 'drizzle-orm';
  import { db } from '../db/client';
  import { tickets, users } from '../db/schema';
  import { AppError } from '../utils/appError';
  import { ErrorCode } from '../utils/envelope';
  import { logger } from '../config/logger';
  import { getProjectBySlug } from './projectService';

  // F09 D-Unsorted-Bucket: stable id for the orphan pseudo-column.
  export const UNSORTED_BUCKET_ID = '__unsorted__';
  const UNSORTED_BUCKET_NAME = 'Unsorted';

  // F09 D-Soft-Cap: warn-only (no truncate). Full virtualization is F10+.
  export const BOARD_SOFT_CAP = Object.freeze({ tickets: 200, columns: 12 });

  export interface BoardAssignee {
    id: string;
    fullName: string;
    avatarUrl: string | null;
  }

  export interface BoardTicket {
    id: string;
    ticketNumber: number;
    title: string;
    statusColumn: string;
    position: number;
    priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | 'CRITICAL';
    labels: string[];
    assignee: BoardAssignee | null;
    creatorId: string;
    createdAt: Date;
    updatedAt: Date;
  }

  export interface BoardColumn {
    id: string;
    name: string;
    isUnsorted: boolean;
    tickets: BoardTicket[];
  }

  export interface BoardPayload {
    project: { id: string; name: string; slug: string };
    columns: BoardColumn[];
  }

  export async function getBoard(slug: string): Promise<BoardPayload> {
    // F08: project lookup by slug.
    const project = await getProjectBySlug(slug);
    if (!project) {
      throw new AppError(ErrorCode.NOT_FOUND, `Project '${slug}' not found`);
    }

    // F09: load this project's tickets ordered by position ASC (parameterized —
    // never string-concat SQL). Left-join users for assignee.
    const rows = await db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        title: tickets.title,
        statusColumn: tickets.statusColumn,
        position: tickets.position,
        priority: tickets.priority,
        labels: tickets.labels,
        assigneeId: tickets.assigneeId,
        creatorId: tickets.creatorId,
        createdAt: tickets.createdAt,
        updatedAt: tickets.updatedAt,
        assigneeFullName: users.fullName,
        assigneeAvatarUrl: users.avatarUrl,
        assigneeRowId: users.id,
      })
      .from(tickets)
      .leftJoin(users, eq(users.id, tickets.assigneeId))
      .where(and(eq(tickets.projectId, project.id)))
      .orderBy(asc(tickets.position));

    const allTickets: BoardTicket[] = rows.map((r) => ({
      id: r.id,
      ticketNumber: r.ticketNumber,
      title: r.title,
      statusColumn: r.statusColumn,
      position: r.position,
      priority: r.priority,
      labels: r.labels ?? [],
      assignee: r.assigneeId
        ? { id: r.assigneeRowId!, fullName: r.assigneeFullName!, avatarUrl: r.assigneeAvatarUrl }
        : null,
      creatorId: r.creatorId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    // F09 D-Soft-Cap: warn (not truncate).
    if (
      allTickets.length > BOARD_SOFT_CAP.tickets ||
      project.columns.length > BOARD_SOFT_CAP.columns
    ) {
      logger.warn(
        {
          projectId: project.id,
          ticketCount: allTickets.length,
          columnCount: project.columns.length,
        },
        'board exceeds soft cap',
      );
    }

    // F09 D-Unsorted-Bucket: group by Column.id; orphans → trailing bucket.
    const columnIds = new Set(project.columns.map((c) => c.id));
    const byColumn = new Map<string, BoardTicket[]>();
    const unsorted: BoardTicket[] = [];

    for (const t of allTickets) {
      if (columnIds.has(t.statusColumn)) {
        const list = byColumn.get(t.statusColumn) ?? [];
        list.push(t);
        byColumn.set(t.statusColumn, list);
      } else {
        unsorted.push(t);
      }
    }

    const columns: BoardColumn[] = project.columns.map((c) => ({
      id: c.id,
      name: c.name,
      isUnsorted: false,
      tickets: byColumn.get(c.id) ?? [],
    }));

    if (unsorted.length > 0) {
      columns.push({
        id: UNSORTED_BUCKET_ID,
        name: UNSORTED_BUCKET_NAME,
        isUnsorted: true,
        tickets: unsorted,
      });
    }

    return {
      project: { id: project.id, name: project.name, slug: project.slug },
      columns,
    };
  }
  ```

  Notes: (a) `getProjectBySlug` reused from F08 (`projectService.ts:75-78`) — returns `null` → `NOT_FOUND`. (b) `leftJoin` users so unassigned tickets still return (assignee fields null). (c) Grouping is O(tickets) — fine within soft cap. (d) `unsorted` appended **only if non-empty** (no empty Unsorted column in the payload). (e) `logger.warn` with structured fields (pino-http `requestLogger` pattern; `logger` from `config/logger`). (f) `priority` typed as the literal union (mirrors the pgEnum). (g) `BOARD_SOFT_CAP` frozen (SCREAMING_SNAKE). (h) `getBoard` <50 lines of logic after the query — early returns + a single grouping loop.

- **`backend/src/services/boardService.test.ts`** (NEW). Mock `db` fluent chain (F08 `projectService.test.ts` pattern) + mock `getProjectBySlug`.

  Table-driven + named scenarios:
  - **getBoard: NOT_FOUND when project absent** — mock `getProjectBySlug` → `null`; assert `AppError` `NOT_FOUND`.
  - **getBoard: groups tickets by column id, sorted by position** — project with columns `[{id:'c1'}, {id:'c2'}]`; mock query → tickets `[c1 pos30, c2 pos10, c1 pos20]`; assert `columns[0].tickets` = `[pos20, pos30]` (ASC), `columns[1].tickets` = `[pos10]`.
  - **getBoard: orphan ticket → unsorted bucket last** — ticket `statusColumn:'ghost'`; assert `columns[last].id === UNSORTED_BUCKET_ID`, `isUnsorted === true`, contains the orphan.
  - **getBoard: no orphans → no unsorted bucket in payload** — all tickets match a column; assert no column has `isUnsorted:true`.
  - **getBoard: unassigned ticket → assignee null** — ticket `assigneeId:null`; left join returns nulls; assert `assignee === null`.
  - **getBoard: assigned ticket → assignee {fullName, avatarUrl}** — assert assignee shape + `avatarUrl` pass-through (incl. null avatarUrl).
  - **getBoard: empty column → tickets: [] (not omitted)** — column with no tickets; assert it appears with `tickets: []`.
  - **getBoard: soft-cap warn at >200 tickets** — mock 201 tickets; assert `logger.warn` called with `{ticketCount:201}`; assert payload still returned in full (no truncate).
  - **getBoard: soft-cap warn at >12 columns** — project with 13 columns; assert `logger.warn` called with `{columnCount:13}`.

  Notes: Mock `../db/client` `db.select().from().leftJoin().where().orderBy()` as a chainable. Mock `./projectService` `getProjectBySlug`. Mock `../config/logger` `logger.warn`. The query returns rows with all selected fields; tests assert the mapping to `BoardTicket`/`BoardColumn`.

**Acceptance Criteria:**
- [ ] `boardService.ts` exports `getBoard`, `UNSORTED_BUCKET_ID`, `BOARD_SOFT_CAP`, and the `BoardPayload`/`BoardColumn`/`BoardTicket` interfaces.
- [ ] `getBoard` returns `NOT_FOUND` on absent project; groups by column id; sorts ASC by position; puts orphans in a trailing unsorted bucket (only if non-empty); unassigned → `assignee:null`; soft-cap warns without truncating.
- [ ] All 9 scenarios pass.
- [ ] `npm run typecheck -w backend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T1 (`tickets` schema), T2 (seed — for a live integration sanity check, not unit-test dep). T4 mocks this module so does not block on it.

---

### T4 — Backend: append `GET /:slug/board` route + supertest tests

**Batch:** B2 · **Depends on:** T1 (mocks T3) · **Parallel with:** T3

**Description:** Append `GET /:slug/board` (any authed user; D-Auth-Scope, D-Slug-Route) to the existing `projectsRouter` in `backend/src/routes/projects.routes.ts`. MW order `authenticate → validateRequest({params: slugParamSchema}) → handler`. Handler calls `boardService.getBoard(slug)` and returns `success(payload)`. Append supertest scenarios to the existing `projects.routes.test.ts` (F08 suite) — REAL `authenticate`, mock `boardService` (its unit logic is covered in T3).

Create / Modify:

- **`backend/src/routes/projects.routes.ts`** (MODIFY — append the board route).

  Add imports + the route after the existing `GET /:slug` block:

  ```typescript
  import * as boardService from '../services/boardService';

  // F09 D-Slug-Route: spec's GET /projects/:id/board → :slug (project URL identifier).
  // Any authenticated user (D-ProjectMembers: no membership yet).
  projectsRouter.get(
    '/:slug/board',
    authenticate,
    validateRequest({ params: slugParamSchema }),
    async (req, res) => {
      const slug = req.params.slug as string;
      const board = await boardService.getBoard(slug);
      res.json(success(board));
    },
  );
  ```

  Notes: (a) Route order: register `/:slug/board` AFTER `/:slug` but BEFORE any catch-all — Express matches `/:slug/board` distinctly from `/:slug` (the `/board` segment disambiguates), so order between them is safe; keep `/:slug/board` right after `/:slug` for readability. (b) Reuses `slugParamSchema` (strict uppercase) → bad slug → `VALIDATION_FAILED`/400 before the service. (c) `boardService.getBoard` throws `NOT_FOUND`/404 on absent project (caught by error MW). (d) `import * as boardService` namespace import so tests can `vi.mock('../services/boardService', ...)` cleanly. (e) No `index.ts` change — `projectsRouter` already mounted at `/api/projects` (`index.ts:50`). (f) `success(board)` → `{data: board}`.

- **`backend/src/routes/projects.routes.test.ts`** (MODIFY — append board scenarios).

  Follow the F08 gold pattern: `vi.hoisted` for env, `vi.mock('../services/boardService')`, `vi.mock('../services/projectService')`, real `authenticate` + real JWTs via `signJwt` (mock `findUserTokenVersion` → matching `ver`). Append:

  - **GET /:slug/board returns 200 + board payload (authed)** — sign JWT (MEMBER); mock `boardService.getBoard('SLYK')` → `{project:{id,name,slug:'SLYK'}, columns:[{id:'c1', name:'To Do', isUnsorted:false, tickets:[]}]}`; GET `/api/projects/SLYK/board` w/ Bearer; assert 200, `body.data.project.slug === 'SLYK'`, `body.data.columns` length 1.
  - **GET /:slug/board returns 404 when project absent** — mock `getBoard` → `throw new AppError(ErrorCode.NOT_FOUND, ...)`; assert 404 `NOT_FOUND`.
  - **GET /:slug/board returns 400 on invalid slug** — GET `/api/projects/slyk/board` (lowercase); assert 400 `VALIDATION_FAILED` (strict `slugParamSchema`); assert `getBoard` NOT called.
  - **GET /:slug/board returns 401 without Bearer** — no auth header; assert 401; assert `getBoard` NOT called.
  - **GET /:slug/board works for MEMBER (no role gate)** — sign JWT (MEMBER); assert 200 (proves board read is not admin-gated — D-Auth-Scope).
  - **GET /:slug/board works for ADMIN** — sign JWT (ADMIN); assert 200.

  Notes: (a) REAL `authenticate` — do NOT mock the middleware (exercises F07 ver compare). (b) Mock `boardService` entirely (the grouping logic is unit-tested in T3). (c) Sign JWTs with real `signJwt` + mock `findUserTokenVersion` → matching `ver`. (d) Append to the existing describe block or add a new `describe('GET /:slug/board')`.

**Acceptance Criteria:**
- [ ] `projects.routes.ts` appends `GET /:slug/board` with MW order `authenticate → validateRequest({params: slugParamSchema}) → handler`.
- [ ] `index.ts` UNCHANGED (router already mounted).
- [ ] Route returns `{data: board}` 200; 404 on absent project; 400 on bad slug; 401 without Bearer; MEMBER + ADMIN both 200.
- [ ] All 6 board scenarios pass alongside the existing F08 scenarios (no regression).
- [ ] `npm run typecheck -w backend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T1 (`tickets` for the service mock to typecheck). Mocks `boardService` (T3) so does not block on T3 merging.

---

### T5 — Frontend: ticket + board types

**Batch:** B3 · **Depends on:** T4 (contract stable) · **Parallel with:** T6, T7, T8

**Description:** Ship the hand-mirrored frontend types (no codegen — F08 convention). `frontend/src/types/ticket.ts` (`Priority`, `Ticket`, `Assignee`, `PRIORITY_DISPLAY`) and `frontend/src/types/board.ts` (`UNSORTED_BUCKET_ID`, `BoardColumn`, `BoardPayload`). These mirror `boardService.ts` (T3) exactly.

Create / Modify:

- **`frontend/src/types/ticket.ts`** (NEW).

  ```typescript
  // F09 D-Priority-Enum: SCREAMING_SNAKE storage; Title-Case display via map.
  export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | 'CRITICAL';

  // PRD REQ-3.2 display labels (Title-Case). Storage stays SCREAMING_SNAKE.
  export const PRIORITY_DISPLAY: Readonly<Record<Priority, string>> = Object.freeze({
      LOW: 'Low',
      MEDIUM: 'Medium',
      HIGH: 'High',
      URGENT: 'Urgent',
      CRITICAL: 'Critical',
  });

  export interface Assignee {
      id: string;
      fullName: string;
      avatarUrl: string | null;
  }

  // F09 D-Assignee-Shape: assignee nullable (unassigned). creatorId returned but
  // not rendered on the card (F09 acceptance lists title/ID/assignee/priority/labels).
  export interface Ticket {
      id: string;
      ticketNumber: number;
      title: string;
      statusColumn: string;
      position: number;
      priority: Priority;
      labels: string[];
      assignee: Assignee | null;
      creatorId: string;
      createdAt: string; // ISO
      updatedAt: string;
  }
  ```

- **`frontend/src/types/board.ts`** (NEW).

  ```typescript
  import type { Ticket } from './ticket';
  import type { Column } from './project';

  // F09 D-Unsorted-Bucket: must match backend UNSORTED_BUCKET_ID exactly.
  export const UNSORTED_BUCKET_ID = '__unsorted__' as const;

  export interface BoardColumn {
      id: string;
      name: string;
      isUnsorted: boolean;
      tickets: Ticket[];
  }

  export interface BoardPayload {
      project: { id: string; name: string; slug: string };
      columns: BoardColumn[];
  }

  // Re-export for ergonomics (BoardColumn already overlaps Column id/name).
  export type { Column };
  ```

  Notes: (a) `UNSORTED_BUCKET_ID` MUST equal the backend constant (`'__unsorted__'`) — the frontend uses it to render `<UnsortedBucket>` distinctly (e.g. muted styling). Add a comment cross-referencing the backend. (b) `BoardColumn` is a superset of `Column` (`id`+`name`) plus `isUnsorted`+`tickets`. (c) No `any` — explicit unions. (d) `createdAt`/`updatedAt` are ISO strings (JSON-serialized Dates).

**Acceptance Criteria:**
- [ ] `types/ticket.ts` exports `Priority`, `PRIORITY_DISPLAY`, `Assignee`, `Ticket` matching backend shapes.
- [ ] `types/board.ts` exports `UNSORTED_BUCKET_ID` (`'__unsorted__'`), `BoardColumn`, `BoardPayload`.
- [ ] `UNSORTED_BUCKET_ID` matches backend `boardService.UNSORTED_BUCKET_ID`.
- [ ] `npm run typecheck -w frontend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T4 (contract). T6/T7/T8 consume these types — agree shapes up front if parallel.

---

### T6 — Frontend: `fetchBoard` client + `boardKeys` + `useBoard` hook

**Batch:** B3 · **Depends on:** T5 · **Parallel with:** T7, T8

**Description:** Ship `frontend/src/api/boards.ts` (`fetchBoard(slug)` via `apiFetch`), add `boardKeys` to `frontend/src/api/queryKeys.ts`, and `frontend/src/hooks/useBoard.ts` (`useBoard(slug)`, TanStack Query, `enabled: !!slug`). Co-located hook test mocks `api/boards`.

Create / Modify:

- **`frontend/src/api/queryKeys.ts`** (MODIFY — append `boardKeys`).

  ```typescript
  export const boardKeys = {
      all: ['boards'] as const,
      detail: (slug: string) => [...boardKeys.all, 'detail', slug] as const,
  };
  ```
  (Append below the existing `projectKeys`. F10 will use `boardKeys.all` for invalidation.)

- **`frontend/src/api/boards.ts`** (NEW).

  ```typescript
  import { apiFetch } from './client';
  import type { BoardPayload } from '@/types/board';

  // js-development-rules fetchBoard pattern. apiFetch injects Bearer + 401 interceptor.
  export function fetchBoard(slug: string): Promise<BoardPayload> {
      return apiFetch<BoardPayload>(`/projects/${slug}/board`);
  }
  ```

- **`frontend/src/hooks/useBoard.ts`** (NEW).

  ```typescript
  import { useQuery } from '@tanstack/react-query';
  import { fetchBoard } from '@/api/boards';
  import { boardKeys } from '@/api/queryKeys';

  // F09: read-on-navigate + background refetch via QueryClient defaults
  // (staleTime 30_000, refetchOnWindowFocus). Explicit 30s polling is F10.
  export function useBoard(slug: string | undefined) {
      return useQuery({
          queryKey: boardKeys.detail(slug ?? ''),
          queryFn: () => fetchBoard(slug!),
          enabled: !!slug,
      });
  }
  ```

- **`frontend/src/hooks/useBoard.test.ts`** (NEW). Mock `api/boards`.

  - **useBoard: returns data on success** — wrap in `QueryClientProvider` (test client, no retries); mock `fetchBoard('SLYK')` → `{project:{slug:'SLYK'}, columns:[]}`; `renderHook(() => useBoard('SLYK'))`; assert `result.current.data.project.slug === 'SLYK'`.
  - **useBoard: enabled only when slug present** — `renderHook(() => useBoard(undefined))`; assert `fetch` NOT called (`enabled: !!slug`).
  - **useBoard: propagates ApiClientError on 404** — mock `fetchBoard` → `throw new ApiClientError('not found', 404, 'NOT_FOUND')`; assert `result.current.error` is `ApiClientError` with status 404.

  Notes: Use `renderHook` from `@testing-library/react`; wrap in a test `QueryClientProvider` (per js-testing-rules). Mock `@/api/boards` via `vi.mock`.

**Acceptance Criteria:**
- [ ] `queryKeys.ts` exports `boardKeys` (all, detail(slug)).
- [ ] `api/boards.ts` exports `fetchBoard(slug)` via `apiFetch`.
- [ ] `hooks/useBoard.ts` exports `useBoard(slug)` gated on `!!slug`.
- [ ] All 3 hook scenarios pass.
- [ ] `npm run typecheck -w frontend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T5 (types).

---

### T7 — Frontend: `TicketCard` + `BoardColumn` + `UnsortedBucket` + `PriorityBadge` + `AssigneeAvatar`

**Batch:** B3 · **Depends:** T5 · **Parallel with:** T6, T8

**Description:** Ship the presentational board components. Each is a single-responsibility functional component with explicit prop interfaces, Tailwind classes (no inline styles), accessible labels (RTL `getByRole`/`getByLabelText` friendly), and co-located tests. `BoardColumn` includes the per-column empty state (D-Empty-State); `UnsortedBucket` is a `BoardColumn` variant for the orphan bucket; `TicketCard` composes `${slug}-${ticketNumber}` (REQ-3.1), title, `<AssigneeAvatar>`, `<PriorityBadge>`, labels.

Create / Modify:

- **`frontend/src/components/PriorityBadge.tsx`** (NEW).

  ```tsx
  import type { Priority } from '@/types/ticket';
  import { PRIORITY_DISPLAY } from '@/types/ticket';

  const PRIORITY_TONE: Readonly<Record<Priority, string>> = Object.freeze({
      LOW: 'bg-slate-100 text-slate-700',
      MEDIUM: 'bg-blue-100 text-blue-700',
      HIGH: 'bg-amber-100 text-amber-700',
      URGENT: 'bg-orange-100 text-orange-700',
      CRITICAL: 'bg-red-100 text-red-700',
  });

  interface PriorityBadgeProps {
      priority: Priority;
  }

  export function PriorityBadge({ priority }: PriorityBadgeProps) {
      return (
          <span
              className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${PRIORITY_TONE[priority]}`}
              aria-label={`Priority: ${PRIORITY_DISPLAY[priority]}`}
          >
              {PRIORITY_DISPLAY[priority]}
          </span>
      );
  }
  ```

- **`frontend/src/components/AssigneeAvatar.tsx`** (NEW).

  ```tsx
  import type { Assignee } from '@/types/ticket';

  interface AssigneeAvatarProps {
      assignee: Assignee | null;
  }

  export function AssigneeAvatar({ assignee }: AssigneeAvatarProps) {
      if (!assignee) {
          return (
              <span
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground"
                  aria-label="Unassigned"
                  title="Unassigned"
              >
                  –
              </span>
          );
      }
      const initials = assignee.fullName
          .split(' ')
          .map((part) => part.charAt(0))
          .join('')
          .slice(0, 2)
          .toUpperCase();
      return assignee.avatarUrl ? (
          <img
              src={assignee.avatarUrl}
              alt={assignee.fullName}
              className="h-6 w-6 rounded-full"
          />
      ) : (
          <span
              className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground"
              title={assignee.fullName}
          >
              {initials}
          </span>
      );
  }
  ```

- **`frontend/src/components/TicketCard.tsx`** (NEW).

  ```tsx
  import type { Ticket } from '@/types/ticket';
  import { AssigneeAvatar } from './AssigneeAvatar';
  import { PriorityBadge } from './PriorityBadge';

  interface TicketCardProps {
      ticket: Ticket;
      projectSlug: string;
  }

  export function TicketCard({ ticket, projectSlug }: TicketCardProps) {
      const ticketId = `${projectSlug}-${ticket.ticketNumber}`; // REQ-3.1
      return (
          <article
              className="space-y-2 rounded border bg-card p-2 text-sm shadow-sm"
              aria-label={`Ticket ${ticketId}: ${ticket.title}`}
          >
              <header className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{ticketId}</span>
                  <PriorityBadge priority={ticket.priority} />
              </header>
              <h4 className="font-medium leading-snug">{ticket.title}</h4>
              <footer className="flex items-center justify-between gap-2">
                  <AssigneeAvatar assignee={ticket.assignee} />
                  {ticket.labels.length > 0 && (
                      <ul className="flex flex-wrap gap-1" aria-label="Labels">
                          {ticket.labels.map((label) => (
                              <li
                                  key={label}
                                  className="rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground"
                              >
                                  {label}
                              </li>
                          ))}
                      </ul>
                  )}
              </footer>
          </article>
      );
  }
  ```

- **`frontend/src/components/BoardColumn.tsx`** (NEW — includes per-column empty state).

  ```tsx
  import type { Ticket } from '@/types/ticket';
  import { TicketCard } from './TicketCard';

  interface BoardColumnProps {
      id: string;
      name: string;
      tickets: Ticket[];
      projectSlug: string;
      isUnsorted?: boolean;
  }

  export function BoardColumn({ id, name, tickets, projectSlug, isUnsorted = false }: BoardColumnProps) {
      return (
          <section
              className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2"
              aria-label={`Column ${name}`}
              data-column-id={id}
          >
              <header className="flex items-center justify-between px-1">
                  <h3 className="text-sm font-semibold">{name}</h3>
                  <span className="text-xs text-muted-foreground">{tickets.length}</span>
              </header>
              {tickets.length === 0 ? (
                  <div
                      role="status"
                      className="rounded border border-dashed p-4 text-center text-xs text-muted-foreground"
                  >
                      No tickets
                  </div>
              ) : (
                  <ul className="flex flex-col gap-2">
                      {tickets.map((ticket) => (
                          <li key={ticket.id}>
                              <TicketCard ticket={ticket} projectSlug={projectSlug} />
                          </li>
                      ))}
                  </ul>
              )}
          </section>
      );
  }
  ```

  Notes: `isUnsorted` reserved for future muted styling; currently the parent renders `<UnsortedBucket>` which wraps `BoardColumn`. Empty state uses `role="status"` + `aria-label` on the section for RTL access.

- **`frontend/src/components/UnsortedBucket.tsx`** (NEW).

  ```tsx
  import type { Ticket } from '@/types/ticket';
  import { BoardColumn } from './BoardColumn';

  interface UnsortedBucketProps {
      tickets: Ticket[];
      projectSlug: string;
  }

  // F09 D-Unsorted-Bucket: trailing pseudo-column for tickets whose status_column
  // matches no current column. Visually muted to signal it's not a real column.
  export function UnsortedBucket({ tickets, projectSlug }: UnsortedBucketProps) {
      return (
          <div className="opacity-80">
              <BoardColumn
                  id="__unsorted__"
                  name="Unsorted"
                  tickets={tickets}
                  projectSlug={projectSlug}
                  isUnsorted
              />
          </div>
      );
  }
  ```

- **Co-located tests** (`TicketCard.test.tsx`, `BoardColumn.test.tsx`, etc.):
  - **TicketCard: renders ticket ID (SLUG-NNN), title, priority badge, labels, assignee avatar** — ticket `{ticketNumber:101, title:'Render', priority:'HIGH', labels:['frontend'], assignee:{...}}`, `projectSlug:'SLYK'`; assert `getByText('SLYK-101')`, `getByText('Render')`, `getByLabelText('Priority: High')`, `getByText('frontend')`, avatar present.
  - **TicketCard: unassigned → "Unassigned" avatar** — `assignee:null`; assert `getByLabelText('Unassigned')`.
  - **BoardColumn: renders tickets sorted as given** — tickets `[pos20, pos10]` (pre-sorted by backend); assert order in DOM.
  - **BoardColumn: empty state when zero tickets** — `tickets:[]`; assert `getByText('No tickets')` + `role="status"`.
  - **PriorityBadge: all 5 priorities render display label** — table-driven over `PRIORITY_DISPLAY`.
  - **AssigneeAvatar: avatarUrl present → img; absent → initials** — two cases.

**Acceptance Criteria:**
- [ ] `PriorityBadge`, `AssigneeAvatar`, `TicketCard`, `BoardColumn`, `UnsortedBucket` exported with explicit prop interfaces.
- [ ] `TicketCard` renders `${projectSlug}-${ticket.ticketNumber}`, title, `<PriorityBadge>`, labels, `<AssigneeAvatar>`; unassigned → "Unassigned" label.
- [ ] `BoardColumn` renders tickets OR the "No tickets" empty state (`role="status"`).
- [ ] All co-located scenarios pass; coverage >70% components.
- [ ] `npm run typecheck -w frontend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T5 (types).

---

### T8 — Frontend: replace `BoardPage` stub + wire board render + tests

**Batch:** B3 · **Depends on:** T5, T6, T7 · **Parallel with:** — (frontend terminal)

**Description:** Replace the `BoardPage` stub (`frontend/src/pages/BoardPage.tsx:1-9`) with the real board render. Reads `:slug` from `useParams`, calls `useBoard(slug)`, renders loading/error/empty-success states. Whole-board-empty (columns non-empty but every column has zero tickets AND no unsorted) renders the project-level CTA (D-Empty-State). Replaces `BoardPage.test.tsx` heading-only assertion with full render tests. **No router change** (`/projects/:slug` → `<BoardPage />` already wired at `routes/index.tsx:49`).

Create / Modify:

- **`frontend/src/pages/BoardPage.tsx`** (REPLACE stub).

  ```tsx
  import { useParams } from 'react-router';
  import { useBoard } from '@/hooks/useBoard';
  import { BoardColumn } from '@/components/BoardColumn';
  import { UnsortedBucket } from '@/components/UnsortedBucket';
  import { ApiClientError } from '@/api/client';

  export function BoardPage() {
      const { slug } = useParams<{ slug: string }>();
      const { data: board, isLoading, error } = useBoard(slug);

      if (!slug) {
          return <div className="p-4">No project selected.</div>;
      }
      if (isLoading) {
          return <div className="p-4">Loading board…</div>;
      }
      if (error instanceof ApiClientError) {
          if (error.status === 404) {
              return <div className="p-4">Project '{slug}' not found.</div>;
          }
          return <div className="p-4 text-destructive">Failed to load board: {error.message}</div>;
      }
      if (!board) {
          return null;
      }

      const totalTickets = board.columns.reduce((sum, c) => sum + c.tickets.length, 0);
      const isWholeBoardEmpty = totalTickets === 0;

      return (
          <div className="flex h-full flex-col gap-4 p-4">
              <header className="flex items-center justify-between">
                  <h1 className="text-2xl font-semibold">{board.project.name}</h1>
                  <span className="text-sm text-muted-foreground">{board.project.slug}</span>
              </header>

              {isWholeBoardEmpty ? (
                  <div
                      role="status"
                      className="rounded border border-dashed p-8 text-center text-muted-foreground"
                  >
                      No tickets yet — F12 will add creation.
                  </div>
              ) : (
                  <div className="flex gap-4 overflow-x-auto">
                      {board.columns.map((column) =>
                          column.isUnsorted ? (
                              <UnsortedBucket
                                  key={column.id}
                                  tickets={column.tickets}
                                  projectSlug={board.project.slug}
                              />
                          ) : (
                              <BoardColumn
                                  key={column.id}
                                  id={column.id}
                                  name={column.name}
                                  tickets={column.tickets}
                                  projectSlug={board.project.slug}
                              />
                          ),
                      )}
                  </div>
              )}
          </div>
      );
  }
  ```

  Notes: (a) `useParams<{slug:string}>` reads the URL param (D-Slug-Route). (b) `useBoard(slug)` gated internally on `!!slug`. (c) Loading/error/empty/success states — early returns, <50-line function body. (d) Whole-board-empty CTA distinguished from per-column empty (D-Empty-State). (e) Unsorted bucket rendered via `<UnsortedBucket>` when `column.isUnsorted`. (f) Horizontal scroll for many columns (soft cap is warn-only; virtualization is F10+). (g) Tailwind only — no inline styles. (h) No `console.log`.

- **`frontend/src/pages/BoardPage.test.tsx`** (REPLACE heading-only assertion).

  Wrap in `<MemoryRouter initialEntries={['/projects/SLYK']}>` + test `QueryClientProvider`. Mock `@/hooks/useBoard`.

  - **renders loading state** — `useBoard` → `{isLoading:true}`; assert "Loading board…".
  - **renders board with columns + tickets** — `useBoard` → `{data:{project:{name:'Slyk',slug:'SLYK'}, columns:[{id:'c1',name:'To Do',isUnsorted:false,tickets:[ticket101]}]}}`; assert `getByText('Slyk')`, `getByText('SLYK')` (slug), `getByText('SLYK-101')` (ticket ID), `getByLabelText('Column To Do')`.
  - **renders per-column empty state** — column with `tickets:[]` (but another column has tickets so board isn't empty); assert `getByText('No tickets')`.
  - **renders whole-board-empty CTA** — `columns:[{...,tickets:[]}]` only; assert `getByText(/No tickets yet/i)` + `role="status"`.
  - **renders unsorted bucket for orphan** — column with `isUnsorted:true`; assert `getByLabelText('Column Unsorted')`.
  - **renders 404 message on NOT_FOUND** — `useBoard` → `{error: new ApiClientError('not found',404,'NOT_FOUND')}`; assert `getByText(/not found/i)`.

  Notes: Mock `react-router` `useParams` to return `{slug:'SLYK'}` OR rely on `<MemoryRouter initialEntries>`. Mock `@/hooks/useBoard` via `vi.mock` returning controlled `{data,isLoading,error}`.

**Acceptance Criteria:**
- [ ] `BoardPage` reads `:slug`, calls `useBoard`, renders loading/error/whole-board-empty/success.
- [ ] Cards rendered via `<BoardColumn>` + `<TicketCard>`; unsorted column via `<UnsortedBucket>`.
- [ ] Whole-board-empty CTA ("No tickets yet — F12 will add creation") renders when `totalTickets === 0`.
- [ ] 404 → "not found" message; other errors → destructive message.
- [ ] All 6 scenarios pass; the old heading-only assertion is removed.
- [ ] `npm run typecheck -w frontend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T5 (types), T6 (hook), T7 (components).

---

### T9 — Integration verification & sign-off

**Batch:** B4 (terminal) · **Depends on:** all prior · **Parallel with:** —

**Description:** The final definition-of-done gate. Run every tool against the as-merged feature, fix gaps, record proof.

Steps:

1. **Backend:**
   ```bash
   cd backend && npm run typecheck && npm run lint && npm run format:check && npm test
   npm run db:migrate  # apply 0004
   npm run db:seed     # apply board seed
   psql "$DATABASE_URL" -c '\d "Tickets"'      # confirm table + FKs
   psql "$DATABASE_URL" -c '\dT "Priority"'    # confirm enum
   psql "$DATABASE_URL" -c 'select count(*) from "Tickets"'  # seed applied
   ```
2. **Frontend:**
   ```bash
   cd frontend && npm run typecheck && npm run lint && npm run format:check && npm test
   npm run build
   ```
3. **Live smoke (backend running + seeded + a signed ADMIN/MEMBER JWT):**
   - `GET /api/projects/SLYK/board` (authed) → 200, `body.data.project.slug === 'SLYK'`, `body.data.columns` includes the 3 default columns; tickets grouped + sorted ASC by `position`; the orphan ticket appears in a trailing column with `isUnsorted:true` + `id === '__unsorted__'`.
   - `GET /api/projects/SLYK/board` — verify a card carries `ticketNumber`, `title`, `priority`, `labels`, `assignee:{fullName,avatarUrl}|null`.
   - `GET /api/projects/NOPE/board` (authed) → 404 `NOT_FOUND`.
   - `GET /api/projects/slyk/board` (lowercase) → 400 `VALIDATION_FAILED` (strict slug).
   - `GET /api/projects/SLYK/board` (no Bearer) → 401.
   - `GET /api/projects/SLYK/board` (MEMBER) → 200 (not admin-gated).
4. **Soft-cap warn (optional, synthetic):** insert >200 tickets for a project (or temporarily lower `BOARD_SOFT_CAP.tickets` in a scratch test) → confirm `logger.warn` fires with `{ticketCount, columnCount}` and the payload still returns in full.
5. **Frontend smoke (browser):**
   - Login → land on `/projects/SLYK` → see columns left-to-right, cards sorted, ticket IDs `SLYK-101` etc., priority badges, labels, assignee avatars.
   - Empty column shows "No tickets".
   - Unsorted bucket (muted) shows the orphan.
   - Navigate to a project with zero tickets → whole-board-empty CTA.
   - Reload `/projects/SLYK` → persists (URL is source of truth).
6. **Record proof:** commit SHAs, sample API responses, screenshot paths.

**Acceptance Criteria:**
- [ ] Every F09 Acceptance bullet (§1 items 1–9) satisfied; record commit SHAs + responses.
- [ ] `Tickets` table exists with all 13 columns + 3 FKs; `Priority` enum exists; seed applied.
- [ ] Board endpoint returns columns + tickets in one payload; tickets grouped by `Column.id`, sorted ASC by `position`; orphan in `isUnsorted:true` trailing bucket (only if non-empty); unassigned → `assignee:null`.
- [ ] 404 on absent project; 400 on bad slug; 401 without Bearer; MEMBER + ADMIN both 200.
- [ ] Frontend: cards show ticket ID + title + assignee avatar + priority badge + labels; empty column → "No tickets"; whole-board-empty → CTA; unsorted bucket visible.
- [ ] Soft-cap warn logged when threshold exceeded (no truncate).
- [ ] Lint/format/typecheck/test/build exit codes: `0 / 0 / 0 / 0 / 0`.

**Dependencies:** T4, T8 (all prior).

---

## 7. Final F09 Acceptance Checklist

- [ ] `Tickets` table per PRD §8.3 read-render slice exists (with F09-added `position`) and migrates cleanly (`0004_*.sql`).
- [ ] `priorityEnum` pgEnum (`LOW`..`CRITICAL`, default `MEDIUM`) exists (SCREAMING_SNAKE storage; Title-Case UI display).
- [ ] `GET /api/projects/:slug/board` (spec's `:id` → slug) returns `{project, columns}` in one payload; any authed user (no role gate).
- [ ] Tickets grouped by `Column.id`, sorted ASC by `position`; orphan `status_column` → trailing `isUnsorted:true` "Unsorted" bucket (only if non-empty); payload never drops tickets.
- [ ] Cards show `${slug}-${ticketNumber}` (REQ-3.1), title, assignee avatar (or "Unassigned"), priority badge, labels.
- [ ] Empty column renders explicit "No tickets" empty state; whole-board-empty renders project-level CTA.
- [ ] Large-board soft cap (`BOARD_SOFT_CAP = {tickets:200, columns:12}`) warns via `logger.warn`; no truncate/virtualize (deferred).
- [ ] Unassigned ticket → `assignee:null`; assigned → `{id, fullName, avatarUrl}`.
- [ ] 404 on absent project; 400 on bad slug; 401 without Bearer.
- [ ] NO ticket-creation endpoint/UI shipped (F12) — seed is the read-data source.
- [ ] Lint + format checks pass on an empty change.
- [ ] Typecheck + test pass (backend + frontend).
- [ ] `npm run build` (frontend) succeeds.

**Integration record (fill during T9):**
- Feature commit SHA: `________`
- `0004_*.sql` applied; `\d "Tickets"` + `\dT "Priority"` output: `________`
- Sample `GET /api/projects/SLYK/board` response (truncated): `________`
- Soft-cap warn log line (synthetic or real): `________`
- Lint/format/typecheck/test/build exit codes: `0 / 0 / 0 / 0 / 0`

---

## 8. Schema deltas owned by this feature

F09 owns the `Tickets` table (PRD §8.3 read-render slice) + the `Priority` enum + the `position` column. Three deltas vs features.md attribution: `Tickets` table (attributed to F12 at L278), `Tickets.position` (attributed to F11 at L263), and the `:slug` route (features.md:229 says `:id`).

| Delta | Detail | Migration |
| --- | --- | --- |
| `Priority` enum | `pgEnum('Priority', ['LOW','MEDIUM','HIGH','URGENT','CRITICAL'])` default `'MEDIUM'`. SCREAMING_SNAKE storage; Title-Case display via frontend `PRIORITY_DISPLAY`. | `CREATE TYPE "Priority" AS ENUM(...)` — `0004_*.sql` |
| `Tickets` table | `id uuid PK defaultRandom`, `project_id uuid FK→Projects(id)`, `ticket_number int` (per-project; F12 owns the counter), `title text`, `description text` (nullable), `status_column text` (references a `Column.id`; no FK — integrity read-time via D-Unsorted-Bucket), `position double precision NOT NULL default 0`, `assignee_id uuid nullable FK→Users(id)`, `creator_id uuid FK→Users(id)`, `priority Priority default 'MEDIUM'`, `labels jsonb $type<string[]> default '[]'`, `created_at`/`updated_at timestamptz NOT NULL`. | `CREATE TABLE "Tickets" (...) + 3 FKs` — `0004_*.sql` |
| `Tickets.position` (vs features.md) | features.md:263 attributes `position` to F11. F09 adds it (read-sort); F11 owns the reorder write. | Inline `position double precision DEFAULT 0` in CREATE TABLE. **Owner sign-off §9a.** |
| `Tickets` table ownership (vs features.md) | features.md:278 attributes `Tickets` to F12. F09 pulls the read-render slice forward (no creation endpoint). | CREATE TABLE in `0004_*.sql`. **Owner sign-off §9b.** |
| Route param `:slug` (vs features.md) | features.md:229 says `GET /projects/:id/board`. F09 uses `:slug` (the project's URL identifier in this codebase). | No migration (routing only). **Owner sign-off §9c.** |

---

## 9. Sign-off list

Owner decisions OBTAINED 2026-06-23 (3 deviations from features.md). LOCKED — proceed.

- **(a) D-Position-Column — LOCKED (owner: "decide what's best" → confirmed):** F09 adds `Tickets.position double precision NOT NULL default 0` and read-sorts ASC by it. features.md:263 attributes `position` to F11; F11 continues to own the reorder *write* (drag-persist). F09 owns the column + read-sort only. **Schema/attribution delta vs features.md:263 — accepted.**
- **(b) D-Tickets-Table — LOCKED (owner: "decide what's best" → confirmed):** F09 creates the `Tickets` table (PRD §8.3 read-render slice) + ships a seed, NO creation endpoint. features.md:278 attributes `Tickets` to F12; no intervening feature between F08 and F12 owns the table, so F09 pulls the read slice forward. Empty-board state is an explicitly-accepted outcome until F12 lands. **Attribution delta vs features.md:278 — accepted.**
- **(c) D-Slug-Route — LOCKED (owner: "slug routing is better"):** Endpoint is `GET /api/projects/:slug/board`, not `GET /projects/:id/board`. The spec's `:id` is interpreted as the project's URL identifier, which is the slug in this codebase (consistent with F08's slug-everywhere routing). **Delta vs features.md:229 — accepted.**
