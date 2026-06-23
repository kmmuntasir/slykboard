import { describe, expect, it } from 'vitest';
import {
  POSITION_EPSILON,
  POSITION_GAP,
  applyMoveToBoard,
  computeDestinationPosition,
  needsRebalance,
  type MoveDescriptor,
} from './boardReorder';
import type { BoardPayload } from '../types/board';
import type { Priority } from '../types/ticket';

// Minimal ticket seat: id + explicit position (the only fields that matter to
// the reorder math).
interface Seat {
  id: string;
  position: number;
}

function buildBoard(columns: { id: string; tickets: Seat[] }[]): BoardPayload {
  return {
    project: { id: 'p1', name: 'Project', slug: 'project' },
    columns: columns.map((column) => ({
      id: column.id,
      name: column.id,
      isUnsorted: false,
      tickets: column.tickets.map((seat) => makeTicket(seat, column.id)),
    })),
  };
}

function makeTicket(seat: Seat, statusColumn: string) {
  return {
    id: seat.id,
    ticketNumber: Number(seat.id.replace(/\D/g, '') || '0'),
    title: seat.id,
    description: null,
    statusColumn,
    position: seat.position,
    priority: 'LOW' as Priority,
    labels: [],
    checklist: [],
    assignee: null,
    creator: null,
    creatorId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

// Shared board: c1 = [t1@0, t2@GAP, t3@2*GAP]; empty = [].
function sharedBoard(): BoardPayload {
  return buildBoard([
    {
      id: 'c1',
      tickets: [
        { id: 't1', position: 0 },
        { id: 't2', position: POSITION_GAP },
        { id: 't3', position: POSITION_GAP * 2 },
      ],
    },
    { id: 'empty', tickets: [] },
  ]);
}

describe('computeDestinationPosition', () => {
  const cases: Array<{ name: string; move: MoveDescriptor; expected: number }> = [
    {
      name: 'prepend -> first.position - GAP',
      move: { ticketId: 'tx', srcColumnId: 'c1', srcIndex: 0, dstColumnId: 'c1', dstIndex: 0 },
      expected: -POSITION_GAP,
    },
    {
      name: 'append -> last.position + GAP',
      move: { ticketId: 'tx', srcColumnId: 'c1', srcIndex: 0, dstColumnId: 'c1', dstIndex: 3 },
      expected: POSITION_GAP * 3,
    },
    {
      name: 'mid-insert -> midpoint of neighbours',
      move: { ticketId: 'tx', srcColumnId: 'c1', srcIndex: 0, dstColumnId: 'c1', dstIndex: 1 },
      expected: POSITION_GAP / 2,
    },
    {
      name: 'into-empty column -> 0',
      move: { ticketId: 'tx', srcColumnId: 'c1', srcIndex: 0, dstColumnId: 'empty', dstIndex: 0 },
      expected: 0,
    },
    {
      name: 'unknown destination column -> 0',
      move: { ticketId: 'tx', srcColumnId: 'c1', srcIndex: 0, dstColumnId: 'nope', dstIndex: 0 },
      expected: 0,
    },
  ];

  cases.forEach(({ name, move, expected }) => {
    it(name, () => {
      expect(computeDestinationPosition(sharedBoard(), move)).toBe(expected);
    });
  });
});

describe('applyMoveToBoard', () => {
  it('moves a ticket across columns and sets position via midpoint rules', () => {
    const board = buildBoard([
      { id: 'c1', tickets: [{ id: 't1', position: 0 }, { id: 't2', position: POSITION_GAP }] },
      { id: 'c2', tickets: [{ id: 't3', position: 0 }, { id: 't4', position: POSITION_GAP }] },
    ]);
    const move: MoveDescriptor = {
      ticketId: 't1',
      srcColumnId: 'c1',
      srcIndex: 0,
      dstColumnId: 'c2',
      dstIndex: 1,
    };

    const result = applyMoveToBoard(board, move);

    const c1 = result.columns.find((column) => column.id === 'c1');
    const c2 = result.columns.find((column) => column.id === 'c2');
    expect(c1?.tickets.map((ticket) => ticket.id)).toEqual(['t2']);
    expect(c2?.tickets.map((ticket) => ticket.id)).toEqual(['t3', 't1', 't4']);
    const moved = c2?.tickets.find((ticket) => ticket.id === 't1');
    expect(moved?.position).toBe(POSITION_GAP / 2);
  });

  it('reorders within a column (remove then insert at dstIndex)', () => {
    const board = sharedBoard(); // c1 = [t1, t2, t3]
    const move: MoveDescriptor = {
      ticketId: 't1',
      srcColumnId: 'c1',
      srcIndex: 0,
      dstColumnId: 'c1',
      dstIndex: 2,
    };

    const result = applyMoveToBoard(board, move);
    const c1 = result.columns.find((column) => column.id === 'c1');
    expect(c1?.tickets.map((ticket) => ticket.id)).toEqual(['t2', 't3', 't1']);
  });

  it('is a no-op (idempotent) when src slot === dst slot on even spacing', () => {
    const board = sharedBoard();
    const move: MoveDescriptor = {
      ticketId: 't2',
      srcColumnId: 'c1',
      srcIndex: 1,
      dstColumnId: 'c1',
      dstIndex: 1,
    };

    const result = applyMoveToBoard(board, move);
    expect(result).toEqual(board); // same order, same positions
  });

  it('is a no-op when the ticket is absent from the source column', () => {
    const board = sharedBoard();
    const move: MoveDescriptor = {
      ticketId: 'missing',
      srcColumnId: 'c1',
      srcIndex: 0,
      dstColumnId: 'c1',
      dstIndex: 0,
    };

    const result = applyMoveToBoard(board, move);
    expect(result).toBe(board); // returns the same reference untouched
  });

  it('does not mutate the input board', () => {
    const board = sharedBoard();
    const snapshot = JSON.parse(JSON.stringify(board)) as BoardPayload;
    const move: MoveDescriptor = {
      ticketId: 't1',
      srcColumnId: 'c1',
      srcIndex: 0,
      dstColumnId: 'empty',
      dstIndex: 0,
    };

    const result = applyMoveToBoard(board, move);

    expect(board).toEqual(snapshot); // original unchanged
    expect(result).not.toBe(board); // new reference returned
  });
});

describe('needsRebalance', () => {
  const cases: Array<{ name: string; positions: number[]; expected: boolean }> = [
    {
      name: 'true when an adjacent gap < EPSILON',
      positions: [0, POSITION_EPSILON / 2],
      expected: true,
    },
    {
      name: 'true when two positions are equal (gap 0)',
      positions: [POSITION_GAP, POSITION_GAP],
      expected: true,
    },
    {
      name: 'true on a negative gap (out of order)',
      positions: [POSITION_GAP, 0],
      expected: true,
    },
    {
      name: 'false on healthy gaps',
      positions: [0, POSITION_GAP, POSITION_GAP * 2],
      expected: false,
    },
    {
      name: 'false for a single position',
      positions: [POSITION_GAP],
      expected: false,
    },
    {
      name: 'false for an empty column',
      positions: [],
      expected: false,
    },
  ];

  cases.forEach(({ name, positions, expected }) => {
    it(name, () => {
      expect(needsRebalance(positions)).toBe(expected);
    });
  });
});
