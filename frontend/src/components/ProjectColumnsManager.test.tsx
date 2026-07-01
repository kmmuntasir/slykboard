// SLYK-02 T3: ProjectColumnsManager component tests.
//
// jsdom CANNOT drive pangea's pointer sensor, so the drag-end CONTRACT is
// verified two ways (mirrors the boardReorder.test.ts approach of testing pure
// reorder math without driving the pointer sensor):
//   1. The pure reorderColumns() helper is unit-tested directly.
//   2. The component's onDragEnd path is exercised by capturing the
//      DragDropContext's onDragEnd from the mounted tree and invoking it with a
//      synthetic DropResult, then asserting updateMut.mutateAsync was called
//      with the reordered columns and toast.success fired.
//
// Mocks useUpdateProject + toast so no QueryClientProvider / sonner is needed.
// ConfirmDialog is mocked to expose deterministic Confirm/Cancel triggers so
// the delete flow can be driven without the real Modal portal (mirrors
// LabelManager.test.tsx). renderInDnd mounts the pangea ancestors the real
// Droppable/Draggable require.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ProjectColumnsManager, reorderColumns } from './ProjectColumnsManager';
import { renderInDnd } from '@/test/dndWrapper';
import type { Column } from '@/types/project';
import type { DropResult } from '@hello-pangea/dnd';

const { mockState, capturedOnDragEnd } = vi.hoisted(() => ({
    mockState: {
        mutateAsync: vi.fn() as ReturnType<typeof vi.fn>,
        isPending: false,
        error: null as null | Error,
        toastSuccess: vi.fn() as ReturnType<typeof vi.fn>,
    },
    capturedOnDragEnd: {
        current: null as null | ((r: DropResult) => void | Promise<void>),
    },
}));

vi.mock('@/hooks/useUpdateProject', () => ({
    useUpdateProject: () => ({
        mutateAsync: mockState.mutateAsync,
        isPending: mockState.isPending,
        error: mockState.error,
    }),
}));

// Note: the toast.success spy is read dynamically (via mockState) so that
// beforeEach's reassignment is visible to the mocked module — capturing the
// value at module-eval time would freeze a stale reference.
vi.mock('@/hooks/useToast', () => ({
    toast: { success: (...args: unknown[]) => mockState.toastSuccess(...args) },
}));

// Capture the DragDropContext onDragEnd while keeping the REAL DragDropContext
// (and the real Droppable/Draggable) so pangea's internal Redux store is wired
// up — stubbing DragDropContext breaks the store Connect(Droppable) needs. We
// wrap the real component and grab its onDragEnd prop for the synthetic-drop
// assertions.
vi.mock('@hello-pangea/dnd', async () => {
    const actual = await vi.importActual<typeof import('@hello-pangea/dnd')>('@hello-pangea/dnd');
    const RealDragDropContext = actual.DragDropContext;
    return {
        ...actual,
        DragDropContext: ({
            onDragEnd,
            ...rest
        }: {
            onDragEnd: (r: DropResult) => void | Promise<void>;
            children: ReactNode;
        }) => {
            capturedOnDragEnd.current = onDragEnd;
            return RealDragDropContext({ onDragEnd, ...rest });
        },
    };
});

// ConfirmDialog mock — exposes deterministic Confirm/Cancel triggers wired to
// the real handlers + renders the title/message so tests can assert the dialog.
vi.mock('./ConfirmDialog', () => ({
    ConfirmDialog: ({
        isOpen,
        title,
        message,
        onConfirm,
        onCancel,
    }: {
        isOpen: boolean;
        title: string;
        message?: string;
        onConfirm: () => void;
        onCancel: () => void;
    }) => {
        if (!isOpen) return null;
        return (
            <div data-testid="confirm-dialog" role="dialog" aria-label={title}>
                <h2>{title}</h2>
                {message ? <p>{message}</p> : null}
                <button type="button" onClick={onConfirm}>
                    DoConfirm
                </button>
                <button type="button" onClick={onCancel}>
                    DoCancel
                </button>
            </div>
        );
    },
}));

const todoCol: Column = { id: 'c1', name: 'To Do' };
const doingCol: Column = { id: 'c2', name: 'In Progress' };
const doneCol: Column = { id: 'c3', name: 'Done' };
const baseColumns: Column[] = [todoCol, doingCol, doneCol];

// Build a synthetic DropResult the way pangea would for a vertical reorder.
function dropResult(
    source: number,
    destination: number | null | undefined,
    draggableId: string,
): DropResult {
    return {
        draggableId,
        type: 'COLUMN',
        source: { index: source, droppableId: 'columns' },
        destination:
            destination === null || destination === undefined
                ? null
                : { index: destination, droppableId: 'columns' },
        reason: 'DROP',
        mode: 'FLUID',
        combine: null,
    } as DropResult;
}

describe('reorderColumns (pure helper)', () => {
    it('returns the reordered array when source !== destination', () => {
        const result = reorderColumns(baseColumns, 0, 2);
        expect(result).not.toBeNull();
        expect(result?.map((c) => c.id)).toEqual(['c2', 'c3', 'c1']);
    });

    it('returns null on a no-op (same index)', () => {
        expect(reorderColumns(baseColumns, 1, 1)).toBeNull();
    });

    it('returns null when destination is missing (dropped outside)', () => {
        expect(reorderColumns(baseColumns, 1, null)).toBeNull();
        expect(reorderColumns(baseColumns, 1, undefined)).toBeNull();
    });

    it('does not mutate the input array', () => {
        const snapshot = [...baseColumns];
        reorderColumns(baseColumns, 0, 2);
        expect(baseColumns).toEqual(snapshot);
    });
});

describe('ProjectColumnsManager', () => {
    beforeEach(() => {
        mockState.mutateAsync = vi.fn().mockResolvedValue(undefined);
        mockState.isPending = false;
        mockState.error = null;
        mockState.toastSuccess = vi.fn();
        capturedOnDragEnd.current = null;
    });

    function renderManager(columns: Column[] = baseColumns) {
        return renderInDnd(<ProjectColumnsManager projectSlug="SLYK" columns={columns} />, {
            type: 'COLUMN',
            droppableId: 'columns',
        });
    }

    it('renders the column list + Add Column button, no Save/Up/Down affordances', () => {
        renderManager();

        expect(screen.getByRole('heading', { name: 'Columns' })).toBeInTheDocument();
        expect(screen.getByLabelText('Column 1 name')).toHaveValue('To Do');
        expect(screen.getByLabelText('Column 2 name')).toHaveValue('In Progress');
        expect(screen.getByLabelText('Column 3 name')).toHaveValue('Done');
        expect(screen.getByRole('button', { name: 'Add Column' })).toBeInTheDocument();

        // No Save Columns button.
        expect(screen.queryByRole('button', { name: /Save Columns/i })).toBeNull();
        // No Up/Down arrow buttons.
        expect(screen.queryByLabelText(/Move column.*up/i)).toBeNull();
        expect(screen.queryByLabelText(/Move column.*down/i)).toBeNull();
    });

    it('renders a drag handle per row', () => {
        renderManager();

        expect(screen.getByLabelText('Drag handle for column 1')).toBeInTheDocument();
        expect(screen.getByLabelText('Drag handle for column 2')).toBeInTheDocument();
        expect(screen.getByLabelText('Drag handle for column 3')).toBeInTheDocument();
    });

    it('drag-end persists reordered columns + toasts "Columns saved."', async () => {
        renderManager();

        expect(capturedOnDragEnd.current).not.toBeNull();
        // handleDragEnd calls setDraft (state update) then awaits mutateAsync +
        // toasts. Wrap in act so React flushes the state update.
        await act(async () => {
            await capturedOnDragEnd.current!(dropResult(0, 2, 'c1'));
        });

        // Mutate persisted with the reordered array.
        await waitFor(() =>
            expect(mockState.mutateAsync).toHaveBeenCalledWith({
                columns: [
                    { id: 'c2', name: 'In Progress' },
                    { id: 'c3', name: 'Done' },
                    { id: 'c1', name: 'To Do' },
                ],
            }),
        );
        // Toast fires after the successful mutate.
        await waitFor(() => expect(mockState.toastSuccess).toHaveBeenCalledWith('Columns saved.'));
    });

    it('no-op drop (same index) does NOT mutate or toast', async () => {
        renderManager();

        await capturedOnDragEnd.current!(dropResult(1, 1, 'c2'));

        expect(mockState.mutateAsync).not.toHaveBeenCalled();
        expect(mockState.toastSuccess).not.toHaveBeenCalled();
    });

    it('drop outside a destination does NOT mutate or toast', async () => {
        renderManager();

        await capturedOnDragEnd.current!(dropResult(1, null, 'c2'));

        expect(mockState.mutateAsync).not.toHaveBeenCalled();
        expect(mockState.toastSuccess).not.toHaveBeenCalled();
    });

    it('name onBlur persists the draft (no toast on rename)', async () => {
        renderManager();

        const input = screen.getByLabelText('Column 1 name');
        fireEvent.change(input, { target: { value: 'Backlog' } });
        fireEvent.blur(input);

        await waitFor(() =>
            expect(mockState.mutateAsync).toHaveBeenCalledWith({
                columns: [
                    { id: 'c1', name: 'Backlog' },
                    { id: 'c2', name: 'In Progress' },
                    { id: 'c3', name: 'Done' },
                ],
            }),
        );
        expect(mockState.toastSuccess).not.toHaveBeenCalled();
    });

    it('Add Column appends a uuid-id New Column + persists immediately', async () => {
        renderManager();

        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        expect(screen.getAllByRole('textbox')).toHaveLength(3);

        fireEvent.click(screen.getByRole('button', { name: 'Add Column' }));

        // New row appears immediately in the draft (optimistic).
        expect(screen.getAllByRole('textbox')).toHaveLength(4);
        expect(screen.getByLabelText('Column 4 name')).toHaveValue('New Column');

        await waitFor(() => expect(mockState.mutateAsync).toHaveBeenCalledTimes(1));
        const firstCall = mockState.mutateAsync.mock.calls[0];
        const call = firstCall?.[0] as { columns: Column[] };
        expect(call.columns).toHaveLength(4);
        expect(call.columns[3]).toEqual({ id: expect.stringMatching(UUID_RE), name: 'New Column' });
        // Existing columns preserved.
        expect(call.columns.slice(0, 3).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    });

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

    it('delete: Delete opens the ConfirmDialog with title + message', () => {
        renderManager();

        expect(screen.queryByTestId('confirm-dialog')).toBeNull();

        fireEvent.click(getFirstDeleteButton());

        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
        expect(screen.getByText('Delete column?')).toBeInTheDocument();
        expect(
            screen.getByText('Are you sure? Tickets in this column must be moved first.'),
        ).toBeInTheDocument();
        expect(mockState.mutateAsync).not.toHaveBeenCalled();
    });

    it('delete: Cancel in the dialog closes it without mutating', () => {
        renderManager();

        fireEvent.click(getFirstDeleteButton());
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'DoCancel' }));

        expect(screen.queryByTestId('confirm-dialog')).toBeNull();
        expect(mockState.mutateAsync).not.toHaveBeenCalled();
    });

    it('delete: confirm removes the column + persists (dialog cleared, no toast)', async () => {
        renderManager();

        fireEvent.click(getFirstDeleteButton());
        fireEvent.click(screen.getByRole('button', { name: 'DoConfirm' }));

        // Dialog cleared immediately on confirm.
        expect(screen.queryByTestId('confirm-dialog')).toBeNull();

        await waitFor(() =>
            expect(mockState.mutateAsync).toHaveBeenCalledWith({
                columns: [
                    { id: 'c2', name: 'In Progress' },
                    { id: 'c3', name: 'Done' },
                ],
            }),
        );
        // No success toast on delete (criterion toasts only reorder).
        expect(mockState.toastSuccess).not.toHaveBeenCalled();
    });
});
