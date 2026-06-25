import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { BoardPage } from './BoardPage';
import { renderInDnd } from '@/test/dndWrapper';
import { ApiClientError } from '@/api/client';
import { useBoardUiStore } from '@/stores/useBoardUiStore';
import type { BoardPayload } from '@/types/board';
import type { Ticket } from '@/types/ticket';

interface BoardMockValue {
    data?: BoardPayload;
    isLoading: boolean;
    error?: unknown;
    refetch?: () => void;
}

const { mockState } = vi.hoisted(() => ({
    mockState: {
        boardValue: { isLoading: false } as BoardMockValue,
    },
}));

vi.mock('@/hooks/useBoard', () => ({
    useBoard: () => mockState.boardValue,
}));

// T5 wires useMoveTicket(slug) into BoardPage; the real hook calls
// useQueryClient(), so mock it here (these are static-render assertions, not
// mutation-behavior tests — the mutation is unit-tested in useMoveTicket.test).
vi.mock('@/hooks/useMoveTicket', () => ({
    useMoveTicket: () => ({ mutate: vi.fn() }),
}));

// F12/T8 wires useCreateTicket(slug) into BoardPage; the real hook calls
// useQueryClient(), so mock it here (consistent with useMoveTicket above).
vi.mock('@/hooks/useCreateTicket', () => ({
    useCreateTicket: () => ({ mutate: vi.fn() }),
}));

// F13 T14 wires EditTicketModal into BoardPage; it calls useQuery +
// useUpdateTicket (which need QueryClient). The modal's behavior is unit-tested
// in EditTicketModal.test.tsx — here we stub it so BoardPage's static-render
// tests don't need a QueryClient provider.
vi.mock('@/components/EditTicketModal', () => ({
    EditTicketModal: () => null,
}));

// F26: BoardFilters calls useUsers + a labels useQuery (both need QueryClient).
// Its behavior is unit-tested in BoardFilters.test.tsx — stub it here so
// BoardPage's static-render tests stay QueryClient-free.
vi.mock('@/components/BoardFilters', () => ({
    BoardFilters: () => null,
}));

const ticket101: Ticket = {
    id: 't101',
    ticketNumber: 101,
    title: 'First ticket',
    description: null,
    statusColumn: 'c1',
    position: 0,
    priority: 'LOW',
    labels: [],
    checklist: [],
    assignee: null,
    creator: null,
    creatorId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

// T4 wraps TicketCard in a pangea <Draggable>; until T5 adds the real
// <DragDropContext>/<Droppable> to BoardPage, the Draggables need a context
// ancestor to mount in tests. renderInDnd provides a throwaway context+droppable
// purely for rendering — it does NOT simulate drag (T5 wires the real context).
function renderBoard() {
    return renderInDnd(
        <MemoryRouter initialEntries={['/projects/SLYK']}>
            <Routes>
                <Route path="/projects/:slug" element={<BoardPage />} />
            </Routes>
        </MemoryRouter>,
    );
}

// F30 T3: render with the same nested tickets/:displayId route the real router
// registers, plus a marker element that mounts only when navigation lands on
// the deep-link path — so a card click can assert the display-ID URL.
function renderBoardWithDetailRoute() {
    return renderInDnd(
        <MemoryRouter initialEntries={['/projects/SLYK']}>
            <Routes>
                <Route path="/projects/:slug" element={<BoardPage />}>
                    <Route
                        path="tickets/:displayId"
                        element={<div data-testid="detail-route-marker" />}
                    />
                </Route>
            </Routes>
        </MemoryRouter>,
    );
}

describe('BoardPage', () => {
    beforeEach(() => {
        mockState.boardValue = { isLoading: false };
        // Filter state lives in a real zustand store shared across renders;
        // reset it so no test leaks an active filter into another.
        useBoardUiStore.getState().clearFilters();
    });

    it('renders loading state', () => {
        mockState.boardValue = { isLoading: true, refetch: vi.fn() };
        renderBoard();

        // BoardPage now renders <BoardSkeleton /> while loading.
        const columns = screen.getAllByTestId('board-skeleton-column');
        expect(columns.length).toBeGreaterThan(0);
        // Skeleton columns are decorative (aria-hidden) — screen readers skip them.
        expect(columns[0]).toHaveAttribute('aria-hidden', 'true');
        expect(screen.queryByText('Slyk')).not.toBeInTheDocument();
    });

    it('renders board with columns + tickets', () => {
        mockState.boardValue = {
            data: {
                project: { id: 'p1', name: 'Slyk', slug: 'SLYK' },
                columns: [{ id: 'c1', name: 'To Do', isUnsorted: false, tickets: [ticket101] }],
            },
            isLoading: false,
        };
        renderBoard();

        expect(screen.getByText('Slyk')).toBeInTheDocument();
        expect(screen.getByText('SLYK')).toBeInTheDocument();
        expect(screen.getByText('SLYK-101')).toBeInTheDocument();
        expect(screen.getByLabelText('Column To Do')).toBeInTheDocument();
    });

    // F30 T3: card click deep-links to the human-readable display-ID URL
    // (/projects/SLYK/tickets/SLYK-101), not the legacy UUID path. Uses the
    // nested tickets/:displayId route with a marker so we don't need a
    // QueryClient (TicketDetailRoute's useQuery is out of scope here).
    it('navigates to the display-ID URL on card click', () => {
        mockState.boardValue = {
            data: {
                project: { id: 'p1', name: 'Slyk', slug: 'SLYK' },
                columns: [{ id: 'c1', name: 'To Do', isUnsorted: false, tickets: [ticket101] }],
            },
            isLoading: false,
        };
        renderBoardWithDetailRoute();

        // Before click: nested route not yet matched.
        expect(screen.queryByTestId('detail-route-marker')).not.toBeInTheDocument();

        // Card aria-label is the padded badge form (SLYK-101); click deep-links.
        fireEvent.click(screen.getByLabelText('Ticket SLYK-101: First ticket'));

        // After click: nested tickets/:displayId route mounted -> URL is the
        // unpadded display-ID form (SLYK-101 for ticketNumber 101).
        expect(screen.getByTestId('detail-route-marker')).toBeInTheDocument();
    });

    it('renders per-column empty state', () => {
        mockState.boardValue = {
            data: {
                project: { id: 'p1', name: 'Slyk', slug: 'SLYK' },
                columns: [
                    { id: 'c1', name: 'To Do', isUnsorted: false, tickets: [ticket101] },
                    { id: 'c2', name: 'Done', isUnsorted: false, tickets: [] },
                ],
            },
            isLoading: false,
        };
        renderBoard();

        expect(screen.getByText('No tickets')).toBeInTheDocument();
        expect(screen.queryByText(/No tickets yet/i)).not.toBeInTheDocument();
    });

    it('renders whole-board-empty CTA', () => {
        mockState.boardValue = {
            data: {
                project: { id: 'p1', name: 'Slyk', slug: 'SLYK' },
                columns: [{ id: 'c1', name: 'To Do', isUnsorted: false, tickets: [] }],
            },
            isLoading: false,
        };
        renderBoard();

        expect(screen.getByText(/No tickets yet/i)).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent(/No tickets yet/i);
        // Truly-empty CTA: the EmptyState surfaces a New-ticket button.
        expect(
            within(screen.getByRole('status')).getByRole('button', { name: 'New ticket' }),
        ).toBeInTheDocument();
    });

    it('renders filtered-empty state with a Clear-filters CTA', () => {
        // Simulate an active filter via the shared board-UI store (the source of
        // truth BoardPage reads for hasActiveFilters / clearFilters).
        useBoardUiStore.getState().setSearchQuery('nomatch');
        mockState.boardValue = {
            data: {
                project: { id: 'p1', name: 'Slyk', slug: 'SLYK' },
                columns: [{ id: 'c1', name: 'To Do', isUnsorted: false, tickets: [] }],
            },
            isLoading: false,
        };
        renderBoard();

        const status = screen.getByRole('status');
        expect(within(status).getByText(/No tickets match your filters/i)).toBeInTheDocument();
        const clearBtn = within(status).getByRole('button', { name: /clear filters/i });
        expect(clearBtn).toBeInTheDocument();

        // Clear-filters CTA resets the shared store.
        fireEvent.click(clearBtn);
        expect(useBoardUiStore.getState().searchQuery).toBe('');
    });

    it('renders Retry (role=alert) on a non-404 error and refetches on retry', () => {
        const refetch = vi.fn();
        mockState.boardValue = {
            error: new ApiClientError('Kaboom', 500, 'INTERNAL_ERROR'),
            isLoading: false,
            data: undefined,
            refetch,
        };
        renderBoard();

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText('Kaboom')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /retry/i }));
        expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('renders unsorted bucket for orphan', () => {
        mockState.boardValue = {
            data: {
                project: { id: 'p1', name: 'Slyk', slug: 'SLYK' },
                columns: [
                    {
                        id: '__unsorted__',
                        name: 'Unsorted',
                        isUnsorted: true,
                        tickets: [ticket101],
                    },
                ],
            },
            isLoading: false,
        };
        renderBoard();

        expect(screen.getByLabelText('Column Unsorted')).toBeInTheDocument();
    });

    it('renders 404 message on NOT_FOUND', () => {
        mockState.boardValue = {
            error: new ApiClientError('Project not found', 404, 'NOT_FOUND'),
            isLoading: false,
            data: undefined,
        };
        renderBoard();

        expect(screen.getByText(/not found/i)).toBeInTheDocument();
    });
});
