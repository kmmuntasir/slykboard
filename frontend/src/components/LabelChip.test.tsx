import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LabelChip } from './LabelChip';
import type { Label } from '@/types/label';

// F14 T7: LabelChip — name renders, runtime hex applied inline, remove button
// is accessible + fires handler, readableTextColor selects black/white text.
function makeLabel(overrides: Partial<Label> = {}): Label {
    return { id: 'l1', name: 'Bug', color: '#FF0000', ...overrides };
}

describe('LabelChip', () => {
    it('renders the label name', () => {
        render(<LabelChip label={makeLabel({ name: 'Defect' })} />);
        expect(screen.getByText('Defect')).toBeInTheDocument();
    });

    it('applies the label color as inline backgroundColor', () => {
        render(<LabelChip label={makeLabel({ color: '#123456' })} />);
        const chip = screen.getByText('Bug').closest('span');
        expect(chip?.style.backgroundColor).toBe('rgb(18, 52, 86)');
    });

    it('does not render a remove button when onRemove is omitted', () => {
        render(<LabelChip label={makeLabel()} />);
        expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    });

    it('renders an accessible remove button that fires onRemove', () => {
        const onRemove = vi.fn();
        render(<LabelChip label={makeLabel({ name: 'Bug' })} onRemove={onRemove} />);
        const btn = screen.getByRole('button', { name: /Remove/ });
        expect(btn).toHaveAccessibleName('Remove Bug');
        fireEvent.click(btn);
        expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it.each([
        { name: 'light background -> black text', color: '#FFFF00', expected: 'rgb(0, 0, 0)' },
        { name: 'dark background -> white text', color: '#000000', expected: 'rgb(255, 255, 255)' },
    ])('picks readable text color for $name', ({ color, expected }) => {
        render(<LabelChip label={makeLabel({ color })} />);
        const chip = screen.getByText('Bug').closest('span');
        expect(chip?.style.color).toBe(expected);
    });
});
