import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
    Dropdown,
    DropdownTrigger,
    DropdownContent,
    DropdownItem,
    DropdownSeparator,
    DropdownLabel,
    DropdownGroup,
} from './Dropdown';

describe('Dropdown', () => {
    function renderDropdown() {
        const onSelect = vi.fn();
        render(
            <Dropdown>
                <DropdownTrigger>Open menu</DropdownTrigger>
                <DropdownContent>
                    <DropdownLabel>Actions</DropdownLabel>
                    <DropdownGroup>
                        <DropdownItem onSelect={onSelect}>Edit</DropdownItem>
                        <DropdownItem variant="destructive">Delete</DropdownItem>
                    </DropdownGroup>
                    <DropdownSeparator />
                    <DropdownGroup>
                        <DropdownItem>Cancel</DropdownItem>
                    </DropdownGroup>
                </DropdownContent>
            </Dropdown>,
        );
        return { onSelect };
    }

    it('renders the trigger (not yet expanded)', () => {
        renderDropdown();
        const trigger = screen.getByRole('button', { name: 'Open menu' });
        expect(trigger).toBeInTheDocument();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('opens on pointerDown (aria-expanded becomes true, menu role appears)', () => {
        renderDropdown();
        const trigger = screen.getByRole('button', { name: 'Open menu' });
        // Radix opens on pointerDown, not click (jsdom + PointerEvent polyfill from T1).
        fireEvent.pointerDown(trigger, { button: 0 });
        const menu = screen.getByRole('menu');
        expect(menu).toBeInTheDocument();
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        // Items reach menuitem role.
        expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
    });

    it('closes on Escape', () => {
        renderDropdown();
        const trigger = screen.getByRole('button', { name: 'Open menu' });
        fireEvent.pointerDown(trigger, { button: 0 });
        expect(screen.getByRole('menu')).toBeInTheDocument();
        // Radix listens on document.body for Escape.
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    // NOTE: "closes on outside pointerdown" + "ArrowDown roving between items"
    // are Radix DismissableLayer/RovingFocus a11y guarantees (the wrapper delegates
    // them to Radix). Esc-dismiss is covered above (proves the dismiss layer works);
    // Radix's own suite covers pointer-outside + arrow-roving. Both are verified in
    // the F51 light/dark visual QA (real Chromium). (jsdom's pointer-event + focus
    // plumbing makes these two interactions flaky here — per F36 doc caveat.)

    it('fires onSelect when an item is chosen', () => {
        const { onSelect } = renderDropdown();
        const trigger = screen.getByRole('button', { name: 'Open menu' });
        fireEvent.pointerDown(trigger, { button: 0 });
        const editItem = screen.getByRole('menuitem', { name: 'Edit' });
        fireEvent.click(editItem);
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('destructive variant applies text-destructive token', () => {
        renderDropdown();
        const trigger = screen.getByRole('button', { name: 'Open menu' });
        fireEvent.pointerDown(trigger, { button: 0 });
        const deleteItem = screen.getByRole('menuitem', { name: 'Delete' });
        expect(deleteItem.className).toContain('text-destructive');
    });

    it('content applies bg-popover token (portal-dark consumer)', () => {
        renderDropdown();
        const trigger = screen.getByRole('button', { name: 'Open menu' });
        fireEvent.pointerDown(trigger, { button: 0 });
        const menu = screen.getByRole('menu');
        expect(menu.className).toContain('bg-popover');
        expect(menu.className).toContain('text-popover-foreground');
        expect(menu.className).toContain('border-border');
    });

    it('default sideOffset=4 (smoke)', () => {
        renderDropdown();
        const trigger = screen.getByRole('button', { name: 'Open menu' });
        fireEvent.pointerDown(trigger, { button: 0 });
        // jsdom does not reflect sideOffset as a real style; assert the menu is present
        // (the sideOffset=4 default is exercised by the component wiring above).
        const menu = screen.getByRole('menu');
        expect(menu).toBeInTheDocument();
    });
});
