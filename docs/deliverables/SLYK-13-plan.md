# Implementation Plan — SLYK-13

**Ticket:** `docs/deliverables/SLYK-13.md`
**Type:** Feature
**Title:** Ticket Comments
**Generated:** 2026-06-30

---

## Summary

Add a per-ticket **Comments** capability. Any project member can post a comment to a ticket; the comment's author can edit their own comment; the author **or** any admin (Platform Admin / Project Admin) can delete a comment. Each comment carries its author (avatar + name) and timestamp; edited comments are visibly marked as edited. Edits and deletes are recorded into the existing ticket activity log as **summary-only** entries — e.g. "User X edited a comment" / "User X deleted a comment" — never the comment body. There is no realtime channel; the comment list refetches on modal open and after every post/edit/delete mutation.

On the frontend, the SLYK-11 `TicketDetailModal` Details tab left a `Comments — coming soon (SLYK-13)` placeholder; this plan replaces it with a real `CommentsSection` rendered below the ticket content, newest last.

The feature fits squarely within the existing `tickets` resource (comments are a ticket sub-resource, like `activity`, `timer`, `time`). It reuses the existing membership middleware (`resolveTicketProject`), the activity-log write path (`recordActivity`), and the avatar/relative-time utilities on the frontend.

## Architectural note (deviation from AGENTS.md)

`AGENTS.md` prescribes a 4-tier `Route → Controller → Service → Repository` layering, but the **actual** codebase is 2-tier: `Route → Service` with handlers inline in `routes/*.routes.ts`, and all persistence in `services/*.ts`. `backend/src/controllers/` and `backend/src/repositories/` contain only `.gitkeep`. This plan mirrors the **actual** convention (every existing feature — tickets, labels, timers, activity, membership — follows the 2-tier pattern).

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| Schema | `backend/src/db/schema.ts` | Add `comments` table; extend `activityActionEnum` with `COMMENT_EDITED` / `COMMENT_DELETED` |
| Migration | `backend/src/db/migrations/0001_*.sql` (+ `meta/`) | New Drizzle migration for the table + enum extension |
| Service (new) | `backend/src/services/commentService.ts` | CRUD + author/admin authorization |
| Service | `backend/src/services/activityLogService.ts` | Extend `ActivityAction` union with `COMMENT_EDITED` / `COMMENT_DELETED` |
| Service | `backend/src/services/activityService.ts` | Extend `EnrichedActionType` + add `case` in `enrichActivityRows` (summary, no content) |
| Middleware | `backend/src/middleware/resolveProject.ts` | Add `resolveCommentProject()` resolver (clone of `resolveLabelProject`) |
| Schema validation (new) | `backend/src/routes/comments.schema.ts` | Zod `commentIdParam`, `createCommentBody`, `updateCommentBody` |
| Routes | `backend/src/routes/tickets.routes.ts` | `GET`/`POST /:ticketId/comments` (inline) |
| Routes (new) | `backend/src/routes/comments.routes.ts` | `PATCH`/`DELETE /:commentId` |
| App wiring | `backend/src/index.ts` | Mount `commentsRouter` at `/api/comments` |
| API client | `frontend/src/api/tickets.ts` (or new `api/comments.ts`) | `fetchTicketComments`, `createTicketComment`, `updateTicketComment`, `deleteTicketComment` |
| Query keys | `frontend/src/api/queryKeys.ts` | Add `ticketKeys.comments(id)` |
| Hooks (new) | `frontend/src/hooks/useTicketComments.ts`, `frontend/src/hooks/useCommentMutations.ts` | Query + create/update/delete mutations with invalidation |
| Component (new) | `frontend/src/components/CommentsSection.tsx` | List + post box; orchestrates `CommentItem` + `CommentForm` |
| Component (new) | `frontend/src/components/CommentItem.tsx` | Single comment row: avatar, name, timestamp, edited marker, edit/delete affordances |
| Component (new) | `frontend/src/components/CommentForm.tsx` | Textarea + submit Button (create + edit modes) |
| Component | `frontend/src/components/TicketDetailModal.tsx` | Replace SLYK-13 placeholder (lines ~223–228) with `<CommentsSection>` |
| Types | `frontend/src/types/activity.ts` | Add `COMMENT_EDITED` / `COMMENT_DELETED` to `ActivityAction` union |
| Util | `frontend/src/utils/describeActivity.ts` | Add `case` clauses rendering "edited a comment" / "deleted a comment" |
| Tests | `*.test.ts(x)` co-located next to each new/changed source | Vitest, table-driven; one behavior per test |

## Proposed Implementation

Build order: schema → migration → service → middleware → routes/wiring → backend tests → frontend data/hooks → frontend components → wire into modal → frontend tests. Backend first because the frontend contracts depend on the API shape.

### Backend Changes

#### 1. Schema — `backend/src/db/schema.ts`

**What:** Add the `comments` table following the conventions used by `activityLogs` (`schema.ts:206–227`) and `timeEntries` (ticket sub-resource, `userId` nullable + `ON DELETE SET NULL` to preserve history if a user is deleted, `ticketId` `ON DELETE CASCADE`).

**Why:** Comments are an editable ticket sub-resource, so they need both `createdAt` and `updatedAt` (unlike the append-only `activityLogs` which has only `createdAt`). `updatedAt` doubles as the "edited at" timestamp.

**Code reference:** mirror `activityLogs` (`schema.ts:254–272`) for FK/`set null`/`cascade`/index idiom; mirror `timeEntries` (`schema.ts:228–249`) for nullable `userId`. Conventions: `uuid('id').primaryKey().defaultRandom()`; `timestamp(..., { withTimezone: true, mode: 'date' }).defaultNow().notNull()`; `updatedAt` with `.$onUpdate(() => new Date())`; snake_case physical names; `index('comments_ticket_id_idx').on(table.ticketId)`.

```ts
export const comments = pgTable(
  'Comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: uuid('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow().$onUpdate(() => new Date()).notNull(),
  },
  (table) => ({ ticketIdx: index('comments_ticket_id_idx').on(table.ticketId) }),
);
export type CommentRow = typeof comments.$inferSelect;
```

> **`authorId` vs `userId`:** existing tables use `userId` for the actor column. Use `authorId`/`author_id` for domain clarity (a comment *author*) OR `userId` for consistency. Pick one and keep it consistent across schema, service, route, and API contract. Recommended: **`authorId`** (clearer in the API response and frontend types). Note: if a user is deleted (`ON DELETE SET NULL`), the comment is retained with a null author — render as "Unknown user" on the frontend (mirroring `describeActivity.ts:16–18`).

#### 2. Extend `activityActionEnum` — `backend/src/db/schema.ts:243–251`

**What:** Add `COMMENT_EDITED` and `COMMENT_DELETED` to the `activityActionEnum`.

**Why:** The activity log is **structured** (enum + `oldValue`/`newValue`), not free-text; the summary sentence is rendered client-side via `describeActivity` (`frontend/src/utils/describeActivity.ts:24–50`). Adding enum values is the consistent path and lets the FE render "edited a comment" / "deleted a comment" deterministically. `oldValue`/`newValue` stay **null** for these actions — guarantees no comment content leaks to the activity log.

**Code reference:** current enum at `schema.ts:243–251`; comment at `:241` confirms no jsonb metadata by design (summary-only is already the project's intent).

```ts
export const activityActionEnum = pgEnum('ActivityAction', [
  'CREATED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'ASSIGNEE_CHANGED',
  'LABELS_CHANGED', 'CONTENT_UPDATED',
  'COMMENT_EDITED', 'COMMENT_DELETED',   // SLYK-13
]);
```

#### 3. Migration — `backend/src/db/migrations/`

**What:** Generate `0001_<name>.sql` via `drizzle-kit generate` (do **not** hand-edit — drizzle owns the `NNNN_` prefix, `meta/_journal.json`, and `meta/0001_snapshot.json`).

**Why:** The migrator runs on boot (`backend/src/index.ts:75–95`, gated by `env.runMigrationsOnStart`). Only one migration exists today (`0000_dear_mattie_franklin.sql`). The generated migration will emit a `CREATE TYPE … AS ENUM` update for the `ActivityAction` enum plus the `CREATE TABLE "Comments"` plus the index. Note Postgres enum extension is append-only and safe (no data rewrite).

**Code reference:** migration mechanism at `index.ts:75–95`; existing migration at `0000_dear_mattie_franklin.sql`.

#### 4. Service — `backend/src/services/commentService.ts` (new)

**What:** CRUD for comments plus author/admin authorization, and the activity-summary writes inside the same transaction.

**Why:** Mirrors the flat service style of `ticketService.ts` / `timerService.ts`. Services own business logic; cross-service imports are flat (`ticketService` already imports `activityLogService`).

**Code reference:** `recordActivity(tx, { ticketId, actorId, action, oldValue?, newValue? })` at `activityLogService.ts:39–49` (must run inside the caller's `db.transaction`); the `Tx` type alias at `activityLogService.ts:6–7`; author-or-admin pattern inline in the service (mirror `timerService.ts:86–101` `stopTimer` — `if (active.userId !== userId && !isAdmin) throw new AppError(FORBIDDEN, ...)`); `AppError(ErrorCode.<CODE>, msg)` from `utils/appError.ts`; `db.transaction(async tx => …)` idiom from `ticketService.ts:196–235`.

Exported functions:

```ts
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// List for a ticket (used by GET /:ticketId/comments). Throws NOT_FOUND if ticket missing.
export async function listComments(ticketId: string): Promise<CommentDto[]>;

// For the resolver — returns the row or null.
export async function getComment(commentId: string): Promise<CommentRow | null>;

// Create. authorId = acting user. Runs in a txn; emits COMMENT_CREATED? — see note below.
export async function createComment(input: { ticketId: string; authorId: string; body: string; }): Promise<CommentDto>;

// Edit. Author only. Runs in a txn; emits COMMENT_EDITED summary (no content) via recordActivity.
export async function updateComment(input: {
  commentId: string; actingUserId: string; body: string;
}): Promise<CommentDto>;

// Delete. Author OR admin. Runs in a txn; emits COMMENT_DELETED summary (no content) via recordActivity.
export async function deleteComment(input: {
  commentId: string; actingUserId: string; isPlatformAdmin: boolean; isProjectAdmin: boolean;
}): Promise<void>;
```

Authorization inside `updateComment` (author only):
```ts
if (comment.authorId !== actingUserId) {
  throw new AppError(ErrorCode.FORBIDDEN, 'You can only edit your own comment');
}
```

Authorization inside `deleteComment` (author or admin):
```ts
const isAdmin = isPlatformAdmin || isProjectAdmin;
if (comment.authorId !== actingUserId && !isAdmin) {
  throw new AppError(ErrorCode.FORBIDDEN, 'You can only delete your own comment');
}
```

Activity write inside each txn (after the mutation), leaving `oldValue`/`newValue` **null**:
```ts
await recordActivity(tx, { ticketId: comment.ticketId, actorId: actingUserId, action: 'COMMENT_EDITED' });
// or 'COMMENT_DELETED'
```

> **Open question (see §Open Questions):** whether *posting* a comment should also create a `COMMENT_CREATED` activity entry. The ticket lists only edit/delete for summary entries — so default to **no** activity row on create, matching the ticket. (If product wants create-logged, add `COMMENT_CREATED` to the enum and a `describeActivity` case.)

`CommentDto` shape (returned to the FE; never the raw DB row from a controller-equivalent handler — though this codebase returns rows directly, the `leftJoin(users)` enrichment pattern from `activityService.ts:152–164` is the precedent for joining author info):
```ts
{
  id: string;
  ticketId: string;
  body: string;
  createdAt: string;   // ISO
  updatedAt: string;   // ISO
  edited: boolean;     // updatedAt > createdAt (or precision-safe comparison)
  author: { id: string | null; fullName: string | null; avatarUrl: string | null };
}
```
`edited` is derived (`updatedAt > createdAt`); no DB column needed. `listComments` orders `createdAt ASC` (newest last, per the ticket).

#### 5. Activity log write/enrichment — `activityLogService.ts`, `activityService.ts`

**What:**
- `activityLogService.ts:9–15`: extend the `ActivityAction` union with `'COMMENT_EDITED' | 'COMMENT_DELETED'` (mirror the DB enum).
- `activityService.ts:14–20` (`EnrichedActionType`): add the same two values.
- `activityService.ts:65–118` (`enrichActivityRows`): add `case 'COMMENT_EDITED':` / `case 'COMMENT_DELETED':` returning `{ ...base, message: null }` (no content). The FE `describeActivity` supplies the verb; nothing content-bearing is stored or returned.

**Why:** Keeps the read side consistent so the existing Activity tab renders the new entries without leaking content.

#### 6. Middleware — `backend/src/middleware/resolveProject.ts`

**What:** Add `resolveCommentProject()` — a clone of `resolveLabelProject()` (`resolveProject.ts:104–127`) that loads a comment by `req.params.commentId` (throwing `NOT_FOUND 'Comment not found'` if absent), then reuses `resolveAndAuthorize(ticket.projectId, userId, isPlatformAdmin)` (`resolveProject.ts:62–74`) to set `req.project` + `req.projectMember`.

**Why:** PATCH/DELETE by `commentId` must resolve the comment → its ticket → its project → membership, same shape as the label-by-id resolver.

**Code reference:** `resolveLabelProject` at `resolveProject.ts:104–127`; the non-revealing FORBIDDEN idiom at `resolveProject.ts:40–74`.

#### 7. Zod schemas — `backend/src/routes/comments.schema.ts` (new)

**What:** Mirror `tickets.schema.ts` conventions.

**Code reference:** `ticketIdParam = z.object({ ticketId: z.uuid() })` at `tickets.schema.ts:3–5`; body schemas with inferred types at `tickets.schema.ts:34–62`.

```ts
import { z } from 'zod';

export const commentIdParam = z.object({ commentId: z.uuid() });
export type CommentIdParam = z.infer<typeof commentIdParam>;

export const createCommentBody = z.object({
  body: z.string().min(1, 'Comment cannot be empty').max(5000, 'Comment is too long'),
});
export type CreateCommentBody = z.infer<typeof createCommentBody>;

export const updateCommentBody = z.object({
  body: z.string().min(1, 'Comment cannot be empty').max(5000, 'Comment is too long'),
});
export type UpdateCommentBody = z.infer<typeof updateCommentBody>;
```

> Tune the `max(5000)` to product preference; pick a value and keep FE `Textarea.maxLength` in sync.

#### 8. Routes — `tickets.routes.ts` + `comments.routes.ts` (new)

**What (inline, ticket-scoped list/create):** add to `tickets.routes.ts` immediately after the existing `/:ticketId/activity` route (`tickets.routes.ts:34`):

```ts
// GET /api/tickets/:ticketId/comments
ticketsRouter.get(
  '/:ticketId/comments',
  authenticate,
  validateRequest({ params: ticketIdParam }),
  resolveTicketProject(),
  async (req, res) => {
    const { ticketId } = req.params as TicketIdParam;
    const comments = await commentService.listComments(ticketId);
    res.json(success(comments));
  },
);

// POST /api/tickets/:ticketId/comments  — any project member
ticketsRouter.post(
  '/:ticketId/comments',
  authenticate,
  validateRequest({ params: ticketIdParam, body: createCommentBody }),
  resolveTicketProject(),
  async (req, res) => {
    const { ticketId } = req.params as TicketIdParam;
    const { body } = req.body as CreateCommentBody;
    const comment = await commentService.createComment({
      ticketId, authorId: req.user!.id, body,
    });
    res.status(201).json(success(comment));
  },
);
```

`resolveTicketProject()` already enforces membership (non-member → `FORBIDDEN`), so "any project member can comment" is satisfied with no extra gate.

**What (new router, comment-id-scoped edit/delete):** `comments.routes.ts`:

```ts
// PATCH /api/comments/:commentId  — author only
commentsRouter.patch(
  '/:commentId',
  authenticate,
  validateRequest({ params: commentIdParam, body: updateCommentBody }),
  resolveCommentProject(),
  async (req, res) => {
    const { commentId } = req.params as CommentIdParam;
    const { body } = req.body as UpdateCommentBody;
    const comment = await commentService.updateComment({
      commentId, actingUserId: req.user!.id, body,
    });
    res.json(success(comment));
  },
);

// DELETE /api/comments/:commentId  — author OR admin
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

**Code reference:** the split (list/create under `:ticketId`, point ops by `:id`) mirrors `labels.routes.ts` (list/create on `projectLabelsRouter`, PATCH/DELETE on flat `labelsRouter`); envelope `success(x)` / `201` / `204` from `utils/envelope.ts` and `tickets.routes.ts:65,95,130,200`.

#### 9. App wiring — `backend/src/index.ts`

**What:** Import `commentsRouter` and `app.use('/api/comments', commentsRouter)` next to the existing mounts (`index.ts:101–109`).

### Frontend Changes

#### 10. Types — `frontend/src/types/activity.ts:4–10`

Add `'COMMENT_EDITED'` / `'COMMENT_DELETED'` to the `ActivityAction` union so the typed FE compiles against the new backend values.

#### 11. `describeActivity` — `frontend/src/utils/describeActivity.ts:24–50`

Add cases (no content):
```ts
case 'COMMENT_EDITED':   return 'edited a comment';
case 'COMMENT_DELETED':  return 'deleted a comment';
```
Mirror the table-driven test `describeActivity.test.ts:22–85` with two new rows.

#### 12. API client — `frontend/src/api/tickets.ts` (or new `api/comments.ts`)

**What:** Add four functions routed through the existing `apiFetch<T>` wrapper (`frontend/src/api/client.ts:60`, which auto-unwraps `{data}`, injects the `Authorization: Bearer` token, and coalesces 401 refreshes):

```ts
export interface CommentAuthorDto { id: string | null; fullName: string | null; avatarUrl: string | null; }
export interface CommentDto {
  id: string; ticketId: string; body: string;
  createdAt: string; updatedAt: string; edited: boolean;
  author: CommentAuthorDto;
}
export async function fetchTicketComments(ticketId: string): Promise<CommentDto[]> { /* GET /tickets/:id/comments */ }
export async function createTicketComment(ticketId: string, body: { body: string }): Promise<CommentDto> { /* POST */ }
export async function updateTicketComment(commentId: string, body: { body: string }): Promise<CommentDto> { /* PATCH /comments/:id */ }
export async function deleteTicketComment(commentId: string): Promise<void> { /* DELETE /comments/:id */ }
```

#### 13. Query keys — `frontend/src/api/queryKeys.ts`

Add inside `ticketKeys`:
```ts
comments: (ticketId: string) => [...ticketKeys.all, 'comments', ticketId] as const,
```

#### 14. Hooks — `hooks/useTicketComments.ts`, `hooks/useCommentMutations.ts` (new)

- `useTicketComments(ticketId)` → `useQuery({ queryKey: ticketKeys.comments(ticketId), queryFn: () => fetchTicketComments(ticketId) })`. Refetch on mount gives "refetch-on-open" for free.
- `useCreateComment(ticketId)` → `useMutation` → `onSettled` invalidates `ticketKeys.comments(ticketId)` (and `ticketKeys.activity(ticketId)` so the new COMMENT_EDITED/DELETED entries surface — though create itself emits no activity, leave it for safety).
- `useUpdateComment(ticketId)` / `useDeleteComment(ticketId)` → `useMutation` → `onSettled` invalidates **both** `ticketKeys.comments(ticketId)` and `ticketKeys.activity(ticketId)` (edits/deletes produce activity rows that the Activity tab must reflect).
- Add `meta: { revertMessage }` to each mutation for the toast convention (consumed by `lib/queryClient.ts`).

**Code reference:** `useUpdateTicket.ts:55–60` already invalidates the activity feed on settle — copy that invalidation shape.

#### 15. Components — `CommentsSection.tsx`, `CommentItem.tsx`, `CommentForm.tsx` (new)

**`CommentsSection`** (`{ ticketId, disabled }`): owns the `useTicketComments` query + the three mutations; renders a `<section aria-label="Comments">` with the comment list (`CommentItem` map) below a `CommentForm` (post box), ordered newest-last (`createdAt` ASC — already server-ordered). Show an empty state ("No comments yet") when the list is empty and not loading. When `disabled` (e.g. soft-deleted ticket), hide the post box.

**`CommentItem`** (`{ comment, canEdit, canDelete, onEdit, onDelete }`): row with:
- `<Avatar src={comment.author.avatarUrl} name={comment.author.fullName} size="sm" />` (reuse `components/ui/Avatar.tsx` — single source of truth per F35).
- Author name (`comment.author.fullName ?? 'Unknown user'`).
- Relative time via `formatRelativeTime(comment.createdAt)` with `title={formatDate(comment.createdAt)}` tooltip — mirror `ActivityItem.tsx:21–27`.
- **Edited marker:** when `comment.edited`, show a muted "(edited)" next to the timestamp (and optionally a `title` with `formatDate(comment.updatedAt)`).
- Body text.
- Edit affordance (pencil) when `canEdit`; switches to `CommentForm` in edit mode.
- Delete affordance (trash) when `canDelete`; confirm via the project's existing confirm pattern.

**`CommentForm`** (`{ mode: 'create' | 'edit', initialValue?, onSubmit, onCancel?, submitLabel }`): local `useState` body, `<Textarea maxLength={5000}>` (`components/ui/Textarea.tsx`) + `<Button variant="primary" size="sm" type="submit" disabled={!body.trim() || isPending}>` (`components/ui/Button.tsx`). Mirror `ManualEntryForm.tsx:65–78` (Textarea + Button + non-empty gate).

Gating derived from `useAuthStore((s) => s.user)`:
- `canEdit = user?.id === comment.author.id` (author only).
- `canDelete = user?.id === comment.author.id || user?.isPlatformAdmin || isProjectAdmin`.
- `isProjectAdmin` is not currently held client-side; either (a) add it to the auth user/project context, or (b) rely on the backend `FORBIDDEN` and hide delete by author-or-platform-admin only, allowing project-admin delete attempts to be surfaced after the fact. **Recommended:** expose project membership role client-side (e.g. via the project fetch used by the board) so the UI can show delete for project admins too. (See Open Questions.)

#### 16. Wire into modal — `TicketDetailModal.tsx:223–228`

**What:** Replace the placeholder block:
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
<CommentsSection ticketId={ticket.id} disabled={!!ticket.deletedAt} />
```
Pass `disabled` when the ticket is soft-deleted so members can't comment on deleted tickets.

**Test update:** `TicketDetailModal.test.tsx:495` ("Comments placeholder (SLYK-13 not yet implemented)") must be updated to assert the real `CommentsSection` renders instead.

## Edge Cases & Risks

- **Concurrent edits / race conditions:** two users editing the same comment simultaneously — last write wins (`updatedAt` bumps). Acceptable for comments; no optimistic-concurrency control needed. The author-only edit guard prevents a non-author from editing.
- **Author deleted mid-comment lifetime:** `authorId` is `ON DELETE SET NULL`, so the comment survives with `author = null`. FE renders "Unknown user" (mirror `describeActivity.ts:16–18`); edit/delete gating must treat `null` author as "not the current user" (no edit; delete only for admins).
- **Soft-deleted ticket:** prevent posting to a deleted ticket. `resolveTicketProject()` already authorizes project access; additionally gate on `ticket.deletedAt` in `createComment` (throw `NOT_FOUND`/`CONFLICT`) and pass `disabled` on the FE so the post box is hidden. (Confirm the desired error shape in Open Questions.)
- **Empty/whitespace body:** Zod `min(1)` prevents empty; FE Textarea gate mirrors it. Decide whether to `trim()` server-side (recommended).
- **Project-admin delete UI:** the client must know the current user's project role to show the delete affordance for Project Admins. If role isn't exposed client-side, project-admin delete still works at the API (returns 204) but the button won't show — UX gap. Resolve by surfacing the role client-side.
- **Activity enum extension migration safety:** Postgres `ALTER TYPE … ADD VALUE` is append-only and transaction-safe in modern PG (≥12); drizzle-kit generates the right statement. Ensure the migrator runs against `directDatabaseUrl` (`index.ts:75–95`).
- **No activity on create (per ticket):** posting a comment does **not** create an activity row. If reviewers expect "X commented", add `COMMENT_CREATED` (enum + describeActivity) — flagged in Open Questions.
- **N+1 on list:** `listComments` must `leftJoin(users)` and resolve author info in a single query (mirror `activityService.ts:152–164`), not per-comment.
- **Comment content leak:** ensure `recordActivity` for `COMMENT_EDITED`/`COMMENT_DELETED` passes **no** `oldValue`/`newValue` (defaults to null) and that `enrichActivityRows` returns no content in `message`. The Activity tab and any activity API consumer must never see comment text.
- **Cross-ticket comment-id access:** `resolveCommentProject()` resolves the comment's real ticket → project, so a user can only act on comments of tickets in projects they can access (non-revealing FORBIDDEN). No IDOR.

## Testing

*Follow project conventions — Vitest + supertest (backend) and Vitest + Testing Library (frontend); table-driven tests; one behavior per test; co-locate `*.test.ts(x)` next to source.*

**Backend unit tests — `commentService.test.ts`** (stub the data-access layer per project rules):
- `createComment` inserts and returns a `CommentDto` with `edited: false`.
- `updateComment` throws `FORBIDDEN` for a non-author; succeeds for the author; sets `edited: true` after update; calls `recordActivity(tx, { action: 'COMMENT_EDITED' })` with **null** oldValue/newValue.
- `deleteComment` throws `FORBIDDEN` for a non-author non-admin; succeeds for the author; succeeds for a Platform Admin; succeeds for a Project Admin; calls `recordActivity(tx, { action: 'COMMENT_DELETED' })` with null values; deletes the row.
- `listComments` returns comments ordered `createdAt ASC`; includes author info; throws `NOT_FOUND` when the ticket is missing.

**Backend route/HTTP tests — `comments.routes.test.ts`** (supertest, table-driven where applicable):
- Member can `GET`/`POST` comments; non-member gets `403 FORBIDDEN`.
- Author can `PATCH`/`DELETE` own; non-author gets `403`; admin can `DELETE` others'.
- `POST` with empty body → `400 VALIDATION_FAILED`; `POST` with oversized body → `400`.
- `PATCH`/`DELETE` on an unknown `commentId` → `404 NOT_FOUND`.
- Soft-deleted ticket: `POST` → blocked (4xx per chosen shape).
- Each successful edit/delete produces exactly one activity row of the right action type with null values (assert via the activity service or a direct query in the test).

**Backend activity tests:**
- Extend `describeActivity`-equivalent backend test (if present) or `activityService.test.ts` for `COMMENT_EDITED`/`COMMENT_DELETED` enrichment (no content).

**Frontend tests:**
- `describeActivity.test.ts`: add two table rows for the new actions.
- `CommentsSection.test.tsx`: renders empty state; renders N items; post box hidden when `disabled`; posting calls `createTicketComment` and invalidates `ticketKeys.comments`.
- `CommentItem.test.tsx`: renders author (avatar fallback to initials / "Unknown user"), relative time, "(edited)" marker when `edited`; shows edit only for author; shows delete for author and admin; edit toggles to `CommentForm`.
- `CommentForm.test.tsx`: submit disabled on empty/whitespace; submits trimmed body; cancel restores original in edit mode.
- `TicketDetailModal.test.tsx:495`: replace the placeholder assertion with one for the real `<CommentsSection>`.

**Manual verification:**
- As a Member: open a ticket, post a comment, see it appear (refetch-on-open + post invalidation).
- Edit your own comment → body updates, "(edited)" marker shows, Activity tab gains "edited a comment".
- Delete your own comment → row disappears, Activity tab gains "deleted a comment".
- As a different Member: cannot edit others' comments (no edit button + API 403); cannot delete others' (no delete button).
- As a Project Admin / Platform Admin: can delete any comment (button visible + API 204).
- Reopen the modal → comments reload correctly (persist + refetch).
- Inspect the activity payload (Network/DB) → confirm **no comment body** is present in COMMENT_EDITED/COMMENT_DELETED rows.

## Acceptance Criteria

- [ ] Any project member can `POST /api/tickets/:ticketId/comments` and see the new comment appear; non-members get `403`.
- [ ] Author can `PATCH` their own comment; non-authors get `403`; admins cannot edit others' comments (no edit path for admins).
- [ ] Author OR any admin (Platform Admin / Project Admin) can `DELETE` a comment; others get `403`.
- [ ] Each edit records a `COMMENT_EDITED` activity row; each delete records a `COMMENT_DELETED` activity row — both with **null** oldValue/newValue (no comment content anywhere in the activity log or API).
- [ ] The Activity tab renders "User X edited a comment" / "User X deleted a comment" via `describeActivity`.
- [ ] Comments render below the ticket content in the Details tab (the SLYK-13 placeholder is replaced), newest last, with author avatar/name + timestamp; edited comments are marked "(edited)".
- [ ] Comment list refetches on modal open and after each post/edit/delete.
- [ ] Comments persist and reload correctly on modal reopen.
- [ ] All new/changed units have co-located Vitest tests; existing tests updated (notably `TicketDetailModal.test.tsx:495`).
- [ ] Drizzle migration (`0001_*.sql`) generated via `drizzle-kit generate` and committed under `backend/src/db/migrations`.

## Open Questions

- **Log comment *creation*?** The ticket specifies only edit/delete summary entries. Default: no activity row on create. Confirm with product; if yes, add `COMMENT_CREATED` to the enum and a `describeActivity` case ("X commented").
- **Project-admin role available client-side?** To show the delete button for Project Admins (not just the author and Platform Admin), the FE needs the current user's project role. Is it already exposed (e.g. via the project/board fetch)? If not, expose it. Otherwise fall back to author-or-platform-admin UI gating with project-admin delete enforced only server-side.
- **Max comment length?** Picked `5000` as a placeholder; confirm product preference and keep FE `maxLength` in sync.
- **Soft-deleted-ticket POST error shape?** `NOT_FOUND 'Ticket not found'` vs `CONFLICT 'Ticket is deleted'`. Pick one (lean `NOT_FOUND` for anti-oracle consistency with the rest of the resolver behavior).
- **Trim body server-side?** Recommend `body.trim()` in the service before length/validation, to avoid whitespace-only persisted comments — confirm.

## Out of Scope

- Realtime comment updates (websockets/SSE) — explicitly not required; refetch-on-open + post-mutation invalidation is sufficient.
- @mentions / rich-text / markdown rendering — plain text only.
- Comment threading / replies — flat list only.
- Pagination of the comment list — load all per ticket (tickets are finite-scope; revisit if a ticket ever accumulates thousands).
- Comment reactions / likes.
- Logging comment *creation* to the activity feed (default off; see Open Questions).
