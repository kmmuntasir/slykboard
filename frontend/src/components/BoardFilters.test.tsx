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
        // The three Select triggers render (Radix dropdown-menu buttons).
        expect(screen.getByRole('button', { name: 'Filter by assignee' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Filter by priority' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Filter by label' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();

        // Open the assignee picker and assert its menuitems (findByRole waits
        // for the users query to resolve before surfacing the dynamic items).
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Filter by assignee' }), {
            button: 0,
        });
        expect(screen.getByRole('menuitem', { name: 'All assignees' })).toBeInTheDocument();
        expect(await screen.findByRole('menuitem', { name: 'Ada Lovelace' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Alan Turing' })).toBeInTheDocument();
        fireEvent.keyDown(document.body, { key: 'Escape' });

        // Open the priority picker (static data; items render immediately).
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Filter by priority' }), {
            button: 0,
        });
        expect(screen.getByRole('menuitem', { name: 'All priorities' })).toBeInTheDocument();
        for (const label of ['Low', 'Medium', 'High', 'Urgent', 'Critical']) {
            expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
        }
        fireEvent.keyDown(document.body, { key: 'Escape' });

        // Open the label picker.
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Filter by label' }), {
            button: 0,
        });
        expect(screen.getByRole('menuitem', { name: 'All labels' })).toBeInTheDocument();
        expect(await screen.findByRole('menuitem', { name: 'bug' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'infra' })).toBeInTheDocument();
    });

    it('search input writes to store.searchQuery (debounced)', async () => {
        render(<BoardFilters slug="SLYK" />, { wrapper: wrapper(newClient()) });

        fireEvent.change(screen.getByPlaceholderText('Search tickets…'), {
            target: { value: 'ci' },
        });

        // Debounced: wait for the store to update after 300ms.
        await waitFor(() => expect(useBoardUiStore.getState().searchQuery).toBe('ci'), {
            timeout: 1000,
        });
    });

    it('selecting an assignee writes the user id (or null for All)', async () => {
        render(<BoardFilters slug="SLYK" />, { wrapper: wrapper(newClient()) });

        const trigger = screen.getByRole('button', { name: 'Filter by assignee' });
        fireEvent.pointerDown(trigger, { button: 0 });
        // findByRole waits for the users query to resolve before clicking.
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Alan Turing' }));
        expect(useBoardUiStore.getState().assigneeFilter).toBe('u2');

        // Reopen and pick "All assignees" → null.
        fireEvent.pointerDown(trigger, { button: 0 });
        fireEvent.click(screen.getByRole('menuitem', { name: 'All assignees' }));
        expect(useBoardUiStore.getState().assigneeFilter).toBeNull();
    });

    it('selecting a priority writes the literal (or null for All)', () => {
        render(<BoardFilters slug="SLYK" />, { wrapper: wrapper(newClient()) });

        const trigger = screen.getByRole('button', { name: 'Filter by priority' });
        fireEvent.pointerDown(trigger, { button: 0 });
        // Display labels are Title-Case; the emitted value stays the raw enum.
        fireEvent.click(screen.getByRole('menuitem', { name: 'High' }));
        expect(useBoardUiStore.getState().priorityFilter).toBe('HIGH');

        fireEvent.pointerDown(trigger, { button: 0 });
        fireEvent.click(screen.getByRole('menuitem', { name: 'All priorities' }));
        expect(useBoardUiStore.getState().priorityFilter).toBeNull();
    });

    it('selecting a label writes the label id (or null for All)', async () => {
        render(<BoardFilters slug="SLYK" />, { wrapper: wrapper(newClient()) });

        const trigger = screen.getByRole('button', { name: 'Filter by label' });
        fireEvent.pointerDown(trigger, { button: 0 });
        // findByRole waits for the labels query to resolve before clicking.
        fireEvent.click(await screen.findByRole('menuitem', { name: 'bug' }));
        expect(useBoardUiStore.getState().labelFilter).toBe('l1');

        fireEvent.pointerDown(trigger, { button: 0 });
        fireEvent.click(screen.getByRole('menuitem', { name: 'All labels' }));
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
