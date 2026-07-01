// F14 T9 / DEL-02: LabelManager component tests.
// Mocks useLabels + the three mutation hooks (vi.hoisted state) so no
// QueryClientProvider is needed — these are render + interaction assertions.
// ConfirmDialog is mocked to expose deterministic Confirm/Cancel triggers so
// the delete flow can be driven without the real Modal portal.
//
// DEL-02 Task 2 — harness extended for the Card + ColorPicker redesign:
//   1. mockState gains `updateIsPending` (seed false) and the useUpdateLabel
//      mock now returns `{ mutate, isPending }`.
//   2. `./ui/ColorPicker` is mocked to a deterministic controlled <input>
//      (the real one portals a Radix Popover to document.body — flaky in jsdom).
//   3. Every render is wrapped in a local <TooltipProvider> (mounted only at
//      app root in production). See ThemeToggle.test.tsx / ui/Tooltip.test.tsx.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { LabelManager } from './LabelManager';
import { TooltipProvider } from '@/components/ui/Tooltip';
import type { Label } from '@/types/label';

const { mockState } = vi.hoisted(() => ({
    mockState: {
        labels: [] as Label[],
        createMutate: vi.fn(),
        updateMutate: vi.fn(),
        deleteMutate: vi.fn(),
        createIsPending: false,
        updateIsPending: false,
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
    useUpdateLabel: () => ({
        mutate: mockState.updateMutate,
        isPending: mockState.updateIsPending,
    }),
    useDeleteLabel: () => ({
        mutate: mockState.deleteMutate,
        isPending: mockState.deleteIsPending,
    }),
}));

vi.mock('@/hooks/useToast', () => ({
    toast: { success: mockState.toastSuccess },
}));

// ColorPicker mock — the real ColorPicker portals a Radix Popover to
// document.body, making its interactions non-deterministic in jsdom. This
// controlled surface mirrors the ConfirmDialog mock style: a plain text input
// carrying the consumer-supplied aria-label so getByLabelText keeps working,
// driven by fireEvent.change. The component passes aria-labels
// "New label color" (create row) and "Edit color for <name>" (edit row).
vi.mock('./ui/ColorPicker', () => ({
    ColorPicker: ({
        value,
        onChange,
        'aria-label': ariaLabel,
    }: {
        value: string;
        onChange: (hex: string) => void;
        'aria-label'?: string;
    }) => (
        <input
            type="text"
            data-testid="color-trigger"
            aria-label={ariaLabel}
            value={value}
            onChange={(e) => onChange(e.target.value)}
        />
    ),
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

// TooltipProvider is mounted app-wide in main.tsx (production) but not in unit
// tests. Task 1 wraps the Edit/Delete icon buttons in Tooltip, so mount a local
// provider here. delayDuration=0 mirrors the project's jsdom Tooltip pattern
// (see ThemeToggle.test.tsx / ui/Tooltip.test.tsx).
function renderWithProvider(node: ReactNode) {
    return render(<TooltipProvider delayDuration={0}>{node}</TooltipProvider>);
}

describe('LabelManager', () => {
    beforeEach(() => {
        mockState.labels = [];
        mockState.createMutate = vi.fn();
        mockState.updateMutate = vi.fn();
        mockState.deleteMutate = vi.fn();
        mockState.createIsPending = false;
        mockState.updateIsPending = false;
        mockState.deleteIsPending = false;
        mockState.toastSuccess = vi.fn();
    });

    // --- Empty state --------------------------------------------------------

    it('empty state: renders "No labels yet" + no Edit/Delete icon buttons', () => {
        mockState.labels = [];
        renderWithProvider(<LabelManager projectSlug="SLYK" />);

        expect(screen.getByText(/No labels yet/)).toBeInTheDocument();
        // No label cards → no Edit/Delete icon buttons.
        expect(screen.queryByRole('button', { name: /Edit / })).toBeNull();
        expect(screen.queryByRole('button', { name: /Delete / })).toBeNull();
    });

    it('renders the create row (heading + New label name/color + Add) without error', () => {
        renderWithProvider(<LabelManager projectSlug="SLYK" />);

        expect(screen.getByRole('heading', { name: 'Labels' })).toBeInTheDocument();
        expect(screen.getByLabelText('New label name')).toBeInTheDocument();
        expect(screen.getByLabelText('New label color')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    });

    // --- List read state ----------------------------------------------------

    it('list read state: each label renders a Card with LabelChip + Edit/Delete icon buttons', () => {
        mockState.labels = [bugLabel, featureLabel];
        renderWithProvider(<LabelManager projectSlug="SLYK" />);

        expect(screen.getByText('Bug')).toBeInTheDocument();
        expect(screen.getByText('Feature')).toBeInTheDocument();

        // Regex aria-labels (Task 1 contract): "Edit <name>" / "Delete <name>".
        expect(screen.getByRole('button', { name: /Edit Bug/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Delete Bug/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Edit Feature/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Delete Feature/ })).toBeInTheDocument();
    });

    // --- Hover / focus reveal ----------------------------------------------

    it('hover/focus reveal — rest state: action container is opacity-0 but buttons stay enabled + reachable', () => {
        mockState.labels = [bugLabel];
        renderWithProvider(<LabelManager projectSlug="SLYK" />);

        // Buttons are keyboard-reachable (getByRole finds them) and enabled.
        const editBtn = screen.getByRole('button', { name: /Edit Bug/ });
        const deleteBtn = screen.getByRole('button', { name: /Delete Bug/ });
        expect(editBtn).toBeEnabled();
        expect(deleteBtn).toBeEnabled();

        // The actions wrapper carries `opacity-0` (active at rest) plus the
        // group-hover/group-focus-within reveal mechanism. The actual visual
        // flip is CSS-driven (Tailwind variants), so it is NOT reflected as a
        // className mutation in jsdom — the static class contract IS the
        // assertion target here.
        const actionsWrapper = editBtn.parentElement;
        expect(actionsWrapper?.className).toContain('opacity-0');
        expect(actionsWrapper?.className).toContain('group-hover:opacity-100');
        expect(actionsWrapper?.className).toContain('group-focus-within:opacity-100');
    });

    it('hover/focus reveal — revealed: the Card carries `group` so the variant classes can apply', () => {
        // jsdom has no CSS engine, so group-hover/group-focus-within never
        // mutate the DOM. The deterministic proxy is the `group` marker on the
        // Card ancestor — without it the reveal variants could never resolve.
        // Asserting the read Card carries `group` + the wrapper carries the
        // reveal variants is the load-bearing contract.
        mockState.labels = [bugLabel];
        renderWithProvider(<LabelManager projectSlug="SLYK" />);

        const editBtn = screen.getByRole('button', { name: /Edit Bug/ });
        const actionsWrapper = editBtn.parentElement;
        const card = actionsWrapper?.parentElement?.parentElement;
        expect(card?.className).toContain('group');
        expect(actionsWrapper?.className).toContain('group-hover:opacity-100');
        expect(actionsWrapper?.className).toContain('group-focus-within:opacity-100');
    });

    // --- Create -------------------------------------------------------------

    it('create: happy path — Add calls createMutate({name,color}); onSuccess fires toast + resets row', () => {
        renderWithProvider(<LabelManager projectSlug="SLYK" />);

        const nameInput = screen.getByLabelText('New label name');
        const colorInput = screen.getByLabelText('New label color');

        // Add starts disabled (empty name).
        expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();

        fireEvent.change(nameInput, { target: { value: 'Urgent' } });
        fireEvent.change(colorInput, { target: { value: '#F59E0B' } });

        // Add is now enabled.
        expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(mockState.createMutate).toHaveBeenCalledWith(
            { name: 'Urgent', color: '#F59E0B' },
            expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
        fireOnSuccess(mockState.createMutate);
        expect(createToast).toHaveBeenCalledWith('Label created.');

        // Row reset: name back to '' and color back to #6B7280 (assert via the
        // mocked ColorPicker value).
        expect(nameInput).toHaveValue('');
        expect(colorInput).toHaveValue('#6B7280');
    });

    it('create: trims the name before calling mutate', () => {
        renderWithProvider(<LabelManager projectSlug="SLYK" />);

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
        renderWithProvider(<LabelManager projectSlug="SLYK" />);

        expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        expect(mockState.createMutate).not.toHaveBeenCalled();
    });

    it('create: Add disabled when createIsPending (seed true)', () => {
        mockState.createIsPending = true;
        renderWithProvider(<LabelManager projectSlug="SLYK" />);

        const addBtn = screen.getByRole('button', { name: 'Add' });
        // Seed a name so the ONLY disable reason is the pending flag.
        fireEvent.change(screen.getByLabelText('New label name'), {
            target: { value: 'Pending' },
        });
        expect(addBtn).toBeDisabled();
        fireEvent.click(addBtn);
        expect(mockState.createMutate).not.toHaveBeenCalled();
    });

    // --- Inline edit --------------------------------------------------------

    it('edit: happy path — Edit swaps to editor; Save calls updateMutate + fires "Label updated." toast', () => {
        mockState.labels = [bugLabel];
        renderWithProvider(<LabelManager projectSlug="SLYK" />);

        // Enter edit mode.
        fireEvent.click(screen.getByRole('button', { name: /Edit Bug/ }));
        const editName = screen.getByLabelText('Label name');
        expect(editName).toBeInTheDocument();
        expect(editName).toHaveValue('Bug');
        // Edit color picker is labelled "Edit color for <name>".
        expect(screen.getByLabelText('Edit color for Bug')).toHaveValue('#EF4444');

        // Rename.
        fireEvent.change(editName, { target: { value: 'Defect' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(mockState.updateMutate).toHaveBeenCalledWith(
            { labelId: 'l1', dto: { name: 'Defect', color: '#EF4444' } },
            expect.objectContaining({ onSuccess: expect.any(Function) }),
        );
        fireOnSuccess(mockState.updateMutate);
        expect(createToast).toHaveBeenCalledWith('Label updated.');

        // Editor exited — read card is back.
        expect(screen.queryByLabelText('Label name')).toBeNull();
        expect(screen.getByRole('button', { name: /Edit Bug/ })).toBeInTheDocument();
    });

    it('edit: Save disabled when name is empty', () => {
        mockState.labels = [bugLabel];
        renderWithProvider(<LabelManager projectSlug="SLYK" />);

        fireEvent.click(screen.getByRole('button', { name: /Edit Bug/ }));
        const editName = screen.getByLabelText('Label name');
        fireEvent.change(editName, { target: { value: '' } });

        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('edit: Save disabled when updateIsPending (seed true)', () => {
        mockState.labels = [bugLabel];
        mockState.updateIsPending = true;
        renderWithProvider(<LabelManager projectSlug="SLYK" />);

        fireEvent.click(screen.getByRole('button', { name: /Edit Bug/ }));
        // Name non-empty: the ONLY disable reason is the pending flag.
        expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    });

    it('edit: Cancel exits edit mode without calling updateMutate', () => {
        mockState.labels = [bugLabel];
        renderWithProvider(<LabelManager projectSlug="SLYK" />);

        fireEvent.click(screen.getByRole('button', { name: /Edit Bug/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(screen.queryByLabelText('Label name')).toBeNull();
        expect(mockState.updateMutate).not.toHaveBeenCalled();
    });

    // --- Delete confirm -----------------------------------------------------

    it('delete: Delete icon opens the ConfirmDialog with title + message', () => {
        mockState.labels = [bugLabel];
        renderWithProvider(<LabelManager projectSlug="SLYK" />);

        expect(screen.queryByTestId('confirm-dialog')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /Delete Bug/ }));

        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
        expect(screen.getByText('Delete label?')).toBeInTheDocument();
        expect(
            screen.getByText('This label will be removed from all tickets. This cannot be undone.'),
        ).toBeInTheDocument();
    });

    it('delete: Cancel in the dialog clears it without calling deleteMutate', () => {
        mockState.labels = [bugLabel];
        renderWithProvider(<LabelManager projectSlug="SLYK" />);

        fireEvent.click(screen.getByRole('button', { name: /Delete Bug/ }));
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'DoCancel' }));

        expect(screen.queryByTestId('confirm-dialog')).toBeNull();
        expect(mockState.deleteMutate).not.toHaveBeenCalled();
    });

    it('delete: confirm calls deleteMutate(bare id) + clears dialog + fires "Label deleted." toast', () => {
        mockState.labels = [bugLabel];
        renderWithProvider(<LabelManager projectSlug="SLYK" />);

        fireEvent.click(screen.getByRole('button', { name: /Delete Bug/ }));
        fireEvent.click(screen.getByRole('button', { name: 'DoConfirm' }));

        // Bare string id, NOT an object payload.
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
