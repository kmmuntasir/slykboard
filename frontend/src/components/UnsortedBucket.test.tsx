import { describe, it, expect } from 'vitest';
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
            creatorId: 'c1',
            createdAt: '2026-06-01T00:00:00.000Z',
            updatedAt: '2026-06-01T00:00:00.000Z',
        };
        renderInDnd(<UnsortedBucket tickets={[ticket]} projectSlug="SLYK" />);
        const column = screen.getByLabelText('Column Unsorted');
        expect(column).toHaveAttribute('data-column-id', '__unsorted__');
        expect(screen.getByText('SLYK-007')).toBeInTheDocument();
    });
});
