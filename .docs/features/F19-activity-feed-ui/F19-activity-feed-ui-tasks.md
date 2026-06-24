# F19 — Activity feed UI: Plan + Task Breakdown

> **Feature:** F19 — Activity feed UI (Phase 2 — Activity visibility)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F18 (DONE ✅), F16 (DONE ✅) · **PRD ref:** REQ-5.1, REQ-5.2, REQ-5.3, PRD §6.5, User Journey 3
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), the project rules discovered for this repo (`.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`), plus dependency feature task docs: [F16](../F16-ticket-detail-modal/F16-ticket-detail-modal-tasks.md), [F18](../F18-activity-log-capture/F18-activity-log-capture-tasks.md)

---

## 1. F19 Recap

**Goal:** Visible history per ticket — a reverse-chronological activity feed inside the ticket modal rendering human-readable sentences ("Muntasir changed Priority from Low to High") with actor, action, old→new, and localized time.

**Ships:** A new `GET /api/tickets/:ticketId/activity` endpoint that returns render-ready rows (actor resolved, column names resolved, assignee names resolved, priority display-ready) capped at 50 newest-first. A `ActivityFeed` React component rendered inside `TicketDetailModal` at the `:160` seam, showing `ActivityItem`s (actor avatar+name, sentence, relative time + absolute tooltip) with a client-side "Show N more" toggle for long feeds. Two pure FE utils: `formatRelativeTime` (native `Intl.RelativeTimeFormat`) and `describeActivity` (a sentence-switch over `actionType`). F19 is **READ + UI only** — it owns NO schema/migration (F18 owns the `ActivityLogs` table + all write paths).

**Acceptance (definition of done):**
- `GET /api/tickets/:ticketId/activity` returns `success({ entries: [...] })` — a reverse-chronological (`ORDER BY created_at DESC`) array of enriched rows; `404 NOT_FOUND` for a missing ticket; `401` for an unauthenticated request; `400 VALIDATION_FAILED` for a bad uuid. Auth = `authenticate` only (F08: all users see all projects — no role gate).
- Each enriched row shape: `{ id, createdAt, actionType, actor: {id, fullName, avatarUrl}|null, from: string|null, to: string|null, message: string|null }`.
- The feed renders inside `TicketDetailModal` (replacing the `:160` seam), reverse-chronological, newest first.
- Each item shows **actor + action + old→new + time**: actor name (or "Unknown user"), a human-readable sentence (REQ-5.2 grammar `{actor} {action} {field} from {old} to {new}`), and time.
- **Graceful removed-entity rendering:** null actor (deleted user — FK `ON DELETE SET NULL`) → "Unknown user"; `'unassigned'` assignee sentinel → "Unassigned"; deleted column id (absent from `projects.columns`) → "Unknown column"; `LABELS_CHANGED` already stores readable names (no resolution needed). FE never crashes.
- **Long feeds:** backend caps at `MAX_ACTIVITY_ROWS` (50, SCREAMING constant); FE renders the first `INITIAL_FEED_VISIBLE` (5) + a "Show N more" `useState` toggle.
- **Localized UTC time:** relative primary ("2h ago") + absolute locale time in a `title` tooltip (satisfies User Journey 3's "at 10:15 AM" on hover; keeps the list scannable).
- `CREATED` → "created the ticket"; `CONTENT_UPDATED` → "updated the description" (REQ-5.3: no diff); `LABELS_CHANGED` → renders the stored readable string.

**Edge cases to resolve up front:**
- **Names of since-removed users/labels render gracefully** → **Decision:** backend enrichment handles ALL entity resolution server-side. Actor `userId` resolved via leftJoin `users` (FK `ON DELETE SET NULL` → null actor = "Unknown user"); assignee `userId` resolved via a `users` lookup map (deleted → "Unknown user", `'unassigned'` sentinel → "Unassigned"); column id resolved via the ticket's `projects.columns` JSONB (deleted id → "Unknown column"); `LABELS_CHANGED` already stores readable names. FE is a dumb sentence-switch over `actionType` — it never resolves ids, never crashes.
- **Very long feeds → cap initial render + "show more"** → **Decision:** backend returns all rows capped at `MAX_ACTIVITY_ROWS` (50, newest-first); FE renders the first `INITIAL_FEED_VISIBLE` (5) + a "Show N more" `useState` toggle (client-side; no infinite-query, no backend pagination). SCREAMING constants for both caps.
- **Time display** → **Decision:** relative primary ("2h ago") via native `Intl.RelativeTimeFormat` + absolute locale time in a `title` tooltip (satisfies User Journey 3's "at 10:15 AM" on hover; keeps list scannable). No new dep.

---

## 2. Codebase Analysis Summary

- **State:** **Greenfield for the read path + UI; both dependencies DONE ✅ in code.** F18 ships the `activityLogs` table (`schema.ts:204-223`) with all 6 capture sites (CREATED/STATUS/PRIORITY/ASSIGNEE/LABELS/CONTENT) live. F16 ships `TicketDetailModal.tsx` with the reserved F19 seam at `:160`. No GET activity route, no enrichment service, no FE activity types/api/components exist yet. **F19 adds NO schema/migration** (read-only over F18's table).

- **Existing structure this feature builds on (with path citations):**
  - **`activityLogs` table** (`backend/src/db/schema.ts:204-223`): `id` (uuid pk), `ticketId` (FK→Tickets `ON DELETE CASCADE`), `userId` (FK→Users **`ON DELETE SET NULL`** — deleted actor preserved as null), `actionType` (`activityActionEnum` 6 values @ `:193-200`), `oldValue` (text nullable), `newValue` (text nullable), `createdAt` (timestamptz). Index `activity_logs_ticket_id_idx` on `ticketId` (`:221`) — F19's exact read path. **F19 owns no schema delta.**
  - **GET route ABSENT.** `backend/src/routes/tickets.routes.ts` has GET/PATCH/DELETE only. F19 adds `GET /:ticketId/activity`. Router mounted at `/api/tickets` (`index.ts:54`). Existing imports (`authenticate`, `validateRequest`, `success`, `AppError`, `ErrorCode`, `ticketIdParam`, `ticketService`, `TicketIdParam`) all reusable.
  - **F18 stored value formats (THE rendering contract)** — verified at every `recordActivity` call site:
    - `CREATED`: `oldValue=null`, `newValue=null` (`ticketService.ts:239`).
    - `STATUS_CHANGED`: **column IDs** (uuid, `Column.id`) old/new (`ticketService.ts:123-131`). **Must resolve id→name** via `projects.columns` JSONB `{id,name}[]`.
    - `PRIORITY_CHANGED`: raw **UPPERCASE enum** (`LOW`/`HIGH`) old/new (`activityLogService.ts:66-68`). Display-ready via `PRIORITY_DISPLAY` (FE `types/ticket.ts:7-13`).
    - `ASSIGNEE_CHANGED`: **userId uuid OR literal `'unassigned'`** old/new (`activityLogService.ts:70-76`). **Must resolve uuid→name** + handle `'unassigned'` sentinel.
    - `LABELS_CHANGED`: `oldValue=null` + `newValue=` **readable string** `"added: Bug; removed: API"` (`formatLabelDiff` `activityLogService.ts:94-103`). **Already human-readable** — no resolution.
    - `CONTENT_UPDATED`: `oldValue=null`, `newValue=null` (`activityLogService.ts:78-80`).
  - **F16 modal seam:** `TicketDetailModal.tsx:160` — `{/* F19 will render the activity feed here. */}` (inside `<Modal>`, after the F17 delete block). Modal prop shape `{ slug, ticketId, onClose, onSubmit }` (`:24-29`); existing `useQuery(ticketKeys.detail(ticketId))` at `:41-47`.
  - **Resolution seams (mirror existing patterns):**
    - **Actor `userId`→`{fullName,avatarUrl}`** via leftJoin `users` — FK `ON DELETE SET NULL` → null actor = "Unknown user" (mirror `getTicket`'s `creatorUser`/`assigneeUser` alias-join + FK-dangle guard at `ticketService.ts:35-36,281-305`). Deleted actor: actor object is `null` → FE renders "Unknown user".
    - **Column id→name** via `projects.columns` JSONB (`schema.ts:76` `jsonb('columns').$type<Column[]>()` where `Column = {id, name}` @ `:56-59`). Load the ticket's project (ticket→`projectId`→`projects.columns`), build an id→name map. Deleted column id (not in the map) → "Unknown column" fallback. Pattern: `moveTicket:94` loads project via `.where(eq(projects.id, ticket.projectId))` then `project.columns.map(...)`.
    - **Assignee uuid→name** via a `users` lookup map built from the distinct assignee userIds in the result set (deleted → "Unknown user"; `'unassigned'` → "Unassigned").
  - **`PRIORITY_DISPLAY`** at `frontend/src/types/ticket.ts:7-13` — `LOW`→`Low`, etc. FE maps the backend's passthrough uppercase enum to Title-Case for display.
  - **No relative-time util** — F19 adds `formatRelativeTime` via native `Intl.RelativeTimeFormat` (no dep). `formatDate` (absolute, `Intl.DateTimeFormat`) exists at `frontend/src/utils/formatDate.ts:1-12` and is reused for the tooltip.
  - **No pagination precedent** — F19 is the first. `ticketKeys = { all, detail(id) }` (`queryKeys.ts:12-15`); F19 adds `activity(id)`. `fetchTicket` pattern (`api/tickets.ts:36-38`) reused for `fetchTicketActivity`.
  - **Route test pattern** — `tickets.routes.test.ts:1-49` uses supertest + `signJwt` for tokens (not a `tokenFor` helper), mocks `ticketService` via `vi.mock(...)` map (currently `{ moveTicket, getTicket, updateTicket, deleteTicket }`), mocks `tokenVersion` + `config`. T1 adds `getTicketActivity: vi.fn()` to the mock map + an activity GET suite.

- **Files F19 creates:** `backend/src/services/activityService.ts` (+ test), `frontend/src/types/activity.ts`, `frontend/src/utils/formatRelativeTime.ts` (+ test), `frontend/src/utils/describeActivity.ts` (+ test), `frontend/src/components/ActivityFeed.tsx` (+ test), `frontend/src/components/ActivityItem.tsx` (+ test). **Files F19 modifies:** `backend/src/routes/tickets.routes.ts` (add GET activity route), `backend/src/routes/tickets.routes.test.ts` (add `getTicketActivity` mock + GET suite), `frontend/src/api/tickets.ts` (add `fetchTicketActivity`), `frontend/src/api/queryKeys.ts` (add `ticketKeys.activity`), `frontend/src/components/TicketDetailModal.tsx` (render feed at `:160` seam).

- **Schema delta: F19 owns NONE.** Read-only over F18's `activityLogs` table. No migration, no `schema.ts` change (see §8).

- **Project rules this plan must satisfy:** `.claude/rules/git-guidelines.md` (branch `feature/SLYK-F19-activity-feed-ui`, single-line commits `SLYK-F19: <msg>`, rebase-merge only, never `--squash`, never `git merge`, sacred rule: never git without explicit approval); `.claude/rules/js-development-rules.md` (RESTful `GET /api/tickets/:ticketId/activity`; route→service→drizzle db; **never string-concat SQL** — `db.select(...).where(eq(...)).orderBy(desc(...))` ORM only; consistent `success(...)` envelope; `authenticate` middleware; **UTC timestamptz** stored, localized on display); `.claude/rules/js-style-guide.md` (2-space JS / 4-space JSX, no `any`, import order external→internal→types→relative, functions <50 lines, early returns, Tailwind no inline styles, PascalCase components `ActivityFeed.tsx`, camelCase utils `formatRelativeTime.ts`/`describeActivity.ts`, SCREAMING constants `MAX_ACTIVITY_ROWS`/`INITIAL_FEED_VISIBLE`); `.claude/rules/js-testing-rules.md` (Vitest co-located, table-driven, `getByRole`/`getByText` priority, `>70%` components); `.claude/rules/persona.md` (Node 24+ / Express 5 / Drizzle / Postgres / React 19 / Vite / Tailwind / TanStack Query).

- **Hidden coupling to plan for:**
  - **Backend enrichment is the load-bearing decision.** The GET route must return render-ready rows (actor + assignee + column names resolved) so the FE stays a dumb sentence-switch. This matches the repo convention ("backend hydrates, FE renders" — labels/boardService, creator+assignee/getTicket). Atomicity: one query+resolution pass handles all edge cases (deleted actor via FK SET NULL, gone column, gone assignee).
  - **Resolution order matters for assignee map.** The assignee userIds live in `oldValue`/`newValue` of `ASSIGNEE_CHANGED` rows as raw strings (uuid OR `'unassigned'`). The enrichment must collect distinct non-`'unassigned'` uuids, batch-resolve via a single `users` select, then map. Don't resolve per-row (N+1).
  - **Column resolution needs the project.** Column ids are ticket-scoped (a ticket belongs to one project). Load the ticket's `projectId`, fetch the project's `columns` JSONB, build id→name map once. A deleted column (id not in map) → "Unknown column".
  - **`LABELS_CHANGED` needs NO resolution** — `newValue` is already `"added: Bug; removed: API"` (readable names captured at write time by `formatLabelDiff`). Passthrough.
  - **`PRIORITY_CHANGED` passthrough** — backend returns the raw uppercase enum (`LOW`/`HIGH`); FE maps to Title-Case via `PRIORITY_DISPLAY`. Do NOT Title-Case server-side (keeps the FE the single display-formatting authority, matching F09).
  - **Show-more is client-side.** `useState` boolean in `ActivityFeed`; renders first `INITIAL_FEED_VISIBLE` items until toggled. No infinite-query, no cursor pagination — the backend cap (50) bounds the payload.
  - **Stale activity cache.** `ActivityFeed` uses `useQuery(ticketKeys.activity(ticketId))`. Edits/moves that produce new activity rows (F18 write paths) must invalidate this key — but those mutations already invalidate `ticketKeys.detail` + `boardKeys.all`. To avoid a stale feed, the existing `useUpdateTicket`/`useMoveTicket` `onSuccess` handlers should ALSO invalidate `ticketKeys.activity(ticketId)`. **This is a small modification to existing hooks** — flag it in T5 (or, alternatively, give the activity `useQuery` a short `staleTime`/`refetchInterval` matching the modal's 30s drift reconciliation). **Decision: add `ticketKeys.activity(ticketId)` invalidation to `useUpdateTicket` + `useMoveTicket` `onSuccess`** (T5) — explicit beats polling.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale (cite source) |
|---|----------|--------|-----------|
| D1 | Backend enrichment vs FE resolution | **BACKEND ENRICH.** GET route returns render-ready rows: actor resolved via leftJoin `users` (FK SET NULL → null), column id→name via `projects.columns` JSONB, assignee uuid→name via a `users` lookup map, `'unassigned'`→"Unassigned", priority enum passthrough (FE Title-Cases). FE is a dumb `actionType` sentence-switch. | Repo convention "backend hydrates, FE renders" (labels/boardService, creator+assignee/getTicket `ticketService.ts:281-305`). Atomicity: one resolution pass handles all deleted-entity edge cases server-side (FK SET NULL actor @ `schema.ts:211`, gone column, gone assignee). FE stays thin + never crashes on bad ids. |
| D2 | Activity GET route | **`GET /api/tickets/:ticketId/activity`** — chain `authenticate → validateRequest({ params: ticketIdParam }) → handler`. `401` unauth; `400 VALIDATION_FAILED` bad uuid; `404 NOT_FOUND` missing ticket; `200 success({ entries })` on success. **No role gate** (F08: all users see all projects). | Rules: RESTful `GET /api/tickets/:id/activity`; `authenticate` only; `validateRequest` + `ticketIdParam` (reused from `tickets.schema.ts`); `success(...)` envelope (`envelope.ts:28`). Router at `/api/tickets` (`index.ts:54`). |
| D3 | Enriched row shape | **`{ id: string, createdAt: string (ISO), actionType: ActivityAction, actor: {id, fullName, avatarUrl}|null, from: string|null, to: string|null, message: string|null }`** where `from`/`to`/`message` are display-ready (names resolved, priority enum passthrough, label-diff string passthrough). | Each row carries everything the FE sentence-switch needs. `actor: null` signals a deleted user (FE → "Unknown user"). `from`/`to` for STATUS/ASSIGNEE/PRIORITY; `message` for LABELS; both null for CREATED/CONTENT. |
| D4 | Edge-case fallbacks | **Unknown user** (null actor / deleted assignee) → FE renders "Unknown user"; **Unassigned** (`'unassigned'` sentinel) → "Unassigned"; **Unknown column** (deleted column id not in `projects.columns`) → "Unknown column"; **LABELS_CHANGED** → passthrough (already readable). | FK `ON DELETE SET NULL` @ `schema.ts:211` preserves the log row with a null actor. `'unassigned'` sentinel @ `activityLogService.ts:73-74`. Column id stored @ `ticketService.ts:129-130`; project columns @ `schema.ts:76`. Spec: "Names of since-removed users/labels render gracefully." |
| D5 | FE ActivityFeed + ActivityItem + show-more | **`ActivityFeed`** (`useQuery(ticketKeys.activity(ticketId))` + `useState` show-more, renders first `INITIAL_FEED_VISIBLE=5` + "Show N more"); **`ActivityItem`** (actor avatar+name, sentence, relative time + absolute title). | Rules: TanStack Query `useQuery`; `useState` for client toggle; Tailwind; PascalCase components; `>70%` coverage. `INITIAL_FEED_VISIBLE` SCREAMING constant. Show-more avoids re-rendering 50 rows on modal open. |
| D6 | Time display | **Relative primary** ("2h ago") via `Intl.RelativeTimeFormat` (native, no dep) **+ absolute locale time in a `title` tooltip** via the existing `formatDate`. | User Journey 3 (`§7:121-130`): "at 10:15 AM" on hover. Keeps the list scannable. `formatDate` @ `utils/formatDate.ts:4-12` already locale-aware. No new dep (D10). |
| D7 | `describeActivity(event)` FE sentence-switch | **PURE fn, table-driven test.** Switch over `actionType`: CREATED → "created the ticket"; STATUS_CHANGED → "moved from {from} to {to}"; PRIORITY_CHANGED → "changed Priority from {from} to {to}" (Title-Case via `PRIORITY_DISPLAY`); ASSIGNEE_CHANGED → "{from} → {to}" assignee; LABELS_CHANGED → `message`; CONTENT_UPDATED → "updated the description". Actor prefix + " · {time}". | REQ-5.2 grammar `{actor} {action} {field} from {old} to {new}`. REQ-5.3: description → generic, no diff. Pure fn → table-testable (`js-testing-rules.md`). |
| D8 | Schema/migration | **NONE.** F19 is read-only over F18's `activityLogs` table. No `schema.ts` change, no migration. | F18 owns the table (`schema.ts:204-223`) + all write paths. F19 = READ + UI only (spec). |
| D9 | Ordering | **Reverse-chronological** (`ORDER BY created_at DESC`, newest first). | Spec acceptance: "reverse-chronological". `desc(activityLogs.createdAt)` ORM. Index `activity_logs_ticket_id_idx` @ `:221` supports the WHERE+ORDER. |
| D10 | New dependencies | **NONE.** `Intl.RelativeTimeFormat` + `Intl.DateTimeFormat` are native. | Rules: avoid unnecessary deps. F16's `formatDate` already uses native Intl. |
| D11 | Relative + absolute time (restated) | **Relative primary + absolute tooltip** (not absolute-only). | See D6. Owner sign-off item (b). |

> **Out of F19 scope (explicitly deferred):**
> - **Schema/migration** → F18 owns the `activityLogs` table + all write/capture paths. F19 is read + UI only.
> - **Content diffing** → REQ-5.3 mandates generic "updated the description" with no diff; PRD §4 defers content diffing. `CONTENT_UPDATED` stays `from`/`to` null.
> - **Backend cursor/offset pagination** → client-side show-more cap (D5) suffices for a per-ticket feed capped at 50. A global/cross-ticket activity feed is separate scope.
> - **Activity export / audit log admin view** → out of scope.
> - **Websocket real-time feed push** → the modal's 30s `refetchInterval` drift reconciliation (F16 pattern) + explicit invalidation (T5) suffice.

> **Owner sign-off needed (see §9):** (a) backend enrich vs FE resolve [recommend backend enrich]; (b) time display relative+tooltip vs absolute-only [recommend relative+tooltip]; (c) show-more client-side cap vs backend pagination [recommend client-side cap, backend max-50]; (d) enrichment shape per-row `{actor, from, to, message}` vs raw rows [recommend enriched]; (e) ASSIGNEE_CHANGED display "Alice → Bob" (backend resolves names) [confirm]; (f) STATUS_CHANGED display "To Do → In Progress" (backend resolves column names) [confirm].

---

## 4. Architecture Overview (Target Tree)

```
slykboard/                                                  # repo root
├── backend/
│   └── src/
│       ├── services/
│       │   ├── activityLogService.ts                       # (F18 — unchanged; write/capture owner)
│       │   └── activityService.ts                          # NEW (T1) — getTicketActivity(ticketId): enrich rows (actor via leftJoin users; column id→name via projects.columns; assignee uuid→name map; 'unassigned'→'Unassigned'; priority passthrough; LABELS passthrough)
│       │       └── activityService.test.ts                 # NEW (T1) — enrichment correctness + deleted-actor/column/assignee fallbacks + reverse-chrono (table-driven)
│       └── routes/
│           ├── tickets.routes.ts                           # MODIFY (T1) — add GET /:ticketId/activity (authenticate + validateRequest → success({ entries }))
│           └── tickets.routes.test.ts                      # MODIFY (T1) — add getTicketActivity to vi.mock map + GET suite (401/400/404/200)
└── frontend/
    └── src/
        ├── types/
        │   └── activity.ts                                 # NEW (T3) — ActivityEntry, ActivityActor, ActivityAction types
        ├── api/
        │   ├── tickets.ts                                  # MODIFY (T3) — add fetchTicketActivity(ticketId)
        │   └── queryKeys.ts                                # MODIFY (T3) — add ticketKeys.activity(id)
        ├── utils/
        │   ├── formatRelativeTime.ts                       # NEW (T2) — Intl.RelativeTimeFormat ("2h ago"); no dep
        │   │   └── formatRelativeTime.test.ts              # NEW (T2) — table-driven (now/recent/hours/days/weeks)
        │   ├── describeActivity.ts                         # NEW (T2) — pure sentence-switch over actionType (uses PRIORITY_DISPLAY); REQ-5.2/5.3 grammar
        │   │   └── describeActivity.test.ts                # NEW (T2) — table-driven per actionType + edge fallbacks
        │   └── formatDate.ts                               # (existing — reused for absolute tooltip)
        ├── components/
        │   ├── ActivityFeed.tsx                            # NEW (T4) — useQuery(ticketKeys.activity) + useState show-more (INITIAL_FEED_VISIBLE=5); renders ActivityItem[]
        │   │   └── ActivityFeed.test.tsx                   # NEW (T4) — renders items reverse-chrono + show-more toggle + loading/error/empty
        │   ├── ActivityItem.tsx                            # NEW (T4) — actor avatar+name, sentence (describeActivity), relative time + absolute title
        │   │   └── ActivityItem.test.tsx                   # NEW (T4) — render per actionType + Unknown user/Unassigned/Unknown column fallbacks
        │   └── TicketDetailModal.tsx                       # MODIFY (T5) — render <ActivityFeed ticketId={ticketId} /> at :160 seam
        └── hooks/
            ├── useUpdateTicket.ts                          # MODIFY (T5) — onSuccess also invalidate ticketKeys.activity(ticketId) (fresh feed after edit)
            └── useMoveTicket.ts                            # MODIFY (T5) — onSuccess also invalidate ticketKeys.activity(ticketId) (fresh feed after move)
```

**Activity read lifecycle (post-F19):**

1. `TicketDetailModal` opens (deep-linked or from board); existing `useQuery(ticketKeys.detail(ticketId))` loads the ticket.
2. `<ActivityFeed ticketId={ticketId} />` mounts at the `:160` seam → `useQuery(ticketKeys.activity(ticketId))` → `fetchTicketActivity(ticketId)` → `GET /api/tickets/:ticketId/activity`.
3. Route: `authenticate` sets `req.user`; `validateRequest({ params: ticketIdParam })` validates the uuid.
4. Handler calls `activityService.getTicketActivity(ticketId)`:
   - Load the ticket row (404 if missing/soft-deleted) → derive `projectId`.
   - Load the project's `columns` JSONB → build column id→name map.
   - Query `activityLogs WHERE ticket_id = $1 ORDER BY created_at DESC LIMIT MAX_ACTIVITY_ROWS(50)`, leftJoin `users` (actor) — FK SET NULL → null actor.
   - Collect distinct assignee userIds from `ASSIGNEE_CHANGED` rows (excluding `'unassigned'`) → batch-resolve via one `users` select → build userId→name map.
   - Enrich each row: `actor` (null if deleted), `from`/`to` (STATUS→column name / ASSIGNEE→user name or "Unassigned" / PRIORITY→passthrough enum), `message` (LABELS→passthrough string).
5. Response: `200 success({ entries: [...] })`.
6. FE `useQuery` caches under `ticketKeys.activity(ticketId)`; renders `ActivityItem[]` reverse-chrono, first `INITIAL_FEED_VISIBLE=5`, "Show N more" toggle.
7. On edit/move (F18 writes a new activity row), `useUpdateTicket`/`useMoveTicket` `onSuccess` invalidates `ticketKeys.activity(ticketId)` → feed refetches (fresh row appears at top).

---

## 5. Parallelization Strategy

Tasks grouped into **5 batches** by dependency order. The BE enrichment route (T1) and the pure FE utils (T2) are disjoint and run in parallel; then FE types+api (T3); then FE components (T4); then modal wiring + invalidation (T5); then verification (T6).

### Batch dependency diagram

```
 ┌─ Batch 1 (BE enrich route ‖ FE pure utils) ────────────────────────────┐
 │  T1  activityService.getTicketActivity + GET /:ticketId/activity +      │
 │      BE route tests                                                     │
 │      [backend/src/services/activityService.ts(+test),                   │
 │       backend/src/routes/tickets.routes.ts,                             │
 │       backend/src/routes/tickets.routes.test.ts]                        │
 │                                                                         │
 │  T2  FE pure utils: formatRelativeTime + describeActivity + tests       │
 │      [frontend/src/utils/formatRelativeTime.ts(+test),                  │
 │       frontend/src/utils/describeActivity.ts(+test)]                    │
 └────────────────────────┬────────────────────────────────────────────────┘
                          │ (route contract + utils exist)
                          ▼
 ┌─ Batch 2 (FE data layer) ──────────────────────────────────────────────┐
 │  T3  types/activity.ts + fetchTicketActivity api + ticketKeys.activity  │
 │      [frontend/src/types/activity.ts,                                   │
 │       frontend/src/api/tickets.ts,                                      │
 │       frontend/src/api/queryKeys.ts]                                    │
 └────────────────────────┬────────────────────────────────────────────────┘
                          │ (api fn + query key + types available)
                          ▼
 ┌─ Batch 3 (FE components) ──────────────────────────────────────────────┐
 │  T4  ActivityFeed (useQuery + show-more) + ActivityItem + tests         │
 │      [frontend/src/components/ActivityFeed.tsx(+test),                  │
 │       frontend/src/components/ActivityItem.tsx(+test)]                  │
 └────────────────────────┬────────────────────────────────────────────────┘
                          │ (components available)
                          ▼
 ┌─ Batch 4 (wiring + invalidation) ──────────────────────────────────────┐
 │  T5  wire <ActivityFeed> into TicketDetailModal :160 seam + add         │
 │      ticketKeys.activity invalidation to useUpdateTicket/useMoveTicket  │
 │      [frontend/src/components/TicketDetailModal.tsx,                    │
 │       frontend/src/hooks/useUpdateTicket.ts,                            │
 │       frontend/src/hooks/useMoveTicket.ts]                              │
 └────────────────────────┬────────────────────────────────────────────────┘
                          │ (feature integrated)
                          ▼
 ┌─ Batch 5 (verification) ───────────────────────────────────────────────┐
 │  T6  integration verification — typecheck/lint/format/test/build +      │
 │      live smoke (feed renders reverse-chrono; edits produce new rows;   │
 │      deleted-user/column/assignee render gracefully; show-more works)   │
 │      [(verification record only)]                                       │
 └─────────────────────────────────────────────────────────────────────────┘
```

- **B1 (T1 ‖ T2) no internal barrier:** T1 (backend) and T2 (FE utils) touch disjoint file sets (backend services/routes vs frontend utils). They can be developed and merged in either order.
- **B1 → B2 hard barrier:** `fetchTicketActivity` (T3) calls `GET /api/tickets/:ticketId/activity` (T1). The route contract must exist. `describeActivity` (T2) is consumed by `ActivityItem` (T4) but T3 doesn't depend on it — however T3's `ActivityEntry` type mirrors T1's response shape, so T1's contract should be settled first.
- **B2 → B3 hard barrier:** `ActivityFeed` (T4) calls `fetchTicketActivity` + uses `ticketKeys.activity` + the `ActivityEntry` type (T3).
- **B3 → B4 hard barrier:** `TicketDetailModal` (T5) renders `<ActivityFeed>` (T4).
- **B4 → B5 hard barrier:** verification runs against the fully integrated feature.

### Merge order rules

1. **B1 (T1 and/or T2) merges first.** Either order is fine (disjoint files). Both must be on main before B2 branches.
2. **B2 (T3) merges second.** FE data layer depends on T1's route contract.
3. **B3 (T4) merges third.** Components depend on T3.
4. **B4 (T5) merges fourth.** Modal wiring + invalidation depend on T4.
5. **B5 (T6) merges last.** Verification record.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | 1 | `backend/src/services/activityService.ts(+test)`, `backend/src/routes/tickets.routes.ts`, `backend/src/routes/tickets.routes.test.ts` | F18/F16 (DONE) | T2 |
| **T2** | 1 | `frontend/src/utils/formatRelativeTime.ts(+test)`, `frontend/src/utils/describeActivity.ts(+test)` | — | T1 |
| **T3** | 2 | `frontend/src/types/activity.ts`, `frontend/src/api/tickets.ts`, `frontend/src/api/queryKeys.ts` | T1 | — |
| **T4** | 3 | `frontend/src/components/ActivityFeed.tsx(+test)`, `frontend/src/components/ActivityItem.tsx(+test)` | T2, T3 | — |
| **T5** | 4 | `frontend/src/components/TicketDetailModal.tsx`, `frontend/src/hooks/useUpdateTicket.ts`, `frontend/src/hooks/useMoveTicket.ts` | T4 | — |
| **T6** | 5 | (verification record only) | T5 | — |

### Developer assignment tracks

- **Solo (recommended):** (T1 ‖ T2) → T3 → T4 → T5 → T6. ~0.5–1 day. F19 is medium: a BE read+enrich route + FE feed component + two utils + modal wiring.
- **2 devs:** Dev-A: T1 (backend) → T3 (after T1) → T4 → T5. Dev-B: T2 (FE utils, parallel with T1) → assists T4 tests. The backend (T1) and FE utils (T2) are disjoint; the rest serializes through the FE stack.
- **3 devs:** Dev-A: T1 (backend). Dev-B: T2 (FE utils). Dev-C: waits for T1, then T3 → T4 → T5. T6 shared.

---

## 6. Tasks

> **Code-snippet note:** the snippets below are illustrative; the implementer MUST read the actual current code (`activityLogService.ts`, `ticketService.ts:261-308` for the alias-join pattern, `tickets.routes.ts`, `tickets.routes.test.ts:1-49`, `tickets.ts`, `queryKeys.ts`, `TicketDetailModal.tsx`, `formatDate.ts`, `types/ticket.ts`) before editing — verify exact signatures and adapt.

### T1 — Backend: `getTicketActivity` enrichment service + `GET /:ticketId/activity` route + tests

**Batch:** 1 · **Depends on:** F18/F16 (DONE) · **Parallel with:** T2

**Description:** The data-correctness + resolution spine. (1) Create `backend/src/services/activityService.ts` exporting `getTicketActivity(ticketId): Promise<ActivityEntry[]>` — enriches F18's rows into render-ready payloads (actor resolved, column names resolved, assignee names resolved, priority enum passthrough, label-diff passthrough). (2) Add `GET /:ticketId/activity` to `backend/src/routes/tickets.routes.ts` (authenticate + validateRequest → `success({ entries })`). (3) Extend `tickets.routes.test.ts` with `getTicketActivity: vi.fn()` in the mock map + a GET suite. (4) Add a co-located `activityService.test.ts` for enrichment correctness + edge-case fallbacks (table-driven).

Create `backend/src/services/activityService.ts`:

```typescript
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { activityLogs, tickets, users, projects } from '../db/schema';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// F19 D8: F19 owns NO schema — read-only over F18's activityLogs table.
// F19 D1/D3/D4: BACKEND ENRICH. Resolve actor (leftJoin users, FK SET NULL),
// column id→name (projects.columns JSONB), assignee uuid→name (batch users lookup),
// 'unassigned'→'Unassigned'. Priority enum + label-diff string passthrough (FE formats).

// F19 D5: cap the payload. 50 newest rows covers any realistic per-ticket history.
export const MAX_ACTIVITY_ROWS = 50;

const UNASSIGNED = 'unassigned';
const UNKNOWN_USER = 'Unknown user';
const UNKNOWN_COLUMN = 'Unknown column';

export type EnrichedActionType =
  | 'CREATED' | 'STATUS_CHANGED' | 'PRIORITY_CHANGED'
  | 'ASSIGNEE_CHANGED' | 'LABELS_CHANGED' | 'CONTENT_UPDATED';

export interface ActivityActor {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface ActivityEntry {
  id: string;
  createdAt: string; // ISO
  actionType: EnrichedActionType;
  actor: ActivityActor | null; // null = deleted user (FK ON DELETE SET NULL)
  from: string | null; // resolved name (column/assignee) or passthrough (priority)
  to: string | null;
  message: string | null; // LABELS_CHANGED readable string passthrough
}

export async function getTicketActivity(ticketId: string): Promise<ActivityEntry[]> {
  // 1. Load the ticket (404 if missing OR soft-deleted — F17 filter).
  const ticketRows = await db
    .select({ id: tickets.id, projectId: tickets.projectId })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  const ticket = ticketRows[0];
  if (!ticket) {
    throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${ticketId}' not found`, {
      details: { ticketId },
    });
  }

  // 2. Load the project's columns JSONB → id→name map (STATUS_CHANGED resolution).
  const projectRows = await db
    .select({ columns: projects.columns })
    .from(projects)
    .where(eq(projects.id, ticket.projectId))
    .limit(1);
  const columnMap = new Map<string, string>(
    (projectRows[0]?.columns ?? []).map((c) => [c.id, c.name]),
  );

  // 3. Query activity rows reverse-chrono, leftJoin users for actor (FK SET NULL → null).
  //    F19 D9: ORDER BY created_at DESC. Index activity_logs_ticket_id_idx supports this.
  const rows = await db
    .select({
      id: activityLogs.id,
      createdAt: activityLogs.createdAt,
      actionType: activityLogs.actionType,
      oldValue: activityLogs.oldValue,
      newValue: activityLogs.newValue,
      actorId: users.id,
      actorFullName: users.fullName,
      actorAvatarUrl: users.avatarUrl,
    })
    .from(activityLogs)
    .leftJoin(users, eq(users.id, activityLogs.userId))
    .where(eq(activityLogs.ticketId, ticketId))
    .orderBy(desc(activityLogs.createdAt))
    .limit(MAX_ACTIVITY_ROWS);

  // 4. Batch-resolve assignee userIds (ASSIGNEE_CHANGED old/new are uuid OR 'unassigned').
  const assigneeIds = new Set<string>();
  for (const row of rows) {
    if (row.actionType === 'ASSIGNEE_CHANGED') {
      if (row.oldValue && row.oldValue !== UNASSIGNED) assigneeIds.add(row.oldValue);
      if (row.newValue && row.newValue !== UNASSIGNED) assigneeIds.add(row.newValue);
    }
  }
  const assigneeMap = new Map<string, string>();
  if (assigneeIds.size > 0) {
    const assigneeRows = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(inArray(users.id, [...assigneeIds]));
    for (const u of assigneeRows) assigneeMap.set(u.id, u.fullName);
  }

  // 5. Enrich each row into a render-ready ActivityEntry.
  return rows.map((row) => {
    const actor: ActivityActor | null =
      row.actorId === null
        ? null // deleted user (FK ON DELETE SET NULL) → FE renders "Unknown user"
        : {
            id: row.actorId,
            fullName: row.actorFullName ?? UNKNOWN_USER,
            avatarUrl: row.actorAvatarUrl,
          };

    let from = row.oldValue;
    let to = row.newValue;
    let message: string | null = null;

    switch (row.actionType) {
      case 'STATUS_CHANGED':
        // Column id → name (deleted column → "Unknown column").
        from = row.oldValue ? (columnMap.get(row.oldValue) ?? UNKNOWN_COLUMN) : null;
        to = row.newValue ? (columnMap.get(row.newValue) ?? UNKNOWN_COLUMN) : null;
        break;
      case 'ASSIGNEE_CHANGED':
        // uuid → name; 'unassigned' → "Unassigned"; deleted → "Unknown user".
        from = resolveAssignee(row.oldValue, assigneeMap);
        to = resolveAssignee(row.newValue, assigneeMap);
        break;
      case 'LABELS_CHANGED':
        // Already a readable string ("added: Bug; removed: API") — passthrough.
        message = row.newValue;
        from = null;
        to = null;
        break;
      case 'PRIORITY_CHANGED':
        // Passthrough uppercase enum — FE Title-Cases via PRIORITY_DISPLAY.
        break;
      case 'CREATED':
      case 'CONTENT_UPDATED':
      default:
        from = null;
        to = null;
        break;
    }

    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      actionType: row.actionType,
      actor,
      from,
      to,
      message,
    };
  });
}

function resolveAssignee(value: string | null, map: Map<string, string>): string | null {
  if (value === null) return null;
  if (value === UNASSIGNED) return 'Unassigned';
  return map.get(value) ?? UNKNOWN_USER;
}
```

Modify `backend/src/routes/tickets.routes.ts` — add import + route (before or after the existing GET `/:ticketId`):

```typescript
import * as activityService from '../services/activityService';

// F19 D2: GET activity feed for a ticket. authenticate only (F08: all users see all projects).
// Returns render-ready enriched rows (D1/D3) reverse-chrono (D9), capped at MAX_ACTIVITY_ROWS.
ticketsRouter.get(
    '/:ticketId/activity',
    authenticate,
    validateRequest({ params: ticketIdParam }),
    async (req, res) => {
        const { ticketId } = req.params as TicketIdParam;
        const entries = await activityService.getTicketActivity(ticketId);
        res.json(success({ entries }));
    },
);
```

**Route ordering note:** Express matches `/:ticketId` and `/:ticketId/activity` correctly (the latter is more specific). Register `/:ticketId/activity` BEFORE `/:ticketId` if there's any ambiguity, OR verify the existing GET `/:ticketId` doesn't shadow it (it won't — `/activity` is a distinct segment).

Modify `backend/src/routes/tickets.routes.test.ts` — add `getTicketActivity: vi.fn()` to the `vi.mock('../services/ticketService', …)` map (note: `activityService` is a SEPARATE module; add a second `vi.mock('../services/activityService', …)`):

```typescript
vi.mock('../services/activityService', () => ({
  getTicketActivity: vi.fn(),
}));
// ...
import * as activityService from '../services/activityService';
const mockedGetTicketActivity = vi.mocked(activityService.getTicketActivity);

describe('GET /api/tickets/:ticketId/activity', () => {
  beforeEach(() => {
    mockedGetTicketActivity.mockReset();
    mockedFindVersion.mockResolvedValue(0);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get(`/api/tickets/${VALID_TICKET_ID}/activity`);
    expect(res.status).toBe(401);
    expect(mockedGetTicketActivity).not.toHaveBeenCalled();
  });

  it('returns 200 success({ entries }) for an authenticated user (no role gate)', async () => {
    const entries = [{ id: 'log-1', createdAt: '2026-06-24T10:00:00.000Z', actionType: 'CREATED', actor: { id: 'u1', fullName: 'Muntasir', avatarUrl: null }, from: null, to: null, message: null }];
    mockedGetTicketActivity.mockResolvedValueOnce(entries);
    const res = await request(app)
      .get(`/api/tickets/${VALID_TICKET_ID}/activity`)
      .set('Authorization', `Bearer ${signJwt({ sub: 'u1', email: 'a@b.c', role: 'MEMBER' })}`);
    expect(res.status).toBe(200);
    expect(res.body.data.entries).toEqual(entries);
    expect(mockedGetTicketActivity).toHaveBeenCalledWith(VALID_TICKET_ID);
  });

  it('returns 404 NOT_FOUND when getTicketActivity throws (missing ticket)', async () => {
    mockedGetTicketActivity.mockRejectedValueOnce(
      new AppError(ErrorCode.NOT_FOUND, `Ticket '${VALID_TICKET_ID}' not found`),
    );
    const res = await request(app)
      .get(`/api/tickets/${VALID_TICKET_ID}/activity`)
      .set('Authorization', `Bearer ${signJwt({ sub: 'u1', email: 'a@b.c', role: 'MEMBER' })}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects an invalid uuid param with 400 VALIDATION_FAILED', async () => {
    const res = await request(app)
      .get('/api/tickets/not-a-uuid/activity')
      .set('Authorization', `Bearer ${signJwt({ sub: 'u1', email: 'a@b.c', role: 'MEMBER' })}`);
    expect(res.status).toBe(400);
    expect(mockedGetTicketActivity).not.toHaveBeenCalled();
  });
});
```

Create `backend/src/services/activityService.test.ts` — table-driven enrichment + edge-case tests (mock `db`):

```typescript
// Table-driven: for each actionType, given raw {oldValue, newValue}, assert enriched {from, to, message}.
// Edge cases: null actor (deleted user) → actor null; deleted column id → "Unknown column";
// 'unassigned' → "Unassigned"; deleted assignee uuid → "Unknown user"; LABELS passthrough;
// reverse-chrono ordering (DESC); MAX_ACTIVITY_ROWS cap applied.
```

**Acceptance Criteria:**
- [ ] `activityService.ts` exists; exports `getTicketActivity(ticketId): Promise<ActivityEntry[]>`, `MAX_ACTIVITY_ROWS = 50`, and the `ActivityEntry`/`ActivityActor`/`EnrichedActionType` types.
- [ ] `getTicketActivity` throws `AppError(ErrorCode.NOT_FOUND, …)` for a missing ticket.
- [ ] Query uses `db.select(...).from(activityLogs).leftJoin(users, eq(users.id, activityLogs.userId)).where(eq(activityLogs.ticketId, ticketId)).orderBy(desc(activityLogs.createdAt)).limit(MAX_ACTIVITY_ROWS)` — ORM only, no string-concat SQL.
- [ ] Actor resolution: null when `actorId` is null (FK SET NULL deleted user); `{id, fullName, avatarUrl}` otherwise.
- [ ] STATUS_CHANGED: column id→name via `projects.columns` map; deleted id → "Unknown column".
- [ ] ASSIGNEE_CHANGED: uuid→name via batch `users` lookup; `'unassigned'` → "Unassigned"; deleted uuid → "Unknown user".
- [ ] PRIORITY_CHANGED: passthrough uppercase enum (no server-side Title-Case).
- [ ] LABELS_CHANGED: `message = newValue` (readable string passthrough); `from`/`to` null.
- [ ] CREATED / CONTENT_UPDATED: `from`/`to`/`message` all null.
- [ ] `GET /:ticketId/activity` route registered with `authenticate → validateRequest({ params: ticketIdParam })`; NO role gate.
- [ ] Route returns `200 success({ entries })`; `401` unauth; `400` bad uuid; `404` missing ticket.
- [ ] `tickets.routes.test.ts` adds the `activityService` mock + GET suite (401/200/404/400).
- [ ] `activityService.test.ts` covers enrichment correctness + all edge-case fallbacks (table-driven).
- [ ] No `any`; no string-concat SQL; 2-space indent.
- [ ] `rtk tsc` (BE) + `rtk vitest run` (BE) pass.

**Dependencies:** F18/F16 (DONE). Decisions D1, D2, D3, D4, D8, D9.

---

### T2 — FE utils: `formatRelativeTime` + `describeActivity` + tests

**Batch:** 1 · **Depends on:** — · **Parallel with:** T1

**Description:** Two pure, table-testable FE utils. (1) `formatRelativeTime(iso): string` — native `Intl.RelativeTimeFormat` ("2h ago", "just now", "3d ago"). (2) `describeActivity(entry): { sentence: string }` — a pure sentence-switch over `actionType` implementing REQ-5.2/5.3 grammar. Both are co-located with table-driven Vitest tests. These have NO backend dependency (pure functions over a typed `ActivityEntry`-shaped argument), so they develop fully in parallel with T1.

Create `frontend/src/utils/formatRelativeTime.ts`:

```typescript
// F19 D6/D10: native Intl.RelativeTimeFormat (no dep). Relative primary ("2h ago");
// the absolute locale time is shown in a title tooltip via formatDate (ActivityItem).
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// F19: relative time for the activity feed. Returns "now"/"5 min ago"/"3 h ago"/"2 d ago"/"1 wk ago"
// or a locale-aware fallback for older. Bounds: the modal's drift reconciliation is 30s, so the
// feed stays fresh; entries older than a week fall back to formatDate (handled by caller if desired).
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
    const then = new Date(iso).getTime();
    const diff = then - now.getTime(); // negative = past

    const absMs = Math.abs(diff);
    if (absMs < MINUTE) return rtf.format(Math.round(diff / 1000), 'second');
    if (absMs < HOUR) return rtf.format(Math.round(diff / MINUTE), 'minute');
    if (absMs < DAY) return rtf.format(Math.round(diff / HOUR), 'hour');
    if (absMs < WEEK) return rtf.format(Math.round(diff / DAY), 'day');
    return rtf.format(Math.round(diff / WEEK), 'week');
}
```

Create `frontend/src/utils/describeActivity.ts`:

```typescript
import { PRIORITY_DISPLAY, type Priority } from '@/types/ticket';
import type { ActivityEntry, ActivityAction } from '@/types/activity';

// F19 D7: PURE sentence-switch over actionType. REQ-5.2 grammar:
//   {actor} {action} {field} from {old} to {new}
// REQ-5.3: CONTENT_UPDATED → generic "updated the description" (no diff).
// Returns the action clause (caller prepends the actor name + appends time).
export interface ActivitySentence {
    clause: string; // e.g. "changed Priority from Low to High"
}

const UNKNOWN_USER = 'Unknown user';

// F19 D4: actor label — null actor (deleted user) → "Unknown user".
export function actorLabel(entry: ActivityEntry): string {
    return entry.actor?.fullName ?? UNKNOWN_USER;
}

export function describeActivity(entry: ActivityEntry): ActivitySentence {
    const clause = describeClause(entry);
    return { clause };
}

function describeClause(entry: ActivityEntry): string {
    switch (entry.actionType) {
        case 'CREATED':
            return 'created the ticket';
        case 'STATUS_CHANGED':
            return `moved from ${entry.from ?? UNKNOWN_USER} to ${entry.to ?? UNKNOWN_USER}`;
        case 'PRIORITY_CHANGED':
            // Backend passes the raw uppercase enum; Title-Case via PRIORITY_DISPLAY.
            return `changed Priority from ${displayPriority(entry.from)} to ${displayPriority(entry.to)}`;
        case 'ASSIGNEE_CHANGED':
            return `changed assignee from ${entry.from ?? UNKNOWN_USER} to ${entry.to ?? UNKNOWN_USER}`;
        case 'LABELS_CHANGED':
            // Backend passthrough readable string ("added: Bug; removed: API").
            return entry.message ?? 'updated labels';
        case 'CONTENT_UPDATED':
            // REQ-5.3: generic, no diff.
            return 'updated the description';
        default:
            return 'updated the ticket';
    }
}

function displayPriority(value: string | null): string {
    if (value === null) return UNKNOWN_USER;
    return PRIORITY_DISPLAY[value as Priority] ?? value;
}
```

**Type note:** `describeActivity` imports `ActivityEntry` from `@/types/activity` (created in T3). For T2 to compile independently, define a **local minimal structural type** in `describeActivity.ts` OR stub `types/activity.ts` as part of T2 (it's a tiny type file — promote it to T2 to unblock). **Decision: move `types/activity.ts` creation into T2** (it's disjoint from T1/T3's other files and T4/T5 depend on it). Update T3 to skip type creation.

Create `frontend/src/types/activity.ts` (moved here from T3):

```typescript
// F19 D3: enriched activity row (backend getTicketActivity response shape).
export type ActivityAction =
    | 'CREATED' | 'STATUS_CHANGED' | 'PRIORITY_CHANGED'
    | 'ASSIGNEE_CHANGED' | 'LABELS_CHANGED' | 'CONTENT_UPDATED';

export interface ActivityActor {
    id: string;
    fullName: string;
    avatarUrl: string | null;
}

export interface ActivityEntry {
    id: string;
    createdAt: string; // ISO
    actionType: ActivityAction;
    actor: ActivityActor | null;
    from: string | null;
    to: string | null;
    message: string | null;
}

export interface ActivityResponse {
    entries: ActivityEntry[];
}
```

Create `frontend/src/utils/formatRelativeTime.test.ts` + `frontend/src/utils/describeActivity.test.ts` — table-driven (per `js-testing-rules.md`):

```typescript
// formatRelativeTime.test.ts: now → "now"; 5 min ago → "5 minutes ago"; 3 h ago; 2 d ago; 1 wk ago.
// describeActivity.test.ts: one row per actionType asserting the clause; edge cases:
//   null actor → actorLabel "Unknown user"; PRIORITY passthrough Title-Cases;
//   STATUS/ASSIGNEE with null from/to → "Unknown user" fallback; LABELS → message passthrough.
```

**Acceptance Criteria:**
- [ ] `formatRelativeTime.ts` exists; uses native `Intl.RelativeTimeFormat` (no dep); handles seconds/minutes/hours/days/weeks.
- [ ] `describeActivity.ts` exists; exports `describeActivity(entry): { clause }` + `actorLabel(entry)`.
- [ ] `describeActivity` switch covers all 6 `actionType`s; CREATED → "created the ticket"; CONTENT_UPDATED → "updated the description" (no diff, REQ-5.3); PRIORITY Title-Cases via `PRIORITY_DISPLAY`; LABELS → `message` passthrough.
- [ ] `actorLabel` returns "Unknown user" for null actor (deleted user, D4).
- [ ] `types/activity.ts` exists with `ActivityEntry`/`ActivityActor`/`ActivityAction`/`ActivityResponse`.
- [ ] Both test files are table-driven; assert per-actionType clauses + edge fallbacks.
- [ ] No `any`; pure functions; 2-space indent; import order correct.
- [ ] `rtk tsc` (FE) + `rtk vitest run` (FE utils) pass.

**Dependencies:** — (pure functions). Decisions D4, D6, D7, D10. (Note: `types/activity.ts` moved here from T3 to unblock T2 compilation.)

---

### T3 — FE: `fetchTicketActivity` api fn + `ticketKeys.activity`

**Batch:** 2 · **Depends on:** T1 · **Parallel with:** —

**Description:** The FE data layer. (1) Add `fetchTicketActivity(ticketId)` to `frontend/src/api/tickets.ts` (mirrors `fetchTicket:36-38`). (2) Add `ticketKeys.activity(id)` to `frontend/src/api/queryKeys.ts`. (`types/activity.ts` is already created in T2.) These depend on T1's route contract (`GET /api/tickets/:ticketId/activity` → `success({ entries })`).

Modify `frontend/src/api/tickets.ts` — append `fetchTicketActivity`:

```typescript
import type { ActivityResponse } from '../types/activity';

// F19 T3: GET /tickets/:id/activity — render-ready enriched activity rows.
// apiFetch unwraps { data } → ActivityResponse ({ entries: ActivityEntry[] }).
export async function fetchTicketActivity(ticketId: string): Promise<ActivityResponse> {
    return apiFetch<ActivityResponse>(`/tickets/${ticketId}/activity`);
}
```

Modify `frontend/src/api/queryKeys.ts` — add `activity` to `ticketKeys`:

```typescript
export const ticketKeys = {
    all: ['tickets'] as const,
    detail: (id: string) => [...ticketKeys.all, 'detail', id] as const,
    // F19 T3: per-ticket activity feed cache key.
    activity: (id: string) => [...ticketKeys.all, 'activity', id] as const,
};
```

**Acceptance Criteria:**
- [ ] `fetchTicketActivity(ticketId): Promise<ActivityResponse>` exists; calls `apiFetch<ActivityResponse>('/tickets/:id/activity')`.
- [ ] `ticketKeys.activity(id)` exists; key shape `['tickets', 'activity', id]`.
- [ ] `ActivityResponse` imported from `@/types/activity` (created in T2).
- [ ] No `any`; 2-space indent.
- [ ] `rtk tsc` (FE) passes.

**Dependencies:** T1 (route contract). Decisions D2, D3.

---

### T4 — FE: `ActivityFeed` + `ActivityItem` components + tests

**Batch:** 3 · **Depends on:** T2, T3 · **Parallel with:** —

**Description:** The UI. (1) `ActivityItem.tsx` — renders one enriched row: actor avatar + name (`actorLabel`), sentence (`describeActivity` clause), relative time (`formatRelativeTime`) with an absolute `title` tooltip (`formatDate`). (2) `ActivityFeed.tsx` — `useQuery(ticketKeys.activity(ticketId))` + `useState` show-more: renders the first `INITIAL_FEED_VISIBLE` items, then a "Show N more" button toggling the rest. Loading/error/empty states.

Create `frontend/src/components/ActivityItem.tsx`:

```tsx
import type { ActivityEntry } from '@/types/activity';
import { actorLabel, describeActivity } from '@/utils/describeActivity';
import { formatRelativeTime } from '@/utils/formatRelativeTime';
import { formatDate } from '@/utils/formatDate';

// F19 D5/D6: one enriched activity row. Actor avatar+name, sentence clause,
// relative time primary + absolute locale time in a title tooltip (Journey 3 "at 10:15 AM").
interface ActivityItemProps {
    entry: ActivityEntry;
}

export function ActivityItem({ entry }: ActivityItemProps) {
    const { clause } = describeActivity(entry);
    const name = actorLabel(entry);
    const absolute = formatDate(entry.createdAt);

    return (
        <li className="flex gap-3 py-2">
            {entry.actor?.avatarUrl ? (
                <img
                    src={entry.actor.avatarUrl}
                    alt={name}
                    className="h-7 w-7 rounded-full"
                />
            ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gray-200 text-xs text-gray-600">
                    {name.charAt(0)}
                </div>
            )}
            <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-800">
                    <span className="font-medium">{name}</span> {clause}
                </p>
                <p className="text-xs text-gray-500" title={absolute}>
                    {formatRelativeTime(entry.createdAt)}
                </p>
            </div>
        </li>
    );
}
```

Create `frontend/src/components/ActivityFeed.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchTicketActivity } from '@/api/tickets';
import { ticketKeys } from '@/api/queryKeys';
import { ActivityItem } from './ActivityItem';

// F19 D5: client-side show-more. Backend caps at MAX_ACTIVITY_ROWS (50); FE renders the
// first INITIAL_FEED_VISIBLE then a "Show N more" toggle. No infinite-query / cursor pagination.
const INITIAL_FEED_VISIBLE = 5;

interface ActivityFeedProps {
    ticketId: string;
}

export function ActivityFeed({ ticketId }: ActivityFeedProps) {
    const [expanded, setExpanded] = useState(false);
    const { data, isLoading, isError } = useQuery({
        queryKey: ticketKeys.activity(ticketId),
        queryFn: () => fetchTicketActivity(ticketId),
    });

    const entries = data?.entries ?? [];
    const visible = expanded ? entries : entries.slice(0, INITIAL_FEED_VISIBLE);
    const hiddenCount = entries.length - INITIAL_FEED_VISIBLE;

    return (
        <div className="mt-4 border-t border-gray-200 pt-4">
            <h3 className="mb-2 text-sm font-semibold text-gray-700">Activity</h3>
            {isLoading && <p className="text-sm text-gray-500">Loading activity…</p>}
            {isError && <p className="text-sm text-red-600">Failed to load activity.</p>}
            {!isLoading && !isError && entries.length === 0 && (
                <p className="text-sm text-gray-500">No activity yet.</p>
            )}
            {entries.length > 0 && (
                <ul className="divide-y divide-gray-100">
                    {visible.map((entry) => (
                        <ActivityItem key={entry.id} entry={entry} />
                    ))}
                </ul>
            )}
            {!expanded && hiddenCount > 0 && (
                <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="mt-2 text-sm text-blue-600 hover:underline"
                >
                    Show {hiddenCount} more
                </button>
            )}
        </div>
    );
}
```

Create `frontend/src/components/ActivityFeed.test.tsx` + `frontend/src/components/ActivityItem.test.tsx` (Testing Library, `getByRole`/`getByText`):

```tsx
// ActivityFeed.test.tsx: renders items reverse-chrono; show-more toggle (5 → all);
// loading/error/empty states; uses mocked useQuery (vi.mock('@tanstack/react-query')).
// ActivityItem.test.tsx: per-actionType render (CREATED/PRIORITY/STATUS/ASSIGNEE/LABELS/CONTENT);
// null actor → "Unknown user"; relative time + absolute title present.
```

**Acceptance Criteria:**
- [ ] `ActivityItem` renders actor avatar (or initial fallback), name + clause sentence, relative time with absolute `title` tooltip.
- [ ] `ActivityItem` handles null actor → "Unknown user" (D4).
- [ ] `ActivityFeed` uses `useQuery(ticketKeys.activity(ticketId))`; loading/error/empty states.
- [ ] `ActivityFeed` renders first `INITIAL_FEED_VISIBLE` (5) entries; "Show N more" toggle reveals the rest; hides the button when expanded or when ≤5 entries.
- [ ] `INITIAL_FEED_VISIBLE = 5` is a SCREAMING constant.
- [ ] No `any`; no inline styles (Tailwind only); explicit prop interfaces; PascalCase components; 4-space JSX / 2-space JS.
- [ ] Tests use `getByRole`/`getByText` priority; table-driven where applicable.
- [ ] Coverage of `ActivityFeed.tsx` + `ActivityItem.tsx` > 70%.
- [ ] `rtk tsc` (FE) + `rtk vitest run` (FE components) pass.

**Dependencies:** T2 (utils + types), T3 (api + query key). Decisions D5, D6, D7.

---

### T5 — FE: wire `ActivityFeed` into `TicketDetailModal` + activity cache invalidation

**Batch:** 4 · **Depends on:** T4 · **Parallel with:** —

**Description:** The integration. (1) Render `<ActivityFeed ticketId={ticketId} />` at the `TicketDetailModal.tsx:160` seam (replacing the comment). (2) Add `ticketKeys.activity(ticketId)` invalidation to `useUpdateTicket` + `useMoveTicket` `onSuccess` so edits/moves (F18 write paths) produce a fresh feed row without waiting for the 30s drift refetch.

Modify `frontend/src/components/TicketDetailModal.tsx` — replace the `:160` seam:

```tsx
import { ActivityFeed } from './ActivityFeed';
// ... inside <Modal>, replacing the :160 comment:
{/* F19 T5: reverse-chronological activity feed (REQ-5.1, REQ-5.2). */}
<ActivityFeed ticketId={ticketId} />
```

Modify `frontend/src/hooks/useUpdateTicket.ts` — add activity invalidation in `onSuccess`:

```typescript
import { ticketKeys } from '@/api/queryKeys';
// in onSuccess, alongside the existing boardKeys/detail invalidations:
queryClient.invalidateQueries({ queryKey: ticketKeys.activity(vars.ticketId) });
```

Modify `frontend/src/hooks/useMoveTicket.ts` — same addition in `onSuccess`.

**Acceptance Criteria:**
- [ ] `TicketDetailModal` renders `<ActivityFeed ticketId={ticketId} />` at the `:160` seam (comment replaced).
- [ ] `useUpdateTicket.onSuccess` invalidates `ticketKeys.activity(ticketId)`.
- [ ] `useMoveTicket.onSuccess` invalidates `ticketKeys.activity(ticketId)`.
- [ ] The `:160` seam comment is replaced by the live component.
- [ ] No `any`; no inline styles.
- [ ] `rtk tsc` (FE) passes.

**Dependencies:** T4. Decisions D5.

---

### T6 — Integration verification & sign-off

**Batch:** 5 (terminal) · **Depends on:** all prior · **Parallel with:** —

**Description:** The final definition-of-done gate. Run every tool against the as-merged feature, fix gaps, record proof. Do NOT check the box — the owner does.

Steps:
1. **Typecheck:** `rtk tsc` (BE + FE) — zero new errors.
2. **Lint:** `rtk lint` — zero new violations.
3. **Format:** `rtk prettier --check` — zero unformatted files.
4. **Tests:** `rtk vitest run` (BE + FE) — all green. Coverage on `activityService.ts` + `ActivityFeed`/`ActivityItem` + utils > 70%.
5. **Build:** FE `npm run build` succeeds; BE boots.
6. **No schema delta:** confirm `schema.ts` is unchanged; no new migration file (F19 owns none — F18 owns the table).
7. **Live smoke (manual):**
   - Start BE + FE locally.
   - Open a ticket detail modal → **Activity feed renders** inside the modal (below the F17 delete block), reverse-chronological, newest first.
   - **Each item shows actor + sentence + time:** e.g. "Muntasir changed Priority from Low to High · 2 h ago" (hover → absolute "Jun 24, 2026, 10:15 AM").
   - **Edits produce new rows:** change priority/assignee/status/labels in the modal → save → a new activity row appears at the top of the feed (cache invalidated by T5).
   - **Deleted-user graceful:** (DB) `UPDATE "Users" SET ... ` to simulate, OR test with a log whose `user_id` is null → renders "Unknown user".
   - **Deleted-column graceful:** a STATUS_CHANGED row whose column id is no longer in `projects.columns` → renders "Unknown column".
   - **Assignee sentinel:** an ASSIGNEE_CHANGED row with `'unassigned'` → renders "Unassigned".
   - **Show-more:** seed >5 activity rows → first 5 render + "Show N more" button → click → all render.
   - **Long feed cap:** confirm backend caps at 50 (`MAX_ACTIVITY_ROWS`).
   - **Auth:** `curl -H "Authorization: Bearer <token>" /api/tickets/<id>/activity` → `200 { data: { entries: [...] } }`; no token → `401`; bad uuid → `400`; missing ticket → `404`.
   - **Localized time:** confirm timestamps render in the browser locale (relative + absolute tooltip).
8. **REQ mapping:** REQ-5.1 (feed exists per ticket) ✅; REQ-5.2 (explicit old→new logging with names) ✅; REQ-5.3 (description → generic, no diff) ✅; User Journey 3 (actor+action+old→new+time) ✅.

**Acceptance Criteria:**
- [ ] `rtk tsc` BE + FE exit 0.
- [ ] `rtk lint` exit 0, no new violations.
- [ ] `rtk prettier --check` exit 0.
- [ ] `rtk vitest run` BE + FE exit 0; coverage > 70% on activityService + ActivityFeed/ActivityItem + utils.
- [ ] FE build + BE boot succeed.
- [ ] No schema.ts change; no new migration (F19 owns none).
- [ ] Live smoke: feed renders in modal reverse-chrono; actor+sentence+time per item; edits produce new top rows; deleted user → "Unknown user"; deleted column → "Unknown column"; `'unassigned'` → "Unassigned"; show-more works (5 → all); backend cap 50; auth 401/400/404/200; localized time.

**Dependencies:** all prior tasks merged.

---

## 7. Final F19 Acceptance Checklist

- [ ] `GET /api/tickets/:ticketId/activity` returns `200 success({ entries })` (reverse-chrono, enriched, capped at 50); `401` unauth; `400` bad uuid; `404` missing ticket. Auth = `authenticate` only (no role gate, F08).
- [ ] Each enriched row: `{ id, createdAt, actionType, actor: {id,fullName,avatarUrl}|null, from, to, message }` (D3).
- [ ] The feed renders inside `TicketDetailModal` (at the `:160` seam), reverse-chronological, newest first.
- [ ] Each item shows **actor + action + old→new + time** (REQ-5.2 grammar; User Journey 3).
- [ ] **Graceful removed-entity rendering:** null actor → "Unknown user"; `'unassigned'` → "Unassigned"; deleted column → "Unknown column"; LABELS passthrough. FE never crashes.
- [ ] **Long feeds:** backend cap `MAX_ACTIVITY_ROWS=50`; FE renders first `INITIAL_FEED_VISIBLE=5` + "Show N more" toggle.
- [ ] **Localized UTC time:** relative primary (native `Intl.RelativeTimeFormat`) + absolute locale tooltip (`formatDate`).
- [ ] REQ-5.1 (feed per ticket) ✅; REQ-5.2 (explicit old→new with names) ✅; REQ-5.3 (description → generic, no diff) ✅.
- [ ] Backend enriches (D1); FE is a dumb sentence-switch (D7); no new deps (D10); ORM only, no string-concat SQL.
- [ ] Edits/moves invalidate `ticketKeys.activity(ticketId)` → fresh feed (T5).
- [ ] All tests pass (Vitest BE + FE); coverage on activity paths > 70%.
- [ ] Typecheck / lint / format / build all green.

**Integration record (fill during T6):**
- Feature commit SHA: `________`
- `GET /api/tickets/<id>/activity` response: `200 { data: { entries: [...] } }` — `________`
- Feed renders in modal (reverse-chrono): `________`
- Edit produces a new top row: `________`
- Deleted user → "Unknown user": `________`
- Deleted column → "Unknown column": `________`
- `'unassigned'` → "Unassigned": `________`
- Show-more (5 → all): `________`
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0`

---

## 8. Schema deltas owned by this feature

**F19 owns NO schema delta.** F19 is **read + UI only** over F18's `activityLogs` table. No `schema.ts` change, no migration. F18 owns the table (`schema.ts:204-223`) and all write/capture paths (CREATED/STATUS/PRIORITY/ASSIGNEE/LABELS/CONTENT).

| Delta | Detail | Migration |
| --- | --- | --- |
| — (none) | F19 adds no tables, columns, enums, or indexes. It reads F18's `activityLogs` via the existing `activity_logs_ticket_id_idx` (`schema.ts:221`). | NONE. |

> **No features.md deltas-table update needed for F19.** (Contrast F17, which introduced a new `tickets.deletedAt` delta. F19 introduces nothing.)

> **Forward contract:** any future global/cross-ticket activity feed (separate scope) would add a new query path over the same `activityLogs` table — still no schema delta.

---

## 9. Cross-cutting decisions — owner sign-off needed

1. **Backend enrich vs FE resolve.** **Recommend: BACKEND ENRICH** (D1). The GET route returns render-ready rows: actor resolved via leftJoin `users` (FK SET NULL → null), column id→name via `projects.columns`, assignee uuid→name via batch lookup, `'unassigned'`→"Unassigned", priority enum passthrough, label-diff passthrough. Rationale: atomicity (one resolution pass), deleted-entity edge cases handled server-side, FE stays a dumb sentence-switch matching the repo convention ("backend hydrates, FE renders" — labels/boardService, creator+assignee/getTicket `ticketService.ts:281-305`). **Needs owner confirmation.**
2. **Time display: relative+tooltip vs absolute-only.** **Recommend: RELATIVE PRIMARY + ABSOLUTE TOOLTIP** (D6/D11). "2h ago" via native `Intl.RelativeTimeFormat` + absolute locale time in a `title` tooltip (satisfies User Journey 3's "at 10:15 AM" on hover; keeps the list scannable). No new dep. **Needs owner confirmation.**
3. **Show-more: client-side cap vs backend pagination.** **Recommend: CLIENT-SIDE CAP, BACKEND MAX-50** (D5). Backend returns all rows capped at `MAX_ACTIVITY_ROWS` (50, newest-first); FE renders the first `INITIAL_FEED_VISIBLE` (5) + a "Show N more" `useState` toggle. No infinite-query/cursor pagination (a per-ticket feed bounded at 50 doesn't need it). **Needs owner confirmation.**
4. **Enrichment shape: per-row `{actor, from, to, message}` vs raw rows.** **Recommend: ENRICHED** (D3). Each row carries everything the FE sentence-switch needs; the FE never resolves ids. **Needs owner confirmation.**
5. **ASSIGNEE_CHANGED display "Alice → Bob" (backend resolves names).** **Confirm:** backend resolves both old/new assignee userIds to names via a batch `users` lookup; `'unassigned'` → "Unassigned"; deleted uuid → "Unknown user". FE renders "changed assignee from Alice to Bob". **Needs owner confirmation.**
6. **STATUS_CHANGED display "To Do → In Progress" (backend resolves column names).** **Confirm:** backend resolves both old/new column ids to names via the ticket's `projects.columns` JSONB map; deleted column id → "Unknown column". FE renders "moved from To Do to In Progress". **Needs owner confirmation.**

---

**Sources:**
- PRD REQ-5.1 ("Every ticket must have a 'History' or 'Activity' feed.").
- PRD REQ-5.2 ("Changing an attribute (Status, Priority, Assignee, Label) must explicitly log the change (e.g., 'Muntasir changed Priority from Low to High').").
- PRD REQ-5.3 (title/description → generic "updated the description"; no diff).
- PRD User Journey 3 (§7:121-130) (open ticket → Activity → actor+action+old→new+time).
- PRD §4 (content diffing out of scope).
- Grounding evidence file:line citations: `backend/src/db/schema.ts:56-59,76,193-200,204-223,221`; `backend/src/services/activityLogService.ts:8-14,39-50,59-103,66-68,70-76,78-80,94-103`; `backend/src/services/ticketService.ts:8,35-36,82-157,94,104,123-131,239,255-308,281-305`; `backend/src/routes/tickets.routes.ts:1-101`; `backend/src/routes/tickets.routes.test.ts:1-49`; `backend/src/index.ts:15,54`; `backend/src/utils/envelope.ts:5-42`; `frontend/src/types/ticket.ts:4-13`; `frontend/src/utils/formatDate.ts:1-12`; `frontend/src/api/tickets.ts:36-38`; `frontend/src/api/queryKeys.ts:12-15`; `frontend/src/components/TicketDetailModal.tsx:1-50,148-176,160`.
- Dependency feature task docs: [F16](../F16-ticket-detail-modal/F16-ticket-detail-modal-tasks.md), [F18](../F18-activity-log-capture/F18-activity-log-capture-tasks.md).
- Project rules: `.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`.