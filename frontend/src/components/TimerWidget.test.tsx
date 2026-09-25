import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TimerWidget } from './TimerWidget';
import type { TimerStateResponse } from '@/types/timer';

// CR-15: the top-bar timer widget — pulsing while tracking, last-tracked restart
// when idle, stop from the dropdown, and title-click navigation.

const { mockState } = vi.hoisted(() => ({
    mockState: {
        state: null as TimerStateResponse | null,
        start: vi.fn(async () => ({})),
        stop: vi.fn(async () => ({})),
    },
}));

vi.mock('@/hooks/useServerTime', () => ({
    useServerTime: () => ({ offset: 0 }),
}));

vi.mock('@/hooks/useTimerState', () => ({
    useTimerState: () => ({ data: mockState.state }),
    useInvalidateTimerState: () => vi.fn(),
}));

vi.mock('@/hooks/useTimer', () => ({
    useTimer: () => ({
        start: mockState.start,
        stop: mockState.stop,
        isStarting: false,
        isStopping: false,
        pendingConfirm: null,
        confirmStart: vi.fn(),
        cancelConfirm: vi.fn(),
    }),
}));

const TICKET = {
    id: 't1',
    ticketNumber: 7,
    title: 'Nightly export',
    projectId: 'p1',
    projectSlug: 'SLYK',
    projectName: 'Slyk',
};

function renderWidget() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={['/projects/SLYK']}>
                <Routes>
                    <Route path="/projects/:slug" element={<TimerWidget />} />
                    <Route
                        path="/projects/:slug/tickets/:displayId"
                        element={<div data-testid="ticket-route" />}
                    />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

describe('TimerWidget (CR-15)', () => {
    beforeEach(() => {
        mockState.start.mockClear();
        mockState.stop.mockClear();
        mockState.state = { active: null, lastTracked: null };
    });

    it('shows a static clock and an empty dropdown with no history', async () => {
        const { container } = renderWidget();
        const trigger = screen.getByRole('button', { name: /Timer/ });
        expect(container.querySelector('svg.animate-pulse')).toBeNull();

        fireEvent.click(trigger);
        expect(await screen.findByText('No time tracked yet.')).toBeInTheDocument();
    });

    it('pulses while a timer runs and shows the ticket + elapsed', async () => {
        mockState.state = {
            active: {
                entryId: 'e1',
                startTime: new Date(Date.now() - 65_000).toISOString(),
                ticket: TICKET,
            },
            lastTracked: null,
        };
        const { container } = renderWidget();
        const trigger = screen.getByRole('button', { name: /Timer running on Nightly export/ });
        expect(container.querySelector('svg.animate-pulse')).not.toBeNull();

        fireEvent.click(trigger);
        expect(await screen.findByText('Nightly export')).toBeInTheDocument();
        expect(screen.getByText('Running')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    });

    it('stops the running timer from the dropdown', async () => {
        mockState.state = {
            active: { entryId: 'e1', startTime: new Date().toISOString(), ticket: TICKET },
            lastTracked: null,
        };
        renderWidget();
        fireEvent.click(screen.getByRole('button', { name: /Timer running/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
        await waitFor(() => expect(mockState.stop).toHaveBeenCalledTimes(1));
    });

    it('shows the project name when the tracked ticket belongs to another project', async () => {
        mockState.state = {
            active: {
                entryId: 'e1',
                startTime: new Date().toISOString(),
                ticket: { ...TICKET, projectSlug: 'ORBIT', projectName: 'Orbit' },
            },
            lastTracked: null,
        };
        renderWidget();
        fireEvent.click(screen.getByRole('button', { name: /Timer running/ }));
        expect(await screen.findByText('Orbit')).toBeInTheDocument();
    });

    it('omits the project name when the tracked ticket is in the current project', async () => {
        mockState.state = {
            active: { entryId: 'e1', startTime: new Date().toISOString(), ticket: TICKET },
            lastTracked: null,
        };
        renderWidget();
        fireEvent.click(screen.getByRole('button', { name: /Timer running/ }));
        expect(await screen.findByText('Nightly export')).toBeInTheDocument();
        expect(screen.queryByText('Slyk')).not.toBeInTheDocument();
    });

    it('shows the project name for a cross-project last-tracked ticket too', async () => {
        mockState.state = {
            active: null,
            lastTracked: {
                ...TICKET,
                projectSlug: 'ORBIT',
                projectName: 'Orbit',
                endedAt: new Date().toISOString(),
                durationMs: 60_000,
            },
        };
        renderWidget();
        fireEvent.click(screen.getByRole('button', { name: /Timer/ }));
        expect(await screen.findByText('Orbit')).toBeInTheDocument();
    });

    it('offers the last-tracked ticket for restart when idle', async () => {
        mockState.state = {
            active: null,
            lastTracked: {
                ...TICKET,
                endedAt: new Date().toISOString(),
                durationMs: 90 * 60_000,
            },
        };
        renderWidget();
        fireEvent.click(screen.getByRole('button', { name: /Timer/ }));
        expect(await screen.findByText('Nightly export')).toBeInTheDocument();
        expect(screen.getByText(/Last tracked:/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Start tracking again' })).toBeInTheDocument();
    });

    it('restarts the last-tracked ticket', async () => {
        mockState.state = {
            active: null,
            lastTracked: { ...TICKET, endedAt: new Date().toISOString(), durationMs: 60_000 },
        };
        renderWidget();
        fireEvent.click(screen.getByRole('button', { name: /Timer/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Start tracking again' }));
        await waitFor(() => expect(mockState.start).toHaveBeenCalledTimes(1));
    });

    it('navigates to the ticket when its title is clicked', async () => {
        mockState.state = {
            active: null,
            lastTracked: { ...TICKET, endedAt: new Date().toISOString(), durationMs: 60_000 },
        };
        renderWidget();
        fireEvent.click(screen.getByRole('button', { name: /Timer/ }));
        fireEvent.click(await screen.findByRole('button', { name: /Nightly export/ }));
        expect(await screen.findByTestId('ticket-route')).toBeInTheDocument();
    });
});
