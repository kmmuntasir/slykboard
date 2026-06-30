// F14 T9: LabelManager component tests.
// Mocks useLabels + the three mutation hooks (vi.hoisted state) so no
// QueryClientProvider is needed — these are render + interaction assertions.
// ConfirmDialog is mocked to expose deterministic Confirm/Cancel triggers so
// the delete flow can be driven without the real Modal portal.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LabelManager } from './LabelManager';
import type { Label } from '@/types/label';

const { mockState } = vi.hoisted(() => ({
    mockState: {
        labels: [] as Label[],
        createMutate: vi.fn(),
        updateMutate: vi.fn(),
        deleteMutate: vi.fn(),
        createIsPending: false,
        deleteIsPending: false,
        toastSuccess: vi.fn(),
    },
}));

vi.mock('@/hooks/useLabels', () => ({
    useLabels: () => ({ data: mockState.labels }),
}));

vi.mock('@/hooks/useLabelMutations', () => ({
    useCreateLabel: () => ({
        mutate: mockState.createMutate,
        isPending: mockState.createIsPending,
    }),
    useUpdateLabel: () => ({ mutate: mockState.updateMutate }),
    useDeleteLabel: () => ({
        mutate: mockState.deleteMutate,
        isPending: mockState.deleteIsPending,
    }),
}));

vi.mock('@/hooks/useToast', () => ({
    toast: { success: mockState.toastSuccess },
}));

// ConfirmDialog mock — mirrors the AddMemberModal.test.tsx pattern. Exposes
// deterministic Confirm/Cancel triggers wired to the real handlers + renders
// the dialog title/message so tests can assert the dialog surfaced.
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

const createToast = mockState.toastSuccess;

const bugLabel: Label = { id: 'l1', name: 'Bug', color: '#EF4444' };
const featureLabel: Label = { id: 'l2', name: 'Feature', color: '#10B981' };

// Invoke the per-call onSuccess passed as the 2nd mutate arg (mirrors how the
// real mutation hook resolves onSuccess), so toast assertions can run sync.
function fireOnSuccess(mutateSpy: ReturnType<typeof vi.fn>) {
    const opts = mutateSpy.mock.calls.at(-1)?.[1] as { onSuccess?: () => void } | undefined;
    opts?.onSuccess?.();
}

describe('LabelManager', () => {
    beforeEach(() => {
        mockState.labels = [];
        mockState.createMutate = vi.fn();
        mockState.updateMutate = vi.fn();
        mockState.deleteMutate = vi.fn();
        mockState.createIsPending = false;
        mockState.deleteIsPending = false;
        mockState.toastSuccess = vi.fn();
    });

    it('renders the create row + empty label list without error', () => {
        render(<LabelManager projectSlug="SLYK" />);

        expect(screen.getByRole('heading', { name: 'Labels' })).toBeInTheDocument();
        expect(screen.getByLabelText('New label name')).toBeInTheDocument();
        expect(screen.getByLabelText('New label color')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
        // No Edit/Delete buttons when empty.
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });

    it('renders the label list from useLabels', () => {
        mockState.labels = [bugLabel, featureLabel];
        render(<LabelManager projectSlug="SLYK" />);

        expect(screen.getByText('Bug')).toBeInTheDocument();
        expect(screen.getByText('Feature')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(2);
        expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2);
    });

    it('create: typing a name + Add calls createLabel mutate + fires "Label created." toast', () => {
        render(<LabelManager projectSlug="SLYK" />);

        fireEvent.change(screen.getByLabelText('New label name'), { target: { value: 'Urgent' } });
        fireEvent.change(screen.getByLabelText('New label color'), {
            target: { value: '#F59E0B' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(mockState.createMutate).toHaveBeenCalledWith(
            { name: 'Urgent', color: '#F59E0B' },
            expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
        fireOnSuccess(mockState.createMutate);
        expect(createToast).toHaveBeenCalledWith('Label created.');
    });

    it('create: trims the name before calling mutate', () => {
        render(<LabelManager projectSlug="SLYK" />);

        fireEvent.change(screen.getByLabelText('New label name'), {
            target: { value: '  Spaced  ' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(mockState.createMutate).toHaveBeenCalledWith(
            { name: 'Spaced', color: '#6B7280' },
            expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
    });

    it('create: Add disabled when name is empty (no mutate)', () => {
        render(<LabelManager projectSlug="SLYK" />);

        expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        expect(mockState.createMutate).not.toHaveBeenCalled();
    });

    it('edit: Edit reveals inline controls; Save calls updateLabel mutate + fires "Label updated." toast', () => {
        mockState.labels = [bugLabel];
        render(<LabelManager projectSlug="SLYK" />);

        // Enter edit mode.
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        const editName = screen.getByLabelText('Edit label name');
        expect(editName).toBeInTheDocument();
        expect(editName).toHaveValue('Bug');

        // Rename.
        fireEvent.change(editName, { target: { value: 'Defect' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(mockState.updateMutate).toHaveBeenCalledWith(
            { labelId: 'l1', dto: { name: 'Defect', color: '#EF4444' } },
            expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
        fireOnSuccess(mockState.updateMutate);
        expect(createToast).toHaveBeenCalledWith('Label updated.');
    });

    it('edit: Cancel exits edit mode without mutating', () => {
        mockState.labels = [bugLabel];
        render(<LabelManager projectSlug="SLYK" />);

        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByLabelText('Edit label name')).toBeNull();
        expect(mockState.updateMutate).not.toHaveBeenCalled();
    });

    it('delete: Delete opens the ConfirmDialog with title + message', () => {
        mockState.labels = [bugLabel];
        render(<LabelManager projectSlug="SLYK" />);

        // No dialog before clicking Delete.
        expect(screen.queryByTestId('confirm-dialog')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

        // Dialog surfaced with the expected title + message.
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
        expect(screen.getByText('Delete label?')).toBeInTheDocument();
        expect(
            screen.getByText('This label will be removed from all tickets. This cannot be undone.'),
        ).toBeInTheDocument();
    });

    it('delete: Cancel in the dialog clears it without calling deleteMut', () => {
        mockState.labels = [bugLabel];
        render(<LabelManager projectSlug="SLYK" />);

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'DoCancel' }));

        expect(screen.queryByTestId('confirm-dialog')).toBeNull();
        expect(mockState.deleteMutate).not.toHaveBeenCalled();
    });

    it('delete: confirm calls deleteLabel mutate(id) + clears the dialog + fires "Label deleted." toast', () => {
        mockState.labels = [bugLabel];
        render(<LabelManager projectSlug="SLYK" />);

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        fireEvent.click(screen.getByRole('button', { name: 'DoConfirm' }));

        expect(mockState.deleteMutate).toHaveBeenCalledWith(
            'l1',
            expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
        // Dialog cleared immediately on confirm.
        expect(screen.queryByTestId('confirm-dialog')).toBeNull();

        fireOnSuccess(mockState.deleteMutate);
        expect(createToast).toHaveBeenCalledWith('Label deleted.');
    });
});
