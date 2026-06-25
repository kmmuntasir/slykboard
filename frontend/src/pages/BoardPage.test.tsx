import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { BoardPage } from './BoardPage';
import { renderInDnd } from '@/test/dndWrapper';
import { ApiClientError } from '@/api/client';
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

describe('BoardPage', () => {
    beforeEach(() => {
        mockState.boardValue = { isLoading: false };
    });

    it('renders loading state', () => {
        mockState.boardValue = { isLoading: true, refetch: vi.fn() };
        renderBoard();

        // BoardPage now renders <BoardSkeleton /> while loading.
        expect(screen.getAllByTestId('board-skeleton-column').length).toBeGreaterThan(0);
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
