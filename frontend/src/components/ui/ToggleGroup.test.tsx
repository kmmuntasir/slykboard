import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToggleGroup, ToggleGroupItem } from './ToggleGroup';

// Radix ToggleGroup renders DIFFERENT a11y trees per `type`:
//   type="single"   -> Root: role="radiogroup";  Item: <button role="radio" aria-checked>
//   type="multiple" -> Root: role="group";        Item: <button aria-pressed>
// (The task brief assumed button/aria-pressed uniformly; tests below assert the
// real Radix roles so they exercise the actual contract consumers depend on.)
describe('ToggleGroup', () => {
    it('renders items queryable by accessible name', () => {
        render(
            <ToggleGroup type="multiple">
                <ToggleGroupItem value="left" aria-label="Align left" />
                <ToggleGroupItem value="center" aria-label="Align center" />
                <ToggleGroupItem value="right" aria-label="Align right" />
            </ToggleGroup>,
        );
        // In multiple mode items are <button aria-pressed> (toggle-button semantics).
        const left = screen.getByRole('button', { name: 'Align left' });
        expect(left).toBeInTheDocument();
        expect(left.getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByRole('button', { name: 'Align center' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Align right' })).toBeInTheDocument();
    });

    it('single mode: clicking an item fires onValueChange(value) and toggles data-state=on', () => {
        const onValueChange = vi.fn();
        render(
            <ToggleGroup type="single" onValueChange={onValueChange}>
                <ToggleGroupItem value="left" aria-label="Align left" />
                <ToggleGroupItem value="center" aria-label="Align center" />
            </ToggleGroup>,
        );
        // single mode items render role="radio" (radio-group semantics).
        const left = screen.getByRole('radio', { name: 'Align left' });
        fireEvent.click(left);
        expect(onValueChange).toHaveBeenCalledTimes(1);
        expect(onValueChange).toHaveBeenCalledWith('left');
        expect(left.getAttribute('data-state')).toBe('on');
        expect(left.getAttribute('aria-checked')).toBe('true');
        // Token assertion: the on-state applies the bg-accent token.
        expect(left.className).toContain('bg-accent');
    });

    it('multiple mode: clicking two items fires onValueChange with an array, both data-state=on', () => {
        const onValueChange = vi.fn();
        render(
            <ToggleGroup type="multiple" onValueChange={onValueChange}>
                <ToggleGroupItem value="bold" aria-label="Bold" />
                <ToggleGroupItem value="italic" aria-label="Italic" />
            </ToggleGroup>,
        );
        const bold = screen.getByRole('button', { name: 'Bold' });
        const italic = screen.getByRole('button', { name: 'Italic' });
        fireEvent.click(bold);
        expect(onValueChange).toHaveBeenLastCalledWith(['bold']);
        fireEvent.click(italic);
        expect(onValueChange).toHaveBeenLastCalledWith(['bold', 'italic']);
        expect(bold.getAttribute('data-state')).toBe('on');
        expect(italic.getAttribute('data-state')).toBe('on');
    });

    it('root applies border-border token', () => {
        render(
            <ToggleGroup type="single" data-testid="tg-root">
                <ToggleGroupItem value="a" aria-label="A" />
            </ToggleGroup>,
        );
        // single mode Root renders role="radiogroup" (multiple mode renders role="group").
        const root = screen.getByRole('radiogroup');
        expect(root.className).toContain('border-border');
        expect(root.className).toContain('bg-muted/40');
    });
});
