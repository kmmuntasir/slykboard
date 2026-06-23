import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ChecklistEditor } from './ChecklistEditor';
import type { ChecklistItem } from '@/types/ticket';

function makeItem(over: Partial<ChecklistItem> = {}): ChecklistItem {
    return { id: 'i1', text: 'Item', done: false, ...over };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('ChecklistEditor', () => {
    it('renders existing items as checkbox + text input + delete button', () => {
        render(<ChecklistEditor value={[makeItem({ id: 'i1', text: 'Design', done: true })]} onChange={vi.fn()} />);
        expect(screen.getByRole('checkbox', { name: 'Toggle "Design"' })).toBeChecked();
        expect(screen.getByLabelText('Edit checklist item "Design"')).toHaveValue('Design');
        expect(
            screen.getByRole('button', { name: 'Delete checklist item "Design"' }),
        ).toBeInTheDocument();
    });

    it('shows progress done/total + an a11y progressbar', () => {
        render(
            <ChecklistEditor
                value={[
                    makeItem({ id: 'i1', text: 'A', done: true }),
                    makeItem({ id: 'i2', text: 'B', done: false }),
                ]}
                onChange={vi.fn()}
            />,
        );
        expect(screen.getByText('1/2')).toBeInTheDocument();
        const bar = screen.getByRole('progressbar');
        expect(bar).toHaveAttribute('aria-valuenow', '1');
        expect(bar).toHaveAttribute('aria-valuemax', '2');
    });

    it('add via Enter appends a uuid-id item (done:false) and clears the draft', () => {
        const onChange = vi.fn();
        render(<ChecklistEditor value={[]} onChange={onChange} />);
        const input = screen.getByLabelText('New checklist item');
        fireEvent.change(input, { target: { value: 'New task' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(onChange).toHaveBeenCalledTimes(1);
        const added = onChange.mock.calls[0]![0] as ChecklistItem[];
        expect(added).toHaveLength(1);
        expect(added[0]?.text).toBe('New task');
        expect(added[0]?.done).toBe(false);
        expect(added[0]?.id).toMatch(UUID_RE);
        // Draft cleared internally → Add disabled again.
        expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    });

    it('add via Add button click appends the item', () => {
        const onChange = vi.fn();
        render(<ChecklistEditor value={[]} onChange={onChange} />);
        fireEvent.change(screen.getByLabelText('New checklist item'), { target: { value: 'X' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));
        expect(onChange).toHaveBeenCalledWith([
            { id: expect.any(String), text: 'X', done: false },
        ]);
    });

    it('Add is disabled when the draft is empty or at capacity (50)', () => {
        const { rerender } = render(<ChecklistEditor value={[]} onChange={vi.fn()} />);
        // Empty draft → disabled.
        expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();

        const full = Array.from({ length: 50 }, (_, i) =>
            makeItem({ id: `i${i}`, text: `t${i}` }),
        );
        rerender(<ChecklistEditor value={full} onChange={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('New checklist item'), {
            target: { value: 'overflow' },
        });
        // At capacity → still disabled, and the cap notice renders.
        expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
        expect(screen.getByText('Maximum 50 items reached.')).toBeInTheDocument();
    });

    it('toggle flips done for the targeted item only', () => {
        const onChange = vi.fn();
        render(
            <ChecklistEditor
                value={[makeItem({ id: 'i1', text: 'A', done: false })]}
                onChange={onChange}
            />,
        );
        fireEvent.click(screen.getByRole('checkbox', { name: 'Toggle "A"' }));
        expect(onChange).toHaveBeenCalledWith([{ id: 'i1', text: 'A', done: true }]);
    });

    it('edit text updates the item text', () => {
        const onChange = vi.fn();
        render(
            <ChecklistEditor
                value={[makeItem({ id: 'i1', text: 'A', done: false })]}
                onChange={onChange}
            />,
        );
        fireEvent.change(screen.getByLabelText('Edit checklist item "A"'), {
            target: { value: 'Updated' },
        });
        expect(onChange).toHaveBeenCalledWith([{ id: 'i1', text: 'Updated', done: false }]);
    });

    it('delete removes the targeted item', () => {
        const onChange = vi.fn();
        render(
            <ChecklistEditor
                value={[makeItem({ id: 'i1', text: 'A' }), makeItem({ id: 'i2', text: 'B' })]}
                onChange={onChange}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Delete checklist item "A"' }));
        expect(onChange).toHaveBeenCalledWith([makeItem({ id: 'i2', text: 'B' })]);
    });

    it('caps text inputs at 200 chars (maxLength attribute)', () => {
        render(<ChecklistEditor value={[makeItem({ id: 'i1', text: 'A' })]} onChange={vi.fn()} />);
        expect(screen.getByLabelText('Edit checklist item "A"')).toHaveAttribute('maxlength', '200');
        expect(screen.getByLabelText('New checklist item')).toHaveAttribute('maxlength', '200');
    });
});
