import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TimerHeroCard } from './TimerHeroCard';

// --- Mocks: timer server-state (server-authoritative timer model) ------------
// Mirrors the TicketDetailModal.test.tsx timer mock surface.
vi.mock('@/api/timer', () => ({
    startTimer: vi.fn().mockResolvedValue({
        entry: { id: 'e1' },
        serverNow: new Date().toISOString(),
    }),
    stopTimer: vi.fn().mockResolvedValue({
        entry: {
            id: 'e1',
            startTime: new Date(Date.now() - 90_000).toISOString(),
            endTime: new Date().toISOString(),
        },
        serverNow: new Date().toISOString(),
    }),
    fetchActiveTimer: vi.fn().mockResolvedValue({ activeTimer: null }),
}));
vi.mock('@/api/time', () => ({
    fetchServerTime: vi.fn().mockResolvedValue({ now: new Date().toISOString() }),
}));

import { fetchActiveTimer, startTimer, stopTimer } from '@/api/timer';

const TICKET_ID = 't101';

function newQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
}

function renderCard(overrides: { client?: QueryClient } = {}) {
    const client = overrides.client ?? newQueryClient();
    const utils = render(
        <QueryClientProvider client={client}>
            <TimerHeroCard ticketId={TICKET_ID} />
        </QueryClientProvider>,
    );
    return { ...utils, client };
}

describe('TimerHeroCard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(fetchActiveTimer).mockResolvedValue({ activeTimer: null });
    });
    afterEach(cleanup);

    it('renders a resting 00:00:00 readout and a full-width Start button', () => {
        renderCard();
        // Large monospace readout (aria-live region so it is queryable by text).
        expect(screen.getByText('00:00:00')).toBeInTheDocument();
        // Single full-width Start affordance; no Stop while resting.
        const start = screen.getByRole('button', { name: 'Start' });
        expect(start).toBeInTheDocument();
        expect(start).toHaveClass('w-full');
        expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    });

    it('Start calls startTimer with the ticket id', async () => {
        renderCard();
        fireEvent.click(screen.getByRole('button', { name: 'Start' }));
        await waitFor(() => expect(startTimer).toHaveBeenCalledWith(TICKET_ID));
    });

    it('Stop calls stopTimer with the ticket id and surfaces the last-tracked duration', async () => {
        // First active-timer resolve: this ticket's timer is running → Stop renders.
        // The stop mutation invalidates timerKeys.active() (see useTimer), which
        // refetches; once that refetch returns null the card flips to resting and
        // shows the "Last tracked" affordance. The second+ resolve (post-stop
        // refetch) falls through to the beforeEach default of null.
        vi.mocked(fetchActiveTimer).mockResolvedValueOnce({
            activeTimer: {
                id: 'e1',
                ticketId: TICKET_ID,
                userId: 'u1',
                startTime: new Date(Date.now() - 1000).toISOString(),
                endTime: null,
                manualEntryMinutes: null,
                description: null,
                createdAt: new Date().toISOString(),
            },
        });
        renderCard();

        const stop = await screen.findByRole('button', { name: 'Stop' });
        expect(stop).toHaveClass('w-full');
        fireEvent.click(stop);

        await waitFor(() => expect(stopTimer).toHaveBeenCalledWith(TICKET_ID));
        // After stop resolves, the last-tracked affordance shows (90s fixture → ~1m 30s).
        await waitFor(() =>
            expect(screen.getByText(/Last tracked:/)).toBeInTheDocument(),
        );
    });
});
