import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TicketCard } from './TicketCard';
import type { Ticket } from '@/types/ticket';

describe('TicketCard', () => {
    const baseTicket: Ticket = {
        id: 't1',
        ticketNumber: 101,
        title: 'Render board',
        statusColumn: 'TODO',
        position: 0,
        priority: 'HIGH',
        labels: ['frontend'],
        assignee: { id: 'u1', fullName: 'Ada Lovelace', avatarUrl: 'https://example.com/a.png' },
        creatorId: 'c1',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
    };

    it('renders ticket id (SLUG-NNN), title, priority badge, labels, and avatar', () => {
        render(<TicketCard ticket={baseTicket} projectSlug="SLYK" />);
        expect(screen.getByText('SLYK-101')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Render board' })).toBeInTheDocument();
        expect(screen.getByLabelText('Priority: High')).toBeInTheDocument();
        expect(screen.getByText('frontend')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toBeInTheDocument();
    });

    it('renders Unassigned avatar when assignee is null', () => {
        const unassigned = { ...baseTicket, assignee: null };
        render(<TicketCard ticket={unassigned} projectSlug="SLYK" />);
        expect(screen.getByLabelText('Unassigned')).toBeInTheDocument();
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });
});
