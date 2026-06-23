import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { TicketCard } from './TicketCard';
import { renderInDnd } from '@/test/dndWrapper';
import type { Ticket } from '@/types/ticket';
import type { Label } from '@/types/label';

describe('TicketCard', () => {
    const frontendLabel: Label = {
        id: '11111111-1111-1111-1111-111111111111',
        name: 'frontend',
        color: '#3B82F6',
    };
    const baseTicket: Ticket = {
        id: 't1',
        ticketNumber: 101,
        title: 'Render board',
        description: null,
        statusColumn: 'TODO',
        position: 0,
        priority: 'HIGH',
        labels: [frontendLabel],
        checklist: [],
        assignee: { id: 'u1', fullName: 'Ada Lovelace', avatarUrl: 'https://example.com/a.png' },
        creator: null,
        creatorId: 'c1',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
    };

    it('renders ticket id (SLUG-NNN), title, priority badge, labels, and avatar', () => {
        renderInDnd(<TicketCard ticket={baseTicket} projectSlug="SLYK" index={0} />);
        expect(screen.getByText('SLYK-101')).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Render board' })).toBeInTheDocument();
        expect(screen.getByLabelText('Priority: High')).toBeInTheDocument();
        expect(screen.getByText('frontend')).toBeInTheDocument();
        expect(screen.getByRole('img', { name: 'Ada Lovelace' })).toBeInTheDocument();
    });

    it('renders labels as colored LabelChips with the label color as background', () => {
        renderInDnd(<TicketCard ticket={baseTicket} projectSlug="SLYK" index={0} />);
        const chip = screen.getByText('frontend');
        // LabelChip renders an inline-styled span wrapping the label name.
        expect(chip.closest('span')?.style.backgroundColor).toBe('rgb(59, 130, 246)');
    });

    it('renders no label list when ticket has no labels', () => {
        const noLabels = { ...baseTicket, labels: [] };
        renderInDnd(<TicketCard ticket={noLabels} projectSlug="SLYK" index={0} />);
        expect(screen.queryByLabelText('Labels')).not.toBeInTheDocument();
    });

    it('renders Unassigned avatar when assignee is null', () => {
        const unassigned = { ...baseTicket, assignee: null };
        renderInDnd(<TicketCard ticket={unassigned} projectSlug="SLYK" index={0} />);
        expect(screen.getByLabelText('Unassigned')).toBeInTheDocument();
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('calls onEdit with ticket.id when card is clicked', () => {
        const onEdit = vi.fn();
        renderInDnd(<TicketCard ticket={baseTicket} projectSlug="SLYK" index={0} onEdit={onEdit} />);
        fireEvent.click(screen.getByRole('heading', { name: 'Render board' }));
        expect(onEdit).toHaveBeenCalledWith('t1');
    });

    it('renders checklist progress chip (done/total) when checklist non-empty', () => {
        const withChecklist: Ticket = {
            ...baseTicket,
            checklist: [
                { id: 'i1', text: 'A', done: true },
                { id: 'i2', text: 'B', done: false },
                { id: 'i3', text: 'C', done: true },
            ],
        };
        renderInDnd(<TicketCard ticket={withChecklist} projectSlug="SLYK" index={0} />);
        // The chip's aria-label encodes the counts.
        expect(screen.getByLabelText('Checklist progress 2 of 3 done')).toBeInTheDocument();
    });

    it('renders no checklist chip when checklist is empty', () => {
        renderInDnd(<TicketCard ticket={baseTicket} projectSlug="SLYK" index={0} />);
        expect(screen.queryByLabelText(/^Checklist progress/)).not.toBeInTheDocument();
    });

    it('does not crash when checklist is missing (stale-cache defense)', () => {
        // A board cached before the checklist field shipped has ticket.checklist = undefined.
        const stale = { ...baseTicket, checklist: undefined } as unknown as Ticket;
        renderInDnd(<TicketCard ticket={stale} projectSlug="SLYK" index={0} />);
        expect(screen.getByText('SLYK-101')).toBeInTheDocument();
        expect(screen.queryByLabelText(/^Checklist progress/)).not.toBeInTheDocument();
    });
});
