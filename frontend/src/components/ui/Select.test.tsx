// DEL-02 — Select primitive tests.
// Mirrors Dropdown.test.tsx (canonical Radix-wrapper test pattern): open via
// fireEvent.pointerDown(trigger, { button: 0 }), close via Escape on body,
// getByRole queries, className.toContain(...) token assertions.
//
// jsdom stance (inherited from Dropdown.test.tsx): roving-focus / ArrowDown
// interactions are Radix RovingFocus a11y guarantees delegated to Radix and
// covered by Radix's own suite + F51 visual QA; jsdom's focus plumbing makes
// them flaky here. Esc-dismiss is covered (proves the dismiss layer works).
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
    SelectSeparator,
    SelectGroup,
    SelectLabel,
} from './Select';

describe('Select', () => {
    function renderSelect(overrides?: {
        value?: string;
        onValueChange?: (v: string) => void;
        searchable?: boolean;
    }) {
        const onValueChange = overrides?.onValueChange ?? vi.fn();
        render(
            <Select
                value={overrides?.value}
                onValueChange={onValueChange}
            >
                <SelectTrigger>
                    <SelectValue placeholder="Pick a color">Pick a color</SelectValue>
                </SelectTrigger>
                <SelectContent searchable={overrides?.searchable}>
                    <SelectLabel>Colors</SelectLabel>
                    <SelectGroup>
                        <SelectItem value="red" textValue="Red" />
                        <SelectItem value="green" textValue="Green" />
                        <SelectItem value="blue" textValue="Blue" />
                    </SelectGroup>
                    <SelectSeparator />
                    <SelectItem value="none" textValue="No color" />
                </SelectContent>
            </Select>,
        );
        return { onValueChange };
    }

    function openMenu() {
        const trigger = screen.getByRole('button', { name: 'Pick a color' });
        // Radix opens on pointerDown, not click (jsdom + PointerEvent polyfill).
        fireEvent.pointerDown(trigger, { button: 0 });
        return trigger;
    }

    it('renders the trigger (not yet expanded)', () => {
        renderSelect();
        const trigger = screen.getByRole('button', { name: 'Pick a color' });
        expect(trigger).toBeInTheDocument();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('opens on pointerDown (aria-expanded true, menu + menuitems appear)', () => {
        renderSelect();
        const trigger = openMenu();
        const menu = screen.getByRole('menu');
        expect(menu).toBeInTheDocument();
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        // Items queryable by accessible name (= textValue rendered as children).
        expect(screen.getByRole('menuitem', { name: 'Red' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Green' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Blue' })).toBeInTheDocument();
    });

    it('closes on Escape', () => {
        renderSelect();
        openMenu();
        expect(screen.getByRole('menu')).toBeInTheDocument();
        // Radix listens on document.body for Escape.
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();
    });

    it('fires onValueChange with the chosen value when an item is selected', () => {
        const { onValueChange } = renderSelect();
        openMenu();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Green' }));
        expect(onValueChange).toHaveBeenCalledTimes(1);
        expect(onValueChange).toHaveBeenCalledWith('green');
    });

    it('shows the check indicator on the selected item (controlled value)', () => {
        renderSelect({ value: 'blue' });
        openMenu();
        // The selected item's leading indicator contains the Check svg.
        const blueItem = screen.getByRole('menuitem', { name: 'Blue' });
        const check = blueItem.querySelector('svg.lucide-check, svg[class*="lucide"]' +
            '[class*="check"]');
        expect(check).not.toBeNull();
        // A non-selected item must NOT show a check.
        const redItem = screen.getByRole('menuitem', { name: 'Red' });
        const redCheck = redItem.querySelector('svg.lucide-check, svg[class*="lucide"]' +
            '[class*="check"]');
        expect(redCheck).toBeNull();
    });

    it('type-to-search hides non-matching items and keeps matching ones', () => {
        renderSelect({ searchable: true });
        openMenu();
        const search = screen.getByRole('textbox', { name: 'Search' });
        fireEvent.change(search, { target: { value: 're' } });
        // "Red" and "Green" include "re"; "Blue" does not.
        expect(screen.queryByRole('menuitem', { name: 'Blue' })).toBeNull();
        expect(screen.getByRole('menuitem', { name: 'Red' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Green' })).toBeInTheDocument();
    });

    // --- Token assertions (semantic tokens only — no raw hex) ---
    // Note: when the menu is open the trigger's accessible name still resolves
    // to the SelectValue text, but Radix may also surface the expanded state in
    // computed text on some jsdom builds, making getByRole({ name }) flaky.
    // Capture the trigger element via openMenu() (it returns the trigger) and
    // assert className on that stable reference instead of re-querying.
    it('trigger carries border-input token', () => {
        renderSelect();
        const trigger = openMenu();
        expect(trigger.className).toContain('border-input');
    });

    it('trigger carries bg-background token', () => {
        renderSelect();
        const trigger = openMenu();
        expect(trigger.className).toContain('bg-background');
    });

    it('content carries bg-popover token (portal-dark consumer)', () => {
        renderSelect();
        openMenu();
        const menu = screen.getByRole('menu');
        expect(menu.className).toContain('bg-popover');
        expect(menu.className).toContain('text-popover-foreground');
        expect(menu.className).toContain('border-border');
    });

    it('item carries focus:bg-accent token', () => {
        renderSelect();
        openMenu();
        const item = screen.getByRole('menuitem', { name: 'Red' });
        expect(item.className).toContain('focus:bg-accent');
    });
});
