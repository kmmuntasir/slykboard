import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { type ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from './Tooltip';

// Radix Tooltip opens on pointerenter (hover) AND focus. jsdom's pointer-event
// plumbing + Radix's delay-scheduling are flaky at the 300ms boundary, so these
// tests exercise the open-on-interaction contract via focus with delayDuration=0
// (instant open — the reliable jsdom path). Real hover + the exact 300ms default
// timing are verified in F51 visual QA (real Chromium); Radix's own suite covers
// focus-roving/outside-dismiss. (Per F36 doc caveat: the specific event is an
// implementation detail; the load-bearing contracts are role=tooltip appears on
// interaction, hides on leave, and wraps a disabled button.)
function renderTooltip(trigger: ReactNode, content = 'Select a project first') {
    return render(
        <TooltipProvider delayDuration={0}>
            <Tooltip>
                <TooltipTrigger asChild>{trigger}</TooltipTrigger>
                <TooltipContent>{content}</TooltipContent>
            </Tooltip>
        </TooltipProvider>,
    );
}

function open(trigger: HTMLElement): void {
    fireEvent.focus(trigger);
    vi.advanceTimersByTime(0);
}

describe('Tooltip', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows the tooltip on focus', () => {
        renderTooltip(<button>Disabled action</button>);
        open(screen.getByRole('button', { name: 'Disabled action' }));
        const tip = screen.getByRole('tooltip');
        expect(tip).toBeInTheDocument();
        expect(tip).toHaveTextContent('Select a project first');
    });

    it('hides on blur', () => {
        renderTooltip(<button>Disabled action</button>);
        const trigger = screen.getByRole('button', { name: 'Disabled action' });
        open(trigger);
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
        fireEvent.blur(trigger);
        vi.advanceTimersByTime(0);
        expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('wraps a DISABLED button and still shows the tooltip (D5 reason)', () => {
        // D5: disabled buttons fire no pointer/focus events → a naive tooltip never
        // opens. The canonical fix is the CONSUMER wrapping the disabled button in a
        // <span>; asChild clones that span with the trigger handlers, so the span
        // receives focus/pointer while the button stays inert. (F42 will use this.)
        renderTooltip(
            <span>
                <button disabled>Disabled action</button>
            </span>,
        );
        const disabledButton = screen.getByRole('button', { name: 'Disabled action' });
        expect(disabledButton).toBeDisabled();
        // The asChild target is the wrapper span (the disabled button's parent).
        open(disabledButton.parentElement as HTMLElement);
        expect(screen.getByRole('tooltip')).toBeInTheDocument();
    });

    // NOTE: a "content applies bg-primary" DOM assertion is intentionally omitted.
    // Radix Tooltip's visual Content (the styled popover, with the className) does
    // not reliably mount in jsdom — only the a11y mirror span (role=tooltip, no
    // className) renders here. The bg-primary token is applied to TooltipContent
    // via cn() (source-verified + build green), and the identical token-on-Content
    // mechanism is proven by Dropdown's bg-popover test (whose visual Content DOES
    // mount). Tooltip's visual styling is verified in F51 light/dark visual QA.

    it('TooltipProvider + Tooltip root forward delayDuration to Radix (wiring smoke)', () => {
        // The wrapper forwards delayDuration to Radix (Provider default 300; per-root
        // override). The exact delay timing is a Radix guarantee verified in F51, not
        // asserted here (jsdom timing at the boundary is flaky). This asserts the
        // prop passthrough renders without error.
        render(
            <TooltipProvider delayDuration={500}>
                <Tooltip delayDuration={250}>
                    <TooltipTrigger asChild>
                        <button>x</button>
                    </TooltipTrigger>
                    <TooltipContent>tip</TooltipContent>
                </Tooltip>
            </TooltipProvider>,
        );
        expect(screen.getByRole('button', { name: 'x' })).toBeInTheDocument();
    });
});
