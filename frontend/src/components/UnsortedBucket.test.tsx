import { describe, vi, it, expect } from 'vitest';

// CR-12: TicketCard ticks the live badge against the server clock; the
// offset hook is stubbed (its own tests cover the offset math).
vi.mock('@/hooks/useServerTime', () => ({
    useServerTime: () => ({ offset: 0 }),
}));

import { screen } from '@testing-library/react';
import { UnsortedBucket } from './UnsortedBucket';
import { renderInDnd } from '@/test/dndWrapper';
import type { Ticket } from '@/types/ticket';

describe('UnsortedBucket', () => {
    it('renders a muted column named Unsorted with the unsorted id', () => {
        const ticket: Ticket = {
            id: 't1',
            ticketNumber: 7,
            title: 'Orphan',
            description: null,
            statusColumn: '__unsorted__',
            position: 0,
            priority: 'LOW',
            labels: [],
            checklist: [],
            assignee: null,
            creator: null,
            creatorId: 'c1',
            type: 'TASK' as const,
            parentId: null,
            parent: null,
            children: [],
            epic: null,
            childCount: 0,
            childDoneCount: 0,
            trackedTotalMs: 0,
            runningTimer: null,
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
        };
        renderInDnd(<UnsortedBucket tickets={[ticket]} projectSlug="SLYK" />);
        const column = screen.getByLabelText('Column Unsorted');
        expect(column).toHaveAttribute('data-column-id', '__unsorted__');
        expect(screen.getByText('SLYK-007')).toBeInTheDocument();
    });
});
