# Task Breakdown — SLYK-13 (Ticket Comments)

**Source plan:** `docs/deliverables/SLYK-13-plan.md`
**Ticket:** `docs/deliverables/SLYK-13.md`
**Generated:** 2026-06-30

> 15 tasks across 10 dependency batches. Backend-first build order (the frontend
> data contract depends on the API shape). Each task touches a tightly-coupled
> few files to minimize merge-conflict surface.

---

## Locked v1 Decisions (from plan Open Questions + codebase analysis)

These are **resolved** — do not re-litigate during implementation:

1. **No activity row on comment create.** Only `COMMENT_EDITED` / `COMMENT_DELETED` summary entries are written. (If product later wants create-logged, add `COMMENT_CREATED` to the enum + a `describeActivity` case.)
2. **Max comment length: 5000 chars.** Keep the FE `Textarea maxLength={5000}` in sync.
3. **Server-side `body.trim()`** before insert/update — reject empty post-trim.
4. **Soft-deleted ticket POST → `NOT_FOUND 'Ticket not found'`** (anti-oracle consistency).
5. **Naming: `authorId` / `author_id`** (domain clarity) — consistent across schema, service, route, and API contract.
6. **`isProjectAdmin` IS available client-side** via `useCurrentProjectMembership(slug)` (`frontend/src/hooks/useProjectMembers.ts:81`). No new fetch needed — resolves the project-admin delete UI gap.
7. **Backend `CommentDto` shape:** `{ id, ticketId, body, createdAt, updatedAt, edited, author: { id, fullName, avatarUrl } }` — `edited` is derived (`updatedAt > createdAt`); `author` is null-safe (deleted author → all-null author object → FE renders "Unknown user").
8. **2-tier architecture** (`Route → Service`, inline handlers, persistence in `services/`). `backend/src/controllers/` and `backend/src/repositories/` contain only `.gitkeep` — follow the actual convention, NOT the 4-tier AGENTS.md prescription.

---

## Parallelization Strategy

### Batch Dependency Diagram

```
BATCH 1 (no deps — fully parallel)
  T1  schema (comments table + enum)        backend/src/db/schema.ts
  T2  activity unions + enrichment          activityLogService.ts + activityService.ts
  T3  Zod schemas (new)                     routes/comments.schema.ts
  T4  FE activity rendering                 types/activity.ts + describeActivity.ts + test
        │
        ├── T1 ──┬──► T5 (migration)            [BATCH 2]
        │        │
        │        └──► T6 (commentService)       [BATCH 3]  (also needs T2)
        │                │
        │                ▼
        │              T7 (resolveCommentProject) [BATCH 4]
        │                │
        │                ▼
        │     T8 (routes + index wiring)         [BATCH 5]  (also needs T3)
        │                │
        │      ┌─────────┴──────────┐
        │      ▼                    ▼
        │   T15 (BE tests)        T9 (FE api+types+queryKeys)   [BATCH 6]
        │   [parallel track]           │
        │                              ▼
        │                          T10 (FE hooks)              [BATCH 7]
        │                              │
        │                   ┌──────────┴──────────┐
        │                   ▼                     ▼
        │                 T11 (CommentForm)   T12 (CommentItem)  [BATCH 8 — parallel]
        │                   │                     │
        │                   └──────────┬──────────┘
        │                              ▼
        │                         T13 (CommentsSection)         [BATCH 9]
        │                              │
        │                              ▼
        │                         T14 (wire modal)              [BATCH 10]
        │
        └── T2, T3, T4: independent Batch-1 leaves (no further dependents
            beyond T6/T8 and the FE chain respectively)
```

**Critical path (backend):** T1 → T6 → T7 → T8.
**Critical path (frontend):** T8 → T9 → T10 → (T11 ∥ T12) → T13 → T14.
**Decoupled track:** T15 (backend tests) runs in parallel with the entire FE chain once T8 lands.

### Merge-Order Rules

- Batches must merge in numeric order (Batch 1 before Batch 2, etc.).
- Within a batch, tasks are conflict-free (disjoint files) and may merge in any order.
- T15 may merge any time after T8; it does not block or wait on any FE task.
- Rebase-and-merge only (per AGENTS.md) — no squash, no merge commits.

### Summary Table

| # | Batch | Target File(s) | Dependencies | Can Parallel With |
|---|-------|----------------|--------------|-------------------|
| T1 | 1 | `backend/src/db/schema.ts` | None | T2, T3, T4 |
| T2 | 1 | `backend/src/services/activityLogService.ts`, `backend/src/services/activityService.ts` | None | T1, T3, T4 |
| T3 | 1 | `backend/src/routes/comments.schema.ts` (new) | None | T1, T2, T4 |
| T4 | 1 | `frontend/src/types/activity.ts`, `frontend/src/utils/describeActivity.ts`, `frontend/src/utils/describeActivity.test.ts` | None | T1, T2, T3 |
| T5 | 2 | `backend/src/db/migrations/0001_*.sql`, `meta/_journal.json`, `meta/0001_snapshot.json` | T1 | (none — solo in batch) |
| T6 | 3 | `backend/src/services/commentService.ts` (new) | T1, T2 | (none — solo in batch) |
| T7 | 4 | `backend/src/middleware/resolveProject.ts` | T6 | (none — solo in batch) |
| T8 | 5 | `backend/src/routes/tickets.routes.ts`, `backend/src/routes/comments.routes.ts` (new), `backend/src/index.ts` | T3, T6, T7 | (none — solo in batch) |
| T9 | 6 | `frontend/src/api/comments.ts` (new), `frontend/src/types/comment.ts` (new), `frontend/src/api/queryKeys.ts` | T8 | T15 |
| T10 | 7 | `frontend/src/hooks/useTicketComments.ts` (new), `frontend/src/hooks/useCommentMutations.ts` (new) | T9 | T15 |
| T11 | 8 | `frontend/src/components/CommentForm.tsx` (new) + test | T10 | T12, T15 |
| T12 | 8 | `frontend/src/components/CommentItem.tsx` (new) + test | T10 | T11, T15 |
| T13 | 9 | `frontend/src/components/CommentsSection.tsx` (new) + test | T11, T12 | T15 |
| T14 | 10 | `frontend/src/components/TicketDetailModal.tsx` + `TicketDetailModal.test.tsx` | T13 | (final FE step) |
| T15 | — | `backend/src/services/commentService.test.ts`, `backend/src/routes/comments.routes.test.ts` (new) | T8 | T9–T14 (fully decoupled) |

### Developer Assignment Tracks

- **Track A — Backend (critical path):** T1 → T5 → T6 → T7 → T8. Carries the schema → migration → service → resolver → routes chain that unblocks all frontend work.
- **Track B — Frontend (critical path):** waits on T8, then T9 → T10 → T11 → T13 → T14. Owns data contract → hooks → form → orchestration → modal wiring. Should also grab T12 (parallel with T11) if a second FE dev isn't available.
- **Track C — Tests / supporting:** T2, T3, T4 are Batch-1 leaves that any developer can grab in parallel on day one; T15 is the backend test track, decoupled from the entire FE chain, ideal for a backend-focused developer once T8 lands.

---

## Task 1 — Backend schema: `comments` table + extend `activityActionEnum`

**Description**

Modify **only** `backend/src/db/schema.ts`. No service/route/migration here (migration is T5).

1. **Extend `activityActionEnum`** (at `backend/src/db/schema.ts:~243–251`). Append two values so the enum reads exactly:
   ```ts
   export const activityActionEnum = pgEnum('ActivityAction', [
     'CREATED',
     'STATUS_CHANGED',
     'PRIORITY_CHANGED',
     'ASSIGNEE_CHANGED',
     'LABELS_CHANGED',
     'CONTENT_UPDATED',
     'COMMENT_EDITED',   // SLYK-13
     'COMMENT_DELETED',  // SLYK-13
   ]);
   ```
   Mirror existing per-line formatting (one value per line). Keep the comment block above it intact; add a short inline note that edit/delete are summary-only (null old/new_value) so no comment content leaks.

2. **Add the `comments` table** mirroring the `activityLogs` idiom (`schema.ts:~254–272`) for FK/`set null`/`cascade`/index conventions and the `timeEntries` idiom (`schema.ts:~276`) for a nullable actor FK. Place it immediately after `activityLogs`. Exact shape:
   ```ts
   // SLYK-13 — Comments. Editable ticket sub-resource; needs both createdAt and
   // updatedAt (updatedAt doubles as the "edited at" timestamp). authorId nullable +
   // ON DELETE SET NULL preserves the row when an author is deleted (history intact).
   // ticketId ON DELETE CASCADE (owned by ticket). Activity summary-only entries
   // (COMMENT_EDITED / COMMENT_DELETED above) carry null old/new_value.
   export const comments = pgTable(
     'Comments',
     {
       id: uuid('id').primaryKey().defaultRandom(),
       ticketId: uuid('ticket_id')
         .notNull()
         .references(() => tickets.id, { onDelete: 'cascade' }),
       authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
       body: text('body').notNull(),
       createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
       updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
         .defaultNow()
         .$onUpdate(() => new Date())
         .notNull(),
     },
     (table) => ({
       ticketIdx: index('comments_ticket_id_idx').on(table.ticketId),
     }),
   );
   export type CommentRow = typeof comments.$inferSelect;
   ```

   Conventions to honor verbatim (all already imported at the top of `schema.ts`):
   - `uuid('id').primaryKey().defaultRandom()` (precedent: `activityLogs`).
   - snake_case physical column name as 1st arg, camelCase access key as the JS identifier (`authorId: uuid('author_id')`).
   - `timestamp(..., { withTimezone: true, mode: 'date' }).defaultNow().notNull()` for `createdAt`.
   - `updatedAt` = same timestamp + `.defaultNow().$onUpdate(() => new Date()).notNull()` (precedent: `users` table).
   - Index named `<table>_<col>_idx` (precedent: `activity_logs_ticket_id_idx`).
   - Use `authorId`/`author_id` — keep consistent across schema, service, route, and API contract.
   - **Do not** touch the import list — `index`, `uuid`, `text`, `timestamp` are already imported.

3. Do **not** edit any other file. Do **not** run `drizzle-kit generate` here (T5 owns that).

**Acceptance Criteria**

- [ ] `activityActionEnum` in `backend/src/db/schema.ts` contains exactly the 8 values above, in that order, `'COMMENT_EDITED'` and `'COMMENT_DELETED'` last.
- [ ] New `comments` `pgTable` exists with the exact columns, FKs (`ticketId` → `tickets.id` `ON DELETE CASCADE`; `authorId` → `users.id` `ON DELETE SET NULL`, nullable), constraints, `createdAt`/`updatedAt` timestamps, and `comments_ticket_id_idx` index.
- [ ] `export type CommentRow = typeof comments.$inferSelect;` is exported.
- [ ] No imports added/removed/changed in `schema.ts`.
- [ ] No other files modified.
- [ ] `tsc`/build passes (no type errors from the schema edit).

**Dependencies:** None (Batch 1).

---

## Task 2 — Backend activity services: extend unions + enrichment

**Description**

Teach the activity read/write path about the two new enum values. No DB schema change (T1 owns that); no comment service/routes here.

1. **`backend/src/services/activityLogService.ts`** — extend the `ActivityAction` union (`activityLogService.ts:~8–15`) to mirror the DB enum:
   ```ts
   export type ActivityAction =
     | 'CREATED'
     | 'STATUS_CHANGED'
     | 'PRIORITY_CHANGED'
     | 'ASSIGNEE_CHANGED'
     | 'LABELS_CHANGED'
     | 'CONTENT_UPDATED'
     | 'COMMENT_EDITED'
     | 'COMMENT_DELETED';
   ```
   No other change — `recordActivity(tx, { action })` already accepts any `ActivityAction` and defaults `oldValue`/`newValue` to null (`activityLogService.ts:~17–49`), which is exactly the summary-only behavior required.

2. **`backend/src/services/activityService.ts`**:
   - Extend `EnrichedActionType` (`activityService.ts:~11–20`) with `| 'COMMENT_EDITED' | 'COMMENT_DELETED'`.
   - In `enrichActivityRows` (`activityService.ts:~82–118`), add two `case` arms (before the `default`) returning the `base` entry unchanged so `message`/`from`/`to` stay null — **no comment content** surfaces. The FE `describeActivity` (T4) supplies the verb:
     ```ts
     case 'COMMENT_EDITED':
     case 'COMMENT_DELETED':
       return base;
     ```
     (`base` at `activityService.ts:~81–89` already sets `from: null, to: null, message: null`.) Place these two cases right after the `CONTENT_UPDATED` case and before the `CREATED`/`default` fallthrough.

3. Do **not** edit any test in this task (new enrichment test cases may be added in T15 if desired). Do **not** touch `schema.ts`, `commentService.ts`, or any route.

**Acceptance Criteria**

- [ ] `ActivityAction` union in `activityLogService.ts` includes `'COMMENT_EDITED'` and `'COMMENT_DELETED'`.
- [ ] `EnrichedActionType` union in `activityService.ts` includes `'COMMENT_EDITED'` and `'COMMENT_DELETED'`.
- [ ] `enrichActivityRows` has explicit `case 'COMMENT_EDITED':` / `case 'COMMENT_DELETED':` arms returning `base` (so `from`, `to`, `message` are all `null`).
- [ ] TypeScript compiles (the `switch` over `EnrichedActionType` remains exhaustive; no fall-through to `default` for the new cases).
- [ ] No other files modified.

**Dependencies:** None (Batch 1). Conceptually complementary to T1's enum extension but edits disjoint files — zero merge-conflict surface.

---

## Task 3 — Backend Zod schemas: `backend/src/routes/comments.schema.ts` (new)

**Description**

Create a **new file** `backend/src/routes/comments.schema.ts` mirroring the conventions in `backend/src/routes/tickets.schema.ts`. No other file touched. This file owns only comment-scoped schemas — reuse `tickets.schema.ts`'s `ticketIdParam` in the route layer (T8); do **not** redefine it here.

Exact contents:
```ts
import { z } from 'zod';

// SLYK-13 — Comment request validation. Mirrors tickets.schema.ts conventions:
// one param schema per route key + body schemas with inferred types.
// Max body length 5000 is a locked v1 default; keep in sync with the FE Textarea maxLength.

export const commentIdParam = z.object({
  commentId: z.uuid(),
});

export const createCommentBody = z.object({
  body: z.string().min(1, 'Comment cannot be empty').max(5000, 'Comment is too long'),
});

export const updateCommentBody = z.object({
  body: z.string().min(1, 'Comment cannot be empty').max(5000, 'Comment is too long'),
});

export type CommentIdParam = z.infer<typeof commentIdParam>;
export type CreateCommentBody = z.infer<typeof createCommentBody>;
export type UpdateCommentBody = z.infer<typeof updateCommentBody>;
```

Conventions (verified against `tickets.schema.ts`):
- Only import is `{ z }` from `'zod'`.
- Param schema shape mirrors `ticketIdParam = z.object({ ticketId: z.uuid() })` (`tickets.schema.ts:~3–5`).
- Body schemas use `z.string().min(1).max(N)` with inline error messages (precedent: `tickets.schema.ts:~44`); field is non-optional so omit `.optional()`.
- Field name is `body` (the comment text) — matches the API contract; route handler destructures `const { body } = req.body as CreateCommentBody`.
- No `.trim()` in the schema (trim is a service-layer decision — see T6).

**Acceptance Criteria**

- [ ] File `backend/src/routes/comments.schema.ts` exists with exactly the three exported schemas (`commentIdParam`, `createCommentBody`, `updateCommentBody`) and three exported types (`CommentIdParam`, `CreateCommentBody`, `UpdateCommentBody`).
- [ ] `commentIdParam` = `z.object({ commentId: z.uuid() })`.
- [ ] Both body schemas validate `body: z.string().min(1, 'Comment cannot be empty').max(5000, 'Comment is too long')`.
- [ ] Only import is `{ z }` from `'zod'`; no other imports.
- [ ] TypeScript compiles; inferred types are correct.
- [ ] No existing files modified.

**Dependencies:** None (Batch 1 — new isolated file).

---

## Task 4 — Frontend activity rendering: extend `ActivityAction` + `describeActivity` + test

**Description**

Make the frontend activity renderer aware of the two new action types so the Activity tab compiles and renders summary sentences once the backend ships them. Three tightly-coupled FE files.

1. **`frontend/src/types/activity.ts`** — extend the `ActivityAction` union (`types/activity.ts:~4–10`):
   ```ts
   export type ActivityAction =
     | 'CREATED'
     | 'STATUS_CHANGED'
     | 'PRIORITY_CHANGED'
     | 'ASSIGNEE_CHANGED'
     | 'LABELS_CHANGED'
     | 'CONTENT_UPDATED'
     | 'COMMENT_EDITED'
     | 'COMMENT_DELETED';
   ```

2. **`frontend/src/utils/describeActivity.ts`** — add two `case` clauses to the `describeClause` switch (`describeActivity.ts:~27–52`), placed before the `default`. Both actions are summary-only and carry no `from`/`to`/`message` content (backend returns `message: null` for them):
   ```ts
   case 'COMMENT_EDITED':
     return 'edited a comment';
   case 'COMMENT_DELETED':
     return 'deleted a comment';
   ```
   Insert them between the `CONTENT_UPDATED` case and the `default:`. The full actor sentence is assembled by `ActivityItem` (caller prepends `actorLabel`), so only the clause is needed — mirror the shape of the existing `'CREATED' → 'created the ticket'` clause.

3. **`frontend/src/utils/describeActivity.test.ts`** — add two new rows to the existing table-driven `cases` array (`describeActivity.test.ts:~24–74`), keeping the `{ name, input, expected }` shape:
   ```ts
   {
     name: 'COMMENT_EDITED → edited a comment',
     input: entry({ actionType: 'COMMENT_EDITED' }),
     expected: 'edited a comment',
   },
   {
     name: 'COMMENT_DELETED → deleted a comment',
     input: entry({ actionType: 'COMMENT_DELETED' }),
     expected: 'deleted a comment',
   },
   ```
   The shared `entry(...)` helper already defaults `from`/`to`/`message` to `null`, matching the backend's summary-only payload — no helper changes needed. Do **not** add separate `it(...)` blocks; the `cases.forEach(...)` loop drives them.

**Acceptance Criteria**

- [ ] `ActivityAction` in `frontend/src/types/activity.ts` includes `'COMMENT_EDITED'` and `'COMMENT_DELETED'`.
- [ ] `describeClause` in `describeActivity.ts` returns `'edited a comment'` for `COMMENT_EDITED` and `'deleted a comment'` for `COMMENT_DELETED`, placed before the `default` arm.
- [ ] `describeActivity.test.ts` `cases` array includes two new rows asserting the exact clauses above.
- [ ] `vitest run frontend/src/utils/describeActivity.test.ts` passes (both new rows green; no regressions).
- [ ] Frontend `tsc`/build compiles with the extended union (switch remains exhaustive; no new `any`).
- [ ] No other frontend files modified.

**Dependencies:** None (Batch 1 — three tightly-coupled FE files; disjoint from all backend paths).

---

## Task 5 — Backend Drizzle migration: generate `0001_*.sql`

**Description**

After T1 lands the `comments` table + enum extension in `backend/src/db/schema.ts`, generate the migration by running `npm run db:generate` (a.k.a. `drizzle-kit generate`) from the `backend/` directory. Do **not** hand-edit any generated file — drizzle owns the `NNNN_` prefix, the SQL, and the snapshot.

Files to commit (new/updated, generated):
- `backend/src/db/migrations/0001_*.sql` (expect `ALTER TYPE "ActivityAction" ADD VALUE` for both new enum members, `CREATE TABLE "Comments"`, and `CREATE INDEX "comments_ticket_id_idx"`)
- `backend/src/db/migrations/meta/_journal.json` (drizzle appends an entry)
- `backend/src/db/migrations/meta/0001_snapshot.json` (new snapshot)

Do **not** modify the existing `0000_dear_mattie_franklin.sql` or `meta/0000_snapshot.json`.

**Code references**
- Migration runner: `backend/src/index.ts` (gated by `env.runMigrationsOnStart`, runs against the direct connection — enum `ADD VALUE` is append-only and transaction-safe in PG ≥12).
- Schema source of truth: `backend/src/db/schema.ts` (after T1).
- Existing single migration: `backend/src/db/migrations/0000_dear_mattie_franklin.sql`.

**Acceptance Criteria**

- [ ] `npm run db:generate` (or `npx drizzle-kit generate`) run from `backend/` produces exactly one new `0001_*.sql`.
- [ ] The generated SQL contains `ALTER TYPE "ActivityAction" ADD VALUE 'COMMENT_EDITED'` and `... 'COMMENT_DELETED'`, plus `CREATE TABLE "Comments"` with columns `id`, `ticket_id`, `author_id`, `body`, `created_at`, `updated_at`, and `CREATE INDEX "comments_ticket_id_idx"`.
- [ ] `meta/_journal.json` has a new entry pointing at `0001_*.sql`.
- [ ] A fresh `meta/0001_snapshot.json` exists.
- [ ] No generated file is hand-edited (drizzle-only content).
- [ ] `0000_*` files untouched.
- [ ] (Verify, optional) Applying the migration against a scratch DB via the boot migrator succeeds.

**Dependencies:** T1.

---

## Task 6 — Backend `commentService.ts` (new): list/get/create/update/delete

**Description**

Create `backend/src/services/commentService.ts` mirroring the flat 2-tier service style of `ticketService.ts` and `timerService.ts`. Import `recordActivity` from `activityLogService.ts` and call it **inside** the caller's `db.transaction`. Import `comments`, `CommentRow` from `../db/schema`. Reuse the local `Tx` alias shape.

**Exported types:**
```ts
export interface CommentAuthorDto { id: string | null; fullName: string | null; avatarUrl: string | null; }
export interface CommentDto {
  id: string;
  ticketId: string;
  body: string;
  createdAt: string;   // ISO
  updatedAt: string;   // ISO
  edited: boolean;     // updatedAt > createdAt
  author: CommentAuthorDto;
}
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
```

**Exported functions:**

1. **`listComments(ticketId: string): Promise<CommentDto[]>`** — `SELECT … FROM comments LEFT JOIN users ON users.id = comments.author_id WHERE comments.ticket_id = ? ORDER BY comments.created_at ASC`. Single query (no N+1) — mirror the join shape of `activityService.ts:~176`. Throw `new AppError(ErrorCode.NOT_FOUND, 'Ticket not found')` if the ticket row is missing. Map rows to `CommentDto` with `author: { id, fullName, avatarUrl }` (null author → all-null author object) and `edited: updatedAt > createdAt`.

2. **`getComment(commentId: string): Promise<CommentRow | null>`** — plain `SELECT * FROM comments WHERE id = ?`. Returns row or `null`. Used by `resolveCommentProject` (T7); must not throw on missing.

3. **`createComment({ ticketId, authorId, body }): Promise<CommentDto>`** — gate on ticket existence/soft-delete: fetch the ticket, throw `new AppError(ErrorCode.NOT_FOUND, 'Ticket not found')` if missing or `ticket.deletedAt` is set (locked v1 default). `body = body.trim()` before insert; reject empty post-trim → `VALIDATION_FAILED`. Insert inside `db.transaction`. Per v1 default, do **NOT** emit a `COMMENT_CREATED` activity row. Return the inserted `CommentDto` (`edited: false`).

4. **`updateComment({ commentId, actingUserId, body }): Promise<CommentDto>`** — inside `db.transaction`: load row; if missing → `NOT_FOUND 'Comment not found'`. **Author-only** guard (mirror `timerService.ts:~86–101`):
   ```ts
   if (comment.authorId !== actingUserId) {
     throw new AppError(ErrorCode.FORBIDDEN, 'You can only edit your own comment');
   }
   ```
   `body = body.trim()`; reject empty. `UPDATE comments SET body = ?, updated_at = now() WHERE id = ?`. Then:
   ```ts
   await recordActivity(tx, { ticketId: comment.ticketId, actorId: actingUserId, action: 'COMMENT_EDITED' });
   ```
   — **no** `oldValue`/`newValue` (default null). Return updated `CommentDto`.

5. **`deleteComment({ commentId, actingUserId, isPlatformAdmin, isProjectAdmin }): Promise<void>`** — inside `db.transaction`: load row; missing → `NOT_FOUND 'Comment not found'`. **Author-or-admin** guard:
   ```ts
   const isAdmin = isPlatformAdmin || isProjectAdmin;
   if (comment.authorId !== actingUserId && !isAdmin) {
     throw new AppError(ErrorCode.FORBIDDEN, 'You can only delete your own comment');
   }
   ```
   `DELETE FROM comments WHERE id = ?`. Then `recordActivity(tx, { ticketId: comment.ticketId, actorId: actingUserId, action: 'COMMENT_DELETED' })` with null values. Treat a null `authorId` as "not the current user" (no edit; delete only via admin).

**Code references**
- `recordActivity(tx, { ticketId, actorId, action, oldValue?, newValue? })` at `activityLogService.ts:~39–49`; `Tx` derivation at `:~6–7`.
- `db.transaction(async tx => …)` idiom: `ticketService.ts` (`updateTicket`).
- Author-or-admin guard: `timerService.ts:~86–101` (`stopTimer`).
- `AppError(ErrorCode.X, msg, { details? })` + codes (`VALIDATION_FAILED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`): `utils/appError.ts`, `utils/envelope.ts`.
- Join/enrich shape: `activityService.ts:~176`.

**Acceptance Criteria**

- [ ] All five functions exported with the signatures above.
- [ ] `listComments` orders `createdAt ASC`, joins users in one query, throws `NOT_FOUND` when ticket is absent, returns `CommentDto[]`.
- [ ] `getComment` returns `CommentRow | null` (never throws for a missing id).
- [ ] `createComment` throws `NOT_FOUND` on missing/soft-deleted ticket; trims body; rejects empty post-trim; inserts and returns `CommentDto` with `edited: false`; emits **no** activity row.
- [ ] `updateComment` throws `FORBIDDEN` for non-author; succeeds for author; trims body; bumps `updatedAt`; calls `recordActivity(tx, { action: 'COMMENT_EDITED' })` with null `oldValue`/`newValue`; returns `CommentDto`.
- [ ] `deleteComment` throws `FORBIDDEN` for non-author non-admin; succeeds for author, Platform Admin, and Project Admin; calls `recordActivity(tx, { action: 'COMMENT_DELETED' })` with null values; deletes the row.
- [ ] Every `recordActivity` call runs inside the same `db.transaction` as the mutation.
- [ ] No comment body content is ever passed to `recordActivity`.

**Dependencies:** T1 (schema, `CommentRow`), T2 (so `'COMMENT_EDITED' | 'COMMENT_DELETED'` are valid `ActivityAction` values).

---

## Task 7 — Backend `resolveCommentProject` middleware

**Description**

Add a new exported middleware to `backend/src/middleware/resolveProject.ts`, cloned from `resolveLabelProject` (`resolveProject.ts:~106–127`). It reads `req.params.commentId` (note: **`commentId`**, not `id`), loads the comment via `commentService.getComment` (T6), throws `new AppError(ErrorCode.NOT_FOUND, 'Comment not found')` if null, then resolves comment → ticket → project → membership via the existing `resolveAndAuthorize(ticket.projectId, req.user.id, req.user.isPlatformAdmin)` (`resolveProject.ts:~62–74`).

The comment carries `ticketId`, not `projectId`, so load its ticket (`ticketService.getTicket(id)`, already used by `tickets.routes.ts`) to obtain `projectId` before calling `resolveAndAuthorize`:

```ts
export function resolveCommentProject() {
  return async function resolveCommentProjectMiddleware(
    req: Request, _res: Response, next: NextFunction,
  ): Promise<void> {
    if (!req.user) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'Authentication required');
    }
    const commentId = req.params.commentId as string;
    const comment = await getComment(commentId);
    if (!comment) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Comment not found');
    }
    const ticket = await getTicket(comment.ticketId);
    if (!ticket) {
      throw new AppError(ErrorCode.NOT_FOUND, 'Ticket not found');
    }
    const { project, projectMember } = await resolveAndAuthorize(
      ticket.projectId, req.user.id, req.user.isPlatformAdmin,
    );
    req.project = project;
    req.projectMember = projectMember;
    next();
  };
}
```

Import `getComment` from `../services/commentService` and `getTicket` from `../services/ticketService`. Match the non-revealing FORBIDDEN idiom already used by `resolveAndAuthorize` (`resolveProject.ts:~40–74`).

**Acceptance Criteria**

- [ ] `resolveCommentProject()` exported from `resolveProject.ts`.
- [ ] Reads `req.params.commentId`.
- [ ] Returns `NOT_FOUND 'Comment not found'` when the comment doesn't exist.
- [ ] Resolves comment → ticket → project → membership and sets `req.project` + `req.projectMember`.
- [ ] Non-members get a non-revealing `FORBIDDEN` (via `resolveAndAuthorize`).
- [ ] Requires `authenticate` upstream — throws `UNAUTHENTICATED` if `req.user` missing.
- [ ] No behavioral regression to `resolveLabelProject` / `resolveTicketProject`.

**Dependencies:** T6 (`commentService.getComment`).

---

## Task 8 — Backend routes + app wiring

**Description**

Wire the comment HTTP surface: inline ticket-scoped list/create in `tickets.routes.ts`, a new `comments.routes.ts` for PATCH/DELETE, and mount the new router in `index.ts`.

**A. Reuse `comments.schema.ts`** (created in T3) — import `commentIdParam`, `createCommentBody`, `updateCommentBody` + inferred types from there. Reuse `ticketIdParam` + `TicketIdParam` from `tickets.schema.ts`. Do **not** redefine either.

**B. Inline routes in `backend/src/routes/tickets.routes.ts`** — add immediately **after** the existing `/:ticketId/activity` route. Import `commentService` and the schemas:
```ts
// GET /api/tickets/:ticketId/comments — any project member (resolveTicketProject enforces)
ticketsRouter.get(
  '/:ticketId/comments',
  authenticate,
  validateRequest({ params: ticketIdParam }),
  resolveTicketProject(),
  async (req, res) => {
    const { ticketId } = req.params as TicketIdParam;
    res.json(success(await commentService.listComments(ticketId)));
  },
);

// POST /api/tickets/:ticketId/comments — any project member
ticketsRouter.post(
  '/:ticketId/comments',
  authenticate,
  validateRequest({ params: ticketIdParam, body: createCommentBody }),
  resolveTicketProject(),
  async (req, res) => {
    const { ticketId } = req.params as TicketIdParam;
    const { body } = req.body as CreateCommentBody;
    const comment = await commentService.createComment({ ticketId, authorId: req.user!.id, body });
    res.status(201).json(success(comment));
  },
);
```
`resolveTicketProject()` already enforces membership (non-member → `FORBIDDEN`), so "any project member can comment" is satisfied with no extra gate.

**C. New `backend/src/routes/comments.routes.ts`** (mirror the split in `labels.routes.ts`):
```ts
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { resolveCommentProject } from '../middleware/resolveProject';
import { validateRequest } from '../middleware/validateRequest';
import { success } from '../utils/envelope';
import {
  commentIdParam, updateCommentBody,
  type CommentIdParam, type UpdateCommentBody,
} from './comments.schema';
import * as commentService from '../services/commentService';

export const commentsRouter = Router();

// PATCH /api/comments/:commentId — author only (enforced in service)
commentsRouter.patch(
  '/:commentId',
  authenticate,
  validateRequest({ params: commentIdParam, body: updateCommentBody }),
  resolveCommentProject(),
  async (req, res) => {
    const { commentId } = req.params as CommentIdParam;
    const { body } = req.body as UpdateCommentBody;
    const comment = await commentService.updateComment({ commentId, actingUserId: req.user!.id, body });
    res.json(success(comment));
  },
);

// DELETE /api/comments/:commentId — author OR admin (enforced in service)
commentsRouter.delete(
  '/:commentId',
  authenticate,
  validateRequest({ params: commentIdParam }),
  resolveCommentProject(),
  async (req, res) => {
    const { commentId } = req.params as CommentIdParam;
    await commentService.deleteComment({
      commentId,
      actingUserId: req.user!.id,
      isPlatformAdmin: req.user!.isPlatformAdmin,
      isProjectAdmin: req.projectMember === 'PROJECT_ADMIN',
    });
    res.status(204).end();
  },
);
```

**D. Mount in `backend/src/index.ts`** — import `commentsRouter` and add `app.use('/api/comments', commentsRouter)` next to the existing mounts.

**Code references**
- Route split (nested list/create vs flat PATCH/DELETE by id): `labels.routes.ts`.
- `resolveTicketProject` membership enforcement: `resolveProject.ts`.
- Envelope + status codes (`success(x)`, `201`, `204`): `utils/envelope.ts`, `tickets.routes.ts`.
- Inline handler shape `authenticate → validateRequest → resolver → async(req,res)`: every route in `tickets.routes.ts`.
- `projectMember` value `'PROJECT_ADMIN'`: confirm against `resolveAndAuthorize` return type / `requireProjectAdmin`.

**Acceptance Criteria**

- [ ] `GET /api/tickets/:ticketId/comments` works for members; non-members get `403 FORBIDDEN`; missing ticket → `404`.
- [ ] `POST /api/tickets/:ticketId/comments` works for members (201); empty body → `400 VALIDATION_FAILED`; oversized (>5000) → `400`; non-member → `403`; soft-deleted ticket → `404` (blocked).
- [ ] `PATCH /api/comments/:commentId` succeeds for author; non-author → `403`; unknown `commentId` → `404`.
- [ ] `DELETE /api/comments/:commentId` succeeds for author, Platform Admin, and Project Admin; others → `403`; unknown `commentId` → `404`.
- [ ] `commentsRouter` mounted at `/api/comments` in `index.ts`.
- [ ] Route-level tests are covered by T15 (not this task).

**Dependencies:** T3 (schemas), T6 (service), T7 (resolver).

---

## Task 9 — Frontend API client + types + query key

**Description**

Stand up the frontend data contract for comments. Create a types file mirroring the backend `CommentDto` shape, an API client with the four CRUD functions routed through `apiFetch<T>` (auto-unwraps `{data}`, injects the bearer token, coalesces 401s, returns `null` for 204), and register a comments query key inside `ticketKeys`.

1. **`frontend/src/types/comment.ts`** (new) — mirrors `ActivityActor` (`types/activity.ts:~12`):
   ```ts
   export interface CommentAuthorDto {
     id: string | null;
     fullName: string | null;
     avatarUrl: string | null;
   }
   export interface CommentDto {
     id: string;
     ticketId: string;
     body: string;
     createdAt: string;
     updatedAt: string;
     edited: boolean;
     author: CommentAuthorDto;
   }
   ```

2. **`frontend/src/api/comments.ts`** (new):
   ```ts
   import { apiFetch } from './client';
   import type { CommentDto } from '../types/comment';

   export async function fetchTicketComments(ticketId: string): Promise<CommentDto[]> {
     return apiFetch<CommentDto[]>(`/tickets/${ticketId}/comments`);
   }
   export async function createTicketComment(ticketId: string, body: { body: string }): Promise<CommentDto> {
     return apiFetch<CommentDto>(`/tickets/${ticketId}/comments`, { method: 'POST', body: JSON.stringify(body) });
   }
   export async function updateTicketComment(commentId: string, body: { body: string }): Promise<CommentDto> {
     return apiFetch<CommentDto>(`/comments/${commentId}`, { method: 'PATCH', body: JSON.stringify(body) });
   }
   export async function deleteTicketComment(commentId: string): Promise<void> {
     await apiFetch<void>(`/comments/${commentId}`, { method: 'DELETE' });
   }
   ```
   All four go through the existing `apiFetch<T>` wrapper — no manual auth header or unwrap logic.

3. **`frontend/src/api/queryKeys.ts`** — add inside `ticketKeys` (next to `activity`):
   ```ts
   comments: (ticketId: string) => [...ticketKeys.all, 'comments', ticketId] as const,
   ```

**Acceptance Criteria**

- [ ] `frontend/src/types/comment.ts` exports `CommentAuthorDto` and `CommentDto` as specified.
- [ ] `frontend/src/api/comments.ts` exports the four functions with the specified signatures, all via `apiFetch<T>`.
- [ ] `frontend/src/api/queryKeys.ts` adds `comments: (ticketId) => [...ticketKeys.all, 'comments', ticketId] as const` inside `ticketKeys`.
- [ ] No tests required for this task (pure passthrough), but `tsc --noEmit` is clean.

**Dependencies:** T8 (backend routes define the contract).

---

## Task 10 — Frontend hooks: query + mutations

**Description**

Wire the comment data contract into TanStack Query: a read query for the list and three mutations (create/update/delete) that invalidate the comments cache plus the activity feed so the Activity tab reflects the new `COMMENT_EDITED`/`COMMENT_DELETED` rows.

1. **`frontend/src/hooks/useTicketComments.ts`** (new):
   ```ts
   export function useTicketComments(ticketId: string) {
     return useQuery({
       queryKey: ticketKeys.comments(ticketId),
       queryFn: () => fetchTicketComments(ticketId),
     });
   }
   ```
   Mount-on-open refetch is satisfied by default `staleTime: 0` behavior — do not over-set `staleTime`.

2. **`frontend/src/hooks/useCommentMutations.ts`** (new) — exports `useCreateComment(ticketId)`, `useUpdateComment(ticketId)`, `useDeleteComment(ticketId)`. Each mutation's `onSettled` invalidates **both** `ticketKeys.comments(ticketId)` and `ticketKeys.activity(ticketId)` (mirror `useUpdateTicket.ts:~64–68`). Create also invalidates activity for safety even though v1 emits no activity on create. Each mutation sets `meta: { revertMessage }` for the toast funnel (`lib/queryClient.ts`):
   - create: `'Comment post failed'`
   - update: `'Comment edit failed'`
   - delete: `'Comment delete failed'`

   `deleteTicketComment` returns `void`; the mutation's `mutationFn` may `void`-wrap the api call.

**Code references**
- Invalidation shape: `useUpdateTicket.ts:~55–68` (invalidates `boardKeys.all`, `ticketKeys.detail(id)`, `ticketKeys.activity(id)`).
- `meta.revertMessage` / `meta.suppressGlobalToast`: `lib/queryClient.ts:~31–44`.

**Acceptance Criteria**

- [ ] `useTicketComments(ticketId)` returns a `useQuery` keyed on `ticketKeys.comments(ticketId)`.
- [ ] `useCreateComment`, `useUpdateComment`, `useDeleteComment` all exported from `useCommentMutations.ts`.
- [ ] Every mutation's `onSettled` invalidates both `ticketKeys.comments(ticketId)` and `ticketKeys.activity(ticketId)`.
- [ ] Every mutation sets `meta: { revertMessage: '…' }`.
- [ ] Co-located hook tests (optional this task; full behavioral tests ride with the components in T11–T13).

**Dependencies:** T9.

---

## Task 11 — Frontend `CommentForm.tsx` + test

**Description**

A reusable textarea + submit form for both creating and editing comments. Compose from existing primitives (`Textarea`, `Button`); gate submit on non-empty trimmed body and in-flight state; trim before submit. The form receives `onSubmit`/`onCancel` as props from the parent so the mutations stay in `CommentsSection`/`CommentItem` (mirrors the prop-passing convention; closest analog `ManualEntryForm.tsx:~65–78`).

**Props:**
```ts
interface CommentFormProps {
  mode: 'create' | 'edit';
  initialValue?: string;
  isPending: boolean;
  onSubmit: (body: string) => void;
  onCancel?: () => void;
  submitLabel?: string;
}
```

**Behavior:**
- Renders `<Textarea maxLength={5000}>` (`components/ui/Textarea.tsx`) bound to local `useState`; `<Button variant="primary" size="sm" type="submit">` disabled when `!body.trim() || isPending`.
- On submit, calls `onSubmit(body.trim())` (server also trims, but client trim avoids whitespace-only round-trips).
- Edit mode renders a Cancel button (`variant="ghost"`, if `onCancel` provided) that restores `initialValue` and calls `onCancel`.
- No inline styles (Tailwind only); functional component with hooks; explicit prop interface.

**Acceptance Criteria (`CommentForm.test.tsx`, co-located, table-driven)**

- [ ] Submit disabled on empty string.
- [ ] Submit disabled on whitespace-only (`'   '`).
- [ ] Submit disabled when `isPending` is true.
- [ ] Submit calls `onSubmit` with trimmed body.
- [ ] Cancel (edit mode) restores `initialValue` and calls `onCancel`.
- [ ] No inline styles; only Tailwind classes.

**Dependencies:** T10 (mutations invoked by the parent; the form's prop shape mirrors the mutation signatures).

---

## Task 12 — Frontend `CommentItem.tsx` + test

**Description**

Render one comment: avatar, author name, relative timestamp with full-date tooltip, edited marker, body, and conditional edit/delete affordances. Gate the affordances off `useCurrentProjectMembership(slug)` (for `isProjectAdmin`), `useRequirePlatformAdmin()` (for platform admin), and the current user's id vs `comment.author.id` (for author). **Author-only edit; author-or-any-admin delete.** Null author → "Unknown user" (mirror `describeActivity.ts:~16–18`).

**Props:**
```ts
interface CommentItemProps {
  comment: CommentDto;
  slug: string;
  onEdit: (comment: CommentDto) => void;
  onDelete: (comment: CommentDto) => void;
}
```
Callbacks bubble to the parent which owns the mutations + edit-mode state.

**Behavior:**
- Reads current user from `useAuthStore((s) => s.user)`; reads `isProjectAdmin` via `useCurrentProjectMembership(slug)` (`useProjectMembers.ts:~81`); reads `isPlatformAdmin` via `useRequirePlatformAdmin()`.
- `canEdit = user?.id === comment.author.id` (author only — note `comment.author.id` may be `null`; a null author is never the current user).
- `canDelete = user?.id === comment.author.id || isPlatformAdmin || isProjectAdmin`.
- Renders `<Avatar src={comment.author.avatarUrl} name={comment.author.fullName} size="sm" />` (`components/ui/Avatar.tsx`); author name `comment.author.fullName ?? 'Unknown user'`.
- Timestamp: `formatRelativeTime(comment.createdAt)` with `title={formatDate(comment.createdAt)}` (mirror `ActivityItem.tsx:~21–27`).
- When `comment.edited`, shows muted "(edited)" with `title={formatDate(comment.updatedAt)}`.
- Edit affordance (pencil) rendered only when `canEdit`; calls `onEdit(comment)`. Delete affordance (trash) only when `canDelete`; calls `onDelete(comment)` (parent confirms via the project's existing confirm pattern).

**Acceptance Criteria (`CommentItem.test.tsx`, co-located, table-driven)**

- [ ] Renders author + avatar; "Unknown user" when `fullName` is null.
- [ ] Shows "(edited)" only when `comment.edited` is true.
- [ ] Edit button shown only for the author.
- [ ] Delete button shown for the author.
- [ ] Delete button shown for a Platform Admin (mock `useRequirePlatformAdmin` → true).
- [ ] Delete button shown for a Project Admin (mock `useProjectMembers`/`useCurrentProjectMembership` → `isProjectAdmin: true`).
- [ ] Neither button shown for a non-author non-admin.

**Dependencies:** T10. (T11 indirectly — edit mode swaps this row for `CommentForm`, but the wiring lives in the parent `CommentsSection`.)

---

## Task 13 — Frontend `CommentsSection.tsx` + test

**Description**

The top-level comments component mounted in the modal. Owns the `useTicketComments` query + the three mutations + the "currently-editing" comment id state. Renders the post box (`CommentForm` create mode) and the list (`CommentItem` map). Handles empty state and the soft-deleted `disabled` gate (hide post box).

**Props:**
```ts
interface CommentsSectionProps {
  ticketId: string;
  slug: string;
  disabled?: boolean;
}
```

**Behavior:**
- Uses `useTicketComments(ticketId)`, `useCreateComment(ticketId)`, `useUpdateComment(ticketId)`, `useDeleteComment(ticketId)`.
- Renders `<section aria-label="Comments">`: when `!disabled`, a `CommentForm` (create mode) at top whose `onSubmit` fires `useCreateComment`; below it the list (`CommentItem` map over `data ?? []`, server-ordered `createdAt` ASC = newest-last).
- Loading and error states follow project convention (skeleton/spinner + error text — match `ActivityItem`/activity feed styling).
- Empty state: when list is empty and not loading, show muted "No comments yet".
- Holds `editingId` state; when a `CommentItem` calls `onEdit`, sets `editingId`; that row renders `CommentForm` (edit mode, `initialValue=comment.body`) instead of the read view; `onSubmit` fires `useUpdateComment` and clears `editingId`; `onCancel` clears `editingId`.
- `onDelete` confirms then fires `useDeleteComment`.
- When `disabled` (soft-deleted ticket), the post box is hidden but existing comments remain readable (consistent with the modal's other `deletedAt` gates — red banner, disabled time-tracking tab, readOnly attribute form).

**Acceptance Criteria (`CommentsSection.test.tsx`, co-located)**

- [ ] Empty state ("No comments yet") renders when the list is empty and not loading.
- [ ] Renders N mocked `CommentItem`s.
- [ ] Post box hidden when `disabled` is true.
- [ ] Create calls `createTicketComment` and invalidates `ticketKeys.comments`.
- [ ] Edit toggles the row to `CommentForm`; on submit calls `updateTicketComment` and clears edit mode.
- [ ] Delete calls `deleteTicketComment`.

**Dependencies:** T11, T12.

---

## Task 14 — Wire `CommentsSection` into `TicketDetailModal.tsx` + update test

**Description**

Replace the SLYK-13 placeholder block at `frontend/src/components/TicketDetailModal.tsx:~223–228`:
```tsx
{/* SLYK-13: Comments section — not yet implemented */}
<section aria-label="Comments" className="mt-4">
    <p className="text-sm text-muted-foreground">
        Comments — coming soon (SLYK-13)
    </p>
</section>
```
with:
```tsx
<CommentsSection ticketId={ticket.id} slug={slug} disabled={!!ticket.deletedAt} />
```
Pass `disabled` when the ticket is soft-deleted so members can't comment on deleted tickets — consistent with the modal's other `deletedAt` gates (red banner at `:~139–149`, time-tracking tab disabled at `:~163`, attribute form readOnly at `:~200`, delete button hidden when `deletedAt`).

Add the `CommentsSection` import.

**Test update:** `frontend/src/components/TicketDetailModal.test.tsx:~495–496` currently asserts the "coming soon" placeholder:
```ts
expect(within(details).getByText(/coming soon/i)).toBeInTheDocument();
```
Replace this assertion with one that the real `CommentsSection` renders (e.g. assert the section `aria-label="Comments"`, or mock `CommentsSection` + `useTicketComments` to keep the modal test focused).

**Acceptance Criteria**

- [ ] Placeholder block at `TicketDetailModal.tsx:~223–228` replaced with `<CommentsSection ticketId={ticket.id} slug={slug} disabled={!!ticket.deletedAt} />`.
- [ ] `CommentsSection` import added.
- [ ] `TicketDetailModal.test.tsx` "coming soon" assertion removed/replaced with a real `CommentsSection` assertion.
- [ ] Soft-deleted ticket case: `CommentsSection` mounted with `disabled` (post box hidden) — covered by T13's `disabled` test; add a modal-level assertion if cheap.
- [ ] `vitest run frontend/src/components/TicketDetailModal.test.tsx` passes.

**Dependencies:** T13.

---

## Task 15 — Backend tests: `commentService.test.ts` + `comments.routes.test.ts`

**Description**

Table-driven Vitest tests for the new backend layer: the service (authorization + activity-write contracts) and the HTTP routes (membership/author/admin gates, validation, 404/204/201 shapes, activity-row side effects). Follow the project's testing rules (one behavior per `it`, table-driven preferred, co-located `*.test.ts`, stub the data-access layer per project rules).

**`backend/src/services/commentService.test.ts`** (co-located, stubs the data-access layer):
- `createComment` returns a `CommentDto` with `edited: false`; throws `NOT_FOUND` when ticket is soft-deleted/missing.
- `updateComment` table-driven: author succeeds (`edited: true` after update); non-author → `FORBIDDEN`; asserts `recordActivity(tx, { action: 'COMMENT_EDITED' })` called with **null** oldValue/newValue (no comment content in activity).
- `deleteComment` table-driven: author succeeds; non-author non-admin → `FORBIDDEN`; Platform Admin succeeds; Project Admin succeeds; asserts `recordActivity(tx, { action: 'COMMENT_DELETED' })` called with null values; row deleted.
- `listComments` returns rows ordered `createdAt ASC` with joined author info; throws `NOT_FOUND` when ticket missing.

**`backend/src/routes/comments.routes.test.ts`** (supertest, table-driven where applicable):
- Member `GET`/`POST` → 200/201; non-member → `403 FORBIDDEN`.
- Author `PATCH`/`DELETE` own → 200/204; non-author `PATCH` → `403`; non-author non-admin `DELETE` → `403`; admin `DELETE` others' → 204.
- `POST` empty body → `400 VALIDATION_FAILED`; oversized body (>5000) → `400`.
- `PATCH`/`DELETE` unknown `commentId` → `404 NOT_FOUND`.
- Soft-deleted ticket: `POST` → blocked (`NOT_FOUND`, per locked v1 decision).
- Each successful edit/delete produces exactly one activity row of the right action with null values (assert via the activity service or a direct query in the test).

**Acceptance Criteria**

- [ ] `commentService.test.ts` covers all behaviors above, table-driven where applicable (authz matrix, missing/edited states).
- [ ] `comments.routes.test.ts` covers the HTTP matrix above, table-driven where applicable.
- [ ] Every `recordActivity` assertion verifies null oldValue/newValue (no comment content leak).
- [ ] All tests co-located next to source; `npm test -- commentService comments.routes` passes.

**Dependencies:** T8 (routes, service, schema, and migration must exist). Independent of all frontend tasks.
