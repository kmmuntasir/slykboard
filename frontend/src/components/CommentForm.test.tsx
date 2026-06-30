import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { CommentForm } from './CommentForm';

// SLYK-13 T11 — CommentForm tests. Table-driven for the disabled-state matrix
// (empty / whitespace-only / isPending), plus explicit cases for the trimmed
// submit payload and the edit-mode Cancel (restore + onCancel).

const ENTER = '  Great work!  ';

describe('CommentForm', () => {
    it.each([
        { name: 'empty body', value: '', expected: true },
        { name: 'whitespace-only body', value: '   \n\t  ', expected: true },
        { name: 'non-empty trimmed body', value: 'Hello', expected: false },
    ])('submit disabled state is $expected when body is "$name"', ({ value, expected }) => {
        render(<CommentForm mode="create" onSubmit={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Write a comment'), { target: { value } });
        const submit = screen.getByRole('button', { name: 'Comment' });
        if (expected) {
            expect(submit).toBeDisabled();
        } else {
            expect(submit).not.toBeDisabled();
        }
    });

    it('disables submit when isPending is true even with a valid body', () => {
        render(<CommentForm mode="create" initialValue="Draft" isPending onSubmit={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Comment' })).toBeDisabled();
    });

    it('fires onSubmit with the TRIMMED body and clears the field (create mode)', () => {
        const onSubmit = vi.fn();
        render(<CommentForm mode="create" onSubmit={onSubmit} />);
        const textarea = screen.getByLabelText('Write a comment');
        fireEvent.change(textarea, { target: { value: ENTER } });
        fireEvent.click(screen.getByRole('button', { name: 'Comment' }));

        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit).toHaveBeenCalledWith('Great work!');
        expect(textarea).toHaveValue('');
    });

    it('keeps the field in edit mode (parent controls teardown) after submit', () => {
        const onSubmit = vi.fn();
        render(<CommentForm mode="edit" initialValue="Original" onSubmit={onSubmit} />);
        const textarea = screen.getByLabelText('Edit comment');
        fireEvent.change(textarea, { target: { value: '  Updated  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save' }));

        expect(onSubmit).toHaveBeenCalledWith('Updated');
        // Edit mode must not auto-clear — parent decides.
        expect(textarea).toHaveValue('  Updated  ');
    });

    it('Cancel restores initialValue and calls onCancel (edit mode)', () => {
        const onCancel = vi.fn();
        render(
            <CommentForm
                mode="edit"
                initialValue="Original"
                onSubmit={vi.fn()}
                onCancel={onCancel}
            />,
        );
        const textarea = screen.getByLabelText('Edit comment');
        fireEvent.change(textarea, { target: { value: 'Something else' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(textarea).toHaveValue('Original');
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('uses the default submit label per mode when submitLabel is omitted', () => {
        const { rerender } = render(<CommentForm mode="create" onSubmit={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Comment' })).toBeInTheDocument();
        rerender(<CommentForm mode="edit" initialValue="x" onSubmit={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    });
});
