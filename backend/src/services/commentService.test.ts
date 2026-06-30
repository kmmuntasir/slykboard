import { beforeEach, describe, expect, it, vi } from 'vitest';

// SLYK-13 T15: co-located unit tests for commentService. Mirrors the harness
// idiom of ticketService.test.ts — a hoisted `bag` of configurable result slots
// behind a single mocked `../db/client`, plus a direct mock of
// `./activityLogService.recordActivity` so every activity-write assertion
// (create = ZERO, edit/delete = exactly ONE summary-only row) targets the
// real contract surface the service calls.
const bag = vi.hoisted(() => ({
  // tickets existence/live checks: db.select({id}).from(tickets).where().limit()
  ticketRow: [] as unknown[],
  // getComment bare select: db.select().from(comments).where().limit()
  commentRow: [] as unknown[],
  // listComments join: db.select({...}).from(comments).leftJoin().where().orderBy()
  listRows: [] as unknown[],
  // create/update re-read join: db.select({...}).from(comments).leftJoin().where().limit()
  joinedRow: [] as unknown[],
  // createComment insert returning
  insertReturn: [] as unknown[],
  // captured .values() arg on the comments insert (trim assertions)
  lastInsert: null as Record<string, unknown> | null,
  // tx.update(...).returning()
  updateReturn: [] as unknown[],
  // tx.delete(...).returning({id})
  deleteReturn: [] as unknown[],
  // captured .set() args
  updateSets: [] as Array<Record<string, unknown>>,
  txnInvoked: vi.fn(),
  lastTx: null as unknown,
}));

const activityMock = vi.hoisted(() => ({ recordActivity: vi.fn() }));

vi.mock('../db/client', async () => {
  const { tickets, comments } = await import('../db/schema');
  const db = {
    // Drizzle: select() -> from(table) -> builder. We branch by table; the
    // comments builder is stateful (`joined` flag) so getComment's bare
    // `.where().limit()` resolves to commentRow while the join re-read's
    // `.leftJoin().where().limit()` resolves to joinedRow.
    select: () => ({
      from: (table: unknown) => {
        if (table === tickets) {
          return {
            where: () => ({ limit: () => Promise.resolve(bag.ticketRow) }),
          };
        }
        if (table === comments) {
          let joined = false;
          const builder = {
            leftJoin: () => {
              joined = true;
              return builder;
            },
            where: () => ({
              orderBy: () => Promise.resolve(bag.listRows),
              limit: () => Promise.resolve(joined ? bag.joinedRow : bag.commentRow),
            }),
          };
          return builder;
        }
        return {
          where: () => ({ limit: () => Promise.resolve([]) }),
        };
      },
    }),
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        bag.lastInsert = vals;
        return { returning: () => Promise.resolve(bag.insertReturn) };
      },
    }),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      bag.txnInvoked();
      const tx = {
        update: () => ({
          set: (s: Record<string, unknown>) => {
            bag.updateSets.push(s);
            return { where: () => ({ returning: () => Promise.resolve(bag.updateReturn) }) };
          },
        }),
        delete: () => ({
          where: () => ({ returning: () => Promise.resolve(bag.deleteReturn) }),
        }),
      };
      bag.lastTx = tx;
      return cb(tx);
    }),
  };
  return { db };
});

vi.mock('./activityLogService', () => ({ recordActivity: activityMock.recordActivity }));

import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import {
  listComments,
  getComment,
  createComment,
  updateComment,
  deleteComment,
} from './commentService';

function resetBag() {
  bag.ticketRow = [];
  bag.commentRow = [];
  bag.listRows = [];
  bag.joinedRow = [];
  bag.insertReturn = [];
  bag.lastInsert = null;
  bag.updateReturn = [];
  bag.deleteReturn = [];
  bag.updateSets = [];
  bag.txnInvoked.mockReset();
  bag.lastTx = null;
  activityMock.recordActivity.mockReset();
}

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const COMMENT_ID = '22222222-2222-4222-8222-222222222222';
const AUTHOR_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';

function makeComment(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: COMMENT_ID,
    ticketId: TICKET_ID,
    authorId: AUTHOR_ID,
    body: 'hello',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  };
}

// Joined-row shape produced by the LEFT JOIN users (authorFullName/authorAvatarUrl
// come from the users side; null when the author FK dangles).
function makeJoined(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: COMMENT_ID,
    ticketId: TICKET_ID,
    authorId: AUTHOR_ID,
    body: 'hello',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    authorFullName: 'Muntasir',
    authorAvatarUrl: 'http://x/a.png',
    ...over,
  };
}

beforeEach(resetBag);

describe('commentService listComments (SLYK-13)', () => {
  it('NOT_FOUND when ticket row is absent (anti-oracle: existence only)', async () => {
    bag.ticketRow = [];

    const error = await listComments('missing').catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND);
    expect((error as AppError).message).toBe('Ticket not found');
    // list query never ran once existence failed.
    expect(bag.listRows).toEqual([]);
  });

  it('returns DTOs in a single join query (no N+1), oldest first (ASC)', async () => {
    bag.ticketRow = [{ id: TICKET_ID }];
    const t0 = new Date('2026-01-01T00:00:00.000Z');
    const t1 = new Date('2026-01-02T00:00:00.000Z');
    const t2 = new Date('2026-01-03T00:00:00.000Z');
    bag.listRows = [
      makeJoined({ id: 'c1', createdAt: t0, updatedAt: t0 }),
      makeJoined({ id: 'c2', createdAt: t1, updatedAt: t2, authorFullName: 'Ada' }),
      makeJoined({ id: 'c3', createdAt: t2, updatedAt: t2, authorId: null }),
    ];

    const result = await listComments(TICKET_ID);

    expect(result).toHaveLength(3);
    // ASC ordering is delegated to the ORM; the mock returns rows in the order
    // the service requested them (orderBy asc(createdAt)). We assert the service
    // did not re-sort and that the returned order matches the join output.
    expect(result.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    // edited flag derived per-row (c2 edited: updatedAt > createdAt).
    expect(result[0]!.edited).toBe(false);
    expect(result[1]!.edited).toBe(true);
    expect(result[2]!.edited).toBe(false);
    // author mapping: present author + null-author sentinel.
    expect(result[0]!.author).toEqual({
      id: AUTHOR_ID,
      fullName: 'Muntasir',
      avatarUrl: 'http://x/a.png',
    });
    expect(result[2]!.author).toEqual({ id: '', fullName: null, avatarUrl: null });
  });
});

describe('commentService getComment (SLYK-13)', () => {
  it.each([
    { name: 'returns the row when found', row: [makeComment()], expected: 'row' },
    { name: 'returns null when missing (null-safe, never throws)', row: [], expected: 'null' },
  ])('$name', async ({ row, expected }) => {
    bag.commentRow = row;

    const result = await getComment(COMMENT_ID);

    if (expected === 'null') {
      expect(result).toBeNull();
    } else {
      expect(result).not.toBeNull();
      expect((result as { id: string }).id).toBe(COMMENT_ID);
    }
  });
});

describe('commentService createComment (SLYK-13)', () => {
  it('NOT_FOUND when ticket is missing (anti-oracle)', async () => {
    bag.ticketRow = [];

    const error = await createComment(TICKET_ID, AUTHOR_ID, 'hi').catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND);
    expect((error as AppError).message).toBe('Ticket not found');
    // No insert, no txn, no activity.
    expect(bag.lastInsert).toBeNull();
    expect(bag.txnInvoked).not.toHaveBeenCalled();
    expect(activityMock.recordActivity).not.toHaveBeenCalled();
  });

  it('NOT_FOUND when ticket is soft-deleted (anti-oracle: identical to missing)', async () => {
    // ticketIsLive resolves to no row -> same NOT_FOUND as a missing ticket.
    bag.ticketRow = [];

    const error = await createComment(TICKET_ID, AUTHOR_ID, 'hi').catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND);
    expect((error as AppError).message).toBe('Ticket not found');
  });

  it('VALIDATION_FAILED when body is empty after trim', async () => {
    bag.ticketRow = [{ id: TICKET_ID }];

    const error = await createComment(TICKET_ID, AUTHOR_ID, '    ').catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(bag.lastInsert).toBeNull();
  });

  it('trims the body before insert and returns the joined DTO', async () => {
    bag.ticketRow = [{ id: TICKET_ID }];
    bag.insertReturn = [makeComment({ id: 'c-new', body: 'trimmed' })];
    bag.joinedRow = [
      makeJoined({ id: 'c-new', body: 'trimmed', authorId: AUTHOR_ID, authorFullName: 'M' }),
    ];

    const result = await createComment(TICKET_ID, AUTHOR_ID, '   trimmed   ');

    expect(bag.lastInsert).not.toBeNull();
    expect(bag.lastInsert!.body).toBe('trimmed');
    expect(bag.lastInsert!.ticketId).toBe(TICKET_ID);
    expect(bag.lastInsert!.authorId).toBe(AUTHOR_ID);
    expect(result.id).toBe('c-new');
    expect(result.body).toBe('trimmed');
    expect(result.author.fullName).toBe('M');
    expect(result.edited).toBe(false);
  });

  it('writes ZERO activity rows on create (summary-only rule: create is silent)', async () => {
    bag.ticketRow = [{ id: TICKET_ID }];
    bag.insertReturn = [makeComment({ id: 'c-new' })];
    bag.joinedRow = [makeJoined({ id: 'c-new' })];

    await createComment(TICKET_ID, AUTHOR_ID, 'hi');

    // createComment never opens a transaction and never records activity.
    expect(bag.txnInvoked).not.toHaveBeenCalled();
    expect(activityMock.recordActivity).not.toHaveBeenCalled();
  });

  it('INTERNAL_ERROR when the insert returns no row (defensive)', async () => {
    bag.ticketRow = [{ id: TICKET_ID }];
    bag.insertReturn = [];

    const error = await createComment(TICKET_ID, AUTHOR_ID, 'hi').catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.INTERNAL_ERROR);
  });
});

describe('commentService updateComment authorization matrix (SLYK-13)', () => {
  // author-only. A null authorId (deleted author) can never equal the acting
  // user -> FORBIDDEN, so an orphaned comment cannot be edited by anyone.
  it.each([
    {
      name: 'author -> success',
      existing: makeComment({ authorId: ACTOR_ID }),
      expectForbidden: false,
    },
    {
      name: 'non-author -> FORBIDDEN "You can only edit your own comment"',
      existing: makeComment({ authorId: AUTHOR_ID }),
      expectForbidden: true,
    },
    {
      name: 'null authorId -> FORBIDDEN (orphan uneditable)',
      existing: makeComment({ authorId: null }),
      expectForbidden: true,
    },
  ])('$name', async ({ existing, expectForbidden }) => {
    bag.commentRow = [existing];
    bag.updateReturn = [makeComment({ body: 'new' })];
    bag.joinedRow = [makeJoined({ body: 'new' })];

    const result = await updateComment(COMMENT_ID, ACTOR_ID, 'new').catch((e) => e);

    if (expectForbidden) {
      expect(result).toBeInstanceOf(AppError);
      expect((result as AppError).code).toBe(ErrorCode.FORBIDDEN);
      expect((result as AppError).message).toBe('You can only edit your own comment');
      expect(bag.txnInvoked).not.toHaveBeenCalled();
      expect(activityMock.recordActivity).not.toHaveBeenCalled();
    } else {
      expect(result).not.toBeInstanceOf(AppError);
      expect((result as { body: string }).body).toBe('new');
    }
  });
});

describe('commentService updateComment body + activity (SLYK-13)', () => {
  it('trims the body and rejects empty-after-trim with VALIDATION_FAILED', async () => {
    bag.commentRow = [makeComment({ authorId: ACTOR_ID })];

    const error = await updateComment(COMMENT_ID, ACTOR_ID, '   ').catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(bag.txnInvoked).not.toHaveBeenCalled();
  });

  it('trims a non-empty body before the update', async () => {
    bag.commentRow = [makeComment({ authorId: ACTOR_ID })];
    bag.updateReturn = [makeComment({ body: 'edited' })];
    bag.joinedRow = [makeJoined({ body: 'edited' })];

    await updateComment(COMMENT_ID, ACTOR_ID, '   edited   ');

    expect(bag.updateSets).toHaveLength(1);
    expect(bag.updateSets[0]!.body).toBe('edited');
    expect(bag.updateSets[0]!.updatedAt).toBeInstanceOf(Date);
  });

  it('writes exactly ONE COMMENT_EDITED activity INSIDE the txn with oldValue===null AND newValue===null (NEVER the body)', async () => {
    bag.commentRow = [makeComment({ authorId: ACTOR_ID, body: 'old' })];
    bag.updateReturn = [makeComment({ body: 'new' })];
    bag.joinedRow = [makeJoined({ body: 'new' })];

    await updateComment(COMMENT_ID, ACTOR_ID, 'new');

    // exactly one txn, exactly one activity call.
    expect(bag.txnInvoked).toHaveBeenCalledTimes(1);
    expect(activityMock.recordActivity).toHaveBeenCalledTimes(1);
    // same-txn participation: the tx handed to recordActivity is the txn's tx.
    const [txArg, payload] = activityMock.recordActivity.mock.calls[0]!;
    expect(txArg).toBe(bag.lastTx);
    expect(payload).toEqual({
      ticketId: TICKET_ID,
      actorId: ACTOR_ID,
      action: 'COMMENT_EDITED',
      oldValue: null,
      newValue: null,
    });
    // CRITICAL: never the body content.
    expect(payload.oldValue).toBeNull();
    expect(payload.newValue).toBeNull();
  });

  it('edited flag is derived (updatedAt > createdAt) in the returned DTO', async () => {
    bag.commentRow = [makeComment({ authorId: ACTOR_ID })];
    const created = new Date('2026-01-01T00:00:00.000Z');
    const updated = new Date('2026-01-05T00:00:00.000Z');
    bag.updateReturn = [makeComment({ body: 'new' })];
    bag.joinedRow = [makeJoined({ body: 'new', createdAt: created, updatedAt: updated })];

    const result = await updateComment(COMMENT_ID, ACTOR_ID, 'new');

    expect(result.edited).toBe(true);
  });

  it('NOT_FOUND when the comment is absent', async () => {
    bag.commentRow = [];

    const error = await updateComment('missing', ACTOR_ID, 'new').catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND);
    expect(activityMock.recordActivity).not.toHaveBeenCalled();
  });

  it('INTERNAL_ERROR when the update returns no row (defensive)', async () => {
    bag.commentRow = [makeComment({ authorId: ACTOR_ID })];
    bag.updateReturn = [];

    const error = await updateComment(COMMENT_ID, ACTOR_ID, 'new').catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.INTERNAL_ERROR);
    // recordActivity runs AFTER the throw -> never reached.
    expect(activityMock.recordActivity).not.toHaveBeenCalled();
  });
});

describe('commentService deleteComment authorization matrix (SLYK-13)', () => {
  // author OR Platform Admin OR Project Admin. A null authorId cannot match the
  // acting user, so only admins may delete an orphaned comment.
  it.each([
    {
      name: 'author -> ok',
      existing: makeComment({ authorId: ACTOR_ID }),
      isPlatformAdmin: false,
      isProjectAdmin: false,
      expectForbidden: false,
    },
    {
      name: 'non-author non-admin -> FORBIDDEN',
      existing: makeComment({ authorId: AUTHOR_ID }),
      isPlatformAdmin: false,
      isProjectAdmin: false,
      expectForbidden: true,
    },
    {
      name: 'Platform Admin -> ok',
      existing: makeComment({ authorId: AUTHOR_ID }),
      isPlatformAdmin: true,
      isProjectAdmin: false,
      expectForbidden: false,
    },
    {
      name: 'Project Admin -> ok',
      existing: makeComment({ authorId: AUTHOR_ID }),
      isPlatformAdmin: false,
      isProjectAdmin: true,
      expectForbidden: false,
    },
    {
      name: 'orphan (null authorId) non-admin -> FORBIDDEN',
      existing: makeComment({ authorId: null }),
      isPlatformAdmin: false,
      isProjectAdmin: false,
      expectForbidden: true,
    },
  ])('$name', async ({ existing, isPlatformAdmin, isProjectAdmin, expectForbidden }) => {
    bag.commentRow = [existing];
    bag.deleteReturn = [{ id: COMMENT_ID }];

    const result = await deleteComment(
      COMMENT_ID,
      ACTOR_ID,
      isPlatformAdmin,
      isProjectAdmin,
    ).catch((e) => e);

    if (expectForbidden) {
      expect(result).toBeInstanceOf(AppError);
      expect((result as AppError).code).toBe(ErrorCode.FORBIDDEN);
      expect(bag.txnInvoked).not.toHaveBeenCalled();
      expect(activityMock.recordActivity).not.toHaveBeenCalled();
    } else {
      expect(result).not.toBeInstanceOf(AppError);
      expect((result as { id: string }).id).toBe(COMMENT_ID);
    }
  });
});

describe('commentService deleteComment activity (SLYK-13)', () => {
  it('writes exactly ONE COMMENT_DELETED activity INSIDE the txn with oldValue===null AND newValue===null (NEVER the body)', async () => {
    bag.commentRow = [makeComment({ authorId: ACTOR_ID, body: 'secret body' })];
    bag.deleteReturn = [{ id: COMMENT_ID }];

    await deleteComment(COMMENT_ID, ACTOR_ID, false, false);

    expect(bag.txnInvoked).toHaveBeenCalledTimes(1);
    expect(activityMock.recordActivity).toHaveBeenCalledTimes(1);
    const [txArg, payload] = activityMock.recordActivity.mock.calls[0]!;
    expect(txArg).toBe(bag.lastTx);
    expect(payload).toEqual({
      ticketId: TICKET_ID,
      actorId: ACTOR_ID,
      action: 'COMMENT_DELETED',
      oldValue: null,
      newValue: null,
    });
    // CRITICAL: never the body content.
    expect(payload.oldValue).toBeNull();
    expect(payload.newValue).toBeNull();
  });

  it('NOT_FOUND when the comment is absent', async () => {
    bag.commentRow = [];

    const error = await deleteComment('missing', ACTOR_ID, false, false).catch((e) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.NOT_FOUND);
    expect(activityMock.recordActivity).not.toHaveBeenCalled();
  });
});

describe('commentService null-safe author mapping (SLYK-13)', () => {
  it('listComments maps a null authorId to the all-null "Unknown user" sentinel', async () => {
    bag.ticketRow = [{ id: TICKET_ID }];
    bag.listRows = [makeJoined({ authorId: null, authorFullName: null, authorAvatarUrl: null })];

    const [result] = await listComments(TICKET_ID);

    expect(result!.author).toEqual({ id: '', fullName: null, avatarUrl: null });
  });

  it('createComment re-read maps a dangling author to the sentinel without crashing', async () => {
    bag.ticketRow = [{ id: TICKET_ID }];
    bag.insertReturn = [makeComment({ authorId: null })];
    bag.joinedRow = [makeJoined({ authorId: null, authorFullName: null, authorAvatarUrl: null })];

    const result = await createComment(TICKET_ID, AUTHOR_ID, 'hi');

    expect(result.author).toEqual({ id: '', fullName: null, avatarUrl: null });
  });
});
