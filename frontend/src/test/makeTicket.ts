import type { Ticket } from '@/types/ticket';

// CR-03: shared Ticket factory for test fixtures. The Ticket interface grew
// hierarchy fields (type/parentId/parent/children/epic/childCount/childDoneCount);
// centralizing the defaults keeps fixtures short and future field additions
// one-line fixes. Override anything per-test via the partial argument.
export function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'ticket-1',
    ticketNumber: 1,
    title: 'Test ticket',
    description: null,
    statusColumn: 'col-1',
    position: 65536,
    priority: 'MEDIUM',
    labels: [],
    checklist: [],
    assignee: null,
    creator: null,
    creatorId: 'user-1',
    dueDate: null,
    type: 'TASK',
    parentId: null,
    parent: null,
    children: [],
    epic: null,
    childCount: 0,
    childDoneCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
