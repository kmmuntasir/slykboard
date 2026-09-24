import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ColumnTimePanel } from './ColumnTimePanel';
import { makeTicket } from '@/test/makeTicket';
import type { ColumnTimeReport } from '@/types/report';

// CR-08: the per-column table — residence + tracked columns, share, visits,
// sorting, and the filters reaching the API layer.

const { mockState } = vi.hoisted(() => ({
    mockState: {
        data: null as ColumnTimeReport | null,
        args: [] as unknown[],
    },
}));

vi.mock('@/api/reports', () => ({
    fetchColumnTimeReport: (...args: unknown[]) => {
        mockState.args.push(args);
        return Promise.resolve(mockState.data);
    },
}));

const HOUR = 3_600_000;

const report: ColumnTimeReport = {
    ticket: {
        id: 't1',
        ticketNumber: 1,
        title: 'Task',
        type: 'TASK',
        statusColumn: 'c2',
        deletedAt: null,
    },
    columns: [
        {
            columnId: 'c1',
            columnName: 'To Do',
            residenceMs: 2 * HOUR,
            trackedMs: HOUR,
            visits: 1,
            sharePct: 66,
        },
        {
            columnId: 'c2',
            columnName: 'In Progress',
            residenceMs: HOUR,
            trackedMs: 30 * 60_000,
            visits: 1,
            sharePct: 33,
        },
        {
            columnId: 'c3',
            columnName: 'Done',
            residenceMs: 0,
            trackedMs: 0,
            visits: 0,
            sharePct: 0,
        },
    ],
    totalResidenceMs: 3 * HOUR,
    totalTrackedMs: HOUR + 30 * 60_000,
    window: null,
    filters: { memberId: null, source: null },
};

function renderPanel() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ColumnTimePanel
                projectSlug="SLYK"
                ticket={makeTicket({ ticketNumber: 1, type: 'TASK', statusColumn: 'c2' })}
                members={[{ id: 'u1', fullName: 'Ada' }]}
            />
        </QueryClientProvider>,
    );
}

describe('ColumnTimePanel (CR-08)', () => {
    beforeEach(() => {
        mockState.args = [];
        mockState.data = report;
    });

    it('renders one row per column with residence, tracked, share, visits', async () => {
        renderPanel();
        await waitFor(() =>
            expect(screen.getByRole('table', { name: 'Time by column' })).toBeInTheDocument(),
        );
        expect(screen.getByText('To Do')).toBeInTheDocument();
        expect(screen.getByText('In Progress')).toBeInTheDocument();
        expect(screen.getByText('Done')).toBeInTheDocument();
        const todoRow = screen.getByText('To Do').closest('tr')!;
        expect(todoRow.textContent).toContain('2h 0m');
        expect(todoRow.textContent).toContain('1h 0m');
        expect(todoRow.textContent).toContain('66%');
        // The current column is flagged.
        expect(screen.getByText('(current)')).toBeInTheDocument();
    });

    it('shows the lifetime totals footer', async () => {
        renderPanel();
        await waitFor(() => expect(screen.getByText(/residence/)).toBeInTheDocument());
        expect(screen.getByText(/all time/)).toBeInTheDocument();
    });

    it('sorts by tracked time when the Tracked header is clicked', async () => {
        renderPanel();
        await waitFor(() => expect(screen.getByText('To Do')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Tracked/ }));
        const rows = screen.getAllByRole('row').slice(1);
        // Ascending first: Done (0) → In Progress → To Do.
        expect(rows[0]!.textContent).toContain('Done');
    });

    it('passes the window, member and source filters to the API', async () => {
        renderPanel();
        await waitFor(() => expect(mockState.args.length).toBeGreaterThan(0));

        fireEvent.pointerDown(screen.getByLabelText('Column time window'), { button: 0 });
        fireEvent.click(await screen.findByRole('menuitem', { name: 'This week' }));
        fireEvent.pointerDown(screen.getByLabelText('Column time member'), { button: 0 });
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Ada' }));
        fireEvent.pointerDown(screen.getByLabelText('Column time source'), { button: 0 });
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Manual' }));

        await waitFor(() => {
            const last = mockState.args.at(-1) as [string, Record<string, unknown>];
            expect(last[0]).toBe('SLYK');
            expect(last[1]).toMatchObject({
                ticket: 'SLYK-001',
                period: 'weekly',
                member: 'u1',
                source: 'manual',
            });
        });
    });
});
