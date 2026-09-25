import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { MemberTimeReport } from './MemberTimeReport';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { useReport } from '@/hooks/useReport';
import { fetchTimeReport } from '@/api/reports';
import type { TimeReportFilters } from '@/api/reports';
import type { ReportUser } from '@/types/report';

// TooltipProvider is mounted app-wide in main.tsx; AssigneeAvatar needs it.

// CR-06: the member report — expandable per-ticket breakdown, epic reference,
// source split, and the member total staying authoritative.
// FR-06.3: the member/source/type filters and the local breakdown sort toggle.

// FR-06.3 filter tests wire the report to its real query hook (like
// ReportsBody does) so a filter change can be asserted on the mocked API
// module — the filters recompute the report server-side.
vi.mock('@/api/reports', () => ({
    fetchTimeReport: vi.fn(),
}));

const WINDOW = {
    start: '2026-09-21T00:00:00.000Z',
    end: '2026-09-28T00:00:00.000Z',
    label: 'This week',
};

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
        filters: {} as TimeReportFilters,
        onFiltersChange: vi.fn(),
        ...overrides,
    };
    return render(
        <TooltipProvider>
            <MemberTimeReport {...props} />
        </TooltipProvider>,
    );
}

// Minimal page stand-in: owns the filter state and the useReport query exactly
// like ReportsBody does, so the rendered controls drive the mocked API module.
function FilteredHarness() {
    const [filters, setFilters] = useState<TimeReportFilters>({});
    const time = useReport('weekly', 0, 'SLYK', filters);
    return (
        <TooltipProvider>
            <MemberTimeReport
                projectSlug="SLYK"
                isLoading={time.isLoading}
                error={time.error}
                onRetry={() => time.refetch()}
                users={time.data?.users ?? []}
                filters={filters}
                onFiltersChange={setFilters}
            />
        </TooltipProvider>
    );
}

function renderHarness() {
    // Fresh QueryClient per render (project convention).
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <FilteredHarness />
        </QueryClientProvider>,
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

    // --- FR-06.3: server-side narrowing filters + local breakdown sort -------

    it('renders the filters and refetches with the selected params on change (FR-06.3)', async () => {
        // Arrange
        vi.mocked(fetchTimeReport).mockResolvedValue({ users, window: WINDOW });
        renderHarness();

        // The kit's Select is DropdownMenu-based: the trigger is a labelled
        // button (HierarchyTimeReport.test.tsx convention).
        expect(screen.getByLabelText('Filter by member')).toBeInTheDocument();
        expect(screen.getByLabelText('Filter by source')).toBeInTheDocument();
        expect(screen.getByLabelText('Filter by ticket type')).toBeInTheDocument();

        // Act: narrow to one member, then to manual entries only.
        fireEvent.pointerDown(screen.getByLabelText('Filter by member'), { button: 0 });
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Ada Lovelace' }));

        // Assert: the filter is part of the server request (and query key).
        await waitFor(() =>
            expect(vi.mocked(fetchTimeReport)).toHaveBeenLastCalledWith('weekly', 0, 'SLYK', {
                member: 'u1',
            }),
        );

        // Act: stack the source filter on top.
        fireEvent.pointerDown(screen.getByLabelText('Filter by source'), { button: 0 });
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Manual' }));

        await waitFor(() =>
            expect(vi.mocked(fetchTimeReport)).toHaveBeenLastCalledWith('weekly', 0, 'SLYK', {
                member: 'u1',
                source: 'manual',
            }),
        );
    });

    it('sorts the expanded breakdown by ticket time when the Time header is toggled (FR-06.3)', () => {
        // Arrange: server order (as returned) is NOT time-desc.
        const unordered: ReportUser[] = [
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
                        id: 't9',
                        ticketNumber: 9,
                        title: 'Small ticket first',
                        type: 'TASK',
                        epic: null,
                        totalMs: 15 * 60_000,
                        autoMs: 0,
                        manualMs: 15 * 60_000,
                        entryCount: 1,
                    },
                    {
                        id: 't10',
                        ticketNumber: 10,
                        title: 'Big ticket second',
                        type: 'STORY',
                        epic: null,
                        totalMs: HOUR,
                        autoMs: HOUR,
                        manualMs: 0,
                        entryCount: 1,
                    },
                ],
            },
        ];
        renderReport({ users: unordered });
        fireEvent.click(screen.getByRole('button', { name: /Ada Lovelace/ }));

        const table = screen.getByRole('table', { name: 'Breakdown for Ada Lovelace' });
        expect(within(table).getAllByRole('row')[1]!.textContent).toContain('Small ticket first');

        // Act / Assert: toggle → tracked time DESC.
        fireEvent.click(within(table).getByRole('button', { name: /^Time/ }));
        expect(within(table).getAllByRole('row')[1]!.textContent).toContain('Big ticket second');

        // Toggle back → server order restored.
        fireEvent.click(within(table).getByRole('button', { name: /^Time/ }));
        expect(within(table).getAllByRole('row')[1]!.textContent).toContain('Small ticket first');
    });
});
