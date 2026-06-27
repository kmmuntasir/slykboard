import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { SelectInput } from './SelectInput';

describe('SelectInput', () => {
    it('renders as combobox with focus-ring token classes', () => {
        render(
            <SelectInput>
                <option value="a">A</option>
            </SelectInput>,
        );
        const select = screen.getByRole('combobox');
        expect(select.className).toContain('border-input');
        expect(select.className).toContain('focus-visible:ring-2');
        expect(select.className).toContain('focus-visible:ring-ring');
    });

    it('renders option children', () => {
        render(
            <SelectInput>
                <option value="a">Alpha</option>
                <option value="b">Bravo</option>
            </SelectInput>,
        );
        const select = screen.getByRole('combobox') as HTMLSelectElement;
        expect(select.options.length).toBe(2);
        expect(select.options[0]?.text).toBe('Alpha');
    });

    it('forwards ref', () => {
        const ref = createRef<HTMLSelectElement>();
        render(
            <SelectInput ref={ref}>
                <option>x</option>
            </SelectInput>,
        );
        expect(ref.current).toBeInstanceOf(HTMLSelectElement);
    });
});
