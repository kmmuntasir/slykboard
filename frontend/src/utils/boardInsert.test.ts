import { describe, expect, it } from 'vitest';
import { applyCreateToBoard } from './boardInsert';
import type { BoardPayload } from '../types/board';
import type { Ticket, Priority } from '../types/ticket';

// Minimal ticket seat: id + statusColumn (the only fields that drive the
// insert logic). position is irrelevant to FE create (backend computes it).
interface Seat {
  id: string;
  statusColumn: string;
  position?: number;
}

function buildBoard(
  columns: { id: string; isUnsorted?: boolean; tickets: Seat[] }[],
): BoardPayload {
  return {
    project: { id: 'p1', name: 'Project', slug: 'project' },
    columns: columns.map((column) => ({
      id: column.id,
      name: column.id,
      isUnsorted: column.isUnsorted ?? false,
      tickets: column.tickets.map((seat) => makeTicket(seat)),
    })),
  };
}

function makeTicket(seat: Seat): Ticket {
  return {
    id: seat.id,
    ticketNumber: Number(seat.id.replace(/\D/g, '') || '0'),
    title: seat.id,
    description: null,
    statusColumn: seat.statusColumn,
    position: seat.position ?? 0,
    priority: 'LOW' as Priority,
    labels: [],
    checklist: [],
    assignee: null,
    creatorId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('applyCreateToBoard', () => {
  const cases: Array<{
    name: string;
    board: BoardPayload;
    ticket: Ticket;
    assert: (result: BoardPayload) => void;
  }> = [
    {
      name: 'appends to the first column when empty (statusColumn c1)',
      board: buildBoard([{ id: 'c1', tickets: [] }]),
      ticket: makeTicket({ id: 'new1', statusColumn: 'c1' }),
      assert: (result) => {
        const col = result.columns.find((c) => c.id === 'c1');
        expect(col?.tickets).toHaveLength(1);
        expect(col?.tickets[0]?.id).toBe('new1');
      },
    },
    {
      name: 'appends to the first column WITH existing tickets (D3 bottom placement)',
      board: buildBoard([{ id: 'c1', tickets: [{ id: 't1', statusColumn: 'c1', position: 0 }] }]),
      ticket: makeTicket({ id: 'new1', statusColumn: 'c1', position: 65536 }),
      assert: (result) => {
        const col = result.columns.find((c) => c.id === 'c1');
        expect(col?.tickets).toHaveLength(2);
        // D3: new ticket is APPENDED LAST, not prepended.
        expect(col?.tickets[1]?.id).toBe('new1');
        expect(col?.tickets[0]?.id).toBe('t1');
      },
    },
    {
      name: 'appends to a specified non-first column (statusColumn c2)',
      board: buildBoard([
        { id: 'c1', tickets: [] },
        { id: 'c2', tickets: [] },
      ]),
      ticket: makeTicket({ id: 'new1', statusColumn: 'c2' }),
      assert: (result) => {
        const c1 = result.columns.find((c) => c.id === 'c1');
        const c2 = result.columns.find((c) => c.id === 'c2');
        expect(c1?.tickets).toHaveLength(0);
        expect(c2?.tickets).toHaveLength(1);
        expect(c2?.tickets[0]?.id).toBe('new1');
      },
    },
    {
      name: 'does NOT touch the unsorted bucket (ticket.statusColumn c1)',
      board: buildBoard([
        { id: 'c1', tickets: [] },
        {
          id: '__unsorted__',
          isUnsorted: true,
          tickets: [{ id: 'orphan', statusColumn: '__unsorted__' }],
        },
      ]),
      ticket: makeTicket({ id: 'new1', statusColumn: 'c1' }),
      assert: (result) => {
        const unsorted = result.columns.find((c) => c.id === '__unsorted__');
        expect(unsorted?.tickets).toHaveLength(1);
        // Same orphan reference preserved (untouched array entry).
        expect(unsorted?.tickets[0]?.id).toBe('orphan');
      },
    },
  ];

  cases.forEach(({ name, board, ticket, assert }) => {
    it(name, () => {
      const result = applyCreateToBoard(board, ticket);
      assert(result);
    });
  });

  it('does not mutate the input board and returns a new reference', () => {
    const board = buildBoard([
      { id: 'c1', tickets: [{ id: 't1', statusColumn: 'c1', position: 0 }] },
    ]);
    const snapshot = JSON.parse(JSON.stringify(board)) as BoardPayload;
    const ticket = makeTicket({ id: 'new1', statusColumn: 'c1', position: 65536 });

    const result = applyCreateToBoard(board, ticket);

    // Original board untouched.
    expect(board).toEqual(snapshot);
    expect(board.columns[0]?.tickets).toHaveLength(1);
    // New references returned.
    expect(result).not.toBe(board);
    expect(result.columns).not.toBe(board.columns);
    expect(result.columns[0]).not.toBe(board.columns[0]);
  });
});
