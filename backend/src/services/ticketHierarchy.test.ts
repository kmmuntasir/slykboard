import { describe, expect, it } from 'vitest';
import { earliestChildColumn, TICKET_TYPE_RANK } from './ticketService';

// CR-03: pure-function unit tests for the "least progressed child" rule and the
// rank ordering. The transactional recompute walk is covered end-to-end against
// the real test DB in ticketService.hierarchy.test.ts.

describe('TICKET_TYPE_RANK (CR-03)', () => {
  it('EPIC ranks above STORY, STORY above TASK, TASK above SUBTASK', () => {
    expect(TICKET_TYPE_RANK.EPIC).toBeGreaterThan(TICKET_TYPE_RANK.STORY);
    expect(TICKET_TYPE_RANK.STORY).toBeGreaterThan(TICKET_TYPE_RANK.TASK);
    expect(TICKET_TYPE_RANK.TASK).toBeGreaterThan(TICKET_TYPE_RANK.SUBTASK);
  });
});

describe('earliestChildColumn (CR-03 FR-03.9)', () => {
  const columns = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];

  it('returns the earliest column occupied by any child', () => {
    expect(earliestChildColumn(columns, ['c3', 'c1'])).toBe('c1');
    expect(earliestChildColumn(columns, ['c2', 'c3'])).toBe('c2');
  });

  it('ignores repeated columns (multiple children in one column)', () => {
    expect(earliestChildColumn(columns, ['c2', 'c2', 'c3'])).toBe('c2');
  });

  it('skips unknown/legacy column ids (unsorted) and resolves the rest', () => {
    expect(earliestChildColumn(columns, ['__unsorted__', 'ghost', 'c2'])).toBe('c2');
  });

  it('returns null when no child column resolves (all unknown or no children)', () => {
    expect(earliestChildColumn(columns, ['ghost'])).toBeNull();
    expect(earliestChildColumn(columns, [])).toBeNull();
    expect(earliestChildColumn([], ['c1'])).toBeNull();
  });
});
