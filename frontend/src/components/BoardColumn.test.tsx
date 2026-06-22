import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { BoardColumn } from './BoardColumn';
import type { Ticket } from '@/types/ticket';

function makeTicket(id: string, ticketNumber: number, position: number): Ticket {
    return {
        id,
        ticketNumber,
        title: `Title ${ticketNumber}`,
        statusColumn: 'TODO',
        position,
        priority: 'LOW',
        labels: [],
        assignee: null,
        creatorId: 'c1',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
    };
}

describe('BoardColumn', () => {
    it('renders tickets in the given order (pre-sorted by backend)', () => {
        const tickets = [makeTicket('a', 20, 20), makeTicket('b', 10, 10)];
        render(<BoardColumn id="TODO" name="To Do" tickets={tickets} projectSlug="SLYK" />);
        const section = screen.getByLabelText('Column To Do');
        const ids = within(section)
            .getAllByRole('article')
            .map((el) => el.getAttribute('aria-label'));
        expect(ids).toEqual(['Ticket SLYK-20: Title 20', 'Ticket SLYK-10: Title 10']);
    });

    it('renders count of tickets', () => {
        const tickets = [makeTicket('a', 1, 1), makeTicket('b', 2, 2)];
        render(<BoardColumn id="TODO" name="To Do" tickets={tickets} projectSlug="SLYK" />);
        expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('renders the empty state when there are no tickets', () => {
        render(<BoardColumn id="TODO" name="To Do" tickets={[]} projectSlug="SLYK" />);
        const status = screen.getByRole('status');
        expect(status).toHaveTextContent('No tickets');
    });
});
