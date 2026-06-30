// DEL-01 — Collapsible wrapper tests.
// Mirrors Dropdown.test.tsx discipline: render helper, fireEvent.click (Radix
// Collapsible toggles on click — unlike DropdownMenu which opens on pointerDown),
// token assertions on the content element. The PointerEvent polyfill in
// src/test-setup.ts covers Radix internals here too.
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './Collapsible';

describe('Collapsible', () => {
    function renderCollapsible() {
        render(
            <Collapsible>
                <CollapsibleTrigger>Toggle</CollapsibleTrigger>
                <CollapsibleContent>Panel body</CollapsibleContent>
            </Collapsible>,
        );
    }

    it('renders the trigger as a button', () => {
        renderCollapsible();
        const trigger = screen.getByRole('button', { name: 'Toggle' });
        expect(trigger).toBeInTheDocument();
        // Radix Collapsible.Trigger exposes aria-expanded on the button.
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    it('hides content initially and reveals it on click', () => {
        renderCollapsible();
        const trigger = screen.getByRole('button', { name: 'Toggle' });

        // Radix Collapsible.Content is mounted but flagged hidden AND its children
        // are not rendered while closed (Presence-based). So the body text must be
        // absent initially, then appear after opening.
        expect(screen.queryByText('Panel body')).toBeNull();

        fireEvent.click(trigger);

        const content = screen.getByText('Panel body');
        expect(content).toBeInTheDocument();
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
    });

    it('reflects data-state=open on root + trigger after opening', () => {
        const { container } = render(
            <Collapsible>
                <CollapsibleTrigger>Toggle</CollapsibleTrigger>
                <CollapsibleContent>Panel body</CollapsibleContent>
            </Collapsible>,
        );
        const trigger = screen.getByRole('button', { name: 'Toggle' });
        // Root is the outermost element rendered by <Collapsible>.
        const root = container.firstElementChild as HTMLElement;

        expect(root.getAttribute('data-state')).toBe('closed');
        expect(trigger.getAttribute('data-state')).toBe('closed');

        fireEvent.click(trigger);

        expect(root.getAttribute('data-state')).toBe('open');
        expect(trigger.getAttribute('data-state')).toBe('open');
    });

    it('content carries the text-foreground token', () => {
        renderCollapsible();
        const trigger = screen.getByRole('button', { name: 'Toggle' });
        fireEvent.click(trigger);
        const content = screen.getByText('Panel body');
        expect(content.className).toContain('text-foreground');
        // Animation tokens ported from Dropdown.tsx:41-42.
        expect(content.className).toContain('data-[state=open]:animate-in');
        expect(content.className).toContain('data-[state=closed]:fade-out-0');
    });
});
