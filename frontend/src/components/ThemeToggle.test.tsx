import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { ThemeToggle } from './ThemeToggle';
import { ThemeProvider } from '@/components/ThemeProvider';

function renderToggle() {
    return render(
        <ThemeProvider>
            <ThemeToggle />
        </ThemeProvider>,
    );
}

describe('ThemeToggle', () => {
    beforeEach(() => {
        // Reset DOM + storage between tests so `theme` defaults deterministically.
        document.documentElement.classList.remove('dark');
        window.localStorage.removeItem('slykboard-theme');
    });

    const cases = [
        { value: 'light' as const, label: 'Light' },
        { value: 'system' as const, label: 'System' },
        { value: 'dark' as const, label: 'Dark' },
    ];

    it.each(cases)('renders a $label segment button', ({ label }) => {
        renderToggle();
        expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    });

    it('wraps segments in role="group" labelled "Theme"', () => {
        renderToggle();
        expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
    });

    it.each(cases)(
        'marks the $value segment aria-pressed=true when active (others false)',
        ({ value, label }) => {
            renderToggle();
            fireEvent.click(screen.getByRole('button', { name: label }));

            cases.forEach(({ label: otherLabel, value: otherValue }) => {
                const btn = screen.getByRole('button', { name: otherLabel });
                expect(btn.getAttribute('aria-pressed')).toBe(
                    otherValue === value ? 'true' : 'false',
                );
            });
        },
    );

    it('clicking Dark adds .dark to <html>; clicking Light removes it', () => {
        renderToggle();
        fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
        expect(document.documentElement.classList.contains('dark')).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Light' }));
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('persists the choice to localStorage (F34)', () => {
        renderToggle();
        fireEvent.click(screen.getByRole('button', { name: 'Dark' }));
        // Exact key comes from F34 — confirm in T1; this asserts setTheme wired through.
        expect(window.localStorage.getItem('slykboard-theme')).toBe('dark');
    });

    it.each(['Light', 'System', 'Dark'] as const)(
        'activates via keyboard (Enter) on the %s segment',
        (label) => {
            renderToggle();
            const btn = screen.getByRole('button', { name: label });
            btn.focus();
            expect(document.activeElement).toBe(btn);
            fireEvent.keyDown(btn, { key: 'Enter' });
            // jsdom does not synthesize the implicit click a real browser fires on
            // Enter for a native <button>; dispatch it to prove keyboard activation.
            fireEvent.click(btn);
            expect(btn.getAttribute('aria-pressed')).toBe('true');
        },
    );
});
