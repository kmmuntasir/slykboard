import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BoardFilters } from './BoardFilters';
import { useBoardUiStore } from '@/stores/useBoardUiStore';
import type { Label } from '@/types/label';

// F26: BoardFilters unit tests. Verifies the bar renders pickers populated from
// the users/labels queries, binds selects/inputs to the store, and that
// changing a filter writes the expected value (so useBoard refires server-side).

vi.mock('@/api/users', () => ({
    listUsers: vi.fn(),
}));
vi.mock('@/api/labels', () => ({
    listLabels: vi.fn(),
}));

import { listUsers } from '@/api/users';
import { listLabels } from '@/api/labels';

const users = [
    { id: 'u1', fullName: 'Ada Lovelace', avatarUrl: null },
    { id: 'u2', fullName: 'Alan Turing', avatarUrl: null },
];
const labels: Label[] = [
    { id: 'l1', name: 'bug', color: '#FF0000' },
    { id: 'l2', name: 'infra', color: '#6B7280' },
];

function wrapper(queryClient: QueryClient) {
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
}

function newClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('BoardFilters', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useBoardUiStore.getState().clearFilters();
        vi.mocked(listUsers).mockResolvedValue(users);
        vi.mocked(listLabels).mockResolvedValue(labels);
    });

    it('renders search input + populated pickers + clear', async () => {
        render(<BoardFilters slug="SLYK" />, { wrapper: wrapper(newClient()) });

        expect(screen.getByPlaceholderText('Search tickets…')).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'All assignees' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();

        expect(await screen.findByRole('option', { name: 'Ada Lovelace' })).toBeInTheDocument();
        expect(await screen.findByRole('option', { name: 'Alan Turing' })).toBeInTheDocument();
        expect(await screen.findByRole('option', { name: 'bug' })).toBeInTheDocument();
        expect(await screen.findByRole('option', { name: 'infra' })).toBeInTheDocument();

        for (const p of ['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL'] as const) {
            expect(screen.getByRole('option', { name: p })).toBeInTheDocument();
        }
    });

    it('search input writes to store.searchQuery (debounced)', async () => {
        render(<BoardFilters slug="SLYK" />, { wrapper: wrapper(newClient()) });

        fireEvent.change(screen.getByPlaceholderText('Search tickets…'), {
            target: { value: 'ci' },
        });

        // Debounced: wait for the store to update after 300ms.
        await waitFor(
            () => expect(useBoardUiStore.getState().searchQuery).toBe('ci'),
            { timeout: 1000 },
        );
    });

    it('selecting an assignee writes the user id (or null for All)', async () => {
        render(<BoardFilters slug="SLYK" />, { wrapper: wrapper(newClient()) });

        // wait for the option to exist before driving the change
        await screen.findByRole('option', { name: 'Alan Turing' });
        const select = screen.getByLabelText('Filter by assignee');
        fireEvent.change(select, { target: { value: 'u2' } });
        expect(useBoardUiStore.getState().assigneeFilter).toBe('u2');

        fireEvent.change(select, { target: { value: '' } });
        expect(useBoardUiStore.getState().assigneeFilter).toBeNull();
    });

    it('selecting a priority writes the literal (or null for All)', () => {
        render(<BoardFilters slug="SLYK" />, { wrapper: wrapper(newClient()) });

        const select = screen.getByLabelText('Filter by priority');
        fireEvent.change(select, { target: { value: 'HIGH' } });
        expect(useBoardUiStore.getState().priorityFilter).toBe('HIGH');

        fireEvent.change(select, { target: { value: '' } });
        expect(useBoardUiStore.getState().priorityFilter).toBeNull();
    });

    it('selecting a label writes the label id (or null for All)', async () => {
        render(<BoardFilters slug="SLYK" />, { wrapper: wrapper(newClient()) });

        // wait for the option to exist before driving the change
        await screen.findByRole('option', { name: 'bug' });
        const select = screen.getByLabelText('Filter by label');
        fireEvent.change(select, { target: { value: 'l1' } });
        expect(useBoardUiStore.getState().labelFilter).toBe('l1');

        fireEvent.change(select, { target: { value: '' } });
        expect(useBoardUiStore.getState().labelFilter).toBeNull();
    });

    it('Clear resets all filters', async () => {
        useBoardUiStore.setState({
            searchQuery: 'foo',
            assigneeFilter: 'u1',
            priorityFilter: 'HIGH',
            labelFilter: 'l1',
        });
        render(<BoardFilters slug="SLYK" />, { wrapper: wrapper(newClient()) });

        fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

        const s = useBoardUiStore.getState();
        expect(s.searchQuery).toBe('');
        expect(s.assigneeFilter).toBeNull();
        expect(s.priorityFilter).toBeNull();
        expect(s.labelFilter).toBeNull();
    });
});
