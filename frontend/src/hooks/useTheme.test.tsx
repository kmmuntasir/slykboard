import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ThemeProvider } from '@/components/ThemeProvider';
import { useTheme } from './useTheme';
import { THEME_STORAGE_KEY } from '@/utils/theme';

/** A consumer that renders the hook's values + a button to toggle theme. */
function TestConsumer({ target }: { target: 'light' | 'dark' | 'system' }) {
    const { theme, resolvedTheme, setTheme } = useTheme();
    return (
        <div>
            <span data-testid="theme">{theme}</span>
            <span data-testid="resolved">{resolvedTheme}</span>
            <button onClick={() => setTheme(target)}>set-{target}</button>
        </div>
    );
}

/** Consumer rendered OUTSIDE the provider — to assert the throw. */
function BareConsumer() {
    useTheme();
    return <span>should-not-render</span>;
}

/** Build a fake MediaQueryList. matches + a change listener we can fire. */
function makeMql(matches: boolean) {
    const listeners = new Set<(e: MediaQueryListEvent) => void>();
    return {
        matches,
        media: '(prefers-color-scheme: dark)',
        onchange: null,
        addEventListener: vi.fn((_type: string, cb: (e: MediaQueryListEvent) => void) =>
            listeners.add(cb),
        ),
        removeEventListener: vi.fn((_type: string, cb: (e: MediaQueryListEvent) => void) =>
            listeners.delete(cb),
        ),
        dispatchEvent: vi.fn(),
        // Test-only helper: fire a change event to all registered listeners.
        __fire(newMatches: boolean) {
            const evt = { matches: newMatches } as MediaQueryListEvent;
            for (const cb of listeners) cb(evt);
        },
    };
}

/** Install a fresh matchMedia stub returning a controlled mql. Returns the mql + a restore fn. */
function stubMatchMedia(initialMatches: boolean) {
    const mql = makeMql(initialMatches);
    const stub = vi.fn(() => mql);
    vi.stubGlobal('matchMedia', stub);
    return {
        mql,
        restore: () => vi.unstubAllGlobals(),
    };
}

beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
});

afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    document.documentElement.classList.remove('dark');
});

describe('ThemeProvider — .dark sync + persistence', () => {
    const cases: Array<{
        name: string;
        stored: string | null;
        osDark: boolean;
        expectedResolved: 'light' | 'dark';
        expectedDarkClass: boolean;
    }> = [
        {
            name: "stored 'dark' → .dark present",
            stored: 'dark',
            osDark: false,
            expectedResolved: 'dark',
            expectedDarkClass: true,
        },
        {
            name: "stored 'light' → .dark absent",
            stored: 'light',
            osDark: true,
            expectedResolved: 'light',
            expectedDarkClass: false,
        },
        {
            name: "stored 'system' + OS dark → .dark present",
            stored: 'system',
            osDark: true,
            expectedResolved: 'dark',
            expectedDarkClass: true,
        },
        {
            name: "stored 'system' + OS light → .dark absent",
            stored: 'system',
            osDark: false,
            expectedResolved: 'light',
            expectedDarkClass: false,
        },
        {
            name: 'null (unset) + OS dark → .dark present (default system)',
            stored: null,
            osDark: true,
            expectedResolved: 'dark',
            expectedDarkClass: true,
        },
        {
            name: 'null (unset) + OS light → .dark absent (default system)',
            stored: null,
            osDark: false,
            expectedResolved: 'light',
            expectedDarkClass: false,
        },
    ];

    for (const c of cases) {
        it(c.name, () => {
            if (c.stored !== null) window.localStorage.setItem(THEME_STORAGE_KEY, c.stored);
            stubMatchMedia(c.osDark);

            render(
                <ThemeProvider>
                    <TestConsumer target="dark" />
                </ThemeProvider>,
            );

            expect(screen.getByTestId('resolved').textContent).toBe(c.expectedResolved);
            expect(document.documentElement.classList.contains('dark')).toBe(c.expectedDarkClass);
        });
    }

    it('setTheme("dark") persists to localStorage and adds .dark', () => {
        stubMatchMedia(false); // OS light
        render(
            <ThemeProvider>
                <TestConsumer target="dark" />
            </ThemeProvider>,
        );

        fireEvent.click(screen.getByText('set-dark'));

        expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
        expect(screen.getByTestId('theme').textContent).toBe('dark');
        expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('setTheme("light") persists to localStorage and removes .dark', () => {
        window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
        stubMatchMedia(true);

        render(
            <ThemeProvider>
                <TestConsumer target="light" />
            </ThemeProvider>,
        );

        // initial: dark
        expect(document.documentElement.classList.contains('dark')).toBe(true);
        fireEvent.click(screen.getByText('set-light'));
        expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
});

describe('ThemeProvider — system follows matchMedia change', () => {
    it('OS dark → light while theme=system: .dark removed', () => {
        window.localStorage.setItem(THEME_STORAGE_KEY, 'system');
        const { mql } = stubMatchMedia(true);

        render(
            <ThemeProvider>
                <TestConsumer target="dark" />
            </ThemeProvider>,
        );

        expect(document.documentElement.classList.contains('dark')).toBe(true);

        act(() => {
            mql.__fire(false); // OS flips to light
        });

        expect(document.documentElement.classList.contains('dark')).toBe(false);
        expect(screen.getByTestId('resolved').textContent).toBe('light');
    });

    it('OS light → dark while theme=system: .dark added', () => {
        window.localStorage.setItem(THEME_STORAGE_KEY, 'system');
        const { mql } = stubMatchMedia(false);

        render(
            <ThemeProvider>
                <TestConsumer target="dark" />
            </ThemeProvider>,
        );

        expect(document.documentElement.classList.contains('dark')).toBe(false);

        act(() => {
            mql.__fire(true); // OS flips to dark
        });

        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(screen.getByTestId('resolved').textContent).toBe('dark');
    });

    it('theme=light ignores OS change (no subscription effect)', () => {
        window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
        const { mql } = stubMatchMedia(true);

        render(
            <ThemeProvider>
                <TestConsumer target="light" />
            </ThemeProvider>,
        );

        expect(document.documentElement.classList.contains('dark')).toBe(false);

        act(() => {
            mql.__fire(false);
        });

        // unchanged — explicit light ignores OS
        expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('cleans up the matchMedia listener on unmount', () => {
        window.localStorage.setItem(THEME_STORAGE_KEY, 'system');
        const { mql } = stubMatchMedia(true);

        const { unmount } = render(
            <ThemeProvider>
                <TestConsumer target="dark" />
            </ThemeProvider>,
        );

        expect(mql.addEventListener).toHaveBeenCalledTimes(1);
        unmount();
        expect(mql.removeEventListener).toHaveBeenCalledTimes(1);
    });
});

describe('ThemeProvider — no-flash agreement', () => {
    it('pre-seeded localStorage=dark → .dark present WITHOUT a flip (seed equals DOM)', () => {
        // Simulate F33's pre-paint script: it already added .dark to <html>.
        document.documentElement.classList.add('dark');
        window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
        stubMatchMedia(false);

        render(
            <ThemeProvider>
                <TestConsumer target="dark" />
            </ThemeProvider>,
        );

        // No toggle: .dark stays present; resolvedTheme matches.
        expect(document.documentElement.classList.contains('dark')).toBe(true);
        expect(screen.getByTestId('resolved').textContent).toBe('dark');
    });
});

describe('ThemeProvider — D8 fallback (localStorage unavailable)', () => {
    it('provider still renders when localStorage throws (in-memory only)', () => {
        // Force localStorage.getItem to throw (private-mode simulation).
        const getter = vi.fn(() => {
            throw new Error('Storage disabled');
        });
        const setter = vi.fn(() => {
            throw new Error('Storage disabled');
        });
        vi.spyOn(Storage.prototype, 'getItem', 'get').mockImplementation(getter);
        vi.spyOn(Storage.prototype, 'setItem', 'set').mockImplementation(setter);
        stubMatchMedia(false);

        expect(() =>
            render(
                <ThemeProvider>
                    <TestConsumer target="dark" />
                </ThemeProvider>,
            ),
        ).not.toThrow();

        // Defaults to 'system' (no stored value readable).
        expect(screen.getByTestId('theme').textContent).toBe('system');

        // setTheme does not throw despite write failure.
        expect(() => fireEvent.click(screen.getByText('set-dark'))).not.toThrow();
        expect(screen.getByTestId('theme').textContent).toBe('dark');
    });
});

describe('useTheme — outside provider throws (D7)', () => {
    it('throws a clear error when rendered outside <ThemeProvider>', () => {
        // Suppress the expected console.error noise from React's error boundary logging.
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

        expect(() => render(<BareConsumer />)).toThrow(
            /useTheme must be used within a <ThemeProvider>/,
        );

        spy.mockRestore();
    });
});
