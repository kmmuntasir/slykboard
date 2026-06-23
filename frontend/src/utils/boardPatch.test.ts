import { describe, it, expect } from 'vitest';
import { applyPatchToBoard } from './boardPatch';
import type { BoardPayload } from '@/types/board';
import type { Ticket, Priority } from '@/types/ticket';

// --- Fixtures --------------------------------------------------------------

function makeTicket(id: string, overrides: Partial<Ticket> = {}): Ticket {
  return {
    id,
    ticketNumber: Number(id.replace(/\D/g, '') || '0'),
    title: `title-${id}`,
    description: null,
    statusColumn: 'c1',
    position: 0,
    priority: 'LOW' as Priority,
    labels: [],
    assignee: null,
    creatorId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function seedBoard(): BoardPayload {
  const t1 = makeTicket('t1', {
    description: '<p>old</p>',
    priority: 'MEDIUM',
    assignee: { id: 'u1', fullName: 'Ada', avatarUrl: null },
  });
  const t2 = makeTicket('t2');
  return {
    project: { id: 'p1', name: 'Slyk', slug: 'slyk' },
    columns: [
      { id: 'c1', name: 'Todo', isUnsorted: false, tickets: [t1, t2] },
      { id: 'c2', name: 'Done', isUnsorted: false, tickets: [] },
    ],
  };
}

// --- Tests -----------------------------------------------------------------

describe('applyPatchToBoard', () => {
  it('patches title only', () => {
    const board = seedBoard();
    const next = applyPatchToBoard(board, 't1', { title: 'New Title' });
    const t = next.columns[0]?.tickets[0];
    expect(t?.title).toBe('New Title');
    // untouched fields stay
    expect(t?.description).toBe('<p>old</p>');
    expect(t?.priority).toBe('MEDIUM');
    expect(t?.assignee).toEqual({ id: 'u1', fullName: 'Ada', avatarUrl: null });
  });

  it('patches description (Ticket HAS description on card)', () => {
    const board = seedBoard();
    const next = applyPatchToBoard(board, 't1', { description: '<p>new desc</p>' });
    expect(next.columns[0]?.tickets[0]?.description).toBe('<p>new desc</p>');
  });

  it('patches priority', () => {
    const board = seedBoard();
    const next = applyPatchToBoard(board, 't1', { priority: 'HIGH' });
    expect(next.columns[0]?.tickets[0]?.priority).toBe('HIGH');
  });

  it('does NOT touch card on assigneeId patch (nested Assignee not resolvable here)', () => {
    const board = seedBoard();
    const next = applyPatchToBoard(board, 't1', { assigneeId: 'u2' });
    const t = next.columns[0]?.tickets[0];
    // title/description/priority/assignee all unchanged; assigneeId NOT grafted on.
    expect(t?.title).toBe('title-t1');
    expect(t?.assignee).toEqual({ id: 'u1', fullName: 'Ada', avatarUrl: null });
    expect((t as unknown as Record<string, unknown>).assigneeId).toBeUndefined();
  });

  it('does NOT touch card on assigneeId=null patch (server reconciles on invalidate)', () => {
    const board = seedBoard();
    const next = applyPatchToBoard(board, 't1', { assigneeId: null });
    const t = next.columns[0]?.tickets[0];
    expect(t?.assignee).toEqual({ id: 'u1', fullName: 'Ada', avatarUrl: null });
  });

  it('returns board unchanged (same reference) when ticketId missing', () => {
    const board = seedBoard();
    const next = applyPatchToBoard(board, 'nope', { title: 'x' });
    expect(next).toBe(board);
  });

  it('does not mutate the input board, columns, or tickets', () => {
    const board = seedBoard();
    const origColumn0 = board.columns[0];
    const origTickets = board.columns[0]?.tickets;
    const origTicket0 = board.columns[0]?.tickets[0];
    applyPatchToBoard(board, 't1', { title: 'mutated' });
    expect(board.columns[0]).toBe(origColumn0);
    expect(board.columns[0]?.tickets).toBe(origTickets);
    expect(board.columns[0]?.tickets[0]).toBe(origTicket0);
    expect(board.columns[0]?.tickets[0]?.title).toBe('title-t1');
  });

  it('patches multiple fields at once (title + priority)', () => {
    const board = seedBoard();
    const next = applyPatchToBoard(board, 't1', { title: 'Multi', priority: 'URGENT' });
    const t = next.columns[0]?.tickets[0];
    expect(t?.title).toBe('Multi');
    expect(t?.priority).toBe('URGENT');
    // untouched fields stay
    expect(t?.description).toBe('<p>old</p>');
  });
});
