# F20 — Server-authoritative timer: Plan + Task Breakdown

> **Feature:** F20 — Server-authoritative timer (start/stop, browser-independent) (Phase 2 — Time tracking)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F16 (DONE ✅) — also uses F17 (DONE ✅), F08 (DONE ✅) · **PRD ref:** REQ-4.1, REQ-4.2, REQ-4.3, PRD §8.4
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), the project rules discovered for this repo (`.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`), plus dependency feature task docs: [F16](../F16-ticket-detail-modal/F16-ticket-detail-modal-tasks.md), [F17](../F17-soft-delete-tickets/F17-soft-delete-tickets-tasks.md), [F08](../F08-user-context/F08-user-context-tasks.md)

---

## 1. F20 Recap

**Goal:** Tracked time is correct regardless of client state — start/stop are recorded server-side, elapsed is computed from a server-issued timestamp, and closing the browser/PC never loses running time.

**Ships:** A "Start Timer" / "Stop Timer" button on each ticket (REQ-4.1). "Start" writes `{user_id, ticket_id, start_time}` server-side (REQ-4.2); the frontend timer is purely visual. "Stop" writes `end_time`. The timer continues running accurately even if the user closes their browser or turns off their computer (REQ-4.3) — reopening the ticket shows the correct elapsed time and allows stop. A user has at most one active (open) timer globally.

**Acceptance (definition of done):**
- `TimeEntries` table per PRD §8.4: `id` (UUID PK), `ticket_id` (UUID FK→Tickets cascade), `user_id` (UUID FK→Users set null), `start_time` (timestamptz), `end_time` (timestamptz nullable), `manual_entry_minutes` (Integer nullable — F21), `description` (text nullable), `created_at` (timestamptz defaultNow).
- `POST /api/tickets/:ticketId/timer/start` writes `{user_id, ticket_id, start_time}` server-side (REQ-4.2).
- `POST /api/tickets/:ticketId/timer/stop` fills `end_time` on the user's open timer for that ticket.
- `GET /api/timer/active` returns the current user's single open timer (if any), globally across all tickets.
- `GET /api/time` returns `{ now: ISO }` (server clock) for client clock-skew correction.
- Elapsed displayed client-side = `(now + serverOffset) - start_time`, recomputed from server time on modal load, ticked every 1s.
- A user has at most **one** active (open) timer globally — enforced server-side by a DB partial unique index on `user_id WHERE end_time IS NULL`.
- Starting a new timer **auto-stops** the previous open timer inside the same transaction.
- Closing the browser / PC and reopening shows the correct elapsed time and allows stop (REQ-4.3).
- Login flow surfaces an abandoned open timer with Resume / Stop / Discard options (clears the single-active lock before a new start).
- Moving a ticket with a running timer across columns does NOT stop the timer.
- Deleting a ticket with a running timer auto-stops the open timer inside `deleteTicket`'s transaction (F17 tie-in).

**Edge cases to resolve up front:**
- **Single-active enforcement (one open timer per user globally)** → **Decision:** DB partial unique index `uniqueIndex('time_entries_one_active').on(userId).where(sql\`${endTime} IS NULL\`)` — Postgres guarantees uniqueness at the storage layer (race-safe). Built via raw `sql` template (`IS NULL` is safe — no value to parameterize, so drizzle bug #4790 does not bite; confirmed by memory `drizzle-partial-index-enum-dollar1`).
- **Auto-stop vs reject on new start when a timer is open** → **Decision:** AUTO-STOP (industry standard — Toggl / Clockify / Harvest all auto-stop the previous timer). Inside `db.transaction`: `UPDATE TimeEntries SET end_time = NOW() WHERE user_id = $1 AND end_time IS NULL`, then `INSERT` new. A concurrent double-start is caught at commit as PG `23505` → `AppError(ErrorCode.CONFLICT, 409)`.
- **Clock skew (client clock ≠ server clock → wrong elapsed)** → **Decision:** dedicated `GET /api/time` → `{ now: ISO }`; client computes `offset = serverNow - clientNow`; elapsed = `(Date.now() + offset) - startTime`; re-synced every 5 min via TanStack Query (`staleTime: 5min`); live display via 1s `setInterval`.
- **Abandoned timers (user closes browser without stopping)** → **Decision:** MVP = login prompt (`GET /api/timer/active` → if open, show "Resume / Stop / Discard") + 24h display cap (client-side clamp on the elapsed readout). Defer the cron reconciliation job (Render Cron / node-cron) to post-MVP. The prompt clears the unique-index lock before any new start (stop or discard commits `end_time`).
- **Switching tickets / moving a timed ticket across columns** → **Decision:** does NOT stop the timer. The timer is user-scoped, not ticket-scoped — it keeps running on its original ticket. Board moves are independent.
- **Deleting a ticket with a running timer** → **Decision:** AUTO-STOP. `deleteTicket` (`ticketService.ts:422-433`) closes any open timer on the ticket inside its existing transaction before soft-deleting. Tie-in to F17.

---

## 2. Codebase Analysis Summary

- **State:** **Greenfield for the table, the timer service, the timer routes, the server-time endpoint, and the timer UI.** F16 (modal) ✅, F17 (soft-delete) ✅, F08 (user context) ✅ are all DONE in code. The integration seams exist and are well-defined.

- **Existing structure this feature builds on (with path citations):**
  - **`TimeEntries` table does NOT exist.** Append after `activityLogs` in `backend/src/db/schema.ts:204-223`. Idiom: `pgTable('TimeEntries', {...})` PascalCase table / camelCase keys; `uuid('id').primaryKey().defaultRandom()`; FKs `ticketId → tickets.id` (cascade) and `userId → users.id` (set null); `timestamp('start_time', { withTimezone: true, mode: 'date' }).notNull()`; `end_time` same type, nullable; `manual_entry_minutes integer` nullable (F21); `description text` nullable; `created_at timestampestz defaultNow notNull`. **Partial unique index** for single-active: `uniqueIndex('time_entries_one_active').on(table.userId).where(sql\`${table.endTime} IS NULL\`)` — MUST use raw `sql` template (NOT `eq()`; drizzle open bug #4790 emits `$1` for `eq()` in partial indexes; memory `drizzle-partial-index-enum-dollar1`). Import `sql` from `drizzle-orm`. No enum in this index → no `$1` bug for the partial index (the `IS NULL` template has no value to parameterize).
  - **`type Tx`** alias at `backend/src/services/ticketService.ts:14`: `type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]` — the canonical tx-threading idiom. `timerService` mirrors it.
  - **`db.transaction`** used throughout (`ticketService.ts:16`+): the start/stop sequence (auto-stop prior → insert new) MUST be one atomic transaction.
  - **`authenticate` middleware** (`backend/src/middleware/auth.ts:41`) sets `req.user = { id, email, role }`. Routes read `req.user!.id` for the acting user (pattern `tickets.routes.ts:75,83`). The timer is **per-user global** — keyed entirely on `req.user!.id`.
  - **Routes / nested pattern:** `backend/src/routes/tickets.routes.ts` exposes `ticketsRouter` mounted at `/api/tickets` (`index.ts:53-57`). Nested sub-resource precedent: `GET /:ticketId/activity` at `tickets.routes.ts:31-40`. F20 adds `POST /:ticketId/timer/start` + `POST /:ticketId/timer/stop` here. A top-level `timer` router adds `GET /api/timer/active`; a top-level `time` route adds `GET /api/time` — both registered in `index.ts:53-57`.
  - **Envelope + errors:** `success(...)` envelope; `AppError` + `ErrorCode` (incl. `CONFLICT`) in `backend/src/utils/envelope.ts`. Single-active violation → `AppError(ErrorCode.CONFLICT, …)`. Zod validation at the edge.
  - **F17 soft-delete interaction:** `deleteTicket` (`ticketService.ts:422-433`) currently soft-deletes (sets a deleted flag / similar) with NO timer awareness. F20 modifies it to auto-stop any open timer on the ticket before the soft-delete, inside the same transaction. The soft-deleted ticket's timer remains stoppable via the URL-driven read-only form (F16/F17 contract).
  - **F18 exclusion:** `activityActionEnum` (`schema.ts:193-200`) has NO timer action type. Timer events live in `TimeEntries` (F20 domain). F20 does NOT call `recordActivity` for timer events.
  - **No timer UI in modal:** `frontend/src/components/TicketDetailModal.tsx` has a header (`:108-125`), a form (`:128-147`), a delete button (`:149-160`), and an activity section (`:162`). The timer UI (Start/Stop + live elapsed) renders between the header and the form (after `:125`). Props `ticketId` + `slug` are available on the modal.

- **Migration:** next file `backend/src/db/migrations/0010_*.sql` (F18 took 0008; the current head before F20 is 0009 — confirm the actual next number at generate time). Dev DB is push-bootstrapped → apply via `docker exec -i slykboard-db psql -U slyk -d slykboard -v ON_ERROR_STOP=1 < 0010_*.sql` (NOT `db:migrate`; memory `dev-db-push-based-no-migration-journal`). No enum in this migration → no `$1` enum bug to reconcile. The partial unique index's `IS NULL` template is safe.

- **Files F20 creates:**
  - `backend/src/services/timerService.ts` — `startTimer`, `stopTimer`, `getActiveTimer`, `stopTimerForTicket` (F17 hook)
  - `backend/src/services/timerService.test.ts` — single-active, auto-stop, stop, get-active, delete interaction
  - `backend/src/routes/timer.routes.ts` — `GET /active` (current user's open timer)
  - `backend/src/routes/time.routes.ts` — `GET /` → `{ now: ISO }`
  - `backend/src/db/migrations/0010_create_time_entries.sql`
  - `frontend/src/types/timer.ts` — `TimeEntry`, `ActiveTimer`, `ServerTime`
  - `frontend/src/api/timer.ts` — `startTimer`, `stopTimer`, `fetchActiveTimer`, `fetchServerTime`
  - `frontend/src/hooks/useTimer.ts` — start/stop mutations + active-timer query
  - `frontend/src/hooks/useServerTime.ts` — clock-skew offset (TanStack Query, 5min staleTime)
  - `frontend/src/hooks/useElapsed.ts` — 1s setInterval tick from server-corrected now
  - `frontend/src/components/TimerControls.tsx` — Start/Stop button + live elapsed readout
  - `frontend/src/components/ActiveTimerPrompt.tsx` — login-time Resume/Stop/Discard prompt
  - `frontend/src/utils/timeFormat.ts` — `formatDuration(ms)` → `"1h 30m"` / `"45m"` / `"0m"`
  - `frontend/src/utils/timeFormat.test.ts`
  - `frontend/src/components/TimerControls.test.tsx`
- **Files F20 modifies:**
  - `backend/src/db/schema.ts` — `timeEntries` table + `time_entries_one_active` partial unique index
  - `backend/src/routes/tickets.routes.ts` — nest `POST /:ticketId/timer/start` + `POST /:ticketId/timer/stop`
  - `backend/src/index.ts` — mount `/api/timer` + `/api/time`
  - `backend/src/services/ticketService.ts` — `deleteTicket` auto-stops an open timer on the ticket inside its txn
  - `frontend/src/components/TicketDetailModal.tsx` — render `<TimerControls ticketId={…} />` between header (`:125`) and form (`:128`)
  - `frontend/src/App.tsx` (or equivalent root) — render `<ActiveTimerPrompt />` after auth (surfaces abandoned timer on login / page reload)

- **Project rules this plan must satisfy:** `.claude/rules/git-guidelines.md` (branch `feature/SLYK-F20-server-authoritative-timer`, single-line commits `SLYK-F20: <msg>`, rebase-merge only, never `--squash`, never `git merge`, sacred rule: never git without explicit approval); `.claude/rules/js-development-rules.md` (route→service→drizzle db; **never string-concat SQL**; transactions for atomicity — auto-stop + insert inside ONE txn; UTC timestamptz; consistent JSON envelope; `authenticate` middleware; Zod validation; TanStack Query for server state; useState for local UI; no WebSocket — F10 polling at 30s suffices); `.claude/rules/js-style-guide.md` (2-space JS, 4-space JSX, no `any`, SCREAMING constants, import order external→internal→types→relative, functions <50 lines, early returns, PascalCase components); `.claude/rules/js-testing-rules.md` (Vitest co-located, table-driven, `>80% business logic`, React Testing Library, `getByRole` priority); `.claude/rules/persona.md` (Node 24+ / Express 5 / Drizzle / Postgres; React 19+ / Vite / Tailwind / TanStack Query).

- **Hidden coupling to plan for:**
  - **The single-active guarantee is the load-bearing invariant.** It must be DB-enforced (partial unique index) — application-level checks alone are race-prone. The auto-stop-then-insert sequence runs in ONE transaction; a concurrent double-start is caught by the index at commit (PG `23505`).
  - **Clock skew is invisible until it bites.** Without `GET /api/time` + offset, a client with a wrong wall clock shows absurd elapsed. The offset is fetched once per modal load and refreshed every 5 min.
  - **The timer is user-scoped, not ticket-scoped.** Board moves (`moveTicket`) must NOT touch `TimeEntries`. `deleteTicket` is the only ticket mutation that touches an open timer (auto-stop), because the ticket is being destroyed.
  - **`deleteTicket` gains a timer dependency.** `timerService.stopTimerForTicket(tx, ticketId)` is called inside `deleteTicket`'s transaction before the soft-delete. This is an F17-owned file — flag the cross-feature touch.
  - **Abandoned timers hold the single-active lock.** The login prompt is the MVP escape hatch: it surfaces the open timer and forces a stop/discard before the user can start a new one. Without it, a user who never stops would be locked out of starting forever.
  - **24h display cap is client-side.** The timer keeps running server-side indefinitely; only the *displayed* elapsed is clamped (e.g. to 24h or "24h+") to avoid runaway integers in the readout. This is a UX decision, not a data decision.
  - **`manual_entry_minutes` + `description` are F21 columns but added now.** PRD §8.4 lists them in the `TimeEntries` schema; F20 creates the table once with the full column set so F21 (manual entry) needs no migration.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale (cite source) |
|---|----------|--------|-----------|
| D1 | `TimeEntries` table | **Per PRD §8.4 + project convention: `id` (UUID PK defaultRandom), `ticket_id` (UUID FK→Tickets ON DELETE CASCADE notNull), `user_id` (UUID FK→Users ON DELETE SET NULL notNull), `start_time` (timestamptz notNull), `end_time` (timestamptz nullable), `manual_entry_minutes` (integer nullable — F21), `description` (text nullable), `created_at` (timestamptz defaultNow notNull). NO `updatedAt`.** | PRD §8.4 is authoritative for the column set. Project convention (F18 `activityLogs`, `tickets`) adds `created_at` timestamptz defaultNow. `user_id` ON DELETE SET NULL preserves history if a user is deleted; `ticket_id` ON DELETE CASCADE because deleted tickets' timers are auto-stopped in `deleteTicket` (F17) anyway, but cascade is the safe fallback. Include `manual_entry_minutes` + `description` now (nullable) so F21 needs no migration. |
| D2 | Single-active enforcement | **DB partial unique index `uniqueIndex('time_entries_one_active').on(userId).where(sql\`${endTime} IS NULL\`)` + application-level auto-stop-on-start inside `db.transaction`.** Concurrent double-start → PG `23505` → `AppError(ErrorCode.CONFLICT, 409)`. | Postgres guarantees uniqueness at the storage layer (PostgreSQL docs §11.8) — race-safe. Application checks alone are TOCTOU-prone. The index is the source of truth. Memory `drizzle-partial-index-enum-dollar1`: use raw `sql` template with `IS NULL` (no value → no `$1` bug). |
| D3 | Auto-stop vs reject on new start | **AUTO-STOP** the previous open timer inside the start transaction (`UPDATE TimeEntries SET end_time = NOW() WHERE user_id = $1 AND end_time IS NULL`, then `INSERT`). | Industry standard — Toggl, Clockify, Harvest all auto-stop on new start (user-friendly, no lost time). Reject forces the user to navigate to the old ticket first; auto-stop is lower friction and matches the "one active timer" mental model. |
| D4 | Clock-skew correction | **Dedicated `GET /api/time` → `{ now: ISO }`.** Client: `offset = serverNow - Date.now()`; elapsed = `(Date.now() + offset) - startTime`; TanStack Query fetch on modal load + `staleTime: 5min` refresh; 1s `setInterval` for live readout. | Client wall clocks are unreliable (SO + r/react consensus). Server-issued `start_time` + a server-time offset makes elapsed robust to skew. 5min re-sync bounds drift to seconds. |
| D5 | Abandoned-timer policy (MVP) | **Login prompt via `GET /api/timer/active`**: if an open timer exists, show "You have a running timer — Resume / Stop / Discard". **24h client-side display cap** (clamp readout; data is unaffected). **Defer** the cron reconciliation job (Render Cron / node-cron) to post-MVP. | The single-active index locks the user out of new starts until the open timer is closed. The prompt is the MVP escape hatch. Cron is over-engineering for MVP (Double HQ / memtime behavior confirms prompt-first is standard). 24h cap is UX-only. |
| D6 | Deleting a ticket with a running timer | **AUTO-STOP** the open timer inside `deleteTicket`'s transaction before the soft-delete (`timerService.stopTimerForTicket(tx, ticketId)`). | The ticket is being destroyed; an orphaned open timer would hold the single-active lock forever. Auto-stop inside the txn keeps it atomic. Tie to F17. |
| D7 | Moving a ticket with a running timer | **Does NOT stop the timer.** The timer is user-scoped and bound to its original `ticket_id`; board moves are orthogonal. | The timer's identity is `(user_id, ticket_id, start_time)`. A column change is a status mutation, unrelated to the timer. Moving ≠ stopping. |
| D8 | Timer HTTP surface | **Nested under `ticketsRouter`: `POST /:ticketId/timer/start` + `POST /:ticketId/timer/stop`** (precedent `GET /:ticketId/activity` `tickets.routes.ts:31-40`). **Top-level: `GET /api/timer/active`** (current user's open timer, global) + **`GET /api/time`** (server clock). | RESTful (rules). Start/stop are ticket-scoped actions (the user starts a timer *on* a ticket). The active-timer lookup is user-scoped (global), so it lives at `/api/timer/active`. The time endpoint is app-global. |
| D9 | Frontend timer component | **`TimerControls`** renders in `TicketDetailModal` between header and form: a Start/Stop button + a live elapsed readout (`useElapsed`). `useServerTime` provides the offset; `useTimer` drives mutations + the active-timer query. | REQ-4.1 mandates a Start/Stop button on each task. The modal is the per-ticket surface (F16). Local 1s tick via `setInterval`; server state via TanStack Query (rules). |
| D10 | Migration 0010 | **`0010_create_time_entries.sql`** — `CREATE TABLE "TimeEntries" (...)` + `CREATE UNIQUE INDEX "time_entries_one_active" ON "TimeEntries" (user_id) WHERE end_time IS NULL`. No enum, no `$1` risk. Applied via `psql` pipe (dev DB push-based). | No `pgEnum` in this migration → the drizzle `$1` enum bug does not apply. The partial index's `IS NULL` is a raw SQL template (no value). Memory `dev-db-push-based-no-migration-journal`: pipe to psql, do not `db:migrate`. |

> **Out of F20 scope (explicitly deferred):**
> - **Manual time entries** → F21. The `manual_entry_minutes` + `description` columns exist now (nullable) but no UI/route to write them.
> - **Cron reconciliation of abandoned timers** → post-MVP. The login prompt handles MVP.
> - **Timer reports / aggregations** → future feature. F20 only stores rows + displays elapsed.
> - **Timer events in the activity log** → F18 domain explicitly excludes timers (F18 `activityActionEnum` has no timer type). Timer state lives in `TimeEntries`.

> **Owner sign-off needed (see §9):** (a) auto-stop vs reject [recommend auto-stop]; (b) abandoned-timer MVP policy [recommend login prompt + 24h cap, defer cron]; (c) deleting ticket with running timer → auto-stop [recommend auto-stop]; (d) server-time endpoint [recommend dedicated `GET /api/time`]; (e) FE elapsed tick [confirm 1s setInterval + server offset]; (f) `manual_entry_minutes` + `description` columns [recommend include now, nullable].

---

## 4. Architecture Overview (Target Tree)

```
slykboard/                                                  # repo root
├── backend/
│   └── src/
│       ├── db/
│       │   ├── schema.ts                                   # MODIFY (T1) — add timeEntries table (after activityLogs :204-223) + time_entries_one_active partial unique index (raw sql IS NULL)
│       │   └── migrations/
│       │       └── 0010_create_time_entries.sql            # NEW (T1) — CREATE TABLE + partial unique index; no enum, no $1 risk
│       ├── services/
│       │   ├── timerService.ts                             # NEW (T2) — startTimer/stopTimer/getActiveTimer/stopTimerForTicket(tx,…)
│       │   ├── timerService.test.ts                        # NEW (T3) — single-active, auto-stop, stop, get-active, delete-hook
│       │   └── ticketService.ts                            # MODIFY (T7) — deleteTicket auto-stops open timer in-txn before soft-delete
│       ├── routes/
│       │   ├── tickets.routes.ts                           # MODIFY (T2) — nest POST /:ticketId/timer/start + POST /:ticketId/timer/stop
│       │   ├── timer.routes.ts                             # NEW (T2) — GET /active (current user's global open timer)
│       │   └── time.routes.ts                              # NEW (T2) — GET / → { now: ISO }
│       └── index.ts                                        # MODIFY (T2) — mount /api/timer + /api/time
└── frontend/
    └── src/
        ├── types/
        │   └── timer.ts                                    # NEW (T4) — TimeEntry, ActiveTimer, ServerTime
        ├── api/
        │   └── timer.ts                                    # NEW (T4) — startTimer/stopTimer/fetchActiveTimer/fetchServerTime
        ├── hooks/
        │   ├── useTimer.ts                                 # NEW (T4) — start/stop mutations + active-timer query
        │   ├── useServerTime.ts                            # NEW (T4) — offset (TanStack Query, staleTime 5min)
        │   └── useElapsed.ts                               # NEW (T5) — 1s setInterval tick from server-corrected now
        ├── utils/
        │   ├── timeFormat.ts                               # NEW (T5) — formatDuration(ms) → "1h 30m"
        │   └── timeFormat.test.ts                          # NEW (T6)
        ├── components/
        │   ├── TimerControls.tsx                           # NEW (T5) — Start/Stop + live elapsed
        │   ├── TimerControls.test.tsx                      # NEW (T6)
        │   ├── ActiveTimerPrompt.tsx                       # NEW (T5) — login Resume/Stop/Discard
        │   └── TicketDetailModal.tsx                       # MODIFY (T7) — render <TimerControls ticketId={…}/> after :125
        └── App.tsx                                         # MODIFY (T7) — render <ActiveTimerPrompt/> after auth
```

**Timer lifecycle (post-F20):**

1. **Start** — `POST /api/tickets/:ticketId/timer/start`. `timerService.startTimer({ userId: req.user!.id, ticketId })` opens ONE `db.transaction`: (a) `UPDATE TimeEntries SET end_time = NOW() WHERE user_id = $1 AND end_time IS NULL` (auto-stop prior), (b) `INSERT INTO TimeEntries (user_id, ticket_id, start_time) VALUES ($1, $2, NOW()) RETURNING *`. A concurrent double-start is caught by `time_entries_one_active` at commit → `CONFLICT 409`. Returns the new `TimeEntry` with `start_time`.
2. **Tick (client)** — `useServerTime` fetches `GET /api/time` → `offset = serverNow - Date.now()` (refreshed every 5 min). `useElapsed(startTime)` runs a 1s `setInterval`: `elapsed = (Date.now() + offset) - startTime`, clamped at 24h for display.
3. **Stop** — `POST /api/tickets/:ticketId/timer/stop`. `timerService.stopTimer({ userId, ticketId })` → `UPDATE TimeEntries SET end_time = NOW() WHERE user_id = $1 AND ticket_id = $2 AND end_time IS NULL RETURNING *`. Returns the closed `TimeEntry` (or `404` if no open timer on that ticket).
4. **Reopen** — `GET /api/timer/active` returns the user's open timer (if any). On modal load, `useTimer`'s active query populates `TimerControls` with the running `start_time` — elapsed resumes correctly (REQ-4.3).
5. **Abandoned** — `ActiveTimerPrompt` (mounted app-wide) reads `/api/timer/active`; if open, offers Resume / Stop / Discard. Stop and Discard both write `end_time` (Discard additionally nulls/flags the row — MVP: just stop).
6. **Delete ticket** — `deleteTicket` calls `stopTimerForTicket(tx, ticketId)` inside its txn before soft-delete, closing any open timer on that ticket.

---

## 5. Parallelization Strategy

Tasks are grouped into **4 batches** by dependency order. The schema+migration (T1) is the spine; the backend timer service+routes (T2) builds on the schema and is the next barrier; then the frontend splits into a parallel pair (T4 types/api/hooks ‖ T5 could start once contracts are fixed, but T5 components depend on T4's hooks → serialize T4→T5 in practice); tests (T3 BE ‖ T6 FE) can parallelize across the stack; then wiring + deleteTicket interaction (T7); then verification (T8).

### Batch dependency diagram

```
 ┌─ Batch 1 (schema spine) ──────────────────────────────────────────────┐
 │  T1  timeEntries table + time_entries_one_active partial unique index  │
 │      + migration 0010 (generate + psql pipe)                           │
 │      [backend/src/db/schema.ts,                                        │
 │       backend/src/db/migrations/0010_create_time_entries.sql]          │
 └────────────────────────┬───────────────────────────────────────────────┘
                          │ (TimeEntries table + partial unique index exist)
                          ▼
 ┌─ Batch 2 (backend timer domain) ───────────────────────────────────────┐
 │  T2  timerService (start/stop/getActive/stopForTicket) + nested timer  │
 │      routes (start/stop) + GET /api/timer/active + GET /api/time +     │
 │      index.ts mounting                                                │
 │      [backend/src/services/timerService.ts,                           │
 │       backend/src/routes/timer.routes.ts,                             │
 │       backend/src/routes/time.routes.ts,                              │
 │       backend/src/routes/tickets.routes.ts,                           │
 │       backend/src/index.ts]                                           │
 └────────────────────────┬───────────────────────────────────────────────┘
                          │ (timer API + contracts fixed)
                          ▼
 ┌─ Batch 3 (FE foundation ‖ BE tests) ───────────────────────────────────┐
 │  T4  FE types + api + hooks (useTimer, useServerTime)                  │
 │      [frontend/src/types/timer.ts, frontend/src/api/timer.ts,          │
 │       frontend/src/hooks/useTimer.ts, frontend/src/hooks/useServerTime]│
 │  ── parallel ──                                                        │
 │  T3  BE tests (timerService: single-active, auto-stop, stop, active,   │
 │      delete-hook via mocked db.transaction)                            │
 │      [backend/src/services/timerService.test.ts]                       │
 └────────────────────────┬───────────────────────────────────────────────┘
                          │ (FE hooks + elapsed util ready; BE green)
                          ▼
 ┌─ Batch 4 (FE components ‖ FE tests) ───────────────────────────────────┐
 │  T5  TimerControls + useElapsed + formatDuration + ActiveTimerPrompt   │
 │      [frontend/src/components/TimerControls.tsx,                       │
 │       frontend/src/components/ActiveTimerPrompt.tsx,                   │
 │       frontend/src/hooks/useElapsed.ts,                                │
 │       frontend/src/utils/timeFormat.ts]                                │
 │  ── then ──                                                            │
 │  T6  FE tests (TimerControls + formatDuration table-driven)            │
 │      [frontend/src/components/TimerControls.test.tsx,                  │
 │       frontend/src/utils/timeFormat.test.ts]                           │
 └────────────────────────┬───────────────────────────────────────────────┘
                          │ (components built + tested)
                          ▼
 ┌─ Batch 5 (wiring + deleteTicket interaction) ──────────────────────────┐
 │  T7  wire TimerControls into TicketDetailModal + ActiveTimerPrompt     │
 │      into App + deleteTicket auto-stop hook                            │
 │      [frontend/src/components/TicketDetailModal.tsx,                   │
 │       frontend/src/App.tsx,                                            │
 │       backend/src/services/ticketService.ts]                           │
 └────────────────────────┬───────────────────────────────────────────────┘
                          │ (feature fully integrated)
                          ▼
 ┌─ Batch 6 (verification) ───────────────────────────────────────────────┐
 │  T8  integration verification — typecheck/lint/format/test/build +     │
 │      migration applied; live smoke (start → stop → reopen → elapsed;   │
 │      single-active; delete auto-stop)                                  │
 │      [(verification record only)]                                      │
 └────────────────────────────────────────────────────────────────────────┘
```

- **B1 → B2 hard barrier:** `timerService` imports `timeEntries` + the partial unique index contract from `schema.ts` (T1). No schema → no service.
- **B2 → B3 hard barrier:** FE types/api/hooks (T4) encode the route contracts (`POST /timer/start`, `/timer/stop`, `GET /timer/active`, `GET /time`) fixed in T2. BE tests (T3) exercise `timerService` from T2. T3 and T4 are independent and can run in parallel.
- **B3 → B4 hard barrier:** `TimerControls` (T5) consumes `useTimer` + `useServerTime` (T4) and `useElapsed` (T5 itself). FE tests (T6) need the components (T5).
- **B4 → B5 hard barrier:** wiring (T7) places the built components into the modal/app and adds the `deleteTicket` hook.
- **B5 → B6 hard barrier:** verification (T8) runs against the fully integrated feature.

### Merge order rules

1. **B1 (T1) merges first.** Schema + migration + partial unique index are the foundation.
2. **B2 (T2) merges second.** Backend timer service + all routes + mounting.
3. **B3 (T3 ‖ T4) merges third.** BE tests (T3) and FE foundation (T4) are disjoint — either order.
4. **B4 (T5 → T6) merges fourth.** Components then their tests.
5. **B5 (T7) merges fifth.** Modal/app wiring + `deleteTicket` interaction.
6. **B6 (T8) merges last.** Verification record.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | 1 | `backend/src/db/schema.ts`, `backend/src/db/migrations/0010_create_time_entries.sql` | F16/F17/F08 (DONE) | — |
| **T2** | 2 | `backend/src/services/timerService.ts`, `backend/src/routes/timer.routes.ts`, `backend/src/routes/time.routes.ts`, `backend/src/routes/tickets.routes.ts`, `backend/src/index.ts` | T1 | — |
| **T3** | 3 | `backend/src/services/timerService.test.ts` | T2 | T4 |
| **T4** | 3 | `frontend/src/types/timer.ts`, `frontend/src/api/timer.ts`, `frontend/src/hooks/useTimer.ts`, `frontend/src/hooks/useServerTime.ts` | T2 | T3 |
| **T5** | 4 | `frontend/src/components/TimerControls.tsx`, `frontend/src/components/ActiveTimerPrompt.tsx`, `frontend/src/hooks/useElapsed.ts`, `frontend/src/utils/timeFormat.ts` | T4 | — |
| **T6** | 4 | `frontend/src/components/TimerControls.test.tsx`, `frontend/src/utils/timeFormat.test.ts` | T5 | — |
| **T7** | 5 | `frontend/src/components/TicketDetailModal.tsx`, `frontend/src/App.tsx`, `backend/src/services/ticketService.ts` | T5, T6 | — |
| **T8** | 6 | (verification record only) | T7 | — |

### Developer assignment tracks

- **Solo (recommended):** T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8. ~2-2.5 days.
- **2 devs:** Dev-A (BE): T1 → T2 → T3 → T7-BE (`deleteTicket` hook). Dev-B (FE): waits for T2 contracts, then T4 → T5 → T6 → T7-FE (modal/app wiring). Converge on T8.
- **3 devs:** Dev-A (BE schema+service): T1 → T2. Dev-B (BE tests): waits for T2, then T3. Dev-C (FE): waits for T2 contracts, then T4 → T5 → T6 → T7. Converge on T8.

---

## 6. Tasks

> **Code-snippet note:** snippets below illustrate the shape and seams. The implementer MUST read the actual current code (`schema.ts`, `ticketService.ts`, `tickets.routes.ts`, `index.ts`, `TicketDetailModal.tsx`) before editing — verify exact signatures (e.g. `type Tx` at `ticketService.ts:14`; `req.user!.id`; the `success(...)` / `AppError(ErrorCode.CONFLICT, …)` helpers in `envelope.ts`; the nested-route precedent at `tickets.routes.ts:31-40`; the modal's header/form boundaries at `:108-147`) and adapt.

### T1 — Schema: `timeEntries` table + `time_entries_one_active` partial unique index + migration 0010

**Batch:** 1 · **Depends on:** F16/F17/F08 (DONE) · **Parallel with:** —

**Description:** The schema spine. Append a new `pgTable` to `backend/src/db/schema.ts` after `activityLogs` (`:204-223`). Add the single-active partial unique index using a raw `sql` template (`IS NULL` — no value, no `$1` bug). Generate migration `0010_create_time_entries.sql` and apply to the dev DB via `psql` pipe (memory `dev-db-push-based-no-migration-journal` — do NOT use `db:migrate`).

Modify `backend/src/db/schema.ts` — append after `activityLogs` (`:204-223`); ensure `sql` is imported from `drizzle-orm`:

```typescript
// F20 — Server-authoritative timer (PRD §8.4, REQ-4.1/4.2/4.3)
export const timeEntries = pgTable(
    'TimeEntries',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        ticketId: uuid('ticket_id')
            .notNull()
            .references(() => tickets.id, { onDelete: 'cascade' }),
        userId: uuid('user_id')
            .notNull()
            .references(() => users.id, { onDelete: 'set null' }),
        startTime: timestamp('start_time', { withTimezone: true, mode: 'date' }).notNull(),
        endTime: timestamp('end_time', { withTimezone: true, mode: 'date' }),
        manualEntryMinutes: integer('manual_entry_minutes'), // F21 — nullable now
        description: text('description'), // F21 — nullable now
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .notNull(),
    },
    (table) => ({
        // Single-active: at most ONE open timer per user globally (D2).
        // MUST use raw sql`... IS NULL` — NOT eq(); drizzle bug #4790 emits $1 for eq() in partial
        // indexes. IS NULL has no value → safe. (memory drizzle-partial-index-enum-dollar1)
        oneActive: uniqueIndex('time_entries_one_active')
            .on(table.userId)
            .where(sql`${table.endTime} IS NULL`),
    }),
);
```

Notes:
- PascalCase table name (`'TimeEntries'`), camelCase keys — matches the idiom (`tickets`, `activityLogs`).
- `start_time`/`end_time`/`created_at` all `{ withTimezone: true, mode: 'date' }` → timestamptz, UTC (rules).
- `manual_entry_minutes` + `description` included now (nullable) so F21 needs no migration (D1, sign-off §9f).
- NO `updatedAt` — a timer row is write-once for `start_time` and appended-to for `end_time`.
- The partial unique index is the single source of truth for the one-active invariant (D2).

Generate the migration:

```bash
npm --prefix backend run db:generate   # drizzle-kit generate → 0010_<tag>.sql
```

The generated `0010_*.sql` should contain (no enum → no `$1` bug to reconcile):

```sql
CREATE TABLE "TimeEntries" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "ticket_id" uuid NOT NULL REFERENCES "Tickets"("id") ON DELETE CASCADE,
    "user_id" uuid NOT NULL REFERENCES "Users"("id") ON DELETE SET NULL,
    "start_time" timestamptz NOT NULL,
    "end_time" timestamptz,
    "manual_entry_minutes" integer,
    "description" text,
    "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "time_entries_one_active" ON "TimeEntries" ("user_id") WHERE end_time IS NULL;
```

Apply to the dev DB (push-based, NOT `db:migrate`):

```bash
docker exec -i slykboard-db psql -U slyk -d slykboard -v ON_ERROR_STOP=1 \
    < backend/src/db/migrations/0010_*.sql
```

**Acceptance Criteria:**
- [ ] `schema.ts` exports `timeEntries` per PRD §8.4 (+ `created_at`, `manual_entry_minutes`, `description`).
- [ ] Columns: `id` (UUID PK defaultRandom), `ticket_id` (FK cascade notNull), `user_id` (FK set null notNull), `start_time` (timestamptz notNull), `end_time` (timestamptz nullable), `manual_entry_minutes` (integer nullable), `description` (text nullable), `created_at` (timestamptz defaultNow notNull).
- [ ] NO `updatedAt` column.
- [ ] Partial unique index `time_entries_one_active` on `user_id WHERE end_time IS NULL`, built via raw `sql` template (NOT `eq()`).
- [ ] `0010_*.sql` exists with the literal `CREATE UNIQUE INDEX ... WHERE end_time IS NULL` (no `$1`).
- [ ] Migration applies cleanly to dev DB via `psql` pipe (`ON_ERROR_STOP=1`).
- [ ] `\d "TimeEntries"` in psql confirms the table + the partial unique index.
- [ ] Inserting two rows for the same `user_id` with `end_time IS NULL` raises `23505` (verify in psql).
- [ ] `rtk tsc` (BE) passes.
- [ ] No `any`; PascalCase table / camelCase keys.

**Dependencies:** F16/F17/F08 (DONE). Decisions D1 (table per §8.4), D2 (single-active partial unique index), D10 (migration 0010, no enum).

---

### T2 — Backend: `timerService` + nested timer routes + `GET /api/timer/active` + `GET /api/time`

**Batch:** 2 · **Depends on:** T1 · **Parallel with:** —

**Description:** The full backend timer domain. Create `timerService.ts` with four functions: `startTimer` (auto-stop prior + insert new in ONE transaction), `stopTimer` (close the user's open timer for a ticket), `getActiveTimer` (the user's global open timer, if any), and `stopTimerForTicket(tx, ticketId)` (the F17 `deleteTicket` hook). Add the nested routes `POST /:ticketId/timer/start` + `POST /:ticketId/timer/stop` to `ticketsRouter`; add a top-level `timer.routes.ts` with `GET /active`; add `time.routes.ts` with `GET /`; mount both in `index.ts`.

Create `backend/src/services/timerService.ts`:

```typescript
import { eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { timeEntries } from '../db/schema';
import { tickets } from '../db/schema';
import type { Tx } from './ticketService'; // canonical Tx alias (ticketService.ts:14)
import { AppError, ErrorCode } from '../utils/envelope';

export type TimeEntry = typeof timeEntries.$inferSelect;
export type NewTimeEntry = typeof timeEntries.$inferInsert;

/**
 * Start a timer. Auto-stops the user's previous open timer (D3), then inserts
 * a new row — inside ONE db.transaction. The partial unique index
 * time_entries_one_active makes a concurrent double-start fail at commit (23505).
 */
export async function startTimer(args: { userId: string; ticketId: string }): Promise<TimeEntry> {
    const { userId, ticketId } = args;
    return db.transaction(async (tx) => {
        // (a) Auto-stop any prior open timer for this user (D3, global).
        await tx
            .update(timeEntries)
            .set({ endTime: new Date() })
            .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)));

        // (b) Insert the new open timer. Verify the ticket exists.
        const ticketRows = await tx.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, ticketId)).limit(1);
        if (ticketRows.length === 0) {
            throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${ticketId}' not found`, { details: { ticketId } });
        }

        const [inserted] = await tx
            .insert(timeEntries)
            .values({ userId, ticketId, startTime: new Date() })
            .returning();
        return inserted;
    }).catch((err: unknown) => {
        // Concurrent double-start → unique violation at commit.
        if (isUniqueViolation(err)) {
            throw new AppError(ErrorCode.CONFLICT, 'A timer is already running for this user', { cause: err });
        }
        throw err;
    });
}

/**
 * Stop the user's open timer on a specific ticket. 404 if none open on that ticket.
 */
export async function stopTimer(args: { userId: string; ticketId: string }): Promise<TimeEntry> {
    const { userId, ticketId } = args;
    const [closed] = await db
        .update(timeEntries)
        .set({ endTime: new Date() })
        .where(and(eq(timeEntries.userId, userId), eq(timeEntries.ticketId, ticketId), isNull(timeEntries.endTime)))
        .returning();
    if (!closed) {
        throw new AppError(ErrorCode.NOT_FOUND, 'No running timer on this ticket', { details: { ticketId } });
    }
    return closed;
}

/**
 * The current user's single open timer (global, across all tickets). null if none.
 */
export async function getActiveTimer(userId: string): Promise<TimeEntry | null> {
    const rows = await db
        .select()
        .from(timeEntries)
        .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)))
        .limit(1);
    return rows[0] ?? null;
}

/**
 * F17 hook: close any open timer on a ticket. Called inside deleteTicket's txn.
 */
export async function stopTimerForTicket(tx: Tx, ticketId: string): Promise<void> {
    await tx
        .update(timeEntries)
        .set({ endTime: new Date() })
        .where(and(eq(timeEntries.ticketId, ticketId), isNull(timeEntries.endTime)));
}

// Postgres SQLSTATE 23505 = unique_violation
function isUniqueViolation(err: unknown): boolean {
    return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === '23505';
}
```

Notes:
- Auto-stop is **user-scoped** (global), stop is **user+ticket-scoped**, `stopTimerForTicket` is **ticket-scoped** (for deletes).
- The transaction wraps auto-stop + insert so a partial failure leaves no dangling open timer.
- `23505` is caught and re-thrown as `CONFLICT` (D2). Verify `ErrorCode.CONFLICT` exists in `envelope.ts`; if not, add it.
- `getActiveTimer` relies on the partial unique index guaranteeing ≤1 row.

Modify `backend/src/routes/tickets.routes.ts` — nest the timer sub-routes (precedent `GET /:ticketId/activity` at `:31-40`). After the existing nested routes:

```typescript
import { timerService } from '../services/timerService';
import { z } from 'zod';

// POST /api/tickets/:ticketId/timer/start
ticketsRouter.post('/:ticketId/timer/start', authenticate, async (req, res, next) => {
    try {
        const entry = await timerService.startTimer({ userId: req.user!.id, ticketId: req.params.ticketId });
        res.status(201).json(success(entry));
    } catch (err) {
        next(err);
    }
});

// POST /api/tickets/:ticketId/timer/stop
ticketsRouter.post('/:ticketId/timer/stop', authenticate, async (req, res, next) => {
    try {
        const entry = await timerService.stopTimer({ userId: req.user!.id, ticketId: req.params.ticketId });
        res.json(success(entry));
    } catch (err) {
        next(err);
    }
});
```

Create `backend/src/routes/timer.routes.ts`:

```typescript
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { success } from '../utils/envelope';
import { timerService } from '../services/timerService';

export const timerRouter = Router();

// GET /api/timer/active — current user's global open timer (null if none)
timerRouter.get('/active', authenticate, async (req, res, next) => {
    try {
        const active = await timerService.getActiveTimer(req.user!.id);
        res.json(success(active));
    } catch (err) {
        next(err);
    }
});
```

Create `backend/src/routes/time.routes.ts`:

```typescript
import { Router } from 'express';
import { success } from '../utils/envelope';

export const timeRouter = Router();

// GET /api/time — server clock for client clock-skew correction (D4)
timeRouter.get('/', (_req, res) => {
    res.json(success({ now: new Date().toISOString() }));
});
```

Modify `backend/src/index.ts` (`:53-57` mounting area) — register the new routers:

```typescript
import { timerRouter } from './routes/timer.routes';
import { timeRouter } from './routes/time.routes';

app.use('/api/timer', timerRouter);
app.use('/api/time', timeRouter);
```

Notes:
- `GET /api/time` is unauthenticated (it leaks no PII — just the server clock); acceptable. If the project gates everything behind `authenticate`, add it there too. Match the project's convention.
- `GET /api/timer/active` IS authenticated (returns user-specific data).

**Acceptance Criteria:**
- [ ] `timerService.ts` exports `startTimer`, `stopTimer`, `getActiveTimer`, `stopTimerForTicket`, plus `TimeEntry` / `NewTimeEntry` types.
- [ ] `startTimer` runs auto-stop + insert in ONE `db.transaction`; concurrent double-start → `CONFLICT 409`.
- [ ] `startTimer` 404s on a nonexistent ticket.
- [ ] `stopTimer` closes the user's open timer for the given ticket; 404 if none open.
- [ ] `getActiveTimer` returns the user's single open timer or null.
- [ ] `stopTimerForTicket(tx, ticketId)` closes any open timer on a ticket (takes `Tx`).
- [ ] `POST /api/tickets/:ticketId/timer/start` → 201 + the new `TimeEntry`.
- [ ] `POST /api/tickets/:ticketId/timer/stop` → 200 + the closed `TimeEntry` (or 404).
- [ ] `GET /api/timer/active` → 200 + the open timer or null.
- [ ] `GET /api/time` → 200 + `{ now: ISO }`.
- [ ] All routes use `authenticate`; `success(...)` envelope; errors via `AppError`.
- [ ] No string-concatenated SQL; all queries via drizzle query builder.
- [ ] No `any`; `rtk tsc` passes.

**Dependencies:** T1. Decisions D2 (single-active), D3 (auto-stop), D4 (clock-skew endpoint), D6 (delete hook signature), D8 (HTTP surface).

---

### T3 — Backend tests: single-active, auto-stop, stop, get-active, delete-hook

**Batch:** 3 · **Depends on:** T2 · **Parallel with:** T4

**Description:** Integrated test coverage in a new `timerService.test.ts`. Cover the single-active invariant, auto-stop-on-start, stop, get-active, the 23505→CONFLICT mapping (mock the DB error), and the `stopTimerForTicket` hook. Use table-driven tests where applicable; mock `db.transaction` to assert auto-stop and insert run in the same txn.

Create `backend/src/services/timerService.test.ts`:

- **`startTimer` → auto-stops prior + inserts new (in-txn):** mock `db.transaction` to capture the callback; assert (a) an `UPDATE … WHERE end_time IS NULL` ran on `timeEntries`, (b) an `INSERT` into `timeEntries` ran, both on the `tx` object. Assert the returned row has `endTime` null.
- **`startTimer` → nonexistent ticket:** ticket lookup empty → `AppError(NOT_FOUND)`.
- **`startTimer` → concurrent double-start (23505):** mock the txn to throw `{ code: '23505' }` → assert `AppError(CONFLICT)`.
- **`stopTimer` → closes open timer:** returning yields a row → 200-shape result with `endTime` set.
- **`stopTimer` → no open timer:** returning empty → `AppError(NOT_FOUND)`.
- **`getActiveTimer` → returns the one open row:** select yields one row → returned; select empty → null.
- **`stopTimerForTicket` → closes any open timer on ticket:** assert the `UPDATE … WHERE ticket_id = $1 AND end_time IS NULL` ran on `tx` (used by `deleteTicket` in T7).
- **Single-active DB guarantee (integration, optional):** if a test DB is available, insert two open rows for the same user → assert `23505`. (Skip if no test DB; the schema test in T1 covers this via psql.)

Notes:
- Mirror the F18 testing idiom: mock `db.transaction` to capture the callback and assert `tx.update` / `tx.insert` calls within it.
- `getByRole`/table-driven where a pure function exists; here most logic is async DB calls → mock-based.

**Acceptance Criteria:**
- [ ] `startTimer` test asserts auto-stop UPDATE + insert INSERT run inside the SAME `db.transaction`.
- [ ] `startTimer` test asserts nonexistent ticket → `NOT_FOUND`.
- [ ] `startTimer` test asserts 23505 → `CONFLICT` (mocked error).
- [ ] `stopTimer` test asserts close + 404-when-none-open.
- [ ] `getActiveTimer` test asserts one-row / null.
- [ ] `stopTimerForTicket` test asserts the ticket-scoped UPDATE runs on `tx`.
- [ ] Coverage of `timerService.ts` > 80%.
- [ ] `rtk vitest run` (BE) passes.
- [ ] No `any`; `import type` for shared types.

**Dependencies:** T2.

---

### T4 — Frontend foundation: types + api client + `useTimer` + `useServerTime` hooks

**Batch:** 3 · **Depends on:** T2 · **Parallel with:** T3

**Description:** The FE contracts and server-state layer. Types mirror the BE `TimeEntry` shape; the api client wraps the four endpoints; `useTimer` drives start/stop mutations + the active-timer query (TanStack Query, invalidates on mutation); `useServerTime` provides the clock-skew offset (`staleTime: 5min`).

Create `frontend/src/types/timer.ts`:

```typescript
export interface TimeEntry {
    id: string;
    ticketId: string;
    userId: string;
    startTime: string; // ISO
    endTime: string | null;
    manualEntryMinutes: number | null;
    description: string | null;
    createdAt: string; // ISO
}

export type ActiveTimer = TimeEntry | null;

export interface ServerTime {
    now: string; // ISO
}
```

Create `frontend/src/api/timer.ts`:

```typescript
import type { ActiveTimer, ServerTime, TimeEntry } from '../types/timer';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = localStorage.getItem('token'); // match project's auth-token convention
    const res = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(init?.headers ?? {}),
        },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error ?? `Request failed: ${res.status}`);
    }
    const body = await res.json();
    return body.data ?? body; // unwrap envelope
}

export const startTimer = (ticketId: string) =>
    request<TimeEntry>(`/api/tickets/${ticketId}/timer/start`, { method: 'POST' });

export const stopTimer = (ticketId: string) =>
    request<TimeEntry>(`/api/tickets/${ticketId}/timer/stop`, { method: 'POST' });

export const fetchActiveTimer = () => request<ActiveTimer>('/api/timer/active');

export const fetchServerTime = () => request<ServerTime>('/api/time');
```

Notes:
- Match the project's existing api-client envelope-unwrap + auth-token pattern (verify how other `api/*.ts` files read the token; align).
- `fetchServerTime` is called frequently (5min) — keep it cheap.

Create `frontend/src/hooks/useTimer.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchActiveTimer, startTimer, stopTimer } from '../api/timer';
import type { TimeEntry } from '../types/timer';

const ACTIVE_KEY = ['timer', 'active'] as const;

export function useActiveTimer() {
    return useQuery({
        queryKey: ACTIVE_KEY,
        queryFn: fetchActiveTimer,
        // F10 polling: 30s. Active timer refresh keeps elapsed honest on long-running timers.
        refetchInterval: 30_000,
    });
}

export function useStartTimer() {
    const qc = useQueryClient();
    return useMutation<TimeEntry, Error, string>({
        mutationFn: (ticketId: string) => startTimer(ticketId),
        onSuccess: (entry) => {
            qc.setQueryData(ACTIVE_KEY, entry); // optimistic: this is now the active timer
            qc.invalidateQueries({ queryKey: ACTIVE_KEY });
        },
    });
}

export function useStopTimer() {
    const qc = useQueryClient();
    return useMutation<TimeEntry, Error, string>({
        mutationFn: (ticketId: string) => stopTimer(ticketId),
        onSuccess: () => {
            qc.setQueryData(ACTIVE_KEY, null); // no active timer after stop
            qc.invalidateQueries({ queryKey: ACTIVE_KEY });
        },
    });
}
```

Create `frontend/src/hooks/useServerTime.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { fetchServerTime } from '../api/timer';

const SERVER_TIME_KEY = ['time', 'now'] as const;

/**
 * Clock-skew correction (D4). offset = serverNow - clientNow (ms).
 * Re-synced every 5 min (staleTime). elapsed = (Date.now() + offset) - startTime.
 */
export function useServerTime() {
    const query = useQuery({
        queryKey: SERVER_TIME_KEY,
        queryFn: async () => {
            const t0 = Date.now();
            const { now } = await fetchServerTime();
            const serverMs = new Date(now).getTime();
            return { offset: serverMs - t0, fetchedAt: t0 };
        },
        staleTime: 5 * 60 * 1000, // 5 min
    });
    return query;
}
```

Notes:
- The offset is computed against the client clock at fetch time; `useElapsed` (T5) applies it: `elapsed = (Date.now() + offset) - startTime`.
- `useActiveTimer` refetches every 30s (F10 polling interval) so the active-timer badge stays current.

**Acceptance Criteria:**
- [ ] `types/timer.ts` exports `TimeEntry`, `ActiveTimer`, `ServerTime` matching the BE shape.
- [ ] `api/timer.ts` exports `startTimer`, `stopTimer`, `fetchActiveTimer`, `fetchServerTime`; uses the auth token + envelope unwrap.
- [ ] `useTimer` exports `useActiveTimer` (30s refetch), `useStartTimer`, `useStopTimer`; mutations invalidate/optimistically set the active-timer query.
- [ ] `useServerTime` computes `offset = serverNow - clientNow` with `staleTime: 5min`.
- [ ] No `any`; `import type` for types.
- [ ] `rtk tsc` (FE) passes.

**Dependencies:** T2 (route contracts).

---

### T5 — Frontend components: `TimerControls` + `useElapsed` + `formatDuration` + `ActiveTimerPrompt`

**Batch:** 4 · **Depends on:** T4 · **Parallel with:** —

**Description:** The visible timer. `TimerControls` renders a Start/Stop button + a live elapsed readout, driven by `useActiveTimer` + `useStartTimer`/`useStopTimer` + `useServerTime` + the new `useElapsed`. `formatDuration(ms)` formats as `"1h 30m"` / `"45m"` / `"0m"` with a 24h display cap. `ActiveTimerPrompt` is mounted app-wide and surfaces an abandoned open timer with Resume / Stop / Discard.

Create `frontend/src/utils/timeFormat.ts`:

```typescript
const MS_PER_MIN = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MIN;
const MAX_DISPLAY_MS = 24 * MS_PER_HOUR; // 24h display cap (D5) — UX only, data unaffected

/**
 * Format ms as "1h 30m" / "45m" / "0m". Clamps the DISPLAY at 24h ("24h+").
 * The server-side timer is unaffected — only the readout is capped.
 */
export function formatDuration(ms: number): string {
    if (ms < 0) return '0m';
    const capped = Math.min(ms, MAX_DISPLAY_MS);
    if (capped >= MAX_DISPLAY_MS) return '24h+';
    const hours = Math.floor(capped / MS_PER_HOUR);
    const minutes = Math.floor((capped % MS_PER_HOUR) / MS_PER_MIN);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}
```

Create `frontend/src/hooks/useElapsed.ts`:

```typescript
import { useEffect, useState } from 'react';

const TICK_MS = 1000;

/**
 * Live elapsed (ms) from a start time, corrected for client/server clock skew.
 * `offset` is from useServerTime. Ticks every 1s. Returns null if no startTime.
 */
export function useElapsed(startTime: string | null, offset: number): number | null {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (startTime === null) return;
        const id = setInterval(() => setNow(Date.now()), TICK_MS);
        return () => clearInterval(id);
    }, [startTime]);
    if (startTime === null) return null;
    return now + offset - new Date(startTime).getTime();
}
```

Create `frontend/src/components/TimerControls.tsx`:

```tsx
import { useActiveTimer, useStartTimer, useStopTimer } from '../hooks/useTimer';
import { useServerTime } from '../hooks/useServerTime';
import { useElapsed } from '../hooks/useElapsed';
import { formatDuration } from '../utils/timeFormat';

interface TimerControlsProps {
    ticketId: string;
}

export function TimerControls({ ticketId }: TimerControlsProps) {
    const active = useActiveTimer();
    const startMut = useStartTimer();
    const stopMut = useStopTimer();
    const serverTime = useServerTime();

    const offset = serverTime.data?.offset ?? 0;
    const isOpenOnThisTicket = active.data?.ticketId === ticketId && active.data?.endTime === null;
    const elapsed = useElapsed(isOpenOnThisTicket ? active.data!.startTime : null, offset);

    if (isOpenOnThisTicket) {
        return (
            <div className="flex items-center gap-3">
                <span className="font-mono tabular-nums" aria-label="elapsed time">
                    {formatDuration(elapsed ?? 0)}
                </span>
                <button
                    type="button"
                    onClick={() => stopMut.mutate(ticketId)}
                    disabled={stopMut.isPending}
                    className="rounded bg-red-600 px-3 py-1 text-sm font-semibold text-white hover:bg-red-700"
                >
                    Stop Timer
                </button>
            </div>
        );
    }

    return (
        <button
            type="button"
            onClick={() => startMut.mutate(ticketId)}
            disabled={startMut.isPending}
            className="rounded bg-green-600 px-3 py-1 text-sm font-semibold text-white hover:bg-green-700"
        >
            Start Timer
        </button>
    );
}
```

Notes:
- A timer open on a *different* ticket: `isOpenOnThisTicket` is false → the modal shows "Start Timer" (which will auto-stop the other one — D3). Consider a hint ("Starting will stop your timer on <other ticket>") — optional polish; MVP: the start just works.
- `aria-label` for accessibility (rules: `getByRole`/`getByLabelText` priority).
- Tailwind classes for styling (rules: no inline styles).

Create `frontend/src/components/ActiveTimerPrompt.tsx`:

```tsx
import { useActiveTimer, useStopTimer } from '../hooks/useTimer';
import { useElapsed } from '../hooks/useElapsed';
import { useServerTime } from '../hooks/useServerTime';
import { formatDuration } from '../utils/timeFormat';

/**
 * Abandoned-timer escape hatch (D5). Mounted app-wide. If the user has an open
 * timer (e.g. they closed the browser without stopping), surface Resume / Stop.
 * MVP: "Discard" == Stop (closes the row). Clears the single-active lock so a
 * new timer can start.
 */
export function ActiveTimerPrompt() {
    const active = useActiveTimer();
    const stopMut = useStopTimer();
    const serverTime = useServerTime();
    const offset = serverTime.data?.offset ?? 0;
    const elapsed = useElapsed(active.data?.startTime ?? null, offset);

    if (!active.data) return null;
    const t = active.data;

    return (
        <div role="alertdialog" aria-label="running timer" className="rounded border border-amber-400 bg-amber-50 p-3">
            <p>
                You have a running timer ({formatDuration(elapsed ?? 0)}) on a ticket. Stop it before starting a new one.
            </p>
            <div className="mt-2 flex gap-2">
                <a href={`/ticket/${t.ticketId}`} className="rounded bg-slate-700 px-3 py-1 text-sm text-white">Resume</a>
                <button
                    type="button"
                    onClick={() => stopMut.mutate(t.ticketId)}
                    disabled={stopMut.isPending}
                    className="rounded bg-red-600 px-3 py-1 text-sm text-white"
                >
                    Stop
                </button>
            </div>
        </div>
    );
}
```

Notes:
- "Discard" is folded into "Stop" for MVP (sign-off §9b). Both close the row. A true discard (delete the row) can be a post-MVP refinement.
- Placement (toast vs banner) — T7 wires it into `App.tsx`.

**Acceptance Criteria:**
- [ ] `formatDuration(ms)` returns `"1h 30m"` / `"45m"` / `"0m"`; clamps at `"24h+"`; handles negative → `"0m"`.
- [ ] `useElapsed(startTime, offset)` returns ms (server-corrected), ticks every 1s, null when no startTime, clears interval on unmount/change.
- [ ] `TimerControls` shows Start when no open timer on this ticket; shows Stop + live elapsed when open on this ticket.
- [ ] `TimerControls` elapsed uses `offset` from `useServerTime`.
- [ ] `ActiveTimerPrompt` renders when `useActiveTimer` returns a timer; offers Resume + Stop.
- [ ] All components are functional + typed; props interfaces explicit.
- [ ] No `any`; no inline styles (Tailwind only); `rtk tsc` (FE) passes.

**Dependencies:** T4. Decisions D4 (offset), D5 (prompt), D9 (TimerControls).

---

### T6 — Frontend tests: `TimerControls` + `formatDuration` (table-driven)

**Batch:** 4 · **Depends on:** T5 · **Parallel with:** —

**Description:** Vitest + React Testing Library coverage. `formatDuration` is pure → table-driven (rules). `TimerControls` is rendered with mocked hooks (`vi.mock`) to assert Start vs Stop rendering and click → mutation calls.

Create `frontend/src/utils/timeFormat.test.ts` (table-driven):

```typescript
import { describe, it, expect } from 'vitest';
import { formatDuration } from './timeFormat';

describe('formatDuration', () => {
    const tests = [
        { name: 'zero', input: 0, expected: '0m' },
        { name: 'negative → 0m', input: -1000, expected: '0m' },
        { name: 'minutes only', input: 45 * 60_000, expected: '45m' },
        { name: 'hours + minutes', input: 90 * 60_000, expected: '1h 30m' },
        { name: 'exactly 24h → 24h+', input: 24 * 60 * 60_000, expected: '24h+' },
        { name: 'over 24h → 24h+', input: 25 * 60 * 60_000, expected: '24h+' },
    ];
    tests.forEach(({ name, input, expected }) => {
        it(name, () => expect(formatDuration(input)).toBe(expected));
    });
});
```

Create `frontend/src/components/TimerControls.test.tsx`:

- **No active timer → Start button:** mock `useActiveTimer` → `{ data: null }`; render; assert a "Start Timer" button is present (`getByRole('button', { name: /start timer/i })`).
- **Open timer on this ticket → Stop + elapsed:** mock `useActiveTimer` → `{ data: { ticketId, startTime: ISO, endTime: null, ... } }`; mock `useServerTime` → `{ data: { offset: 0 } }`; render; assert "Stop Timer" button + an elapsed readout (`getByLabelText(/elapsed/i)`).
- **Open timer on a different ticket → Start (auto-stop on click):** mock active timer with a different `ticketId`; assert Start button (clicking calls `startMut.mutate`, which auto-stops the other server-side).
- **Click Start → calls startMut:** `fireEvent.click` the Start button → assert the mocked `startTimer` api was called with the ticketId.
- **Click Stop → calls stopMut:** `fireEvent.click` the Stop button → assert the mocked `stopTimer` api was called.

Notes:
- Mock at the hook level (`vi.mock('../hooks/useTimer', …)`) to keep the test focused on rendering logic.
- Use `getByRole` / `getByLabelText` (rules priority).

**Acceptance Criteria:**
- [ ] `formatDuration` table-driven tests cover zero, negative, minutes, hours+minutes, 24h cap (boundary + over).
- [ ] `TimerControls` tests cover: no-active → Start; open-on-this-ticket → Stop + elapsed; open-on-other-ticket → Start; click Start → start api; click Stop → stop api.
- [ ] Coverage of `TimerControls.tsx` + `timeFormat.ts` > 70% (components) / >80% (util).
- [ ] `rtk vitest run` (FE) passes.
- [ ] No `any`; Testing Library priority followed.

**Dependencies:** T5.

---

### T7 — Wiring: `TimerControls` into `TicketDetailModal` + `ActiveTimerPrompt` into `App` + `deleteTicket` auto-stop hook

**Batch:** 5 · **Depends on:** T5, T6 · **Parallel with:** —

**Description:** The final integration. (1) Render `<TimerControls ticketId={…} />` in `TicketDetailModal` between the header (`:125`) and the form (`:128`). (2) Render `<ActiveTimerPrompt />` in `App.tsx` after auth so abandoned timers surface on login/reload. (3) Modify `deleteTicket` (`ticketService.ts:422-433`) to call `timerService.stopTimerForTicket(tx, ticketId)` inside its transaction before the soft-delete (D6, F17 tie-in).

Modify `frontend/src/components/TicketDetailModal.tsx` — between the header (`:125`) and the form (`:128`):

```tsx
import { TimerControls } from './TimerControls';

// ... inside the modal JSX, after the header block and before the form
<TimerControls ticketId={ticket.id} />
```

Modify `frontend/src/App.tsx` (or the authenticated root) — render the prompt so it appears whenever the user has an open timer:

```tsx
import { ActiveTimerPrompt } from './components/ActiveTimerPrompt';

// inside the authenticated layout
<ActiveTimerPrompt />
```

Modify `backend/src/services/ticketService.ts` — `deleteTicket` (`:422-433`): inside its existing `db.transaction`, call `stopTimerForTicket(tx, ticketId)` before the soft-delete:

```typescript
import { stopTimerForTicket } from './timerService';

// inside deleteTicket's db.transaction(async (tx) => { ... }), BEFORE the soft-delete:
await stopTimerForTicket(tx, ticketId); // F20 — close any open timer on this ticket (D6)
// ... existing soft-delete logic
```

Notes:
- `deleteTicket` already runs in a transaction (verify; F17 established this). The timer stop participates in that txn — atomic.
- The `TimerControls` import path + the modal's existing prop names (`ticket.id` / `ticketId`) must be verified against the actual modal code.
- The prompt's placement (banner vs toast) is a UX choice; a simple top-of-app banner is MVP-appropriate.
- **Cross-feature flag:** T7 modifies `ticketService.ts` (F17-owned file). The change is additive (one `await stopTimerForTicket(tx, …)` line inside the existing txn) and does not alter F17's soft-delete semantics.

**Acceptance Criteria:**
- [ ] `TicketDetailModal` renders `<TimerControls ticketId={…} />` between header and form.
- [ ] `App.tsx` renders `<ActiveTimerPrompt />` within the authenticated layout.
- [ ] `deleteTicket` calls `stopTimerForTicket(tx, ticketId)` inside its transaction before soft-deleting.
- [ ] Deleting a ticket with an open timer closes that timer (no orphaned open timer holds the single-active lock).
- [ ] `rtk tsc` (BE + FE) passes.
- [ ] No `any`; existing modal/app behavior unchanged aside from the additions.

**Dependencies:** T5, T6 (FE), T2 (`stopTimerForTicket`). Decisions D6 (delete auto-stop), D9 (modal placement).

---

### T8 — Integration verification & sign-off

**Batch:** 6 (terminal) · **Depends on:** all prior · **Parallel with:** —

**Description:** The final definition-of-done gate. Run every tool against the as-merged feature, fix gaps, record proof. Do NOT check the box — the owner does.

Steps:
1. **Typecheck:** `rtk tsc` (BE + FE) — zero new errors.
2. **Lint:** `rtk lint` — zero new violations.
3. **Format:** `rtk prettier --check` — zero unformatted files.
4. **Tests:** `rtk vitest run` (BE + FE) — all green. Coverage on `timerService.ts` + `formatDuration`/`TimerControls` > 80%.
5. **Build:** `rtk npm run build` (FE) succeeds; backend boots (`npm run dev:api` / `node`) succeeds.
6. **Migration applied:** confirm `0010_*.sql` ran on dev DB; `\d "TimeEntries"` shows the table + the `time_entries_one_active` partial unique index.
7. **Routes registered:** `GET /api/time`, `GET /api/timer/active`, `POST /api/tickets/:id/timer/start`, `POST /api/tickets/:id/timer/stop` all respond (401 without auth, 2xx with).
8. **Live smoke (manual, via UI + psql):**
   - Open a ticket modal → click "Start Timer" → `SELECT * FROM "TimeEntries" WHERE end_time IS NULL;` → one open row (`user_id`, `ticket_id`, `start_time`, `end_time` null).
   - Reload the page / close the browser / reopen → the modal shows the correct elapsed (server-corrected) and a "Stop Timer" button (REQ-4.3).
   - Click "Stop Timer" → the row's `end_time` is set.
   - Start a timer on ticket A, then start on ticket B → ticket A's row auto-closes (`end_time` set), only ticket B's row remains open (single-active + auto-stop).
   - Attempt a concurrent double-start (two tabs) → one succeeds, the other gets `409 CONFLICT` (DB-enforced).
   - Open a timer, then move the ticket across columns → timer keeps running (D7).
   - Open a timer, then delete the ticket → the timer's `end_time` is set inside the delete txn (D6); no orphaned open timer.
   - Log in fresh with an abandoned open timer → `ActiveTimerPrompt` surfaces Resume/Stop (D5).
9. **Clock-skew check:** with a deliberately skewed client clock, confirm elapsed matches the server-issued `start_time` (offset applied), not the client wall clock.
10. **24h cap:** a very old open timer displays "24h+" (data unaffected).
11. **Verify F21 readiness:** `manual_entry_minutes` + `description` columns exist (nullable) on `TimeEntries`.
12. **Record proof** in the integration record below.

**Acceptance Criteria:**
- [ ] `rtk tsc` BE + FE exit 0.
- [ ] `rtk lint` exit 0, no new violations.
- [ ] `rtk prettier --check` exit 0.
- [ ] `rtk vitest run` BE + FE exit 0; coverage > 80% on timer logic.
- [ ] FE build + BE boot succeed.
- [ ] Migration applied; `\d "TimeEntries"` confirms table + `time_entries_one_active` partial unique index.
- [ ] All four timer routes respond correctly (401 unauth, 2xx auth).
- [ ] Live smoke: start writes `{user_id, ticket_id, start_time}` (end_time null); stop fills end_time; reload preserves elapsed + allows stop (REQ-4.3); single-active holds; auto-stop-on-new-start works; concurrent double-start → 409; cross-column move keeps timer; delete auto-stops; abandoned-timer prompt surfaces.
- [ ] Clock-skew: elapsed follows server time, not client wall clock.
- [ ] 24h display cap shows "24h+".

**Dependencies:** all prior tasks merged.

---

## 7. Final F20 Acceptance Checklist

- [ ] `TimeEntries` table exists per PRD §8.4: `id` (UUID PK), `ticket_id` (UUID FK→Tickets cascade), `user_id` (UUID FK→Users set null), `start_time` (timestamptz), `end_time` (timestamptz nullable), `manual_entry_minutes` (integer nullable), `description` (text nullable), `created_at` (timestamptz defaultNow).
- [ ] Partial unique index `time_entries_one_active` on `user_id WHERE end_time IS NULL` (built via raw `sql` template — no `$1`).
- [ ] `POST /api/tickets/:ticketId/timer/start` writes `{user_id, ticket_id, start_time}` server-side (REQ-4.2); `end_time` null.
- [ ] `POST /api/tickets/:ticketId/timer/stop` fills `end_time` on the user's open timer for that ticket.
- [ ] `GET /api/timer/active` returns the current user's single open timer globally (or null).
- [ ] `GET /api/time` returns `{ now: ISO }` for clock-skew correction.
- [ ] A user has at most ONE open timer globally — DB-enforced (partial unique index); concurrent double-start → `409 CONFLICT`.
- [ ] Starting a new timer AUTO-STOPS the previous open timer inside one transaction.
- [ ] Elapsed displayed client-side = `(now + serverOffset) - start_time`, recomputed from server time on load, ticked every 1s.
- [ ] Closing the browser/PC and reopening shows correct elapsed + allows stop (REQ-4.3).
- [ ] Abandoned timers surface via `ActiveTimerPrompt` (Resume / Stop); 24h display cap.
- [ ] Moving a ticket across columns does NOT stop its timer (D7).
- [ ] Deleting a ticket with a running timer auto-stops it inside `deleteTicket`'s transaction (D6).
- [ ] `TimerControls` renders a Start/Stop button on each ticket (REQ-4.1).
- [ ] Timer events are NOT written to `ActivityLogs` (F18 exclusion; they live in `TimeEntries`).
- [ ] All tests pass (Vitest BE + FE); coverage on timer logic > 80%.
- [ ] Typecheck / lint / format / build all green.
- [ ] NO string-concatenated SQL; all queries via drizzle query builder.
- [ ] `manual_entry_minutes` + `description` columns exist (F21-ready).

**Integration record (fill during T8):**
- Feature commit SHA: `________`
- Migration applied (`0010_*.sql`): `yes / no`
- `\d "TimeEntries"` output (table + partial unique index confirmed): `________`
- Live smoke: start-OK / stop-OK / reload-elapsed-OK (REQ-4.3) / single-active-OK / auto-stop-OK / concurrent-409-OK / move-keeps-timer-OK / delete-auto-stop-OK / abandoned-prompt-OK
- Clock-skew: elapsed-follows-server-OK
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0`

---

## 8. Schema deltas owned by this feature

**F20 owns TWO schema deltas** (the `TimeEntries` table is new; the partial unique index is the deltas-table row at features.md:594):

| Delta | Detail | Migration |
| --- | --- | --- |
| (a) `TimeEntries` table (NEW) | Per PRD §8.4 + project convention: `id` UUID PK defaultRandom; `ticket_id` UUID FK→Tickets ON DELETE CASCADE notNull; `user_id` UUID FK→Users ON DELETE SET NULL notNull; `start_time` timestamptz notNull; `end_time` timestamptz nullable; `manual_entry_minutes` integer nullable (F21); `description` text nullable (F21); `created_at` timestamptz defaultNow notNull. NO `updatedAt`. | `0010_create_time_entries.sql` — `CREATE TABLE "TimeEntries" (...)`. No enum → no `$1` bug. Applied via `psql` pipe (dev DB push-based; memory `dev-db-push-based-no-migration-journal`). |
| (b) `time_entries_one_active` partial unique index | `CREATE UNIQUE INDEX "time_entries_one_active" ON "TimeEntries" ("user_id") WHERE end_time IS NULL` — enforces the single-active-timer invariant at the storage layer (D2). features.md:594 assigns this delta to F20. Built via raw `sql\`${endTime} IS NULL\`` template in the drizzle schema (NOT `eq()` — drizzle bug #4790; memory `drizzle-partial-index-enum-dollar1`). The `IS NULL` template has no value → no `$1` to parameterize → safe. | Included in `0010_create_time_entries.sql`. |

> **Include `manual_entry_minutes` + `description` now — justification:** PRD §8.4 lists them in the `TimeEntries` schema as F21's columns. Adding them now (nullable) means F21 (manual time entry) needs no migration — it only adds the UI/route to populate them. Deferring would force a second migration for a column the PRD already specifies. Owner sign-off §9f.

---

## 9. Cross-cutting decisions — CONFIRMED (owner-approved 2026-06-24)

1. **Auto-stop vs reject on new start when a timer is open.** **Recommendation: AUTO-STOP.** Industry standard (Toggl, Clockify, Harvest all auto-stop the previous timer on a new start). Auto-stop is user-friendly and matches the "one active timer" mental model; reject forces navigation to the old ticket first. Implemented as `UPDATE … SET end_time = NOW() WHERE user_id = $1 AND end_time IS NULL` then `INSERT`, inside one `db.transaction`. **CONFIRMED.**
2. **Abandoned-timer policy.** **CONFIRMED: NO abandoned-timer feature.** A timer runs indefinitely if not stopped — no login prompt, no 24h display cap, no cron reconciliation job. An admin can stop ANY ticket's timer at any time (the stop route allows admin to stop a timer regardless of owner; regular users can only stop their own).
3. **Deleting a ticket with a running timer.** **Recommendation: AUTO-STOP** inside `deleteTicket`'s transaction (`stopTimerForTicket(tx, ticketId)`) before the soft-delete. An orphaned open timer would hold the single-active lock forever. Tie-in to F17. **CONFIRMED.**
4. **Server-time endpoint.** **Recommendation: dedicated `GET /api/time` → `{ now: ISO }`.** Client clock skew is otherwise uncorrectable; the endpoint is trivial and leak-free. The client computes `offset = serverNow - clientNow` and refreshes every 5 min. **CONFIRMED.**
5. **Frontend elapsed tick.** **Confirm: 1s `setInterval` (live readout) + server-time offset (correctness).** `useElapsed(startTime, offset)` recomputes `(Date.now() + offset) - startTime` each tick; `useServerTime` refreshes the offset every 5 min. **CONFIRMED.**
6. **`manual_entry_minutes` + `description` columns — include now (F21-ready) or defer.** **Recommendation: include now, nullable.** PRD §8.4 specifies them; adding them now avoids a second migration when F21 ships. **CONFIRMED.**

---

**Sources:**
- PRD §8.4 (`TimeEntries` schema — authoritative column set).
- PRD REQ-4.1 (Start/Stop button on each task).
- PRD REQ-4.2 (backend logs `start_time` on Start, `end_time` on Stop; frontend purely visual).
- PRD REQ-4.3 (timer continues accurately across browser/PC close).
- PRD User Journey 1 steps 5/7 (Start Timer / Stop Timer).
- `features.md` deltas table (`time_entries_one_active` partial unique index assigned to F20, :594).
- Grounding evidence file:line citations: `backend/src/db/schema.ts:193-223`; `backend/src/services/ticketService.ts:14,422-433`; `backend/src/middleware/auth.ts:41`; `backend/src/routes/tickets.routes.ts:31-40,75,83`; `backend/src/index.ts:53-57`; `backend/src/utils/envelope.ts` (`AppError`, `ErrorCode.CONFLICT`); `frontend/src/components/TicketDetailModal.tsx:108-162`.
- External: PostgreSQL docs §11.8 (partial unique indexes, storage-layer uniqueness); Drizzle docs + GitHub #4790 (raw `sql` template required for partial-index `where`, `eq()` emits `$1`); Toggl / Clockify / Harvest (auto-stop-on-start industry standard); Stack Overflow + r/react (server-time offset for clock-skew correction); Double HQ / memtime (login-prompt-first abandoned-timer UX).
- Project memory: `drizzle-partial-index-enum-dollar1` (use raw `sql\`IS NULL\`` not `eq()`; `IS NULL` is safe — no value to parameterize); `dev-db-push-based-no-migration-journal` (apply via `psql` pipe, not `db:migrate`).
- Project rules: `.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`.