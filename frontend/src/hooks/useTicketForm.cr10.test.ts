import { describe, it, expect } from 'vitest';

import { makeTicketFormSchema, ticketFormSchema } from './useTicketForm';

// CR-10: the required-field contract. Create mode demands a description, an
// explicit priority, and an ordered Start/End window; edit mode tolerates legacy
// blanks but still requires the window.

const base = {
  title: 'Ticket',
  description: 'Details',
  priority: 'MEDIUM' as const,
  assigneeId: null,
  labelIds: [],
  checklist: [],
  statusColumn: 'todo',
  startDate: '2026-01-01T00:00:00.000Z',
  endDate: '2026-01-08T00:00:00.000Z',
  type: 'TASK' as const,
  parentId: null,
};

const createSchema = makeTicketFormSchema({ requireDescription: true, requirePriority: true });

describe('CR-10 ticket form contract', () => {
  it('create mode accepts a fully specified ticket', () => {
    expect(createSchema.safeParse(base).success).toBe(true);
  });

  it('create mode rejects an empty description', () => {
    const result = createSchema.safeParse({ ...base, description: '   ' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'description')).toBe(true);
    }
  });

  it('create mode rejects a missing priority (no MEDIUM default)', () => {
    const result = createSchema.safeParse({ ...base, priority: null });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'priority')).toBe(true);
    }
  });

  it('rejects a missing start or end', () => {
    expect(createSchema.safeParse({ ...base, startDate: null }).success).toBe(false);
    expect(createSchema.safeParse({ ...base, endDate: null }).success).toBe(false);
  });

  it('rejects an end that is not after the start', () => {
    const result = createSchema.safeParse({
      ...base,
      startDate: '2026-01-08T00:00:00.000Z',
      endDate: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === 'endDate')).toBe(true);
    }
  });

  it('rejects an equal start and end', () => {
    expect(
      createSchema.safeParse({
        ...base,
        endDate: base.startDate,
      }).success,
    ).toBe(false);
  });

  it('edit mode tolerates an empty legacy description', () => {
    expect(ticketFormSchema.safeParse({ ...base, description: '' }).success).toBe(true);
  });
});
