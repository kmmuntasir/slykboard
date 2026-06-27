import { describe, expect, it } from 'vitest';
import { diffTicketChanges, formatLabelDiff } from './activityLogService';

describe('diffTicketChanges', () => {
  const base = { title: 't', description: 'd', priority: 'HIGH', assigneeId: 'u1' };

  const tests = [
    { name: 'no-op -> empty', next: base, labelDiff: null, expected: [] },
    {
      name: 'priority change only',
      next: { ...base, priority: 'LOW' },
      labelDiff: null,
      expected: [{ action: 'PRIORITY_CHANGED', oldValue: 'HIGH', newValue: 'LOW' }],
    },
    {
      name: 'assignee change (to unassigned)',
      next: { ...base, assigneeId: null },
      labelDiff: null,
      expected: [{ action: 'ASSIGNEE_CHANGED', oldValue: 'u1', newValue: 'unassigned' }],
    },
    {
      name: 'assignee set (from unassigned)',
      next: { ...base, assigneeId: 'u2' },
      labelDiff: null,
      expected: [{ action: 'ASSIGNEE_CHANGED', oldValue: 'u1', newValue: 'u2' }],
    },
    {
      name: 'title change -> one CONTENT_UPDATED',
      next: { ...base, title: 't2' },
      labelDiff: null,
      expected: [{ action: 'CONTENT_UPDATED', oldValue: null, newValue: 'title' }],
    },
    {
      name: 'description change -> one CONTENT_UPDATED',
      next: { ...base, description: 'd2' },
      labelDiff: null,
      expected: [{ action: 'CONTENT_UPDATED', oldValue: null, newValue: 'description' }],
    },
    {
      name: 'labels added',
      next: base,
      labelDiff: { added: ['Bug', 'UI'], removed: [] },
      expected: [{ action: 'LABELS_CHANGED', oldValue: null, newValue: 'added: Bug, UI' }],
    },
    {
      name: 'labels removed only',
      next: base,
      labelDiff: { added: [], removed: ['API'] },
      expected: [{ action: 'LABELS_CHANGED', oldValue: null, newValue: 'removed: API' }],
    },
    {
      name: 'labels added + removed',
      next: base,
      labelDiff: { added: ['Bug'], removed: ['API'] },
      expected: [
        { action: 'LABELS_CHANGED', oldValue: null, newValue: 'added: Bug; removed: API' },
      ],
    },
    {
      name: 'labels empty diff -> no row',
      next: base,
      labelDiff: { added: [], removed: [] },
      expected: [],
    },
    {
      name: 'multiple changes -> multiple rows',
      next: { title: 't2', description: 'd2', priority: 'LOW', assigneeId: 'u2' },
      labelDiff: { added: ['Bug'], removed: [] },
      expected: [
        { action: 'PRIORITY_CHANGED', oldValue: 'HIGH', newValue: 'LOW' },
        { action: 'ASSIGNEE_CHANGED', oldValue: 'u1', newValue: 'u2' },
        { action: 'CONTENT_UPDATED', oldValue: null, newValue: 'title and description' },
        { action: 'LABELS_CHANGED', oldValue: null, newValue: 'added: Bug' },
      ],
    },
  ];

  tests.forEach(({ name, next, labelDiff, expected }) => {
    it(name, () => {
      expect(diffTicketChanges(base, next, labelDiff)).toEqual(expected);
    });
  });
});

describe('formatLabelDiff', () => {
  it('added only', () => {
    expect(formatLabelDiff({ added: ['Bug'], removed: [] })).toBe('added: Bug');
  });

  it('removed only', () => {
    expect(formatLabelDiff({ added: [], removed: ['API'] })).toBe('removed: API');
  });

  it('both', () => {
    expect(formatLabelDiff({ added: ['Bug', 'UI'], removed: ['API'] })).toBe(
      'added: Bug, UI; removed: API',
    );
  });

  it('neither -> empty string', () => {
    expect(formatLabelDiff({ added: [], removed: [] })).toBe('');
  });
});
