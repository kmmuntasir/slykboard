# F18 — Activity log capture: Plan + Task Breakdown

> **Feature:** F18 — Activity log capture (Phase 2 — Audit)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F12 (DONE ✅) — also hooks F13 (DONE ✅), F11 (DONE ✅), F14 (DONE ✅) · **PRD ref:** REQ-5.2, REQ-5.3, PRD §8.5
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), the project rules discovered for this repo (`.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`), plus dependency feature task docs: [F12](../F12-ticket-creation-sequential-ids/F12-ticket-creation-sequential-ids-tasks.md), [F13](../F13-ticket-attributes-title-description-assignee-priority/F13-ticket-attributes-title-description-assignee-priority-tasks.md), [F11](../F11-drag-drop-order-persistence/F11-drag-drop-order-persistence-tasks.md), [F14](../F14-labels-catalog/F14-labels-catalog-tasks.md)

---

## 1. F18 Recap

**Goal:** Ticket attribute changes are recorded as structured, append-only events inside the same transaction as the mutation — so the audit trail can never diverge from the data.

**Ships:** No new UI or HTTP route. Each write path (`createTicket`, `updateTicket`, `moveTicket`) stamps one or more rows into a new `ActivityLogs` table: creation writes `CREATED`; changing status / priority / assignee / labels writes the corresponding typed row with `old_value`/`new_value` strings; title/description edits write a single generic `CONTENT_UPDATED` row. Every row carries the acting user id + UTC timestamp. Timer events are explicitly out of scope (they live in `TimeEntries`). No-op edits write zero rows.

**Acceptance (definition of done):**
- `ActivityLogs` table per PRD §8.5: `id` (UUID PK), `ticket_id` (UUID FK→Tickets, cascade), `user_id` (UUID FK→Users), `action_type` (enum), `old_value` (String nullable), `new_value` (String nullable), `created_at` (timestampestz, default now).
- `action_type` enum has **6 values**: `CREATED`, `STATUS_CHANGED`, `PRIORITY_CHANGED`, `ASSIGNEE_CHANGED`, `LABELS_CHANGED` (F18-added per features.md deltas), `CONTENT_UPDATED`.
- Status / priority / assignee / label changes each write a typed row with `old_value`/`new_value` (REQ-5.2).
- Title or description edit writes exactly one `CONTENT_UPDATED` row (REQ-5.3); content diffing NOT required.
- Creation writes `CREATED` (actor = creator).
- Every event row is authored with the acting user + UTC timestamp, inside the mutation's own transaction.
- Label changes store a readable added/removed NAMES diff in `new_value` (e.g. `"added: Bug, UI; removed: API"`), not raw ID arrays.
- No-op edits (nothing changed) write zero activity rows.

**Edge cases to resolve up front:**
- **Same-transaction capture so logs never diverge from data** → **Decision:** wrap `updateTicket`'s snapshot + field-update + label-replace + log-insert in ONE `db.transaction` (closes GAP #1 — `updateTicket` today is a bare `db.update(...).returning()` at `ticketService.ts:326-330`). `createTicket` (`:194-220`) and `moveTicket` (`:110-138`) already run in `db.transaction` — write logs inside them. To make the label replace participate in `updateTicket`'s txn (true atomicity + closes GAP #2 — labels hydrate from a separate `db` pool and `replaceTicketLabels` deletes joins before any hook can read them), **refactor `replaceTicketLabels` + `hydrateLabelsForTickets` to accept an optional `tx` argument (default `db`)** so `updateTicket`'s txn owns the label replace too. This eliminates the F15 workaround note at `ticketService.ts:222-226` (label linking outside the create txn).
- **Label readable diff (not raw ID arrays)** → **Decision:** hydrate OLD labels via `hydrateLabelsForTickets([ticketId])` BEFORE `replaceTicketLabels` runs; resolve NEW label names from `patch.labelIds` via the project-scoped `labels` table select (pattern `labelService.ts:115-119`); store a readable string in `new_value` (e.g. `"added: Bug, UI; removed: API"`) with `old_value` null — per §8.5 String columns (no jsonb metadata column).
- **No-op edits must not create spam logs** → **Decision:** per-field `old !== new` check; emit ZERO rows if nothing changed. `CONTENT_UPDATED` only if title OR description changed. If a `PATCH` carries `labelIds` but the resolved set equals the old set, emit zero `LABELS_CHANGED` rows.
- **Timer events** → **Decision:** out of scope. Timer rows live in `TimeEntries` (separate domain, F20). Document; F18 adds no timer action type.
- **Checklist changes** → **Decision:** NOT audited. PRD REQ-5.2 enumerates Status/Priority/Assignee/Label only; there is no `CHECKLIST_CHANGED` enum value and F18 adds none. Document.

---

## 2. Codebase Analysis Summary

- **State:** **Greenfield for the table + helpers; integration seams are PARTIALLY present and have TWO gaps.** F12 (ticket CRUD), F13 (title/description/priority/assignee edit), F11 (board move), F14 (labels) are all DONE ✅ in code. The audit hooks are NOT present — `ActivityLogs` does not exist, `recordActivity` does not exist, `actingUserId` is threaded to `updateTicket` but UNUSED. Two concrete gaps (below) must be closed for same-transaction capture.

- **Existing structure this feature builds on (with path citations):**
  - **`ActivityLogs` table does NOT exist.** Append after `ticketLabels` in `backend/src/db/schema.ts:185`. Idiom (cite `tickets` :108-144, `labels` :148-166, `ticketLabels` :170-185, `priorityEnum` :102, `roleEnum` :22): `pgTable('ActivityLogs', {...})` PascalCase table / camelCase key; `uuid('id').primaryKey().defaultRandom()`; FK `.references(() => tickets.id, { onDelete: 'cascade' })` for `ticketId` + `.references(() => users.id)` for `actorId`; `timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull()` (append-only — no `updatedAt`); index on `ticketId` (the F19 read path). New `pgEnum('ActivityAction', [...])` for `action_type`. **No jsonb metadata column** — PRD §8.5 specifies `old_value`/`new_value` String columns.
  - **`type Tx`** alias at `backend/src/services/ticketService.ts:14`: `type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]` — the canonical tx-threading idiom; `allocateTicketNumber(tx, ...)` at `:145` is the pattern a `recordActivity(tx, ...)` helper mirrors.
  - **`updateTicket`** (`ticketService.ts:295-350`) returns `{ old: TicketRow; new: TicketRow }`; `actingUserId` accepted (`:298`) but UNUSED (comment `:293-294` "F18 will stamp audit metadata"); `TODO(F18)` at `:346-348`. Fields diffed: title, description, priority, assigneeId (`:309-324`); checklist is in the patch but NOT in F18's audited set. **GAP #1: `updateTicket` is a bare `db.update(...).returning()` at `:326-330` — NO transaction.** F18 must wrap snapshot + update + label-replace + log-write in ONE `db.transaction`.
  - **`createTicket`** (`ticketService.ts:177-231`) runs in `db.transaction` (`:194-220`); `creatorId` on the input (`:168`); returns inserted row (`:219`/`:230`). Label linking is OUTSIDE the txn (`:227-229`) — the F15 fix. CREATED log goes inside the txn (actor = `creatorId`).
  - **`moveTicket`** (`ticketService.ts:73-139`) runs in `db.transaction` (`:110-138`); old row loaded at `:79` (old `statusColumn` available); writes `statusColumn` at `:111-114`; returns only the NEW row (no `{old,new}`). **GAP: `MoveTicketInput` (`:54-58`) has NO `actingUserId`** — route calls at `backend/src/routes/tickets.routes.ts:66` and `:79` pass no actor. F18 must add `actingUserId` to `MoveTicketInput` + thread `req.user!.id` at both call sites.
  - **`replaceTicketLabels`** (`backend/src/services/labelService.ts:108-134`) and **`hydrateLabelsForTickets`** (`:85-106`) both use the shared `db` pool, NOT a `tx`. **GAP #2: `TicketRow` carries NO labels** (labels live in the `ticketLabels` join); `replaceTicketLabels` deletes old joins (`:128`) BEFORE any post-call hook can read them. F18 must hydrate OLD labels via `hydrateLabelsForTickets([ticketId])` BEFORE `replaceTicketLabels` runs, resolve NEW label names from `patch.labelIds` via the project-scoped `labels` table select (pattern `:115-119`), and store a readable added/removed-NAMES diff.
  - **`TicketPatch`** (`ticketService.ts:45-52`): `title?, description?, priority?, assigneeId?, labelIds?, checklist?`.
  - **Routes:** `backend/src/routes/tickets.routes.ts` — move endpoint at `:66` and `:79` (both need `req.user!.id` threaded into `MoveTicketInput`); `PATCH /:id` (`updateTicket`) and `POST /` (`createTicket`) already have `req.user` in scope.

- **Migration:** journal-based, next file `backend/src/db/migrations/0008_*.sql`; dev DB is push-bootstrapped → apply via `docker exec -i slykboard-db psql -U slyk -d slykboard -v ON_ERROR_STOP=1 < 0008_*.sql` (NOT `db:migrate`; project memory `dev-db-push-based-no-migration-journal`). Watch the enum-add for drizzle `$1` param SQL (memory `drizzle-partial-index-enum-dollar1`) — `LABELS_CHANGED` must be a literal in the SQL, not `$1`.

- **Files F18 creates:**
  - `backend/src/services/activityLogService.ts` (`recordActivity(tx, …)` insert helper + pure `diffTicketChanges(...)` decision function)
  - `backend/src/services/activityLogService.test.ts` (table-driven, >80% coverage)
  - `backend/src/db/migrations/0008_create_activity_logs.sql`
- **Files F18 modifies:**
  - `backend/src/db/schema.ts` (`activityLogs` table + `activityActionEnum` + `ticketId` index)
  - `backend/src/services/ticketService.ts` (`createTicket` → CREATED in-txn; `updateTicket` → wrap in `db.transaction` + hydrate old labels + diff → logs; `moveTicket` → add `actingUserId` to `MoveTicketInput` + STATUS_CHANGED in-txn)
  - `backend/src/services/labelService.ts` (`replaceTicketLabels` + `hydrateLabelsForTickets` accept optional `tx`)
  - `backend/src/routes/tickets.routes.ts` (thread `req.user!.id` to move call sites)
  - `backend/src/services/ticketService.test.ts` (activity-row assertions, no-op assertions, same-txn assertion, label readable-diff assertion)

- **Project rules this plan must satisfy:** `.claude/rules/git-guidelines.md` (branch `feature/SLYK-F18-activity-log-capture`, single-line commits `SLYK-F18: <msg>`, rebase-merge only, never `--squash`, never `git merge`, sacred rule: never git without explicit approval); `.claude/rules/js-development-rules.md` (route→service→drizzle db; **never string-concat SQL**; transactions for atomicity — log inside the mutation's txn; UTC timestampestz; consistent JSON envelope; no invented error codes); `.claude/rules/js-style-guide.md` (2-space JS, no `any`, SCREAMING constants for `ACTION_TYPES`, import order external→internal→types→relative, functions <50 lines, early returns); `.claude/rules/js-testing-rules.md` (Vitest co-located, table-driven, `>80% business logic`, mock `db.transaction` to assert in-txn log writes); `.claude/rules/persona.md` (Node 24+ / Express 5 / Drizzle / Postgres).

- **Hidden coupling to plan for:**
  - **The `updateTicket` transaction refactor is the load-bearing change.** Today it is a bare `db.update(...).returning()`; wrapping it in `db.transaction` changes the snapshot→update→label-replace→log-insert sequence into one atomic unit. The label replace MUST be inside this txn for true atomicity (GAP #2), which requires the `labelService` `tx` refactor.
  - **`replaceTicketLabels` deletes joins before any post-hook can read them.** Old labels MUST be hydrated BEFORE the replace call. The `tx` refactor makes this safe inside the txn.
  - **`MoveTicketInput` has no actor.** Both route call sites must thread `req.user!.id` or STATUS_CHANGED rows will have a null actor.
  - **`actingUserId` is already on `updateTicket`'s input but UNUSED.** F18 activates it.
  - **drizzle enum-add SQL bug (memory `drizzle-partial-index-enum-dollar1`).** `ALTER TYPE ... ADD VALUE 'LABELS_CHANGED'` must be a literal in the migration SQL, not a `$1` param. Reconcile before applying.
  - **F18 is capture-only.** No GET route, no UI. F19 owns the feed route + UI (REQ-5.1).
  - **Value casing.** Store the raw storage value (UPPERCASE enum / raw id / readable label-name string) in `old_value`/`new_value`. F19 formats for display.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale (cite source) |
|---|----------|--------|-----------|
| D1 | `ActivityLogs` table | **Per PRD §8.5: `id` (UUID PK), `ticket_id` (UUID FK→Tickets cascade), `user_id` (UUID FK→Users), `action_type` (enum), `old_value` (String nullable), `new_value` (String nullable), `created_at` (timestampestz defaultNow).** Add an index on `ticket_id` for the F19 read path. | PRD §8.5 is authoritative for the column set. Append-only → no `updatedAt`. Index on `ticket_id` because F19's feed query is per-ticket. Idiom: `tickets` :108-144, `ticketLabels` :170-185. |
| D2 | `action_type` enum | **`pgEnum('ActivityAction', [...])` with 6 values: `CREATED`, `STATUS_CHANGED`, `PRIORITY_CHANGED`, `ASSIGNEE_CHANGED`, `LABELS_CHANGED`, `CONTENT_UPDATED`.** `LABELS_CHANGED` is the F18-added value (features.md deltas table). The enum is a NEW Postgres enum TYPE (not just a column). | PRD §8.5 lists 5 values; features.md deltas table mandates adding `LABELS_CHANGED` → 6 total. Memory `drizzle-partial-index-enum-dollar1`: the enum-add must be a literal in the SQL, not drizzle's buggy `$1` param. |
| D3 | Audit helper | **`recordActivity(tx, { ticketId, actorId, action, oldValue?, newValue? })` in a new `activityLogService.ts`.** Mirrors the `allocateTicketNumber(tx, ...)` idiom at `ticketService.ts:145` and the `type Tx` alias at `:14`. | The `tx`-threading idiom is canonical in this codebase. Centralizing the insert keeps the column set + naming in one place and makes in-txn assertions easy to mock. |
| D4 | `createTicket` → CREATED | **Write one `CREATED` row inside `createTicket`'s existing `db.transaction`** (`ticketService.ts:194-220`); actor = `creatorId` (`:168`); `old_value`/`new_value` null. | Same-txn atomicity (edge case 1). `creatorId` is already on the input. |
| D5 | `updateTicket` → wrap in `db.transaction` + diff → logs | **Wrap the snapshot + field update + label replace + log inserts in ONE `db.transaction`** (closes GAP #1). Hydrate OLD labels before `replaceTicketLabels` (closes GAP #2). Per-field `old !== new` diff → emit `PRIORITY_CHANGED` / `ASSIGNEE_CHANGED` / `CONTENT_UPDATED` / `LABELS_CHANGED` rows. No-op → zero rows. | Today `updateTicket` is a bare `db.update(...).returning()` (`ticketService.ts:326-330`) — logs would diverge on partial failure. `actingUserId` already on the input (`:298`) but unused (`TODO(F18)` :346-348). Label joins are deleted by `replaceTicketLabels` (`labelService.ts:128`) before any hook can read → must hydrate pre-replace. |
| D6 | `moveTicket` → `actingUserId` + STATUS_CHANGED | **Add `actingUserId` to `MoveTicketInput` (`ticketService.ts:54-58`) and thread `req.user!.id` at both route call sites (`tickets.routes.ts:66`, `:79`).** Write `STATUS_CHANGED` inside `moveTicket`'s existing `db.transaction` (`:110-138`); old status loaded at `:79`. | `moveTicket` already runs in a txn; only the actor is missing. REQ-5.2: status changes must log with old/new. |
| D7 | Refactor labelService fns to accept `tx` | **`replaceTicketLabels(..., tx = db)` and `hydrateLabelsForTickets(ticketIds, tx = db)` accept an optional `tx` argument (default `db`).** `updateTicket` passes its own txn; other callers unchanged. | True atomicity for the label-replace-inside-update-txn. Default `db` makes it backward-compatible (no break to F14 callers). |
| D8 | No-op suppression | **Per-field `old !== new` check; emit ZERO rows if nothing changed.** `CONTENT_UPDATED` only if title OR description changed. Labels: if resolved set equals old set, emit zero. | Edge case 3 (no spam logs). Pure decision, easy to table-test. |
| D9 | Label diff = readable NAMES string | **Hydrate OLD label names before replace; resolve NEW names from `patch.labelIds` via the `labels` table; store `"added: Bug, UI; removed: API"` in `new_value`, `old_value` null.** | Edge case 2 (readable diff, not raw IDs). PRD §8.5 = String columns. |
| D10 | Checklist NOT audited | **No `CHECKLIST_CHANGED` enum value; no row written for checklist-only edits.** | PRD REQ-5.2 enumerates Status/Priority/Assignee/Label only. |
| D11 | Capture-only — no route/UI | **F18 adds NO HTTP route and NO UI. F19 owns the feed route + UI (REQ-5.1).** | REQ-5.1 = F19; F18 = REQ-5.2/5.3 capture. |
| D12 | Value casing in old/new_value | **Store the raw storage value** (UPPERCASE enum like `HIGH`; raw `userId`; readable label-name string for labels). **F19 formats for display.** | F18 stores canonical values; F19 owns presentation. |
| D13 | `CONTENT_UPDATED` granularity | **One `CONTENT_UPDATED` row per edit if title OR description changed** (not one per field). `old_value`/`new_value` null (content diffing NOT required per REQ-5.3). | REQ-5.3: generic "updated" entry; no content diff. One row avoids spam while still signaling a content edit. |

> **Out of F18 scope (explicitly deferred):**
> - **Activity feed / history UI + GET route** → **F19** (REQ-5.1, User Journey 3). F18 is capture-only.
> - **Timer events** → out of scope (live in `TimeEntries`, F20). F18 adds no timer action type.
> - **Checklist audit** → not in REQ-5.2's enumerated set; no enum value added.
> - **Content diffing (title/description field-level diffs)** → REQ-5.3 explicitly does NOT require it; one generic `CONTENT_UPDATED` row suffices.

> **Owner sign-off CONFIRMED 2026-06-24 (see §9):** (a) refactor labelService fns to accept `tx`; (b) `old_value`/`new_value` as §8.5 Strings; (c) checklist NOT audited; (d) F18 = capture-only (F19 owns feed); (e) raw storage value casing; (f) one `CONTENT_UPDATED` row per content edit.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/                                                  # repo root
├── backend/
│   └── src/
│       ├── db/
│       │   ├── schema.ts                                   # MODIFY (T1) — add activityActionEnum + activityLogs table (after ticketLabels :185) + ticketId index
│       │   └── migrations/
│       │       └── 0008_create_activity_logs.sql            # NEW (T1) — CREATE TYPE + CREATE TABLE + CREATE INDEX; literal enum values (not $1)
│       ├── services/
│       │   ├── activityLogService.ts                        # NEW (T2) — recordActivity(tx, …) insert helper + pure diffTicketChanges(old, new, labelDiff) decision fn
│       │   ├── activityLogService.test.ts                   # NEW (T2) — table-driven diff + recordActivity in-txn assertion; >80% coverage
│       │   ├── ticketService.ts                             # MODIFY (T3/T4/T5) — createTicket→CREATED in-txn; updateTicket→wrap db.transaction+hydrate+diff+logs; moveTicket→actingUserId+STATUS_CHANGED
│       │   ├── ticketService.test.ts                        # MODIFY (T6) — activity-row assertions, no-op zero-rows, label readable-diff, same-txn via mocked db.transaction
│       │   └── labelService.ts                              # MODIFY (T5) — replaceTicketLabels + hydrateLabelsForTickets accept optional tx (default db)
│       └── routes/
│           └── tickets.routes.ts                            # MODIFY (T4) — thread req.user!.id to moveTicket call sites (:66, :79)
└── (no frontend changes — F18 is backend capture-only; F19 owns the feed UI)
```

**Update lifecycle (post-F18, `PATCH /api/tickets/:id`):**

1. Route receives the patch; `req.user!.id` is the actor. `updateTicket({ ticketId, patch, actingUserId })` is called.
2. `updateTicket` opens ONE `db.transaction(async (tx) => { ... })`.
3. Inside the txn: load the OLD row (full `TicketRow`).
4. If `patch.labelIds` is present: hydrate OLD label names via `hydrateLabelsForTickets([ticketId], tx)` (BEFORE replace); resolve NEW names from `patch.labelIds` via the `labels` table select (project-scoped); compute the added/removed NAMES diff.
5. Apply the field update (`tx.update(...).returning()`); apply the label replace via `replaceTicketLabels(..., tx)`.
6. Compute the per-field diff: `diffTicketChanges(old, new, labelDiff)` → `[{ action, oldValue?, newValue? }]` (pure function; no-op → empty array).
7. For each diff entry, `recordActivity(tx, { ticketId, actorId: actingUserId, action, oldValue, newValue })` inserts an `ActivityLogs` row — all inside the same txn.
8. Txn commits atomically: data + logs together, or neither.

---

## 5. Parallelization Strategy

Tasks are grouped into **4 batches** by dependency order. The schema+migration+enum (T1) is the spine; `activityLogService` (T2) builds on the schema; then the three integration hooks (T3/T4/T5) — note T4 and T5 touch overlapping files (`ticketService.ts`, `labelService.ts`) and MUST be serialized. T6 (tests) runs against the integrated feature.

### Batch dependency diagram

```
 ┌─ Batch 1 (schema spine) ──────────────────────────────────────────────┐
 │  T1  activityLogs table + activityActionEnum + ticketId index +        │
 │      migration 0008 (generate + psql pipe) + schema test               │
 │      [backend/src/db/schema.ts,                                        │
 │       backend/src/db/migrations/0008_create_activity_logs.sql]         │
 └────────────────────────┬───────────────────────────────────────────────┘
                          │ (ActivityLogs table + Tx alias + enum exist)
                          ▼
 ┌─ Batch 2 (audit helper) ───────────────────────────────────────────────┐
 │  T2  activityLogService.ts — recordActivity(tx, …) insert helper +     │
 │      pure diffTicketChanges(old, new, labelDiff) decision fn + tests   │
 │      [backend/src/services/activityLogService.ts,                      │
 │       backend/src/services/activityLogService.test.ts]                 │
 └────────────────────────┬───────────────────────────────────────────────┘
                          │ (recordActivity + diffTicketChanges available)
                          ▼
 ┌─ Batch 3 (integration hooks — SERIALIZED, overlapping files) ──────────┐
 │  T3  createTicket → CREATED in-txn                                     │
 │      [backend/src/services/ticketService.ts (createTicket only)]       │
 │      ↓ then                                                             │
 │  T4  moveTicket → actingUserId on MoveTicketInput + STATUS_CHANGED     │
 │      in-txn + route threading                                          │
 │      [backend/src/services/ticketService.ts (moveTicket only),         │
 │       backend/src/routes/tickets.routes.ts]                            │
 │      ↓ then                                                             │
 │  T5  updateTicket → wrap db.transaction + labelService tx refactor +   │
 │      hydrate old labels + diff → logs + no-op skip                     │
 │      [backend/src/services/ticketService.ts (updateTicket only),       │
 │       backend/src/services/labelService.ts]                            │
 │  (T3, T4, T5 ALL touch ticketService.ts → serialize within B3)         │
 └────────────────────────┬───────────────────────────────────────────────┘
                          │ (all three hooks emit logs)
                          ▼
 ┌─ Batch 4 (tests + verification) ───────────────────────────────────────┐
 │  T6  backend tests — ticketService create/update/move activity rows;   │
 │      no-op writes zero; label readable-diff; same-txn assertion via    │
 │      mocked db.transaction                                             │
 │      [backend/src/services/ticketService.test.ts]                      │
 │      ↓ then                                                             │
 │  T7  integration verification — typecheck/lint/format/test/build +     │
 │      migration applied; no new route; live smoke (edit → row via psql) │
 │      [(verification record only)]                                      │
 └────────────────────────────────────────────────────────────────────────┘
```

- **B1 → B2 hard barrier:** `activityLogService` imports the `activityLogs` table + `activityActionEnum` from `schema.ts` (T1). No schema → no helper.
- **B2 → B3 hard barrier:** all three hooks call `recordActivity(tx, …)` and `diffTicketChanges(...)` from T2.
- **Within B3: T3 → T4 → T5 SERIALIZED.** All three modify `ticketService.ts` (different functions, but same file → merge conflicts if parallel). T5 additionally modifies `labelService.ts` (the `tx` refactor). T4 also touches `tickets.routes.ts`.
- **B3 → B4 hard barrier:** tests run against the integrated feature.

### Merge order rules

1. **B1 (T1) merges first.** Schema + migration + enum are the foundation.
2. **B2 (T2) merges second.** Helper + pure diff function + its own tests.
3. **B3 (T3 → T4 → T5) merges third, in that order.** Each hook is a separate commit (`SLYK-F18:` single-line). T5 (the load-bearing txn refactor) merges last within B3.
4. **B4 (T6 → T7) merges last.** Integrated tests, then verification record.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | 1 | `backend/src/db/schema.ts`, `backend/src/db/migrations/0008_create_activity_logs.sql` | F12/F13/F11/F14 (DONE) | — |
| **T2** | 2 | `backend/src/services/activityLogService.ts`, `backend/src/services/activityLogService.test.ts` | T1 | — |
| **T3** | 3 | `backend/src/services/ticketService.ts` (createTicket) | T2 | — (serialized in B3) |
| **T4** | 3 | `backend/src/services/ticketService.ts` (moveTicket), `backend/src/routes/tickets.routes.ts` | T2, T3 | — (serialized in B3) |
| **T5** | 3 | `backend/src/services/ticketService.ts` (updateTicket), `backend/src/services/labelService.ts` | T2, T4 | — (serialized in B3) |
| **T6** | 4 | `backend/src/services/ticketService.test.ts` | T3, T4, T5 | — |
| **T7** | 4 | (verification record only) | T6 | — |

### Developer assignment tracks

- **Solo (recommended):** T1 → T2 → T3 → T4 → T5 → T6 → T7. ~1.5-2 days. The `ticketService.ts` edits are serialized because they touch the same file.
- **2 devs:** Dev-A: T1 → T2 → T3. Dev-B: waits for T2, then T4 → T5 (must wait for Dev-A's T3 to land in `ticketService.ts` to avoid conflicts). Converge on T6 → T7. In practice, solo is cleaner given the single-file serialization.

---

## 6. Tasks

> **Code-snippet note:** the snippets below are illustrative of the shape and seams; the implementer MUST read the actual current code (`ticketService.ts`, `labelService.ts`, `tickets.routes.ts`) before editing — verify exact signatures (e.g. `updateTicket({ ticketId, patch, actingUserId })` is an object destructure; `MoveTicketInput` is `{ ticketId, statusColumn, position }`; the error helper is `AppError(ErrorCode.NOT_FOUND, …)`; the db import is `../db/client`) and adapt the snippets to match.

### T1 — Schema: `activityLogs` table + `activityActionEnum` + `ticketId` index + migration 0008

**Batch:** 1 · **Depends on:** F12/F13/F11/F14 (DONE) · **Parallel with:** —

**Description:** The schema spine. Append a new `pgEnum` and a new `pgTable` to `backend/src/db/schema.ts` after `ticketLabels` (`:185`). Generate migration `0008_create_activity_logs.sql`, reconcile the drizzle `$1` enum bug (memory `drizzle-partial-index-enum-dollar1`), and apply to the dev DB via `psql` pipe (memory `dev-db-push-based-no-migration-journal` — do NOT use `db:migrate`).

Modify `backend/src/db/schema.ts` — append after `ticketLabels` (`:185`):

```typescript
// F18 — Activity log capture (PRD §8.5, REQ-5.2/5.3)
export const activityActionEnum = pgEnum('ActivityAction', [
    'CREATED',
    'STATUS_CHANGED',
    'PRIORITY_CHANGED',
    'ASSIGNEE_CHANGED',
    'LABELS_CHANGED', // F18-added per features.md deltas table
    'CONTENT_UPDATED',
]);

export const activityLogs = pgTable(
    'ActivityLogs',
    {
        id: uuid('id').primaryKey().defaultRandom(),
        ticketId: uuid('ticket_id')
            .notNull()
            .references(() => tickets.id, { onDelete: 'cascade' }),
        userId: uuid('user_id').references(() => users.id), // nullable: tolerate a null/system actor
        actionType: activityActionEnum('action_type').notNull(),
        oldValue: text('old_value'),
        newValue: text('new_value'),
        createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
            .defaultNow()
            .notNull(),
    },
    (table) => ({
        ticketIdx: index('activity_logs_ticket_id_idx').on(table.ticketId), // F19 read path
    }),
);
```

Notes:
- **No jsonb metadata column** — PRD §8.5 specifies `old_value`/`new_value` String (`text`) columns.
- `user_id` FK to `users.id`; recommend `ON DELETE SET NULL` to preserve audit history if a user is deleted (verify drizzle default; set explicitly if needed). Confirm onDelete behavior with owner.
- Append-only: NO `updatedAt` column.
- PascalCase table name (`'ActivityLogs'`), camelCase keys — matches the idiom.
- Index on `ticket_id` for F19's `WHERE ticket_id = $1 ORDER BY created_at` feed query.

Generate the migration:

```bash
npm --prefix backend run db:generate   # drizzle-kit generate → 0008_<tag>.sql
```

Then **reconcile `0008_*.sql`** before applying — drizzle may emit `$1` param SQL for the enum value list (memory `drizzle-partial-index-enum-dollar1`). The SQL must contain literal enum values:

```sql
-- 0008_*.sql (reconciled: literal enum values, NOT $1)
CREATE TYPE "ActivityAction" AS ENUM(
    'CREATED',
    'STATUS_CHANGED',
    'PRIORITY_CHANGED',
    'ASSIGNEE_CHANGED',
    'LABELS_CHANGED',
    'CONTENT_UPDATED'
);

CREATE TABLE "ActivityLogs" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "ticket_id" uuid NOT NULL REFERENCES "Tickets"("id") ON DELETE CASCADE,
    "user_id" uuid REFERENCES "Users"("id") ON DELETE SET NULL,
    "action_type" "ActivityAction" NOT NULL,
    "old_value" text,
    "new_value" text,
    "created_at" timestampestz DEFAULT now() NOT NULL
);

CREATE INDEX "activity_logs_ticket_id_idx" ON "ActivityLogs" ("ticket_id");
```

Apply to the dev DB (push-based, NOT `db:migrate`):

```bash
docker exec -i slykboard-db psql -U slyk -d slykboard -v ON_ERROR_STOP=1 \
    < backend/src/db/migrations/0008_*.sql
```

**Acceptance Criteria:**
- [ ] `schema.ts` exports `activityActionEnum` (6 values) and `activityLogs` table per §8.5.
- [ ] `activityLogs` has `id`, `ticket_id` (FK cascade), `user_id` (FK users), `action_type` (enum), `old_value` (text nullable), `new_value` (text nullable), `created_at` (timestampestz defaultNow notNull).
- [ ] NO `updatedAt` column (append-only).
- [ ] NO jsonb metadata column (§8.5 Strings only).
- [ ] Index `activity_logs_ticket_id_idx` on `ticket_id`.
- [ ] `0008_*.sql` exists with LITERAL enum values (no `$1` param).
- [ ] Migration applies cleanly to dev DB via `psql` pipe (`ON_ERROR_STOP=1`).
- [ ] `\d "ActivityLogs"` in psql confirms the table + enum + index.
- [ ] `rtk tsc` (BE) passes.
- [ ] No `any`; PascalCase table / camelCase keys.

**Dependencies:** F12/F13/F11/F14 (DONE). Decisions D1 (table per §8.5), D2 (6-value enum).

---

### T2 — `activityLogService.ts`: `recordActivity(tx, …)` insert helper + pure `diffTicketChanges(...)`

**Batch:** 2 · **Depends on:** T1 · **Parallel with:** —

**Description:** The reusable audit layer. Two exports: (1) `recordActivity(tx, { ticketId, actorId, action, oldValue?, newValue? })` — a thin insert mirroring the `allocateTicketNumber(tx, ...)` idiom (`ticketService.ts:145`) and the `type Tx` alias (`:14`); (2) a PURE `diffTicketChanges(old, next, labelDiff)` decision function returning `ActivityLogEntry[]` (empty if no-op). The pure function is table-testable without a DB.

Create `backend/src/services/activityLogService.ts`:

```typescript
import { activityLogs } from '../db/schema';
import type { Tx } from './ticketService'; // canonical Tx alias (ticketService.ts:14)

export type ActivityAction = (typeof activityActionEnum)[number];

export interface ActivityLogEntry {
    action: ActivityAction;
    oldValue: string | null;
    newValue: string | null;
}

export interface LabelDiff {
    added: string[]; // label NAMES (readable)
    removed: string[]; // label NAMES (readable)
}

interface RecordActivityArgs {
    ticketId: string;
    actorId: string;
    action: ActivityAction;
    oldValue?: string | null;
    newValue?: string | null;
}

/**
 * Insert one ActivityLogs row. MUST be called inside the caller's db.transaction
 * so the log never diverges from the data. Mirrors allocateTicketNumber(tx, ...).
 */
export async function recordActivity(
    tx: Tx,
    { ticketId, actorId, action, oldValue = null, newValue = null }: RecordActivityArgs,
): Promise<void> {
    await tx.insert(activityLogs).values({
        ticketId,
        userId: actorId,
        actionType: action,
        oldValue,
        newValue,
    });
}

/**
 * PURE decision function → the activity entries to write for a ticket update.
 * Empty array => no-op (D8). No DB access → table-testable.
 *
 * - PRIORITY_CHANGED / ASSIGNEE_CHANGED: scalar changed (raw storage value, D12)
 * - CONTENT_UPDATED: title OR description changed (ONE row, D13; old/new null)
 * - LABELS_CHANGED: labelDiff has added or removed names (D9)
 * - Checklist: NOT audited (D10)
 * NOTE: STATUS_CHANGED is emitted by moveTicket (T4), not here.
 */
export function diffTicketChanges(
    old: { title: string; description: string | null; priority: string; assigneeId: string | null },
    next: { title: string; description: string | null; priority: string; assigneeId: string | null },
    labelDiff: LabelDiff | null,
): ActivityLogEntry[] {
    const entries: ActivityLogEntry[] = [];

    if (old.priority !== next.priority) {
        entries.push({ action: 'PRIORITY_CHANGED', oldValue: old.priority, newValue: next.priority });
    }

    if (old.assigneeId !== next.assigneeId) {
        entries.push({
            action: 'ASSIGNEE_CHANGED',
            oldValue: old.assigneeId ?? 'unassigned',
            newValue: next.assigneeId ?? 'unassigned',
        });
    }

    if (old.title !== next.title || old.description !== next.description) {
        entries.push({ action: 'CONTENT_UPDATED', oldValue: null, newValue: null });
    }

    if (labelDiff && (labelDiff.added.length > 0 || labelDiff.removed.length > 0)) {
        entries.push({ action: 'LABELS_CHANGED', oldValue: null, newValue: formatLabelDiff(labelDiff) });
    }

    return entries;
}

/** "added: Bug, UI; removed: API" (D9 readable NAMES string) */
export function formatLabelDiff(diff: LabelDiff): string {
    const parts: string[] = [];
    if (diff.added.length > 0) parts.push(`added: ${diff.added.join(', ')}`);
    if (diff.removed.length > 0) parts.push(`removed: ${diff.removed.join(', ')}`);
    return parts.join('; ');
}
```

Notes:
- `import { activityActionEnum } from '../db/schema'` is also needed for the `ActivityAction` type (add to the schema import alongside `activityLogs`).
- If importing `type Tx` from `./ticketService` risks a circular import, relocate the `type Tx` alias to a shared module. Verify; prefer reuse.
- `assigneeId` null → store `'unassigned'` (readable; F19 can format). Owner sign-off §9e.

Create `backend/src/services/activityLogService.test.ts` (table-driven, `>80%`):

```typescript
import { describe, it, expect } from 'vitest';
import { diffTicketChanges, formatLabelDiff } from './activityLogService';

describe('diffTicketChanges', () => {
    const base = { title: 't', description: 'd', priority: 'HIGH', assigneeId: 'u1' };
    const tests = [
        { name: 'no-op → empty', next: base, labelDiff: null, expected: [] },
        {
            name: 'priority change only',
            next: { ...base, priority: 'LOW' }, labelDiff: null,
            expected: [{ action: 'PRIORITY_CHANGED', oldValue: 'HIGH', newValue: 'LOW' }],
        },
        {
            name: 'assignee change (to unassigned)',
            next: { ...base, assigneeId: null }, labelDiff: null,
            expected: [{ action: 'ASSIGNEE_CHANGED', oldValue: 'u1', newValue: 'unassigned' }],
        },
        {
            name: 'title change → one CONTENT_UPDATED',
            next: { ...base, title: 't2' }, labelDiff: null,
            expected: [{ action: 'CONTENT_UPDATED', oldValue: null, newValue: null }],
        },
        {
            name: 'labels added',
            next: base, labelDiff: { added: ['Bug', 'UI'], removed: [] },
            expected: [{ action: 'LABELS_CHANGED', oldValue: null, newValue: 'added: Bug, UI' }],
        },
        {
            name: 'labels added + removed',
            next: base, labelDiff: { added: ['Bug'], removed: ['API'] },
            expected: [{ action: 'LABELS_CHANGED', oldValue: null, newValue: 'added: Bug; removed: API' }],
        },
        { name: 'labels no-op (empty diff) → no row', next: base, labelDiff: { added: [], removed: [] }, expected: [] },
        {
            name: 'multiple changes → multiple rows',
            next: { title: 't2', description: 'd2', priority: 'LOW', assigneeId: 'u2' },
            labelDiff: { added: ['Bug'], removed: [] },
            expected: [
                { action: 'PRIORITY_CHANGED', oldValue: 'HIGH', newValue: 'LOW' },
                { action: 'ASSIGNEE_CHANGED', oldValue: 'u1', newValue: 'u2' },
                { action: 'CONTENT_UPDATED', oldValue: null, newValue: null },
                { action: 'LABELS_CHANGED', oldValue: null, newValue: 'added: Bug' },
            ],
        },
    ];

    tests.forEach(({ name, next, labelDiff, expected }) => {
        it(name, () => {
            expect(diffTicketChanges(base, next, labelDiff)).toEqual(expected);
        });
    });
});

describe('formatLabelDiff', () => {
    it('added only', () => expect(formatLabelDiff({ added: ['Bug'], removed: [] })).toBe('added: Bug'));
    it('removed only', () => expect(formatLabelDiff({ added: [], removed: ['API'] })).toBe('removed: API'));
    it('both', () =>
        expect(formatLabelDiff({ added: ['Bug', 'UI'], removed: ['API'] })).toBe('added: Bug, UI; removed: API'));
});
```

`recordActivity` is exercised via the `ticketService` tests in T6 (mocked `db.transaction` to assert the insert happened inside the txn).

**Acceptance Criteria:**
- [ ] `activityLogService.ts` exports `recordActivity(tx, …)` (inserts one row, no return).
- [ ] `recordActivity` signature mirrors `allocateTicketNumber(tx, ...)` (takes `Tx`).
- [ ] `diffTicketChanges` is PURE (no DB access) and returns `ActivityLogEntry[]` (empty for no-op).
- [ ] `diffTicketChanges` emits `PRIORITY_CHANGED`, `ASSIGNEE_CHANGED`, `CONTENT_UPDATED`, `LABELS_CHANGED`; never `STATUS_CHANGED` (moveTicket) or `CREATED` (createTicket).
- [ ] `CONTENT_UPDATED` is ONE row if title OR description changed (D13).
- [ ] Checklist changes do NOT produce a row (D10).
- [ ] `formatLabelDiff` produces `"added: …; removed: …"` (D9).
- [ ] Table-driven tests cover all branches + no-op + multi-change; coverage of `activityLogService.ts` > 80%.
- [ ] No `any`; `import type` for `Tx`, `ActivityAction`, `ActivityLogEntry`, `LabelDiff`.
- [ ] `rtk tsc` + `rtk vitest run` (this file) pass.

**Dependencies:** T1 (schema). Decisions D3, D8, D9, D10, D12, D13.

---

### T3 — `createTicket` → write `CREATED` log inside its transaction

**Batch:** 3 · **Depends on:** T2 · **Parallel with:** — (serialized in B3)

**Description:** The simplest hook. `createTicket` (`ticketService.ts:177-231`) already runs in `db.transaction` (`:194-220`) and has `creatorId` on the input (`:168`). Add one `recordActivity(tx, { ticketId: inserted.id, actorId: creatorId, action: 'CREATED' })` call inside the txn, after the insert (`:219`).

```typescript
// inside createTicket's db.transaction(async (tx) => { ... })
const [inserted] = await tx.insert(tickets).values({...}).returning();
// ... existing allocateTicketNumber / position logic (preserve order) ...
await recordActivity(tx, {
    ticketId: inserted.id,
    actorId: input.creatorId,
    action: 'CREATED',
}); // NEW — F18
return inserted;
```

Notes:
- Import `recordActivity` from `./activityLogService`.
- `actorId` = `input.creatorId` (`:168`).
- `old_value`/`new_value` null for `CREATED`.
- The F15 label-linking-outside-txn note (`:222-226`) is NOT touched by T3 — `createTicket`'s label linking stays as-is; the CREATED row is independent of labels.

**Acceptance Criteria:**
- [ ] `createTicket` calls `recordActivity(tx, { ticketId, actorId: input.creatorId, action: 'CREATED' })` INSIDE its `db.transaction`.
- [ ] The CREATED row is written in the same txn as the ticket insert (same-txn assertion in T6).
- [ ] If the txn rolls back, no CREATED row is written.
- [ ] `actorId` = `creatorId` (never null).
- [ ] No `any`; `rtk tsc` passes.
- [ ] Existing `createTicket` tests still pass.

**Dependencies:** T2. Decision D4.

---

### T4 — `moveTicket` → add `actingUserId` to `MoveTicketInput` + `STATUS_CHANGED` in-txn + route threading

**Batch:** 3 · **Depends on:** T2, T3 · **Parallel with:** — (serialized in B3)

**Description:** `moveTicket` (`ticketService.ts:73-139`) already runs in `db.transaction` (`:110-138`) and loads the old row at `:79` (old `statusColumn` available). Two changes: (1) add `actingUserId: string` to `MoveTicketInput` (`:54-58` — currently `{ ticketId, statusColumn, position }`); (2) write a `STATUS_CHANGED` row inside the txn when the status actually changes. Then thread `req.user!.id` at both route call sites.

```typescript
// :54-58 — add actingUserId to the existing { ticketId, statusColumn, position } shape
export interface MoveTicketInput {
    ticketId: string;
    statusColumn: string;
    position: number;
    actingUserId: string; // NEW — F18
}

// inside moveTicket's db.transaction, after the status/position write
const oldStatus = oldRow.statusColumn; // captured from the row loaded at :79
if (oldStatus !== input.statusColumn) {
    await recordActivity(tx, {
        ticketId: input.ticketId,
        actorId: input.actingUserId,
        action: 'STATUS_CHANGED',
        oldValue: oldStatus,
        newValue: input.statusColumn,
    });
}
```

Modify `backend/src/routes/tickets.routes.ts` — both move call sites (`:66` attribute+move path, `:79` move-only path). Each currently calls `moveTicket({ ticketId, statusColumn, position })`:

```typescript
moved = await ticketService.moveTicket({
    ticketId,
    statusColumn: body.statusColumn!,
    position: body.position!,
    actingUserId: req.user!.id, // NEW — F18
});
```

Notes:
- Verify the old row load at `:79` is inside or before the txn; capture `oldStatus` before the write. If `oldRow` is loaded outside the txn, reload it inside for transactional consistency.
- No-op move (same column) → the `oldStatus !== input.statusColumn` guard skips the log. (A same-column reposition is NOT a status change → no row.)
- Both route call sites MUST thread `req.user!.id`.

**Acceptance Criteria:**
- [ ] `MoveTicketInput` includes `actingUserId: string` (alongside `ticketId`, `statusColumn`, `position`).
- [ ] `moveTicket` writes `STATUS_CHANGED` inside its `db.transaction` when `oldStatus !== newStatus`.
- [ ] Same-column reposition writes ZERO rows.
- [ ] `old_value` = old status column, `new_value` = new status column (raw storage values, D12).
- [ ] Both route call sites (`tickets.routes.ts:66`, `:79`) pass `req.user!.id` as `actingUserId`.
- [ ] If the txn rolls back, no STATUS_CHANGED row is written (T6).
- [ ] No `any`; `rtk tsc` passes.
- [ ] Existing `moveTicket` tests updated for the new required input field.

**Dependencies:** T2, T3. Decision D6.

---

### T5 — `updateTicket` → wrap in `db.transaction` + `labelService` `tx` refactor + hydrate old labels + diff → logs + no-op skip

**Batch:** 3 · **Depends on:** T2, T4 · **Parallel with:** — (serialized in B3; load-bearing)

**Description:** The most complex hook; closes both gaps. (1) Refactor `replaceTicketLabels` and `hydrateLabelsForTickets` in `labelService.ts` to accept an optional `tx` argument (default `db`) — backward compatible. (2) Wrap `updateTicket`'s snapshot + field update + label replace + log inserts in ONE `db.transaction` (closes GAP #1). (3) If `patch.labelIds` is present, hydrate OLD label names via `hydrateLabelsForTickets([ticketId], tx)` BEFORE `replaceTicketLabels`, resolve NEW names from `patch.labelIds` via the `labels` table, compute the added/removed NAMES diff (closes GAP #2). (4) Run `diffTicketChanges(old, next, labelDiff)` and write each entry via `recordActivity(tx, …)` — all inside the txn. (5) No-op → zero rows. PRESERVE the existing `{ old, new }` return shape.

Modify `backend/src/services/labelService.ts` — `replaceTicketLabels` (`:108-134`) and `hydrateLabelsForTickets` (`:85-106`):

```typescript
import type { Tx } from './ticketService';

export async function hydrateLabelsForTickets(ticketIds: string[], tx: Tx | typeof db = db) {
    // ... existing body, but use `tx` instead of `db` for the select/join
}

export async function replaceTicketLabels(args: { ticketId: string; labelIds: string[] }, tx: Tx | typeof db = db) {
    // ... existing body, but use `tx` for the delete + insert
}
```

(Adapt to the existing signatures — keep the default `db` so F14 callers are unchanged. Verify the exact current signatures before editing.)

Modify `backend/src/services/ticketService.ts` — `updateTicket` (`:295-350`):

```typescript
export async function updateTicket({
    ticketId,
    patch,
    actingUserId,
}: {
    ticketId: string;
    patch: TicketPatch;
    actingUserId: string;
}): Promise<{ old: TicketRow; new: TicketRow }> {
    return db.transaction(async (tx) => {
        // 1. Load OLD row inside the txn
        const oldRows = await tx.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1);
        const oldRow = oldRows[0];
        if (!oldRow) throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${ticketId}' not found`, { details: { ticketId } });

        // 2. If labelIds in patch, hydrate OLD labels BEFORE replace (GAP #2)
        let labelDiff: LabelDiff | null = null;
        if (patch.labelIds !== undefined) {
            const oldLabelMap = await hydrateLabelsForTickets([ticketId], tx);
            const oldNames = (oldLabelMap.get(ticketId) ?? []).map((l) => l.name);
            const newLabelRows = patch.labelIds.length === 0
                ? []
                : await tx.select({ name: labels.name }).from(labels).where(inArray(labels.id, patch.labelIds));
            const newNames = newLabelRows.map((l) => l.name);
            const oldSet = new Set(oldNames);
            const newSet = new Set(newNames);
            labelDiff = {
                added: newNames.filter((n) => !oldSet.has(n)),
                removed: oldNames.filter((n) => !newSet.has(n)),
            };
        }

        // 3. Apply the field update (existing patch→column-set builder, now on tx)
        const updateSet: Partial<TicketRow> = { updatedAt: new Date() };
        if (patch.title !== undefined) updateSet.title = patch.title;
        if (patch.description !== undefined) updateSet.description = /* existing sanitize null/val logic */;
        if (patch.priority !== undefined) updateSet.priority = patch.priority;
        if (patch.assigneeId !== undefined) updateSet.assigneeId = patch.assigneeId;
        if (patch.checklist !== undefined) updateSet.checklist = patch.checklist;
        const updated = await tx.update(tickets).set(updateSet).where(eq(tickets.id, ticketId)).returning();
        const newRow = updated[0];
        if (!newRow) throw new AppError(ErrorCode.INTERNAL_ERROR, `Update returned no row for ticket '${ticketId}'`);

        // 4. Label replace inside the txn (D7 refactor)
        if (patch.labelIds !== undefined) {
            await replaceTicketLabels({ ticketId, labelIds: patch.labelIds }, tx);
        }

        // 5. Diff + log (pure decision → in-txn inserts); no-op → no rows
        const entries = diffTicketChanges(
            { title: oldRow.title, description: oldRow.description, priority: oldRow.priority, assigneeId: oldRow.assigneeId },
            { title: newRow.title, description: newRow.description, priority: newRow.priority, assigneeId: newRow.assigneeId },
            labelDiff,
        );
        for (const entry of entries) {
            await recordActivity(tx, { ticketId, actorId: actingUserId, action: entry.action, oldValue: entry.oldValue, newValue: entry.newValue });
        }

        return { old: oldRow, new: newRow };
    });
}
```

Notes:
- PRESERVE the `{ old, new }` return shape (F16/F13 consume it). The txn wrapper returns it from the callback.
- `actingUserId` is now USED — remove the `TODO(F18)` at `:346-348`.
- Reuse the existing patch→column-set logic (description sanitization via `sanitizeDescription`); the snippet above is illustrative — port the real logic onto `tx`.
- The route `PATCH /:id` already passes `actingUserId: req.user!.id` (verify; if not, add it).
- Checklist changes are NOT in the diff → no row (D10).

**Acceptance Criteria:**
- [ ] `replaceTicketLabels` and `hydrateLabelsForTickets` accept an optional `tx` arg (default `db`); existing F14 callers unchanged.
- [ ] `updateTicket` wraps snapshot + update + label replace + log inserts in ONE `db.transaction`.
- [ ] OLD labels are hydrated via `hydrateLabelsForTickets([ticketId], tx)` BEFORE `replaceTicketLabels`.
- [ ] Label replace runs via `replaceTicketLabels(..., tx)` (inside the txn).
- [ ] `diffTicketChanges` drives the log entries; each entry → one `recordActivity(tx, …)` insert.
- [ ] No-op edit (nothing changed) → ZERO activity rows.
- [ ] `updateTicket` still returns `{ old, new }` (F16/F13 compatibility).
- [ ] `actingUserId` is now used; `TODO(F18)` removed.
- [ ] If the txn rolls back, no data change AND no log rows (T6 same-txn assertion).
- [ ] No `any`; `rtk tsc` passes.

**Dependencies:** T2 (`recordActivity`, `diffTicketChanges`), T4 (same file, serialized). Decisions D5, D7, D8, D9.

---

### T6 — Backend tests: activity rows, no-op, label readable-diff, same-txn assertion

**Batch:** 4 · **Depends on:** T3, T4, T5 · **Parallel with:** —

**Description:** Integrated test coverage in `backend/src/services/ticketService.test.ts`. Mock `db.transaction` so the test can assert that `recordActivity` was called INSIDE the txn callback (on the `tx` object, not on `db`). Cover: create/update/move each write the expected rows; no-op writes zero; label change produces a readable NAMES diff; same-txn atomicity (rollback → no rows).

Modify `backend/src/services/ticketService.test.ts`:

- **`createTicket` → CREATED in-txn:** after create, assert one `ActivityLogs` row with `action_type='CREATED'`, `user_id=creatorId`; mock rollback → no ticket AND no activity row.
- **`moveTicket` → STATUS_CHANGED in-txn:** cross-column move → one `STATUS_CHANGED` row (old/new status); same-column reposition → ZERO rows; `actingUserId` = passed user; rollback → no row.
- **`updateTicket` → typed rows + no-op + label diff:**
  - priority only → one `PRIORITY_CHANGED` (raw enum old/new).
  - assignee only → one `ASSIGNEE_CHANGED`.
  - title only → one `CONTENT_UPDATED` (old/new null).
  - title + priority → two rows.
  - no-op patch (same values) → ZERO rows.
  - labels (set differs) → one `LABELS_CHANGED` with `new_value` like `"added: Bug; removed: API"` (readable NAMES, not IDs).
  - labels (set identical) → ZERO `LABELS_CHANGED` rows.
  - checklist only → ZERO rows (D10).
  - rollback → no data change AND no activity rows.
- **Same-txn assertion (key correctness):** mock `db.transaction` to capture the callback; assert `recordActivity` (or `tx.insert(activityLogs)`) is invoked on the `tx` mock within the callback's scope — proving the log writes participate in the mutation's transaction.

**Acceptance Criteria:**
- [ ] `createTicket` test asserts the CREATED row + actor + rollback-skips.
- [ ] `moveTicket` test asserts STATUS_CHANGED (cross-column) + zero (same-column) + actor + rollback-skips.
- [ ] `updateTicket` tests cover PRIORITY_CHANGED, ASSIGNEE_CHANGED, CONTENT_UPDATED, LABELS_CHANGED, no-op (zero), label-set-identical (zero), checklist-only (zero), rollback-skips.
- [ ] Label diff assertion checks a READABLE NAMES string, not raw IDs.
- [ ] Same-txn assertion: `recordActivity` is called on the `tx` object inside the `db.transaction` callback.
- [ ] Coverage of `ticketService.ts` activity paths > 80%.
- [ ] `rtk vitest run` (BE) passes.
- [ ] No `any`; `import type` for shared types.

**Dependencies:** T3, T4, T5.

---

### T7 — Integration verification & sign-off

**Batch:** 4 (terminal) · **Depends on:** all prior · **Parallel with:** —

**Description:** The final definition-of-done gate. Run every tool against the as-merged feature, fix gaps, record proof. Do NOT check the box — the owner does. Confirm NO new HTTP route and NO UI (F18 = capture-only; F19 owns the feed).

Steps:
1. **Typecheck:** `rtk tsc` (BE) — zero new errors.
2. **Lint:** `rtk lint` — zero new violations.
3. **Format:** `rtk prettier --check` — zero unformatted files.
4. **Tests:** `rtk vitest run` (BE) — all green. Coverage on `activityLogService.ts` + activity paths > 80%.
5. **Build:** backend boots (`npm run dev:api` / `node`) succeeds.
6. **Migration applied:** confirm `0008_*.sql` ran on dev DB; `\d "ActivityLogs"` shows the table, the `ActivityAction` enum (6 values incl. `LABELS_CHANGED`), and `activity_logs_ticket_id_idx`.
7. **No new route:** `tickets.routes.ts` added NO new HTTP endpoint (only threaded `actingUserId`).
8. **No new UI:** NO frontend files changed (F19 owns the feed UI).
9. **Live smoke (manual, via psql — no UI yet):**
   - Start backend locally.
   - Create a ticket (authenticated) → `SELECT * FROM "ActivityLogs" WHERE ticket_id='<id>';` → one `CREATED` row (creator's `user_id`, UTC `created_at`).
   - PATCH priority → one `PRIORITY_CHANGED` row (raw enum old/new).
   - PATCH title → one `CONTENT_UPDATED` row.
   - PATCH no-op (same values) → ZERO new rows.
   - PATCH labels (add/remove) → one `LABELS_CHANGED` row with readable `"added: …; removed: …"`.
   - Move across columns → one `STATUS_CHANGED` row.
   - Reposition within same column → ZERO new rows.
   - Confirm `created_at` UTC; `user_id` = acting user on every row.
10. **Verify F19 readiness:** `activity_logs_ticket_id_idx` exists; `action_type` enum has all 6 values F19 will render.
11. **Record proof** in the integration record below.

**Acceptance Criteria:**
- [ ] `rtk tsc` BE exit 0.
- [ ] `rtk lint` exit 0, no new violations.
- [ ] `rtk prettier --check` exit 0.
- [ ] `rtk vitest run` BE exit 0; coverage > 80% on `activityLogService.ts` + activity paths.
- [ ] Backend boots cleanly.
- [ ] Migration applied; `\d "ActivityLogs"` confirms table + 6-value enum + ticket_id index.
- [ ] NO new HTTP route (F19 owns the feed route).
- [ ] NO frontend changes (F19 owns the feed UI).
- [ ] Live smoke: create→CREATED; priority→PRIORITY_CHANGED; title→CONTENT_UPDATED; no-op→zero; labels→readable NAMES diff; cross-column move→STATUS_CHANGED; same-column move→zero.
- [ ] Every row has a non-null `user_id` (acting user) and UTC `created_at`.

**Dependencies:** all prior tasks merged.

---

## 7. Final F18 Acceptance Checklist

- [ ] `ActivityLogs` table exists per PRD §8.5: `id` (UUID PK), `ticket_id` (UUID FK→Tickets cascade), `user_id` (UUID FK→Users), `action_type` (enum), `old_value` (text nullable), `new_value` (text nullable), `created_at` (timestampestz defaultNow notNull).
- [ ] `action_type` enum has 6 values: `CREATED`, `STATUS_CHANGED`, `PRIORITY_CHANGED`, `ASSIGNEE_CHANGED`, `LABELS_CHANGED`, `CONTENT_UPDATED` (literal in SQL, not `$1`).
- [ ] Index `activity_logs_ticket_id_idx` on `ticket_id` (F19 read path).
- [ ] `createTicket` writes one `CREATED` row inside its transaction (actor = creator).
- [ ] `updateTicket` is wrapped in `db.transaction`; status/priority/assignee/label changes each write a typed row with `old_value`/`new_value` (REQ-5.2); title/description edits write exactly one `CONTENT_UPDATED` row (REQ-5.3).
- [ ] `moveTicket` writes `STATUS_CHANGED` inside its transaction; same-column reposition writes zero rows.
- [ ] Every event row carries the acting user id + UTC timestamp.
- [ ] All log writes happen INSIDE the mutation's transaction (same-txn atomicity).
- [ ] No-op edits write ZERO rows.
- [ ] Label changes store a readable added/removed NAMES diff in `new_value`, not raw ID arrays.
- [ ] Checklist changes are NOT audited.
- [ ] Timer events are NOT in scope.
- [ ] F18 adds NO new HTTP route and NO UI (capture-only; F19 owns the feed).
- [ ] `replaceTicketLabels` + `hydrateLabelsForTickets` accept an optional `tx` (default `db`); F14 callers unaffected.
- [ ] All tests pass (Vitest BE); coverage on `activityLogService.ts` + activity paths > 80%.
- [ ] Typecheck / lint / format / build all green.
- [ ] NO string-concatenated SQL; all queries via drizzle query builder.

**Integration record (fill during T7):**
- Feature commit SHA: `________`
- Migration applied (`0008_*.sql`): `yes / no`
- `\d "ActivityLogs"` output (table + enum + index confirmed): `________`
- psql smoke: CREATED OK / PRIORITY_CHANGED OK / CONTENT_UPDATED OK / no-op-zero OK / LABELS_CHANGED-readable OK / STATUS_CHANGED OK / same-column-zero OK
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0`

---

## 8. Schema deltas owned by this feature

**F18 owns TWO schema deltas** (both already rows in the `features.md` deltas table):

| Delta | Detail | Migration |
| --- | --- | --- |
| (a) `ActivityLogs` table (NEW) | Per PRD §8.5: `id` UUID PK defaultRandom; `ticket_id` UUID FK→Tickets ON DELETE CASCADE notNull; `user_id` UUID FK→Users ON DELETE SET NULL; `action_type` `ActivityAction` enum notNull; `old_value` text nullable; `new_value` text nullable; `created_at` timestampestz defaultNow notNull. Index `activity_logs_ticket_id_idx` on `ticket_id`. **NO `updatedAt`; NO jsonb metadata column** (§8.5 mandates String `old_value`/`new_value`). | `0008_create_activity_logs.sql` — `CREATE TYPE "ActivityAction" AS ENUM(...)` (6 literal values) + `CREATE TABLE "ActivityLogs" (...)` + `CREATE INDEX`. Applied via `psql` pipe (dev DB is push-based). |
| (b) `action_type` enum `+ LABELS_CHANGED` | A NEW Postgres enum TYPE `ActivityAction` with 6 values (`CREATED`, `STATUS_CHANGED`, `PRIORITY_CHANGED`, `ASSIGNEE_CHANGED`, `LABELS_CHANGED`, `CONTENT_UPDATED`). `LABELS_CHANGED` is the F18-added value mandated by the features.md deltas table. | Included in `0008_create_activity_logs.sql` (the `CREATE TYPE`). **Reconcile drizzle `$1` enum bug** (memory `drizzle-partial-index-enum-dollar1`) — values must be literals in the SQL. |

> **No jsonb metadata column — justification:** PRD §8.5 is authoritative and specifies `old_value`/`new_value` as String columns. A jsonb `metadata` column would deviate from the PRD schema and push parsing complexity onto F19. Storing readable Strings keeps the column set PRD-compliant and F19's read path trivial. Owner sign-off §9b.

---

## 9. Cross-cutting decisions — CONFIRMED (owner-approved 2026-06-24)

1. **Refactor `labelService` fns to accept `tx` (true atomicity).** **Confirmed: refactor.** `replaceTicketLabels` + `hydrateLabelsForTickets` accept an optional `tx` (default `db`) so `updateTicket`'s txn owns the label replace too. This closes GAP #2 and makes the snapshot→update→label-replace→log-write sequence truly atomic. The default `db` keeps F14 callers backward-compatible. The lower-risk alternative mirrors the F15 workaround but reintroduces the divergence risk D5 is meant to eliminate. **Deviate flag:** touches `labelService.ts` (F14-owned file).
2. **`old_value`/`new_value` as §8.5 Strings.** **Confirmed: §8.5 Strings.** PRD §8.5 is authoritative. For labels, store a readable NAMES string in `new_value`, `old_value` null.
3. **Checklist changes are NOT audited.** **Confirmed: do NOT audit.** PRD REQ-5.2 enumerates Status/Priority/Assignee/Label only. No `CHECKLIST_CHANGED` enum value; a checklist-only edit writes zero rows.
4. **F18 = capture-only (no GET route; F19 adds the feed route + UI).** **Confirmed: capture-only.** REQ-5.1 (the feed) = F19. F18 adds NO HTTP surface and NO frontend files; verification is via psql until F19 ships the feed.
5. **Value casing in `old_value`/`new_value` (raw UPPERCASE storage value).** **Confirmed: raw storage value.** Store the raw enum (`HIGH`), raw `userId` (or `'unassigned'`), readable label NAMES. F19 formats for display. Keeps F18 a pure capture layer.
6. **`CONTENT_UPDATED` granularity (one row per content edit).** **Confirmed: one row if title OR description changed.** REQ-5.3 calls for a generic "updated" entry with no content diff. One row per edit avoids spam. `old_value`/`new_value` null.

---

**Sources:**
- PRD §8.5 (`ActivityLogs` schema — authoritative column set).
- PRD REQ-5.2 (Status/Priority/Assignee/Label changes must log with old/new).
- PRD REQ-5.3 (title/description edits → generic `CONTENT_UPDATED`; no content diff).
- `features.md` deltas table (`+ LABELS_CHANGED` enum value mandated).
- Grounding evidence file:line citations: `backend/src/db/schema.ts:22,102,108-144,148-166,170-185`; `backend/src/services/ticketService.ts:14,45-58,73-139,145,168,177-231,222-226,295-350`; `backend/src/services/labelService.ts:85-134`; `backend/src/routes/tickets.routes.ts:66,79`.
- Project memory: `dev-db-push-based-no-migration-journal` (apply via psql pipe, not `db:migrate`); `drizzle-partial-index-enum-dollar1` (reconcile enum-add to literal SQL).
- Project rules: `.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`.
