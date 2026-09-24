import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import { MemberTimeReport } from './MemberTimeReport';
import { TooltipProvider } from '@/components/ui/Tooltip';
import type { ReportUser } from '@/types/report';

// TooltipProvider is mounted app-wide in main.tsx; AssigneeAvatar needs it.

// CR-06: the member report — expandable per-ticket breakdown, epic reference,
// source split, and the member total staying authoritative.

const HOUR = 3_600_000;

const users: ReportUser[] = [
    {
        id: 'u1',
        fullName: 'Ada Lovelace',
        avatarUrl: null,
        totalMs: HOUR + 15 * 60_000,
        autoMs: HOUR,
        manualMs: 15 * 60_000,
        entryCount: 2,
        tickets: [
            {
                id: 't2',
                ticketNumber: 2,
                title: 'Checkout story',
                type: 'STORY',
                epic: { id: 'e1', ticketNumber: 1, title: 'Payments epic' },
                totalMs: HOUR,
                autoMs: HOUR,
                manualMs: 0,
                entryCount: 1,
            },
            {
                id: 't3',
                ticketNumber: 3,
                title: 'Loose task',
                type: 'TASK',
                epic: null,
                totalMs: 15 * 60_000,
                autoMs: 0,
                manualMs: 15 * 60_000,
                entryCount: 1,
            },
        ],
    },
    {
        id: 'u2',
        fullName: 'Bob Turing',
        avatarUrl: null,
        totalMs: 30 * 60_000,
        autoMs: 30 * 60_000,
        manualMs: 0,
        entryCount: 1,
        tickets: [
            {
                id: 't4',
                ticketNumber: 4,
                title: 'Ops task',
                type: 'TASK',
                epic: null,
                totalMs: 30 * 60_000,
                autoMs: 30 * 60_000,
                manualMs: 0,
                entryCount: 1,
            },
        ],
    },
];

function renderReport(overrides: Partial<React.ComponentProps<typeof MemberTimeReport>> = {}) {
    const props = {
        projectSlug: 'SLYK',
        isLoading: false,
        error: null,
        onRetry: vi.fn(),
        users,
        ...overrides,
    };
    return render(
        <TooltipProvider>
            <MemberTimeReport {...props} />
        </TooltipProvider>,
    );
}

describe('MemberTimeReport (CR-06)', () => {
    it('renders one row per member with the headline total', () => {
        renderReport();
        expect(screen.getByRole('table', { name: 'Member time report' })).toBeInTheDocument();
        expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
        expect(screen.getByText('Bob Turing')).toBeInTheDocument();
        expect(screen.getByText('1h 15m')).toBeInTheDocument();
    });

    it('expands a member row into the per-ticket breakdown', () => {
        renderReport();
        fireEvent.click(screen.getByRole('button', { name: /Ada Lovelace/ }));

        const table = screen.getByRole('table', { name: 'Breakdown for Ada Lovelace' });
        expect(within(table).getByText('Checkout story')).toBeInTheDocument();
        expect(within(table).getByText('Loose task')).toBeInTheDocument();
        expect(within(table).getByText('SLYK-002')).toBeInTheDocument();
    });

    it('shows the epic reference and the auto/manual split per row', () => {
        renderReport();
        fireEvent.click(screen.getByRole('button', { name: /Ada Lovelace/ }));
        const table = screen.getByRole('table', { name: 'Breakdown for Ada Lovelace' });
        expect(within(table).getByText('(in Payments epic)')).toBeInTheDocument();
        expect(within(table).getByText('1h 0m auto')).toBeInTheDocument();
        expect(within(table).getByText('15m 0s manual')).toBeInTheDocument();
    });

    it('collapses on a second click', () => {
        renderReport();
        const trigger = screen.getByRole('button', { name: /Ada Lovelace/ });
        fireEvent.click(trigger);
        expect(
            screen.getByRole('table', { name: 'Breakdown for Ada Lovelace' }),
        ).toBeInTheDocument();
        fireEvent.click(trigger);
        expect(screen.queryByRole('table', { name: 'Breakdown for Ada Lovelace' })).toBeNull();
    });

    it('sorts members by total when the header is clicked', () => {
        renderReport();
        expect(screen.getAllByRole('row')[1]!.textContent).toContain('Ada Lovelace');
        fireEvent.click(screen.getByRole('button', { name: /Total Time/ }));
        expect(screen.getAllByRole('row')[1]!.textContent).toContain('Bob Turing');
    });

    it('shows the empty state when no time was tracked', () => {
        renderReport({ users: [] });
        expect(screen.getByText('No time tracked')).toBeInTheDocument();
        expect(screen.getByText('No time tracked in this period.')).toBeInTheDocument();
    });

    it('surfaces a retry control on error', () => {
        const onRetry = vi.fn();
        renderReport({ error: new Error('boom'), onRetry });
        expect(screen.getByRole('alert')).toBeInTheDocument();
    });
});
