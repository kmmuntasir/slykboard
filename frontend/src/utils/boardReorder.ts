import type { BoardPayload } from '../types/board';
import type { Ticket } from '../types/ticket';

// F11 D1: midpoint insertion over the existing doublePrecision position column.
// The board read path already sorts by position ASC; each reorder picks a
// position between the moved ticket's new neighbours so a drop typically
// updates a single row. A column rebalance fires only when a gap exhausts
// POSITION_EPSILON (~50 mid-inserts between the same neighbours).
export const POSITION_GAP = 65536;
export const POSITION_EPSILON = 1e-6;

export interface MoveDescriptor {
  ticketId: string;
  srcColumnId: string;
  srcIndex: number;
  dstColumnId: string;
  dstIndex: number;
}

// Index into the destination column EXCLUDING the moved ticket, then apply the
// D1 rules: prepend = first - GAP; append = last + GAP; mid = midpoint of the
// two neighbours; into-empty column = 0.
export function computeDestinationPosition(board: BoardPayload, move: MoveDescriptor): number {
  const dstColumn = board.columns.find((column) => column.id === move.dstColumnId);
  if (!dstColumn) {
    return 0;
  }

  // Neighbours are the destination list with the moved ticket removed, so a
  // same-column move computes its position against the post-removal slot.
  const neighbours = dstColumn.tickets.filter((ticket) => ticket.id !== move.ticketId);
  const clampedIndex = Math.max(0, Math.min(move.dstIndex, neighbours.length));
  const prev = clampedIndex > 0 ? neighbours[clampedIndex - 1] : undefined;
  const next = clampedIndex < neighbours.length ? neighbours[clampedIndex] : undefined;

  if (prev && next) {
    return (prev.position + next.position) / 2;
  }
  if (prev) {
    return prev.position + POSITION_GAP; // append after the last neighbour
  }
  if (next) {
    return next.position - POSITION_GAP; // prepend before the first neighbour
  }
  return 0; // into-empty column
}

// Immutable: returns a NEW BoardPayload. The moved ticket is spliced out of its
// source column and inserted into the destination column at dstIndex with its
// position set via computeDestinationPosition. The input board is never mutated.
export function applyMoveToBoard(board: BoardPayload, move: MoveDescriptor): BoardPayload {
  const srcColumn = board.columns.find((column) => column.id === move.srcColumnId);
  const movedTicket = srcColumn?.tickets.find((ticket) => ticket.id === move.ticketId);
  if (!movedTicket) {
    return board; // ticket absent -> idempotent no-op
  }

  const position = computeDestinationPosition(board, move);
  const relocated: Ticket = { ...movedTicket, position };

  return {
    ...board,
    columns: board.columns.map((column) => {
      const isSource = column.id === move.srcColumnId;
      const isDestination = column.id === move.dstColumnId;

      if (isSource && isDestination) {
        // Same column: remove the ticket, then insert it back at dstIndex.
        const reordered = column.tickets.filter((ticket) => ticket.id !== move.ticketId);
        const nextTickets = [...reordered];
        nextTickets.splice(move.dstIndex, 0, relocated);
        return { ...column, tickets: nextTickets };
      }
      if (isSource) {
        return {
          ...column,
          tickets: column.tickets.filter((ticket) => ticket.id !== move.ticketId),
        };
      }
      if (isDestination) {
        const nextTickets = [...column.tickets];
        nextTickets.splice(move.dstIndex, 0, relocated);
        return { ...column, tickets: nextTickets };
      }
      return column;
    }),
  };
}

// True when any adjacent pair in the (assumed-ascending) position list has a gap
// below POSITION_EPSILON -- the signal the backend uses to trigger a rebalance.
export function needsRebalance(positions: number[]): boolean {
  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1];
    const curr = positions[i];
    if (prev !== undefined && curr !== undefined && curr - prev < POSITION_EPSILON) {
      return true;
    }
  }
  return false;
}
