import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { HierarchyTimeReport } from './HierarchyTimeReport';
import { makeTicket } from '@/test/makeTicket';

// CR-04/CR-05: the hierarchy report section — node picker, roll-up summary,
// member table, breakdown rows, and filter wiring. Data layer mocked at the
// module boundary (the hooks are the seam; api/* is mocked underneath them).

const { mockState } = vi.hoisted(() => ({
    mockState: {
        rollup: null as unknown,
        breakdown: null as unknown,
        entries: null as unknown,
        rollupArgs: [] as unknown[],
        breakdownArgs: [] as unknown[],
        entriesArgs: [] as unknown[],
    },
}));

vi.mock('@/hooks/useReport', () => ({
    useNodeRollup: (...args: unknown[]) => {
        mockState.rollupArgs.push(args);
        return { data: mockState.rollup, isLoading: false, error: null, refetch: vi.fn() };
    },
    useNodeBreakdown: (...args: unknown[]) => {
        mockState.breakdownArgs.push(args);
        return { data: mockState.breakdown, isLoading: false, error: null, refetch: vi.fn() };
    },
    useNodeEntries: (...args: unknown[]) => {
        mockState.entriesArgs.push(args);
        return { data: mockState.entries, isLoading: false };
    },
}));

const HOUR = 3_600_000;

const epic = makeTicket({ id: 'e1', ticketNumber: 1, title: 'Payments epic', type: 'EPIC' });
const story = makeTicket({ id: 's1', ticketNumber: 2, title: 'Checkout story', type: 'STORY' });
const subtask = makeTicket({ id: 'b1', ticketNumber: 3, title: 'Hook subtask', type: 'SUBTASK' });

const WINDOW = {
    start: '2026-09-21T00:00:00.000Z',
    end: '2026-09-28T00:00:00.000Z',
    label: 'Week of Sep 21, 2026',
};

function wrapper({ children }: { children: React.ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderReport() {
    return render(
        <HierarchyTimeReport
            projectSlug="SLYK"
            period="weekly"
            offset={0}
            tickets={[epic, story, subtask]}
        />,
        { wrapper },
    );
}

/** Open the node picker and choose the epic. */
async function selectEpic() {
    fireEvent.pointerDown(screen.getByLabelText('Report node'), { button: 0 });
    fireEvent.click(await screen.findByRole('menuitem', { name: /Payments epic/ }));
}

describe('HierarchyTimeReport (CR-04/CR-05)', () => {
    beforeEach(() => {
        mockState.rollupArgs = [];
        mockState.breakdownArgs = [];
        mockState.entriesArgs = [];
        mockState.rollup = {
            node: { id: 'e1', ticketNumber: 1, title: 'Payments epic', type: 'EPIC' },
            window: WINDOW,
            totalMs: 3 * HOUR + 30 * 60_000,
            autoMs: 3 * HOUR,
            manualMs: 30 * 60_000,
            entryCount: 3,
        };
        mockState.breakdown = {
            node: { id: 'e1', ticketNumber: 1, title: 'Payments epic', type: 'EPIC' },
            window: WINDOW,
            totalMs: 3 * HOUR + 30 * 60_000,
            autoMs: 3 * HOUR,
            manualMs: 30 * 60_000,
            entryCount: 3,
            members: [
                {
                    id: 'u1',
                    fullName: 'Ada',
                    avatarUrl: null,
                    totalMs: HOUR,
                    autoMs: HOUR,
                    manualMs: 0,
                    entryCount: 1,
                },
                {
                    id: 'u2',
                    fullName: 'Bob',
                    avatarUrl: null,
                    totalMs: 30 * 60_000,
                    autoMs: 0,
                    manualMs: 30 * 60_000,
                    entryCount: 2,
                },
            ],
            rows: [
                {
                    id: 's1',
                    ticketNumber: 2,
                    title: 'Checkout story',
                    type: 'STORY',
                    ownMs: 30 * 60_000,
                    rollupMs: 3 * HOUR + 30 * 60_000,
                    entryCount: 2,
                    members: [{ id: 'u1', totalMs: HOUR }],
                },
                {
                    id: 'b1',
                    ticketNumber: 3,
                    title: 'Hook subtask',
                    type: 'SUBTASK',
                    ownMs: 3 * HOUR,
                    rollupMs: 3 * HOUR,
                    entryCount: 1,
                    members: [],
                },
            ],
        };
        mockState.entries = null;
    });

    it('prompts for a node before showing any numbers', () => {
        renderReport();
        expect(screen.getByText(/Pick an epic, story, or task/)).toBeInTheDocument();
        expect(screen.queryByText('Total tracked')).not.toBeInTheDocument();
    });

    it('renders the roll-up summary with the auto/manual split (CR-04)', async () => {
        renderReport();
        await selectEpic();

        await waitFor(() => expect(screen.getByText('Total tracked')).toBeInTheDocument());
        // The total and the story row's tracked column both read 3h 30m;
        // the auto split (3h 0m) also appears in the breakdown row, so scope
        // the split assertions to the summary block.
        const summary = screen.getByText('Total tracked').parentElement!.parentElement!;
        expect(within(summary).getByText('3h 30m')).toBeInTheDocument();
        expect(within(summary).getByText('3h 0m')).toBeInTheDocument();
        expect(within(summary).getByText('30m 0s')).toBeInTheDocument();
        expect(screen.getByText(WINDOW.label)).toBeInTheDocument();
        // The node is addressed by display id on the wire.
        const lastCall = mockState.rollupArgs.at(-1) as unknown[];
        expect(lastCall[3]).toBe('SLYK-1');
    });

    it('lists the member summary with per-member split + entry counts (CR-05.3)', async () => {
        renderReport();
        await selectEpic();

        await waitFor(() => expect(screen.getByText('By member')).toBeInTheDocument());
        expect(screen.getByText('Ada')).toBeInTheDocument();
        expect(screen.getByText(/1h 0m auto/)).toBeInTheDocument();
        expect(screen.getByText('Bob')).toBeInTheDocument();
        expect(screen.getByText(/30m 0s manual/)).toBeInTheDocument();
        expect(screen.getByText('1 entries')).toBeInTheDocument();
    });

    it('renders per-ticket rows with own + tracked columns (CR-05.1)', async () => {
        renderReport();
        await selectEpic();

        await waitFor(() =>
            expect(
                screen.getByRole('table', { name: 'Time breakdown by ticket' }),
            ).toBeInTheDocument(),
        );
        expect(screen.getByText('Checkout story')).toBeInTheDocument();
        expect(screen.getByText('Hook subtask')).toBeInTheDocument();
        // Server order (tracked DESC) is the default render order.
        const rows = screen.getAllByRole('row').slice(1);
        expect(rows[0]!.textContent).toContain('Checkout story');
    });

    it('re-sorts rows when the Own column is clicked (FR-05.4)', async () => {
        renderReport();
        await selectEpic();
        await waitFor(() => expect(screen.getByText('Checkout story')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: /^Own/ }));
        const rows = screen.getAllByRole('row').slice(1);
        // Own DESC: subtask 3h > story 30m.
        expect(rows[0]!.textContent).toContain('Hook subtask');
    });

    it('expands a row to show its raw entries with source labels (CR-05.2/CR-11)', async () => {
        mockState.entries = {
            node: { id: 'e1', ticketNumber: 1, title: 'Payments epic', type: 'EPIC' },
            window: WINDOW,
            entries: [
                {
                    id: 'te1',
                    ticketId: 'b1',
                    ticketNumber: 3,
                    ticketTitle: 'Hook subtask',
                    ticketType: 'SUBTASK',
                    userId: 'u1',
                    userFullName: 'Ada',
                    userAvatarUrl: null,
                    startTime: '2026-09-22T10:00:00.000Z',
                    endTime: '2026-09-22T13:00:00.000Z',
                    durationMs: 3 * HOUR,
                    type: 'timer',
                    description: null,
                    adjusted: false,
                    adjustmentReason: null,
                },
            ],
        };
        renderReport();
        await selectEpic();
        await waitFor(() => expect(screen.getByText('Checkout story')).toBeInTheDocument());

        // Expand the subtask row — the entries query surfaces its raw list.
        fireEvent.click(screen.getByRole('button', { name: /SLYK-003/ }));
        await waitFor(() => expect(screen.getByText('Auto')).toBeInTheDocument());
        const entryRow = screen.getByText('Auto').closest('li')!;
        expect(within(entryRow).getByText('Ada')).toBeInTheDocument();
        expect(within(entryRow).getByText('3h 0m')).toBeInTheDocument();
    });

    it('passes the member filter to the report hooks (FR-05.4)', async () => {
        renderReport();
        await selectEpic();
        await waitFor(() => expect(screen.getByText('By member')).toBeInTheDocument());

        fireEvent.pointerDown(screen.getByLabelText('Filter by member'), { button: 0 });
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Ada' }));

        await waitFor(() => {
            const call = mockState.breakdownArgs.at(-1) as unknown[];
            expect((call[4] as { member: string | null }).member).toBe('u1');
        });
    });

    it('passes the source filter to the report hooks (FR-05.4)', async () => {
        renderReport();
        await selectEpic();

        fireEvent.pointerDown(screen.getByLabelText('Filter by source'), { button: 0 });
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Manual' }));

        await waitFor(() => {
            const call = mockState.rollupArgs.at(-1) as unknown[];
            expect((call[4] as { source: string | null }).source).toBe('manual');
        });
    });

    it('excludes subtasks from the node picker (their time rolls up via parents)', async () => {
        renderReport();
        fireEvent.pointerDown(screen.getByLabelText('Report node'), { button: 0 });
        expect(await screen.findByRole('menuitem', { name: /Payments epic/ })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: /Checkout story/ })).toBeInTheDocument();
        expect(screen.queryByRole('menuitem', { name: /Hook subtask/ })).not.toBeInTheDocument();
    });
});
