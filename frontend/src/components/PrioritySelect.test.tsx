import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PrioritySelect } from './PrioritySelect';
import { PRIORITY_DISPLAY } from '@/types/ticket';
import type { Priority } from '@/types/ticket';

describe('PrioritySelect', () => {
    const cases: Array<{ priority: Priority; label: string }> = (
        Object.keys(PRIORITY_DISPLAY) as Priority[]
    ).map((p) => ({ priority: p, label: PRIORITY_DISPLAY[p] }));

    it('renders all 5 priority options with display labels', () => {
        render(<PrioritySelect value="LOW" onChange={vi.fn()} />);
        expect(screen.getAllByRole('option')).toHaveLength(5);
        cases.forEach(({ label }) => {
            expect(screen.getByRole('option', { name: label })).toBeInTheDocument();
        });
    });

    it('is accessible via combobox role with "Priority" name', () => {
        render(<PrioritySelect value="LOW" onChange={vi.fn()} />);
        expect(screen.getByRole('combobox', { name: 'Priority' })).toBeInTheDocument();
    });

    it('marks the current value as selected', () => {
        render(<PrioritySelect value="HIGH" onChange={vi.fn()} />);
        const highOption = screen.getByRole('option', { name: 'High' });
        expect(highOption).toHaveProperty('selected', true);
    });

    it('fires onChange with the selected enum value', () => {
        const onChange = vi.fn();
        render(<PrioritySelect value="LOW" onChange={onChange} />);
        fireEvent.change(screen.getByRole('combobox', { name: 'Priority' }), {
            target: { value: 'URGENT' },
        });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('URGENT');
    });
});
