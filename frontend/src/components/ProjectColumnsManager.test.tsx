// F27: ProjectColumnsManager component tests.
// Mocks useUpdateProject via vi.hoisted state so no QueryClientProvider is
// needed — these are render + interaction assertions on the draft + mutation.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApiClientError } from '@/api/client';
import { ProjectColumnsManager } from './ProjectColumnsManager';
import type { Column } from '@/types/project';

const { mockState } = vi.hoisted(() => ({
    mockState: {
        mutateAsync: vi.fn() as ReturnType<typeof vi.fn>,
        isPending: false,
        error: null as null | Error,
    },
}));

vi.mock('@/hooks/useUpdateProject', () => ({
    useUpdateProject: () => ({
        mutateAsync: mockState.mutateAsync,
        isPending: mockState.isPending,
        error: mockState.error,
    }),
}));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function renderManager(columns: Column[]) {
    return render(<ProjectColumnsManager projectSlug="SLYK" columns={columns} />);
}

// Returns the first per-row Delete button, narrowed to a definite Element so
// indexed-access never yields `undefined` to fireEvent (noUncheckedIndexedAccess).
function getFirstDeleteButton(): HTMLElement {
    const buttons = screen.getAllByRole('button', { name: 'Delete' });
    const first = buttons[0];
    if (!first) {
        throw new Error('Expected at least one Delete button');
    }
    return first;
}

const cols: Column[] = [
    { id: 'c1', name: 'Todo' },
    { id: 'c2', name: 'Done' },
];

describe('ProjectColumnsManager', () => {
    beforeEach(() => {
        mockState.mutateAsync = vi.fn().mockResolvedValue(undefined);
        mockState.isPending = false;
        mockState.error = null;
    });

    it('renders the Columns heading and seeded column names (smoke)', () => {
        renderManager(cols);

        expect(screen.getByRole('heading', { name: 'Columns' })).toBeInTheDocument();
        expect(screen.getByLabelText('Column 1 name')).toHaveValue('Todo');
        expect(screen.getByLabelText('Column 2 name')).toHaveValue('Done');
    });

    it('Add Column appends a uuid-id New Column row to the draft only (no mutate)', () => {
        renderManager(cols);

        expect(screen.getAllByRole('textbox')).toHaveLength(2);

        fireEvent.click(screen.getByRole('button', { name: 'Add Column' }));

        const inputs = screen.getAllByRole('textbox');
        expect(inputs).toHaveLength(3);
        expect(screen.getByLabelText('Column 3 name')).toHaveValue('New Column');
        expect(mockState.mutateAsync).not.toHaveBeenCalled();

        // Saving after Add persists 3 columns, the new one with a uuid id.
        fireEvent.click(screen.getByRole('button', { name: 'Save Columns' }));
        const pending = mockState.mutateAsync.mock.calls.at(-1)?.[0];
        expect(pending.columns).toEqual([
            { id: 'c1', name: 'Todo' },
            { id: 'c2', name: 'Done' },
            { id: expect.stringMatching(UUID_RE), name: 'New Column' },
        ]);
    });

    it('Rename updates the draft and Save sends the full columns array', async () => {
        renderManager(cols);

        fireEvent.change(screen.getByLabelText('Column 1 name'), { target: { value: 'Renamed' } });

        expect(screen.getByLabelText('Column 1 name')).toHaveValue('Renamed');
        expect(mockState.mutateAsync).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Save Columns' }));

        await waitFor(() =>
            expect(mockState.mutateAsync).toHaveBeenCalledWith({
                columns: [
                    { id: 'c1', name: 'Renamed' },
                    { id: 'c2', name: 'Done' },
                ],
            }),
        );
    });

    it('Reorder up/down swaps adjacent rows; boundary up/down buttons disabled', async () => {
        renderManager(cols);

        // Boundary: first row's up + last row's down are disabled.
        expect(screen.getByRole('button', { name: 'Move column 1 up' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Move column 2 down' })).toBeDisabled();
        // Middle buttons are enabled.
        expect(screen.getByRole('button', { name: 'Move column 2 up' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Move column 1 down' })).toBeEnabled();

        fireEvent.click(screen.getByRole('button', { name: 'Move column 2 up' }));

        // After swap: row1 = Done, row2 = Todo.
        expect(screen.getByLabelText('Column 1 name')).toHaveValue('Done');
        expect(screen.getByLabelText('Column 2 name')).toHaveValue('Todo');

        fireEvent.click(screen.getByRole('button', { name: 'Save Columns' }));

        await waitFor(() =>
            expect(mockState.mutateAsync).toHaveBeenCalledWith({
                columns: [
                    { id: 'c2', name: 'Done' },
                    { id: 'c1', name: 'Todo' },
                ],
            }),
        );
    });

    it('Delete opens the confirm modal without calling mutateAsync', () => {
        renderManager(cols);

        expect(screen.queryByRole('dialog')).toBeNull();

        fireEvent.click(getFirstDeleteButton());

        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText('Delete column?')).toBeInTheDocument();
        expect(
            screen.getByText(
                'Delete this column? Tickets still in this column must be moved first.',
            ),
        ).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

        expect(mockState.mutateAsync).not.toHaveBeenCalled();
    });

    it('Cancel in the modal closes it and keeps the column (no mutate)', () => {
        renderManager(cols);

        fireEvent.click(getFirstDeleteButton());
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getAllByRole('textbox')).toHaveLength(2);
        expect(mockState.mutateAsync).not.toHaveBeenCalled();
    });

    it('Confirm in the modal calls mutateAsync with that column removed', async () => {
        renderManager(cols);

        fireEvent.click(getFirstDeleteButton());
        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        await waitFor(() =>
            expect(mockState.mutateAsync).toHaveBeenCalledWith({
                columns: [{ id: 'c2', name: 'Done' }],
            }),
        );
    });

    it('A rejected mutation surfaces the server error message in the UI', () => {
        mockState.error = new ApiClientError('Columns cannot be empty', 409, 'CONFLICT');
        mockState.mutateAsync = vi.fn().mockRejectedValue(mockState.error);

        renderManager(cols);

        expect(screen.getByText('Columns cannot be empty')).toBeInTheDocument();
    });
});
