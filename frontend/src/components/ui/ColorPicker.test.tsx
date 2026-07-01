// DEL-01 — ColorPicker tests.
// 8-case vitest + RTL suite mirroring DatePicker.test.tsx (Radix Popover opens
// on fireEvent.click, NOT pointerDown) and Select.test.tsx (token assertions via
// expect(el.className).toContain(...)). jsdom cannot compute CSS, so classes are
// asserted directly.
//
// Radix-managed interactions — Enter/Space-to-open, outside-pointerdown /
// outside-click close, roving focus / focus trap, focus return to the trigger,
// Tab order, and any computed color or popover positioning — are delegated to
// Radix's own suite + manual/visual light/dark QA. They are flaky in jsdom and
// are intentionally NOT unit-asserted here. Esc-dismiss IS covered (proves the
// dismissable layer works), matching the sibling suites' stance.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createRef } from 'react';
import { ColorPicker } from './ColorPicker';

// --- Shared harness (mirrors DatePicker.test.tsx's render…/openPicker pair) ---

function renderPicker(overrides?: {
    value?: string;
    onChange?: (hex: string) => void;
    'aria-label'?: string;
    className?: string;
}) {
    const onChange = overrides?.onChange ?? vi.fn();
    render(
        <ColorPicker
            value={overrides?.value ?? '#6b7280'}
            onChange={onChange}
            aria-label={overrides?.['aria-label'] ?? 'Pick color'}
            className={overrides?.className}
        />,
    );
    return { onChange };
}

function getTrigger(name = 'Pick color') {
    return screen.getByRole('button', { name });
}

function openPicker(name = 'Pick color') {
    const trigger = getTrigger(name);
    fireEvent.click(trigger); // Popover opens on CLICK, not pointerDown.
    return trigger;
}

describe('ColorPicker', () => {
    // 1. Renders a swatch button reflecting value — the swatch has no text, so its
    //    accessible name is the aria-label; the inline fill reflects the hex.
    //
    //    jsdom normalizes an authored #RRGGBB inline style to rgb() (verified: the
    //    raw `style` attribute reads `background-color: rgb(107, 114, 128)`), so
    //    the hex digits are not retrievable — assert the rgb equivalent instead,
    //    which proves the `value` prop flows into the swatch fill (0x6B=107,
    //    0x72=114, 0x80=128 for #6B7280).
    it('renders a swatch button whose inline background reflects value', () => {
        renderPicker({ value: '#6B7280', 'aria-label': 'Pick color' });
        const trigger = getTrigger('Pick color');
        expect(trigger).toBeInTheDocument();
        expect(trigger.style.backgroundColor).toBe('rgb(107, 114, 128)');
    });

    // 2. Token / className conventions — focus ring on the trigger; portal-dark
    //    consumer tokens (bg-popover / text-popover-foreground) on the content.
    it('uses house tokens: focus-visible ring on trigger, bg-popover content', () => {
        renderPicker();
        const trigger = getTrigger();
        expect(trigger.className).toContain('focus-visible:ring');

        openPicker();
        const input = screen.getByLabelText('Hex color');
        const content = input.closest('[class*="bg-popover"]');
        expect(content).not.toBeNull();
        expect(content!.className).toContain('bg-popover');
        expect(content!.className).toContain('text-popover-foreground');
    });

    // 3. Opens on click — revealing the hex field.
    it('opens on click revealing the hex field', () => {
        renderPicker();
        openPicker();
        expect(screen.getByLabelText('Hex color')).toBeInTheDocument();
    });

    // 4. onChange fires #-prefixed from the hex field regardless of `prefixed`
    //    (react-colorful always emits a leading '#').
    it('fires onChange with a #-prefixed hex from the hex field', () => {
        const onChange = vi.fn();
        renderPicker({ value: '#000000', onChange });
        openPicker();
        const input = screen.getByLabelText('Hex color');
        fireEvent.change(input, { target: { value: 'ff0000' } });
        expect(onChange).toHaveBeenCalledWith('#ff0000');
        // noUncheckedIndexedAccess is on → index with the non-null assertion.
        expect(onChange.mock.calls[0]![0]).toBe('#ff0000');
    });

    // 5. Swatch is keyboard-focusable — the Radix Trigger renders a native <button>.
    it('renders a native <button> trigger (keyboard-focusable)', () => {
        renderPicker();
        expect(getTrigger().tagName).toBe('BUTTON');
    });

    // 6. Closes on Escape (Radix DismissableLayer listens on document.body).
    it('closes on Escape', () => {
        renderPicker();
        openPicker();
        expect(screen.getByLabelText('Hex color')).toBeInTheDocument();
        fireEvent.keyDown(document.body, { key: 'Escape' });
        expect(screen.queryByLabelText('Hex color')).toBeNull();
    });

    // 7. forwardRef works — ref lands on the Trigger <button>.
    it('forwards ref to the trigger button', () => {
        const ref = createRef<HTMLButtonElement>();
        render(
            <ColorPicker
                ref={ref}
                value="#6b7280"
                onChange={vi.fn()}
                aria-label="Pick color"
            />,
        );
        expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    });

    // 8. className override wins — caller class merges last via cn/tailwind-merge.
    it('applies caller className to the trigger', () => {
        renderPicker({ className: 'h-12 w-12' });
        const trigger = getTrigger();
        expect(trigger.className).toContain('h-12');
        expect(trigger.className).toContain('w-12');
    });
});
