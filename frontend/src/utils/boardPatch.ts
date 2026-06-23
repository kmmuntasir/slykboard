import type { BoardPayload } from '@/types/board';
import type { UpdateTicketDto } from '@/types/ticket';

/**
 * Apply an attribute patch to a board's ticket row (immutable).
 *
 * Spreads title/description/priority from the patch. Skips assigneeId because
 * the board ticket stores the nested `assignee` object (not assigneeId) and
 * resolving it requires a user lookup. The server reconciles the assignee on
 * the next board refetch (onSettled invalidation).
 *
 * Returns the board unchanged if the ticketId is not found.
 */
export function applyPatchToBoard(
  board: BoardPayload,
  ticketId: string,
  patch: UpdateTicketDto,
): BoardPayload {
  let found = false;
  const columns = board.columns.map((column) => {
    const tickets = column.tickets.map((ticket) => {
      if (ticket.id !== ticketId) return ticket;
      found = true;
      const next: typeof ticket = { ...ticket };
      if (patch.title !== undefined) next.title = patch.title;
      if (patch.description !== undefined) next.description = patch.description;
      if (patch.priority !== undefined) next.priority = patch.priority;
      return next;
    });
    return { ...column, tickets };
  });
  return found ? { ...board, columns } : board;
}
