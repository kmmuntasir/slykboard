import type { BoardPayload } from '../types/board';
import type { Ticket } from '../types/ticket';

// F12 D3: new cards land at the BOTTOM of the first column. The backend
// computes position; the FE only needs to append the ticket to the column's
// ticket array (backend already returns the correct position in the Ticket).

// Immutable: returns a NEW BoardPayload with the ticket appended to the
// matching column's tickets array. Does NOT mutate the input.
export function applyCreateToBoard(board: BoardPayload, ticket: Ticket): BoardPayload {
  // The new ticket's statusColumn is columns[0].id (backend default) or a
  // specified column; find the matching column and append. The isUnsorted guard
  // ensures the unsorted bucket is never touched (create never targets it).
  const columns = board.columns.map((column) => {
    if (column.id === ticket.statusColumn && !column.isUnsorted) {
      return { ...column, tickets: [...column.tickets, ticket] };
    }
    return column;
  });
  return { ...board, columns };
}
