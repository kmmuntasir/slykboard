// F14 T9: LabelManager component tests.
// Mocks useLabels + the three mutation hooks (vi.hoisted state) so no
// QueryClientProvider is needed — these are render + interaction assertions.
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
    },
}));

vi.mock('@/hooks/useLabels', () => ({
    useLabels: () => ({ data: mockState.labels }),
}));

vi.mock('@/hooks/useLabelMutations', () => ({
    useCreateLabel: () => ({ mutate: mockState.createMutate, isPending: mockState.createIsPending }),
    useUpdateLabel: () => ({ mutate: mockState.updateMutate }),
    useDeleteLabel: () => ({ mutate: mockState.deleteMutate }),
}));

const bugLabel: Label = { id: 'l1', name: 'Bug', color: '#EF4444' };
const featureLabel: Label = { id: 'l2', name: 'Feature', color: '#10B981' };

describe('LabelManager', () => {
    beforeEach(() => {
        mockState.labels = [];
        mockState.createMutate = vi.fn();
        mockState.updateMutate = vi.fn();
        mockState.deleteMutate = vi.fn();
        mockState.createIsPending = false;
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

    it('create: typing a name + Add calls createLabel mutate', () => {
        render(<LabelManager projectSlug="SLYK" />);

        fireEvent.change(screen.getByLabelText('New label name'), { target: { value: 'Urgent' } });
        fireEvent.change(screen.getByLabelText('New label color'), { target: { value: '#F59E0B' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(mockState.createMutate).toHaveBeenCalledWith({
            name: 'Urgent',
            color: '#F59E0B',
        });
    });

    it('create: trims the name before calling mutate', () => {
        render(<LabelManager projectSlug="SLYK" />);

        fireEvent.change(screen.getByLabelText('New label name'), {
            target: { value: '  Spaced  ' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(mockState.createMutate).toHaveBeenCalledWith({
            name: 'Spaced',
            color: '#6B7280',
        });
    });

    it('create: Add disabled when name is empty (no mutate)', () => {
        render(<LabelManager projectSlug="SLYK" />);

        expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        expect(mockState.createMutate).not.toHaveBeenCalled();
    });

    it('edit: Edit reveals inline controls; Save calls updateLabel mutate', () => {
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

        expect(mockState.updateMutate).toHaveBeenCalledWith({
            labelId: 'l1',
            dto: { name: 'Defect', color: '#EF4444' },
        });
    });

    it('edit: Cancel exits edit mode without mutating', () => {
        mockState.labels = [bugLabel];
        render(<LabelManager projectSlug="SLYK" />);

        fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByLabelText('Edit label name')).toBeNull();
        expect(mockState.updateMutate).not.toHaveBeenCalled();
    });

    it('delete: Delete reveals confirm prompt; Confirm calls deleteLabel mutate', () => {
        mockState.labels = [bugLabel];
        render(<LabelManager projectSlug="SLYK" />);

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        expect(screen.getByText('Delete? Removes from all tickets.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
        expect(mockState.deleteMutate).toHaveBeenCalledWith('l1');
    });

    it('delete: Cancel exits confirm mode without mutating', () => {
        mockState.labels = [bugLabel];
        render(<LabelManager projectSlug="SLYK" />);

        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByText('Delete? Removes from all tickets.')).toBeNull();
        expect(mockState.deleteMutate).not.toHaveBeenCalled();
    });
});
