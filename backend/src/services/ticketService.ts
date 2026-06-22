import { and, asc, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { projects, tickets } from '../db/schema'
import { AppError } from '../utils/appError'
import { ErrorCode } from '../utils/envelope'
import { UNSORTED_BUCKET_ID } from './boardService'

// F11 D1: doublePrecision midpoint strategy. GAP = spacing between siblings;
// EPSILON = the minimum detectable neighbor gap — below it we rebalance the column.
export const POSITION_GAP = 65536
export const POSITION_EPSILON = 1e-6

export type TicketRow = typeof tickets.$inferSelect

export interface MoveTicketInput {
    ticketId: string
    statusColumn: string
    position: number
}

// True when any adjacent pair in an ASC-ordered position list is closer than EPSILON
// → precision exhausted → whole column must be re-numbered.
function columnNeedsRebalance(positions: number[]): boolean {
    for (let i = 1; i < positions.length; i += 1) {
        const prev = positions[i - 1]!
        const next = positions[i]!
        if (next - prev < POSITION_EPSILON) {
            return true
        }
    }
    return false
}

export async function moveTicket({
    ticketId,
    statusColumn,
    position,
}: MoveTicketInput): Promise<TicketRow> {
    // 1. Load the ticket (404 if absent). Derive projectId from the row.
    const [ticket] = await db
        .select()
        .from(tickets)
        .where(eq(tickets.id, ticketId))
        .limit(1)
    if (!ticket) {
        throw new AppError(ErrorCode.NOT_FOUND, `Ticket '${ticketId}' not found`, {
            details: { ticketId },
        })
    }

    // 2. Load the project's configured columns (JSONB) for membership validation.
    const [project] = await db
        .select({ columns: projects.columns })
        .from(projects)
        .where(eq(projects.id, ticket.projectId))
        .limit(1)
    if (!project) {
        throw new AppError(ErrorCode.NOT_FOUND, `Project for ticket '${ticketId}' not found`, {
            details: { ticketId },
        })
    }

    // 3. Validate statusColumn: must be a real Column.id AND must NOT be the unsorted
    //    sentinel (you cannot persist a card INTO __unsorted__ — it is display-only).
    const columnIds = project.columns.map((column) => column.id)
    if (statusColumn === UNSORTED_BUCKET_ID || !columnIds.includes(statusColumn)) {
        throw new AppError(ErrorCode.VALIDATION_FAILED, `Unknown column '${statusColumn}'`, {
            details: { statusColumn: 'Unknown column' },
        })
    }

    // 4-6. Single Drizzle transaction: write both fields, conditionally rebalance the
    //      destination column, then return the final row. A thrown error inside aborts
    //      the txn (drizzle/pg rollback) — atomicity is structural.
    return db.transaction(async (tx) => {
        await tx
            .update(tickets)
            .set({ statusColumn, position, updatedAt: new Date() })
            .where(eq(tickets.id, ticketId))

        // 5. Re-read the destination column ASC by position; rebalance on tight gap.
        const columnRows = await tx
            .select({ id: tickets.id, position: tickets.position })
            .from(tickets)
            .where(
                and(eq(tickets.projectId, ticket.projectId), eq(tickets.statusColumn, statusColumn)),
            )
            .orderBy(asc(tickets.position))

        if (columnNeedsRebalance(columnRows.map((row) => row.position))) {
            // Re-number the whole column index * GAP in the same txn.
            await Promise.all(
                columnRows.map((row, index) =>
                    tx
                        .update(tickets)
                        .set({ position: index * POSITION_GAP })
                        .where(eq(tickets.id, row.id)),
                ),
            )
        }

        // 6. Return the moved ticket's final state (post any rebalance).
        const [updated] = await tx
            .select()
            .from(tickets)
            .where(eq(tickets.id, ticketId))
            .limit(1)
        return updated!
    })
}
