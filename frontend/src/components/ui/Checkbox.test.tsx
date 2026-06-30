import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
    it('renders an accessible checkbox (role=checkbox)', () => {
        render(<Checkbox aria-label="Accept terms" />);
        expect(screen.getByRole('checkbox', { name: 'Accept terms' })).toBeInTheDocument();
    });

    it('clicking fires onCheckedChange — true then false on subsequent clicks', () => {
        const onCheckedChange = vi.fn();
        render(<Checkbox aria-label="Notify" onCheckedChange={onCheckedChange} />);
        const checkbox = screen.getByRole('checkbox', { name: 'Notify' });
        fireEvent.click(checkbox);
        expect(onCheckedChange).toHaveBeenLastCalledWith(true);
        fireEvent.click(checkbox);
        expect(onCheckedChange).toHaveBeenLastCalledWith(false);
        expect(onCheckedChange).toHaveBeenCalledTimes(2);
    });

    it('when checked, root has data-state=checked and bg-primary token', () => {
        render(<Checkbox aria-label="Notify" checked />);
        const checkbox = screen.getByRole('checkbox', { name: 'Notify' });
        expect(checkbox.getAttribute('data-state')).toBe('checked');
        expect(checkbox.className).toContain('bg-primary');
    });

    it('unchecked root carries border-input token', () => {
        render(<Checkbox aria-label="Notify" />);
        const checkbox = screen.getByRole('checkbox', { name: 'Notify' });
        expect(checkbox.className).toContain('border-input');
    });

    it('disabled prop applies opacity-50 disabled token', () => {
        render(<Checkbox aria-label="Notify" disabled />);
        const checkbox = screen.getByRole('checkbox', { name: 'Notify' });
        expect(checkbox.className).toContain('opacity-50');
    });
});
