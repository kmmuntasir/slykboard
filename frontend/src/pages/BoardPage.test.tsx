import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { BoardPage } from './BoardPage';
import { ApiClientError } from '@/api/client';
import type { BoardPayload } from '@/types/board';
import type { Ticket } from '@/types/ticket';

interface BoardMockValue {
    data?: BoardPayload;
    isLoading: boolean;
    error?: unknown;
}

const { mockState } = vi.hoisted(() => ({
    mockState: {
        boardValue: { isLoading: false } as BoardMockValue,
    },
}));

vi.mock('@/hooks/useBoard', () => ({
    useBoard: () => mockState.boardValue,
}));

const ticket101: Ticket = {
    id: 't101',
    ticketNumber: 101,
    title: 'First ticket',
    statusColumn: 'c1',
    position: 0,
    priority: 'LOW',
    labels: [],
    assignee: null,
    creatorId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderBoard() {
    return render(
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
        mockState.boardValue = { isLoading: true };
        renderBoard();

        expect(screen.getByText('Loading board…')).toBeInTheDocument();
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
