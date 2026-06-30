import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { comments, tickets, users } from '../db/schema';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { recordActivity } from './activityLogService';

// Canonical tx alias (mirrors ticketService.ts:14 and activityLogService.ts:6).
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// SLYK-13: null-safe author shape. A comment whose author row was deleted
// (authorId FK ON DELETE SET NULL) resolves to the all-null sentinel below so
// the FE can render "Unknown user" uniformly — matches the plan's "deleted
// author -> all-null author object" directive.
export interface CommentAuthorDto {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
}

export interface CommentDto {
  id: string;
  ticketId: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  edited: boolean;
  author: CommentAuthorDto;
}

export type CommentRow = typeof comments.$inferSelect;

// Deleted-author sentinel: all fields null/empty so the FE renders
// "Unknown user" without special-casing the presence of the object.
const UNKNOWN_AUTHOR: CommentAuthorDto = { id: '', fullName: null, avatarUrl: null };

interface JoinedCommentRow {
  id: string;
  ticketId: string;
  authorId: string | null;
  body: string;
  createdAt: Date;
  updatedAt: Date;
  authorFullName: string | null;
  authorAvatarUrl: string | null;
}

function toCommentDto(row: JoinedCommentRow): CommentDto {
  // `edited` is DERIVED — never persisted. A DB trigger or $onUpdate bumping
  // updatedAt on every UPDATE would otherwise mark freshly-created rows edited
  // only if updatedAt drifted past createdAt; defaultNow keeps them equal at
  // insert, so edited is false until a real edit lands.
  const edited = row.updatedAt.getTime() > row.createdAt.getTime();
  const author: CommentAuthorDto =
    row.authorId === null
      ? UNKNOWN_AUTHOR
      : {
          id: row.authorId,
          fullName: row.authorFullName,
          avatarUrl: row.authorAvatarUrl,
        };
  return {
    id: row.id,
    ticketId: row.ticketId,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    edited,
    author,
  };
}

/**
 * SLYK-13: existence check for a NON-soft-deleted ticket. Anti-oracle: a missing
 * ticket and a soft-deleted ticket both surface as a single NOT_FOUND so the
 * client cannot distinguish the two states. Returns true when the ticket is
 * live, false otherwise.
 */
async function ticketIsLive(ticketId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), isNull(tickets.deletedAt)))
    .limit(1);
  return row !== undefined;
}

/**
 * SLYK-13 T6: list all comments for a ticket, oldest first (newest LAST).
 * Single LEFT JOIN users — no N+1. Throws NOT_FOUND when the ticket does not
 * exist (anti-oracle: existence only, soft-delete state is not distinguished).
 */
export async function listComments(ticketId: string): Promise<CommentDto[]> {
  // Existence check (presence only — do NOT reveal soft-delete state here).
  const [exists] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (!exists) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Ticket not found', {
      details: { ticketId },
    });
  }

  const rows: JoinedCommentRow[] = await db
    .select({
      id: comments.id,
      ticketId: comments.ticketId,
      authorId: comments.authorId,
      body: comments.body,
      createdAt: comments.createdAt,
      updatedAt: comments.updatedAt,
      authorFullName: users.fullName,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.ticketId, ticketId))
    .orderBy(asc(comments.createdAt));

  return rows.map(toCommentDto);
}

/**
 * SLYK-13 T6: single-row read by id. Never throws on miss — returns null so the
 * route/resolver layer maps the absence to the appropriate error (NOT_FOUND or
 * a resolver-specific shape). Used to load a comment before an auth-gated mutation.
 */
export async function getComment(commentId: string): Promise<CommentRow | null> {
  const [row] = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
  return row ?? null;
}

/**
 * SLYK-13 T6: create a comment. Gates on ticket existence AND soft-delete
 * (anti-oracle — both surface as the same NOT_FOUND). Trims the body and rejects
 * empty input. NO activity row is written on create — only EDIT and DELETE emit
 * summary-only activity (plan, binding rule). Returns the new CommentDto.
 */
export async function createComment(
  ticketId: string,
  authorId: string,
  bodyRaw: string,
): Promise<CommentDto> {
  // Anti-oracle: a missing OR soft-deleted ticket both look identical to the
  // caller, so the existence state cannot be probed via this endpoint.
  const live = await ticketIsLive(ticketId);
  if (!live) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Ticket not found', {
      details: { ticketId },
    });
  }

  const body = bodyRaw.trim();
  if (body.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'Comment body cannot be empty');
  }

  const [inserted] = await db
    .insert(comments)
    .values({ ticketId, authorId, body })
    .returning();
  if (!inserted) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'Insert returned no comment row');
  }

  // Re-read with the author join so the returned DTO carries the author. A plain
  // returning() yields the comment row only; the join is a single extra query,
  // acceptable on create (write path, not the list hot path).
  const [joined] = await db
    .select({
      id: comments.id,
      ticketId: comments.ticketId,
      authorId: comments.authorId,
      body: comments.body,
      createdAt: comments.createdAt,
      updatedAt: comments.updatedAt,
      authorFullName: users.fullName,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.id, inserted.id))
    .limit(1);
  if (!joined) {
    // Insert succeeded but the row vanished — defensive; treat as internal error.
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'Inserted comment not readable');
  }
  return toCommentDto(joined);
}

/**
 * SLYK-13 T6: update a comment's body. Author-only authorization (a null
 * authorId means the acting user can never be the author -> FORBIDDEN). Trims
 * the body and rejects empty input. Inside db.transaction: update the row then
 * write a single COMMENT_EDITED activity row with oldValue AND newValue null
 * (summary-only — comment CONTENT is NEVER logged). Returns the updated CommentDto.
 */
export async function updateComment(
  commentId: string,
  actingUserId: string,
  bodyRaw: string,
): Promise<CommentDto> {
  const existing = await getComment(commentId);
  if (!existing) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Comment not found', {
      details: { commentId },
    });
  }

  // Author-only. A null authorId (deleted author) can never equal the acting
  // user -> FORBIDDEN, so an orphaned comment cannot be edited by anyone.
  if (existing.authorId !== actingUserId) {
    throw new AppError(ErrorCode.FORBIDDEN, 'You can only edit your own comment');
  }

  const body = bodyRaw.trim();
  if (body.length === 0) {
    throw new AppError(ErrorCode.VALIDATION_FAILED, 'Comment body cannot be empty');
  }

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(comments)
      .set({ body, updatedAt: new Date() })
      .where(eq(comments.id, commentId))
      .returning();
    if (!row) {
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        `Update returned no row for comment '${commentId}'`,
        { details: { commentId } },
      );
    }

    // Summary-only: NEVER log comment content. oldValue AND newValue are both
    // null — the activity feed records only "a comment was edited", not what it
    // said. recordActivity runs inside THIS txn so a rollback discards both.
    await recordActivity(tx, {
      ticketId: existing.ticketId,
      actorId: actingUserId,
      action: 'COMMENT_EDITED',
      oldValue: null,
      newValue: null,
    });

    return row;
  });

  // Re-read with the author join for the DTO (author FK is stable post-update).
  const [joined] = await db
    .select({
      id: comments.id,
      ticketId: comments.ticketId,
      authorId: comments.authorId,
      body: comments.body,
      createdAt: comments.createdAt,
      updatedAt: comments.updatedAt,
      authorFullName: users.fullName,
      authorAvatarUrl: users.avatarUrl,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!joined) {
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'Updated comment not readable');
  }
  return toCommentDto(joined);
}

/**
 * SLYK-13 T6: delete a comment. Authorization matrix: the author OR any admin
 * (platform OR project). A null authorId cannot match the acting user, so only
 * admins may delete an orphaned comment. Inside db.transaction: delete the row
 * then write a single COMMENT_DELETED activity row with oldValue AND newValue
 * null (summary-only — comment CONTENT is NEVER logged). Returns the deleted id.
 */
export async function deleteComment(
  commentId: string,
  actingUserId: string,
  isPlatformAdmin: boolean,
  isProjectAdmin: boolean,
): Promise<{ id: string }> {
  const existing = await getComment(commentId);
  if (!existing) {
    throw new AppError(ErrorCode.NOT_FOUND, 'Comment not found', {
      details: { commentId },
    });
  }

  const isAuthor = existing.authorId !== null && existing.authorId === actingUserId;
  const isAdmin = isPlatformAdmin || isProjectAdmin;
  if (!isAuthor && !isAdmin) {
    throw new AppError(ErrorCode.FORBIDDEN, 'You can only delete your own comment');
  }

  return db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(comments)
      .where(eq(comments.id, commentId))
      .returning({ id: comments.id });
    if (!deleted) {
      throw new AppError(
        ErrorCode.INTERNAL_ERROR,
        `Delete returned no row for comment '${commentId}'`,
        { details: { commentId } },
      );
    }

    // Summary-only: NEVER log comment content. oldValue AND newValue are both
    // null — the feed records only "a comment was deleted". Inside THIS txn.
    await recordActivity(tx, {
      ticketId: existing.ticketId,
      actorId: actingUserId,
      action: 'COMMENT_DELETED',
      oldValue: null,
      newValue: null,
    });

    return deleted;
  });
}
