import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { ThemeToggle } from './ThemeToggle';
import { ThemeProvider } from '@/components/ThemeProvider';
import { TooltipProvider } from '@/components/ui/Tooltip';

// TooltipProvider is mounted app-wide in main.tsx (production). Tests render an
// isolated subtree, so mount it here too — Radix Tooltip throws without it.
// delayDuration=0 mirrors the project's Tooltip.test.tsx jsdom pattern (instant
// open on focus — the reliable path in jsdom; real hover/timer is flaky here).
function renderToggle() {
    return render(
        <ThemeProvider>
            <TooltipProvider delayDuration={0}>
                <ThemeToggle />
            </TooltipProvider>
        </ThemeProvider>,
    );
}

describe('ThemeToggle', () => {
    beforeEach(() => {
        // Reset DOM + storage between tests so `theme` defaults deterministically
        // to 'system' (see ThemeProvider seed).
        document.documentElement.classList.remove('dark');
        window.localStorage.removeItem('slykboard-theme');
    });

    const cases = [
        { value: 'light' as const, label: 'Light' },
        { value: 'system' as const, label: 'System' },
        { value: 'dark' as const, label: 'Dark' },
    ];

    it.each(cases)('renders a $label segment (role=radio)', ({ label }) => {
        renderToggle();
        // Radix ToggleGroup single-mode renders role="radio" per item.
        expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    });

    it('wraps segments in a radiogroup labelled "Theme"', () => {
        // Radix single-mode renders role="radiogroup" (was role="group"); the
        // aria-label="Theme" moved from the old container to <ToggleGroup>.
        renderToggle();
        expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    });

    it.each(cases)(
        'marks the $value segment aria-checked=true when active (others false)',
        ({ value, label }) => {
            renderToggle();
            fireEvent.click(screen.getByRole('radio', { name: label }));

            // NOTE: Radix ToggleGroupItem drives active styling via data-state=on,
            // but wrapping each item in <TooltipTrigger asChild> (required by T8
            // Change 2) causes Radix Slot to merge the Tooltip's data-state
            // ("closed") onto the same node, clobbering the item's data-state.
            // aria-checked is the authoritative a11y signal Radix still maintains
            // correctly, so assert active state through it.
            cases.forEach(({ label: otherLabel, value: otherValue }) => {
                const item = screen.getByRole('radio', { name: otherLabel });
                expect(item.getAttribute('aria-checked')).toBe(
                    otherValue === value ? 'true' : 'false',
                );
            });
        },
    );

    it('clicking Dark adds .dark to <html>; clicking Light removes it', () => {
        renderToggle();
        fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
        expect(document.documentElement.classList.contains('dark')).toBe(true);

        fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('persists the choice to localStorage (F34)', () => {
        renderToggle();
        fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
        // Exact key comes from F34 — confirm in T1; this asserts setTheme wired through.
        expect(window.localStorage.getItem('slykboard-theme')).toBe('dark');
    });

    it('clicking the active segment does NOT deselect (guard: no setTheme(""))', () => {
        // Default seed (empty localStorage) is 'system' → System is active.
        renderToggle();
        const systemItem = screen.getByRole('radio', { name: 'System' });
        expect(systemItem.getAttribute('aria-checked')).toBe('true');

        // Radix single-mode would fire onValueChange('') on re-click; the component
        // guards it, so theme stays 'system', aria-checked stays true, and nothing
        // is persisted (localStorage stays null — no setTheme('') write).
        fireEvent.click(systemItem);
        expect(systemItem.getAttribute('aria-checked')).toBe('true');
        expect(window.localStorage.getItem('slykboard-theme')).toBeNull();
    });

    it.each(['Light', 'System', 'Dark'] as const)(
        'activates via click on the %s segment',
        (label) => {
            renderToggle();
            const item = screen.getByRole('radio', { name: label });
            fireEvent.click(item);
            expect(item.getAttribute('aria-checked')).toBe('true');
        },
    );

    it.each(cases)('shows a tooltip with the $label text on focus', ({ label }) => {
        renderToggle();
        // Radix Tooltip content is portalled + lazy-mounted (only present when open).
        // Open via focus (project jsdom pattern — see ui/Tooltip.test.tsx). When one
        // tooltip opens Radix may keep a sibling's portal in the DOM, so use getAll
        // and assert at least one rendered node carries the label text.
        const item = screen.getByRole('radio', { name: label });
        fireEvent.focus(item);
        expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    });
});
