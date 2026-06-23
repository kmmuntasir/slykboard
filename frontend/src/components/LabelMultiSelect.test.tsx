import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useLabels } from '@/hooks/useLabels';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Label } from '@/types/label';
import { LabelMultiSelect } from './LabelMultiSelect';

vi.mock('@/hooks/useLabels', () => ({
    useLabels: vi.fn(),
}));

const labelsFixture: Label[] = [
    { id: 'l1', name: 'Bug', color: '#FF0000' },
    { id: 'l2', name: 'Urgent', color: '#FFA500' },
];

function mockUseLabels(
    overrides: Partial<UseQueryResult<Label[]>> = {},
): UseQueryResult<Label[]> {
    return {
        data: labelsFixture,
        isLoading: false,
        error: null,
        ...overrides,
    } as unknown as UseQueryResult<Label[]>;
}

describe('LabelMultiSelect', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders an accessible Labels trigger button', () => {
        vi.mocked(useLabels).mockReturnValue(mockUseLabels());
        render(<LabelMultiSelect projectSlug="proj" value={[]} onChange={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Labels' })).toBeInTheDocument();
    });

    it('aria-expanded reflects open state after click', () => {
        vi.mocked(useLabels).mockReturnValue(mockUseLabels());
        render(<LabelMultiSelect projectSlug="proj" value={[]} onChange={vi.fn()} />);
        const trigger = screen.getByRole('button', { name: 'Labels' });
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });

    it('lists all labels from useLabels when opened', () => {
        vi.mocked(useLabels).mockReturnValue(mockUseLabels());
        render(<LabelMultiSelect projectSlug="proj" value={[]} onChange={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: 'Labels' }));
        expect(screen.getByRole('checkbox', { name: 'Bug' })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Urgent' })).toBeInTheDocument();
    });

    it('renders selected labels as LabelChips in the trigger', () => {
        vi.mocked(useLabels).mockReturnValue(mockUseLabels());
        render(
            <LabelMultiSelect
                projectSlug="proj"
                value={['l1']}
                onChange={vi.fn()}
            />,
        );
        // Selected chip renders in the trigger button by name; the popover is closed.
        expect(screen.getByText('Bug')).toBeInTheDocument();
        expect(screen.queryByText('Urgent')).toBeNull();
    });

    it('toggling a checkbox fires onChange with the added id', () => {
        const onChange = vi.fn();
        vi.mocked(useLabels).mockReturnValue(mockUseLabels());
        render(<LabelMultiSelect projectSlug="proj" value={[]} onChange={onChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'Labels' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Bug' }));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(['l1']);
    });

    it('toggling a checked checkbox fires onChange with the id removed', () => {
        const onChange = vi.fn();
        vi.mocked(useLabels).mockReturnValue(mockUseLabels());
        render(
            <LabelMultiSelect
                projectSlug="proj"
                value={['l1', 'l2']}
                onChange={onChange}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Labels' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Bug' }));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(['l2']);
    });

    it('closes the popover on outside click', () => {
        vi.mocked(useLabels).mockReturnValue(mockUseLabels());
        render(
            <div>
                <span data-testid="outside">outside</span>
                <LabelMultiSelect projectSlug="proj" value={[]} onChange={vi.fn()} />
            </div>,
        );
        const trigger = screen.getByRole('button', { name: 'Labels' });
        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        fireEvent.mouseDown(screen.getByTestId('outside'));
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('disables the trigger while labels are loading', () => {
        vi.mocked(useLabels).mockReturnValue(
            mockUseLabels({ data: undefined, isLoading: true }),
        );
        render(<LabelMultiSelect projectSlug="proj" value={[]} onChange={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Labels' })).toBeDisabled();
    });
});
