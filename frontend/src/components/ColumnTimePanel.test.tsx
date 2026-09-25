import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ColumnTimePanel } from './ColumnTimePanel';
import { makeTicket } from '@/test/makeTicket';
import type { ColumnTimeReport } from '@/types/report';

// CR-08: the per-column table — residence + tracked columns, share, visits,
// sorting (board order by default, name via the sort dropdown), the hide-empty
// toggle, the CR-11 auto/manual split, and the filters reaching the API layer.

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
const MINUTE = 60_000;

// Rows are deliberately NOT in alphabetical order — the default sort must
// preserve this server (board) order, not locale-sort the names.
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
            autoMs: 40 * MINUTE,
            manualMs: 20 * MINUTE,
            visits: 1,
            sharePct: 66,
        },
        {
            columnId: 'c2',
            columnName: 'In Progress',
            residenceMs: HOUR,
            trackedMs: 30 * MINUTE,
            autoMs: 30 * MINUTE,
            manualMs: 0,
            visits: 1,
            sharePct: 33,
        },
        {
            columnId: 'c3',
            columnName: 'Done',
            residenceMs: 0,
            trackedMs: 0,
            autoMs: 0,
            manualMs: 0,
            visits: 0,
            sharePct: 0,
        },
    ],
    totalResidenceMs: 3 * HOUR,
    totalTrackedMs: HOUR + 30 * MINUTE,
    autoMs: 70 * MINUTE,
    manualMs: 20 * MINUTE,
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

function bodyRows() {
    return screen.getAllByRole('row').slice(1);
}

function rowNames() {
    return bodyRows().map((row) => row.querySelector('td')!.textContent);
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
        const rows = bodyRows();
        // Ascending first: Done (0) → In Progress → To Do.
        expect(rows[0]!.textContent).toContain('Done');
    });

    it('preserves the server (board) column order by default', async () => {
        renderPanel();
        await waitFor(() => expect(screen.getByText('To Do')).toBeInTheDocument());
        // Server order, NOT alphabetical (Done would be first if name-sorted).
        expect(rowNames()).toEqual(['To Do', 'In Progress(current)', 'Done']);
    });

    it('sorts alphabetically when the Column name sort is selected', async () => {
        renderPanel();
        await waitFor(() => expect(screen.getByText('To Do')).toBeInTheDocument());

        fireEvent.pointerDown(screen.getByLabelText('Column time sort'), { button: 0 });
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Column name' }));

        await waitFor(() => {
            expect(rowNames()).toEqual(['Done', 'In Progress(current)', 'To Do']);
        });
    });

    it('hides and restores fully empty columns via the toggle', async () => {
        renderPanel();
        await waitFor(() => expect(screen.getByText('Done')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('checkbox', { name: 'Hide empty columns' }));
        expect(screen.queryByText('Done')).not.toBeInTheDocument();
        expect(bodyRows()).toHaveLength(2);

        fireEvent.click(screen.getByRole('checkbox', { name: 'Hide empty columns' }));
        expect(screen.getByText('Done')).toBeInTheDocument();
        expect(bodyRows()).toHaveLength(3);
    });

    it('renders the auto/manual split on rows and totals, omitting zero segments', async () => {
        renderPanel();
        await waitFor(() => expect(screen.getByText('To Do')).toBeInTheDocument());

        // Mixed row: both segments labeled.
        const todoRow = screen.getByText('To Do').closest('tr')!;
        expect(todoRow.textContent).toContain('40m 0s auto · 20m 0s manual');

        // Single-source row: no split line (the tracked figure is unambiguous).
        const progressRow = screen.getByText('In Progress').closest('tr')!;
        expect(progressRow.textContent).toContain('30m 0s');
        expect(progressRow.textContent).not.toContain('auto');
        expect(progressRow.textContent).not.toContain('manual');

        // Footer total split.
        expect(screen.getByText(/residence/).textContent).toContain(
            'tracked 1h 30m (1h 10m auto · 20m 0s manual)',
        );
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
