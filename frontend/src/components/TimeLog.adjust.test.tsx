import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TimeLog } from './TimeLog';
import { fetchTimeEntries, adjustTimeEntry } from '@/api/timer';

// CR-14: the Time Log adjustment affordance — Adjust on closed timer entries
// only, mandatory reason, adjusted marker + original duration, and the mutation
// contract (signed minutes).

vi.mock('@/api/timer');

const HOUR = 3_600_000;

const closedEntry = {
    id: 'e1',
    ticketId: 't1',
    startTime: '2026-01-01T10:00:00.000Z',
    endTime: '2026-01-01T12:30:00.000Z',
    durationMs: 2.5 * HOUR,
    originalDurationMs: 2.5 * HOUR,
    adjustmentMinutes: null,
    adjustmentReason: null,
    description: null,
    type: 'timer' as const,
    user: { id: 'u1', fullName: 'Ada', avatarUrl: null },
};

function renderLog(entries: unknown[]) {
    vi.mocked(fetchTimeEntries).mockResolvedValue({
        entries,
        totalMs: 2.5 * HOUR,
    } as never);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <TimeLog ticketId="t1" />
        </QueryClientProvider>,
    );
}

describe('TimeLog adjustment (CR-14)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('offers Adjust on a closed timer entry and requires a reason', async () => {
        renderLog([closedEntry]);
        fireEvent.click(await screen.findByRole('button', { name: 'Adjust' }));
        fireEvent.change(screen.getByLabelText('Adjustment minutes'), {
            target: { value: '-120' },
        });
        fireEvent.change(screen.getByLabelText('Adjustment reason'), {
            target: { value: 'short' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }));

        expect(
            await screen.findByText('A reason of at least 10 characters is required.'),
        ).toBeInTheDocument();
        expect(adjustTimeEntry).not.toHaveBeenCalled();
    });

    it('rejects a zero adjustment', async () => {
        renderLog([closedEntry]);
        fireEvent.click(await screen.findByRole('button', { name: 'Adjust' }));
        fireEvent.change(screen.getByLabelText('Adjustment reason'), {
            target: { value: 'A perfectly fine reason' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }));
        expect(
            await screen.findByText(/Enter a non-zero whole number of minutes/),
        ).toBeInTheDocument();
        expect(adjustTimeEntry).not.toHaveBeenCalled();
    });

    it('sends the signed minutes + reason on save', async () => {
        vi.mocked(adjustTimeEntry).mockResolvedValue({
            id: 'e1',
            adjustmentMinutes: -120,
            adjustmentReason: 'Away from the desk',
        } as never);
        renderLog([closedEntry]);
        fireEvent.click(await screen.findByRole('button', { name: 'Adjust' }));
        fireEvent.change(screen.getByLabelText('Adjustment minutes'), {
            target: { value: '-120' },
        });
        fireEvent.change(screen.getByLabelText('Adjustment reason'), {
            target: { value: 'Away from the desk for an emergency' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }));

        await waitFor(() =>
            expect(adjustTimeEntry).toHaveBeenCalledWith('t1', 'e1', {
                adjustmentMinutes: -120,
                reason: 'Away from the desk for an emergency',
            }),
        );
    });

    it('shows the adjusted marker and the original duration', async () => {
        renderLog([
            {
                ...closedEntry,
                durationMs: 0.5 * HOUR,
                originalDurationMs: 2.5 * HOUR,
                adjustmentMinutes: -120,
                adjustmentReason: 'Away from the desk for an emergency',
            },
        ]);
        expect(await screen.findByText(/Adjusted -120m/)).toBeInTheDocument();
        expect(
            screen.getByText((_, el) => el?.textContent?.startsWith('Original: 2h 30m') ?? false),
        ).toBeInTheDocument();
        expect(screen.getByText(/Away from the desk for an emergency/)).toBeInTheDocument();
    });

    it('does NOT offer Adjust on a running entry or a manual entry', async () => {
        renderLog([
            { ...closedEntry, endTime: null, durationMs: null },
            {
                ...closedEntry,
                id: 'm1',
                type: 'manual',
                manualEntryMinutes: 30,
                durationMs: 0.5 * HOUR,
            },
        ]);
        await waitFor(() => expect(screen.getAllByText('Running').length).toBeGreaterThan(0));
        expect(screen.queryByRole('button', { name: 'Adjust' })).not.toBeInTheDocument();
    });
});
