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
        // Radix dropdown-menu trigger; open it to surface the menuitems.
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Priority' }), { button: 0 });
        expect(screen.getAllByRole('menuitem')).toHaveLength(5);
        cases.forEach(({ label }) => {
            expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument();
        });
    });

    it('is accessible via button role with "Priority" aria-label', () => {
        render(<PrioritySelect value="LOW" onChange={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Priority' })).toBeInTheDocument();
    });

    it('shows the current value label in the trigger', () => {
        render(<PrioritySelect value="HIGH" onChange={vi.fn()} />);
        const trigger = screen.getByRole('button', { name: 'Priority' });
        expect(trigger).toHaveTextContent('High');
    });

    it('fires onChange with the selected enum value', () => {
        const onChange = vi.fn();
        render(<PrioritySelect value="LOW" onChange={onChange} />);
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Priority' }), { button: 0 });
        fireEvent.click(screen.getByRole('menuitem', { name: 'Urgent' }));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('URGENT');
    });
});
