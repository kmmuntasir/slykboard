import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { tickets, timeEntries, users } from '../db/schema';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// Local alias mirroring ticketService.ts — the drizzle tx client type.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type TimeEntry = typeof timeEntries.$inferSelect;

// F20: map a PG 23505 (unique_violation) raised by the partial unique index
// time_entries_one_active into a 409 CONFLICT AppError. Drizzle rethrows the
// raw pg error; we inspect its `code` to distinguish it from other failures.
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}

// F20 §9.1: start a timer on a ticket. Runs auto-stop + existence check + insert
// in ONE transaction so the partial unique index (one active timer per user)
// cannot be violated mid-sequence. serverNow is captured post-commit so the
// client clock-skew baseline reflects the moment the row became durable.
export async function startTimer(args: {
  ticketId: string;
  userId: string;
}): Promise<{ entry: TimeEntry; serverNow: string }> {
  const { ticketId, userId } = args;

  return db
    .transaction(async (tx) => {
      // (a) Auto-stop the user's prior open timer (user-scoped, global — any ticket).
      await tx
        .update(timeEntries)
        .set({ endTime: new Date() })
        .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)));

      // (b) Verify the ticket exists (and is not soft-deleted) before inserting.
      const ticketRows = await tx
        .select({ id: tickets.id })
        .from(tickets)
        .where(eq(tickets.id, ticketId))
        .limit(1);
      if (ticketRows.length === 0) {
        throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${ticketId}' not found`, {
          details: { ticketId },
        });
      }

      // (c) Insert the new open timer.
      const [inserted] = await tx
        .insert(timeEntries)
        .values({ userId, ticketId, startTime: new Date() })
        .returning();
      return inserted!;
    })
    .catch((err: unknown) => {
      if (isUniqueViolation(err)) {
        throw new AppError(ErrorCode.CONFLICT, 'Timer already active', { cause: err });
      }
      throw err;
    })
    .then((entry) => ({ entry, serverNow: new Date().toISOString() }));
}

// F20 §9.5: stop the active timer on a ticket. Admin may stop any; a Member may
// only stop their own. Closes by id (not by ticketId) and re-guards on
// endTime IS NULL to defend against a concurrent stop closing it first.
export async function stopTimer(args: {
  ticketId: string;
  userId: string;
  isAdmin: boolean;
}): Promise<TimeEntry> {
  const { ticketId, userId, isAdmin } = args;

  const [active] = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.ticketId, ticketId), isNull(timeEntries.endTime)))
    .limit(1);
  if (!active) {
    throw new AppError(ErrorCode.NOT_FOUND, 'No running timer on this ticket', {
      details: { ticketId },
    });
  }
  if (active.userId !== userId && !isAdmin) {
    throw new AppError(ErrorCode.FORBIDDEN, 'You can only stop your own timer');
  }

  const [closed] = await db
    .update(timeEntries)
    .set({ endTime: new Date() })
    .where(and(eq(timeEntries.id, active.id), isNull(timeEntries.endTime)))
    .returning();
  if (!closed) {
    // Race guard: a concurrent stop closed this timer between our read and write.
    throw new AppError(ErrorCode.NOT_FOUND, 'No running timer on this ticket');
  }
  return closed;
}

// F20: return the current user's single global open timer, or null if none.
// The partial unique index guarantees at most one open row per user.
export async function getActiveTimer(userId: string): Promise<TimeEntry | null> {
  const rows = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, userId), isNull(timeEntries.endTime)))
    .limit(1);
  return rows[0] ?? null;
}

// F17 hook (§9.3): close any running timer on a ticket before soft-delete.
// Runs inside the caller's transaction; NO permission check (delete is admin-only).
export async function stopTimerForTicket(tx: Tx, ticketId: string): Promise<void> {
  await tx
    .update(timeEntries)
    .set({ endTime: new Date() })
    .where(and(eq(timeEntries.ticketId, ticketId), isNull(timeEntries.endTime)));
}

// F20: time-tracking log. All TimeEntries for a ticket, reverse-chrono, with
// computed per-entry durations and a total of closed durations (the running
// entry is excluded from the total — its elapsed time is still accruing).
export interface TimeEntryWithDuration {
  id: string;
  startTime: string; // ISO
  endTime: string | null; // null = still running
  durationMs: number | null; // null if running; else end - start (or minutes*60000 for manual)
  description: string | null;
  type: 'manual' | 'timer';
  user: { id: string; fullName: string; avatarUrl: string | null } | null;
}

export interface TimeEntriesResponse {
  entries: TimeEntryWithDuration[];
  totalMs: number; // sum of all closed durations (running entry excluded)
}

export async function getTimeEntries(ticketId: string): Promise<TimeEntriesResponse> {
  const rows = await db
    .select({
      id: timeEntries.id,
      startTime: timeEntries.startTime,
      endTime: timeEntries.endTime,
      manualEntryMinutes: timeEntries.manualEntryMinutes,
      description: timeEntries.description,
      userId: users.id,
      userFullName: users.fullName,
      userAvatarUrl: users.avatarUrl,
    })
    .from(timeEntries)
    .leftJoin(users, eq(users.id, timeEntries.userId))
    .where(eq(timeEntries.ticketId, ticketId))
    .orderBy(desc(timeEntries.startTime));

  const entries: TimeEntryWithDuration[] = rows.map((r) => {
    const isManual = r.manualEntryMinutes !== null;
    const durationMs = isManual
      ? (r.manualEntryMinutes ?? 0) * 60_000
      : r.endTime
        ? r.endTime.getTime() - r.startTime.getTime()
        : null;
    return {
      id: r.id,
      startTime: r.startTime.toISOString(),
      endTime: r.endTime?.toISOString() ?? null,
      durationMs,
      description: r.description,
      type: isManual ? 'manual' : 'timer',
      user:
        r.userId === null
          ? null
          : {
              id: r.userId,
              fullName: r.userFullName ?? 'Unknown user',
              avatarUrl: r.userAvatarUrl,
            },
    };
  });

  const totalMs = entries
    .filter((e) => e.durationMs !== null)
    .reduce((sum, e) => sum + (e.durationMs ?? 0), 0);

  return { entries, totalMs };
}

// F21 §9.1: log time without running the timer. Inserts a completed row with
// manualEntryMinutes set and start/end stamped to the same instant (the schema's
// startTime NOT NULL + the one-active-per-user partial index forbid null end;
// the duration is carried solely by manualEntryMinutes, not the wall-clock span).
export async function addManualEntry(args: {
  ticketId: string;
  userId: string;
  minutes: number;
  description?: string;
}): Promise<TimeEntryWithDuration> {
  const { ticketId, userId, minutes, description } = args;

  const ticketRows = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1);
  if (ticketRows.length === 0) {
    throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${ticketId}' not found`, {
      details: { ticketId },
    });
  }

  const now = new Date();
  const [row] = await db
    .insert(timeEntries)
    .values({
      ticketId,
      userId,
      startTime: now,
      endTime: now,
      manualEntryMinutes: minutes,
      description: description ?? null,
    })
    .returning({
      id: timeEntries.id,
      startTime: timeEntries.startTime,
      endTime: timeEntries.endTime,
      manualEntryMinutes: timeEntries.manualEntryMinutes,
      description: timeEntries.description,
    });

  // F22: resolve the author so manual entries carry the same user shape as timer entries.
  const [userRow] = await db
    .select({ fullName: users.fullName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = userRow
    ? { id: userId, fullName: userRow.fullName, avatarUrl: userRow.avatarUrl }
    : null;

  return {
    id: row!.id,
    startTime: row!.startTime.toISOString(),
    endTime: row!.endTime?.toISOString() ?? null,
    durationMs: (row!.manualEntryMinutes ?? 0) * 60_000,
    description: row!.description,
    type: 'manual',
    user,
  };
}
