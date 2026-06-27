// F34 — ThemeProvider + useTheme: React-side theme controller.
// Owns 'light' | 'dark' | 'system' state, persists it (key slykboard-theme),
// syncs .dark on document.documentElement, and follows OS scheme changes when 'system'.
//
// NO-FLASH AGREEMENT (load-bearing): the lazy useState seed calls
// resolveInitialTheme(localStorage.getItem(THEME_STORAGE_KEY), matchMedia(...).matches)
// — the SAME key + SAME rule as F33's index.html pre-paint script — so React's first
// render equals the script's result and the .dark-sync effect toggles nothing on mount.
//
// Reuses F33's seam verbatim (do NOT re-derive the key or resolution rule):
//   THEME_STORAGE_KEY, resolveInitialTheme, ThemePreference, ResolvedTheme
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
    THEME_STORAGE_KEY,
    resolveInitialTheme,
    type ResolvedTheme,
    type ThemePreference,
} from '@/utils/theme';

/** Value exposed by useTheme() and consumed by descendants (e.g. F40 toggle). */
export interface ThemeContextValue {
    /** The user's choice ('light' | 'dark' | 'system'). */
    theme: ThemePreference;
    /** Update the choice + persist it. */
    setTheme: (next: ThemePreference) => void;
    /** The concrete theme after system resolution ('light' | 'dark') — use for icon-picking etc. */
    resolvedTheme: ResolvedTheme;
}

export const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

interface ThemeProviderProps {
    children: ReactNode;
}

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

/** Read prefersDark safely (D8: matchMedia may throw in some privacy modes). */
function readPrefersDark(): boolean {
    try {
        return window.matchMedia(DARK_MEDIA_QUERY).matches;
    } catch {
        return false;
    }
}

export function ThemeProvider({ children }: ThemeProviderProps) {
    // Lazy seed — runs ONCE. Reads the SAME key + SAME rule as F33's pre-paint script
    // so the seed equals the current DOM .dark state → no flip on first render.
    const [theme, setThemeState] = useState<ThemePreference>(() => {
        try {
            const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemePreference | null;
            // resolveInitialTheme returns 'light' | 'dark'; but the USER CHOICE we surface
            // is the stored value (incl. 'system'). Stored invalid/null → default 'system'.
            if (stored === 'light' || stored === 'dark' || stored === 'system') {
                return stored;
            }
            return 'system';
        } catch {
            // D8: localStorage unavailable → default 'system' (in-memory only).
            return 'system';
        }
    });

    // prefersDark is STATE so the system-subscription effect can update it on OS scheme change;
    // resolvedTheme re-derives and the .dark-sync effect follows. Seeded once at mount via the
    // same readPrefersDark() the F33 pre-paint script used → no-flash agreement holds.
    const [prefersDark, setPrefersDark] = useState<boolean>(() => readPrefersDark());

    // resolvedTheme: concrete light/dark after system resolution. F40 icon-picking consumes this.
    const resolvedTheme: ResolvedTheme =
        theme === 'system' ? resolveInitialTheme(null, prefersDark) : theme;

    // setTheme: persist (try/catch — D8) + update state.
    const setTheme = useCallback((next: ThemePreference) => {
        setThemeState(next);
        try {
            localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
            // D8: persistence failed (private mode / disabled storage) → keep working in-memory.
        }
    }, []);

    // .dark-sync effect (D3: document.documentElement). Idempotent on first run (seed equals DOM).
    useEffect(() => {
        const root = document.documentElement;
        if (resolvedTheme === 'dark') {
            root.classList.add('dark');
        } else {
            root.classList.remove('dark');
        }
    }, [resolvedTheme]);

    // system-subscription effect (D4): only when theme === 'system'. Follows OS scheme changes.
    useEffect(() => {
        if (theme !== 'system') return; // explicit light/dark ignores OS changes

        let mql: MediaQueryList;
        try {
            mql = window.matchMedia(DARK_MEDIA_QUERY);
        } catch {
            // D8: matchMedia unavailable → nothing to subscribe to; .dark-sync effect still holds.
            return;
        }

        // OS scheme changed: update prefersDark state → resolvedTheme re-derives → the .dark-sync
        // effect toggles document.documentElement (D3). Reads e.matches (the NEW value the event
        // carries — real MediaQueryListEvents reflect the post-change state).
        const onChange = (e: MediaQueryListEvent) => {
            setPrefersDark(e.matches);
        };

        mql.addEventListener('change', onChange);
        return () => {
            mql.removeEventListener('change', onChange);
        };
    }, [theme]);

    const value = useMemo<ThemeContextValue>(
        () => ({ theme, setTheme, resolvedTheme }),
        [theme, setTheme, resolvedTheme],
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
