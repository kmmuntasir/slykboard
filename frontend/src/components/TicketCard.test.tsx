// CR-12: TicketCard ticks the live badge against the server clock; the
// offset hook is stubbed (its own tests cover the offset math).
vi.mock('@/hooks/useServerTime', () => ({
    useServerTime: () => ({ offset: 0 }),
}));

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

    it('calls onEdit with the display ID (SLYK-NNN) when card is clicked', () => {
        const onEdit = vi.fn();
        renderInDnd(
            <TicketCard ticket={baseTicket} projectSlug="SLYK" index={0} onEdit={onEdit} />,
        );
        fireEvent.click(screen.getByRole('heading', { name: 'Render board' }));
        // F30 D1: card click emits the unpadded display ID (SLYK-NNN), not the UUID
        expect(onEdit).toHaveBeenCalledWith('SLYK-101');
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

    // SLYK-06 T5 — card root surface token/contrast className assertions.
    // The click surface is the <article> (aria-label="Ticket <id>: <title>"),
    // so select it by its article role + heading-derived accessible name.
    it('card root carries border-border + elevation ring + bg-card surface', () => {
        renderInDnd(<TicketCard ticket={baseTicket} projectSlug="SLYK" index={0} />);
        // The card <article> inherits role="button" from @hello-pangea/dnd's
        // dragHandleProps, so select it via the button role + heading-derived name.
        const card = screen.getByRole('button', { name: /Render board/ });
        expect(card.className).toContain('border-border');
        expect(card.className).toContain('ring-');
        expect(card.className).toContain('bg-card');
    });

    // ---- CR-03: hierarchy decorations -------------------------------------

    it('CR-03: renders no type badge for a plain TASK', () => {
        renderInDnd(<TicketCard ticket={baseTicket} projectSlug="SLYK" index={0} />);
        expect(screen.queryByText('Task')).not.toBeInTheDocument();
    });

    it.each([
        ['EPIC', 'Epic'],
        ['STORY', 'Story'],
        ['SUBTASK', 'Subtask'],
    ] as const)('CR-03: renders a %s type badge', (type, label) => {
        renderInDnd(<TicketCard ticket={{ ...baseTicket, type }} projectSlug="SLYK" index={0} />);
        expect(screen.getByText(label)).toBeInTheDocument();
    });

    it('CR-03: renders the epic chip for descendants of an epic (not for the epic itself)', () => {
        renderInDnd(
            <TicketCard
                ticket={{
                    ...baseTicket,
                    type: 'STORY',
                    epic: { id: 'e1', ticketNumber: 42, title: 'Payments epic' },
                }}
                projectSlug="SLYK"
                index={0}
            />,
        );
        expect(screen.getByText('Payments epic')).toBeInTheDocument();
    });

    it('CR-03: renders children progress + derived-column lock for parents', () => {
        renderInDnd(
            <TicketCard
                ticket={{ ...baseTicket, type: 'EPIC', childCount: 3, childDoneCount: 2 }}
                projectSlug="SLYK"
                index={0}
            />,
        );
        expect(screen.getByLabelText('Children progress 2 of 3 done')).toBeInTheDocument();
    });

    it('CR-03: shows the parent chip on a subtask whose parent is in another column', () => {
        renderInDnd(
            <TicketCard
                ticket={{
                    ...baseTicket,
                    type: 'SUBTASK',
                    parentId: 'p1',
                    parent: {
                        id: 'p1',
                        ticketNumber: 7,
                        title: 'Parent',
                        type: 'TASK',
                        statusColumn: 'DOING',
                    },
                }}
                projectSlug="SLYK"
                index={0}
            />,
        );
        expect(screen.getByTitle('Nested under: Parent')).toBeInTheDocument();
        expect(screen.getByText(/SLYK-007/)).toBeInTheDocument();
    });

    it('CR-03: hides the parent chip when the card is already nested under its parent (isNested)', () => {
        renderInDnd(
            <TicketCard
                ticket={{
                    ...baseTicket,
                    type: 'SUBTASK',
                    parentId: 'p1',
                    parent: {
                        id: 'p1',
                        ticketNumber: 7,
                        title: 'Parent',
                        type: 'TASK',
                        statusColumn: 'TODO',
                    },
                }}
                projectSlug="SLYK"
                index={0}
                isNested
            />,
        );
        expect(screen.queryByTitle('Nested under: Parent')).not.toBeInTheDocument();
    });

    // ---- CR-12: tracked-total badge + live running state ---------------------

    it('CR-12: renders the tracked total badge when time exists', () => {
        renderInDnd(
            <TicketCard
                ticket={{ ...baseTicket, trackedTotalMs: 3 * 3_600_000 + 20 * 60_000 }}
                projectSlug="SLYK"
                index={0}
            />,
        );
        expect(screen.getByText('Tracked time')).toBeInTheDocument();
        expect(screen.getByText('3h 20m')).toBeInTheDocument();
    });

    it('CR-12: hides the badge when nothing is tracked and nothing runs', () => {
        renderInDnd(<TicketCard ticket={baseTicket} projectSlug="SLYK" index={0} />);
        expect(screen.queryByText('Tracked time')).not.toBeInTheDocument();
    });

    it('CR-12: shows a pulsing badge with the running elapsed time', () => {
        const started = new Date(Date.now() - 90_000).toISOString();
        const { container } = renderInDnd(
            <TicketCard
                ticket={{ ...baseTicket, runningTimer: { userId: 'u9', startTime: started } }}
                projectSlug="SLYK"
                index={0}
            />,
        );
        expect(screen.getByText('running')).toBeInTheDocument();
        expect(screen.getByText('1m 30s')).toBeInTheDocument();
        expect(container.querySelector('svg.animate-pulse')).not.toBeNull();
    });

    it('CR-12: the live badge is present even with zero tracked total', () => {
        const started = new Date(Date.now() - 30_000).toISOString();
        renderInDnd(
            <TicketCard
                ticket={{ ...baseTicket, runningTimer: { userId: 'u9', startTime: started } }}
                projectSlug="SLYK"
                index={0}
            />,
        );
        expect(screen.getByText('running')).toBeInTheDocument();
        expect(screen.getByText('30s')).toBeInTheDocument();
    });
});
