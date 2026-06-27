import { describe, it, expect } from 'vitest';
import {
  enrichActivityRows,
  resolveAssignee,
  MAX_ACTIVITY_ROWS,
  type ActivityEntry,
} from './activityService';

// ActionType union mirrored from the service for the row factory's override type.
type ActionType =
  | 'CREATED'
  | 'STATUS_CHANGED'
  | 'PRIORITY_CHANGED'
  | 'ASSIGNEE_CHANGED'
  | 'LABELS_CHANGED'
  | 'CONTENT_UPDATED';

// Build an ActivityLogRow input with sane defaults; tests override per case.
function makeRow(
  over: Partial<{
    id: string;
    createdAt: Date | string;
    actionType: ActionType;
    oldValue: string | null;
    newValue: string | null;
    actorId: string | null;
    actorFullName: string | null;
    actorAvatarUrl: string | null;
  }> = {},
) {
  return {
    id: 'log-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    actionType: 'CREATED' as ActionType,
    oldValue: null,
    newValue: null,
    actorId: 'u-1',
    actorFullName: 'Alice',
    actorAvatarUrl: 'https://img/a.png',
    ...over,
  };
}

// Enrich a single row and assert it produced exactly one entry. Keeps the
// table-driven cases concise and satisfies noUncheckedIndexedAccess.
function enrichOne(
  over: Parameters<typeof makeRow>[0],
  columnMap = new Map<string, string>(),
  assigneeMap = new Map<string, string>(),
): ActivityEntry {
  const entries = enrichActivityRows([makeRow(over)], columnMap, assigneeMap);
  expect(entries).toHaveLength(1);
  return entries[0]!;
}

describe('MAX_ACTIVITY_ROWS', () => {
  it('caps the feed at 50 rows', () => {
    expect(MAX_ACTIVITY_ROWS).toBe(50);
  });
});

describe('resolveAssignee', () => {
  const tests = [
    { name: 'null → null', input: null as string | null, expected: null },
    { name: "'unassigned' → 'Unassigned'", input: 'unassigned', expected: 'Unassigned' },
    { name: 'known id → mapped name', input: 'u-1', expected: 'Alice' },
    { name: 'unknown id → "Unknown user"', input: 'u-ghost', expected: 'Unknown user' },
  ];

  tests.forEach(({ name, input, expected }) => {
    it(name, () => {
      const map = new Map([['u-1', 'Alice']]);
      expect(resolveAssignee(input, map)).toBe(expected);
    });
  });
});

describe('enrichActivityRows', () => {
  const columnMap = new Map([
    ['c1', 'To Do'],
    ['c2', 'In Progress'],
  ]);
  const assigneeMap = new Map([['u-1', 'Alice']]);

  it('CREATED → actor set, from/to/message null', () => {
    const entry = enrichOne({ actionType: 'CREATED' }, columnMap, assigneeMap);
    expect(entry.actionType).toBe('CREATED');
    expect(entry.actor).toEqual({
      id: 'u-1',
      fullName: 'Alice',
      avatarUrl: 'https://img/a.png',
    });
    expect(entry.from).toBeNull();
    expect(entry.to).toBeNull();
    expect(entry.message).toBeNull();
  });

  it('CONTENT_UPDATED → all-null from/to/message', () => {
    const entry = enrichOne({ actionType: 'CONTENT_UPDATED' }, columnMap, assigneeMap);
    expect(entry.actionType).toBe('CONTENT_UPDATED');
    expect(entry.from).toBeNull();
    expect(entry.to).toBeNull();
    expect(entry.message).toBeNull();
  });

  const statusTests = [
    {
      name: 'STATUS_CHANGED known columns resolve to names',
      oldValue: 'c1',
      newValue: 'c2',
      expectedFrom: 'To Do',
      expectedTo: 'In Progress',
    },
    {
      name: 'STATUS_CHANGED unknown column id → "Unknown column"',
      oldValue: 'ghost',
      newValue: 'c2',
      expectedFrom: 'Unknown column',
      expectedTo: 'In Progress',
    },
  ];
  statusTests.forEach(({ name, oldValue, newValue, expectedFrom, expectedTo }) => {
    it(name, () => {
      const entry = enrichOne(
        { actionType: 'STATUS_CHANGED', oldValue, newValue },
        columnMap,
        assigneeMap,
      );
      expect(entry.from).toBe(expectedFrom);
      expect(entry.to).toBe(expectedTo);
      expect(entry.message).toBeNull();
    });
  });

  const assigneeTests = [
    {
      name: 'ASSIGNEE_CHANGED unassigned → "Unassigned"',
      oldValue: 'unassigned',
      newValue: 'u-1',
      expectedFrom: 'Unassigned',
      expectedTo: 'Alice',
    },
    {
      name: 'ASSIGNEE_CHANGED unknown uuid → "Unknown user"',
      oldValue: 'u-1',
      newValue: 'u-ghost',
      expectedFrom: 'Alice',
      expectedTo: 'Unknown user',
    },
    {
      name: 'ASSIGNEE_CHANGED null old/new → null',
      oldValue: null,
      newValue: null,
      expectedFrom: null,
      expectedTo: null,
    },
  ];
  assigneeTests.forEach(({ name, oldValue, newValue, expectedFrom, expectedTo }) => {
    it(name, () => {
      const entry = enrichOne(
        { actionType: 'ASSIGNEE_CHANGED', oldValue, newValue },
        columnMap,
        assigneeMap,
      );
      expect(entry.from).toBe(expectedFrom);
      expect(entry.to).toBe(expectedTo);
      expect(entry.message).toBeNull();
    });
  });

  it('PRIORITY_CHANGED → raw SCREAMING_SNAKE passthrough, message null', () => {
    const entry = enrichOne(
      { actionType: 'PRIORITY_CHANGED', oldValue: 'HIGH', newValue: 'MEDIUM' },
      columnMap,
      assigneeMap,
    );
    expect(entry.from).toBe('HIGH');
    expect(entry.to).toBe('MEDIUM');
    expect(entry.message).toBeNull();
  });

  it('LABELS_CHANGED → message = newValue, from/to null', () => {
    const entry = enrichOne(
      { actionType: 'LABELS_CHANGED', newValue: 'bug, urgent' },
      columnMap,
      assigneeMap,
    );
    expect(entry.message).toBe('bug, urgent');
    expect(entry.from).toBeNull();
    expect(entry.to).toBeNull();
  });

  it('actor fallback: actorId null → actor null', () => {
    const entry = enrichOne(
      { actorId: null, actorFullName: null, actorAvatarUrl: null },
      columnMap,
      assigneeMap,
    );
    expect(entry.actor).toBeNull();
  });

  it('actor fallback: actorFullName null → "Unknown user"', () => {
    const entry = enrichOne({ actorFullName: null, actorAvatarUrl: null }, columnMap, assigneeMap);
    expect(entry.actor).toEqual({
      id: 'u-1',
      fullName: 'Unknown user',
      avatarUrl: null,
    });
  });

  const iso = '2026-06-15T12:30:45.000Z';
  it('createdAt coercion: Date → same ISO string', () => {
    const entry = enrichOne({ createdAt: new Date(iso) }, columnMap, assigneeMap);
    expect(entry.createdAt).toBe(iso);
  });

  it('createdAt coercion: ISO string → same ISO string', () => {
    const entry = enrichOne({ createdAt: iso }, columnMap, assigneeMap);
    expect(entry.createdAt).toBe(iso);
  });

  it('ordering: preserves input row order (does not sort)', () => {
    const rows = [makeRow({ id: 'a' }), makeRow({ id: 'b' }), makeRow({ id: 'c' })];
    const entries = enrichActivityRows(rows, columnMap, assigneeMap);
    expect(entries.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });
});
