// F33 — No-flash theme bootstrap: pure resolution rule.
// Single source of truth for the stored→resolved mapping. The inline <script> in
// index.html mirrors this logic in vanilla JS (it cannot import pre-paint without
// becoming a deferred module → flash). Keep both in sync; drift = subtle bug.
// F34's ThemeProvider imports THEME_STORAGE_KEY + resolveInitialTheme.

/** localStorage key holding the user's persisted preference. FIXED (PRD §3.2, decision #2):
 *  renaming is a breaking change to every existing user's preference. */
export const THEME_STORAGE_KEY = 'slykboard-theme';

/** The value the user chose (or 'system' default / null when unset). */
export type ThemePreference = 'light' | 'dark' | 'system';

/** The concrete theme to apply to the DOM (no 'system' — that resolves to light/dark). */
export type ResolvedTheme = 'light' | 'dark';

/**
 * Resolve a stored preference + OS hint to a concrete theme. Pure: no DOM, no I/O.
 * Rule (D4):
 *   - 'dark'  → 'dark'
 *   - 'light' → 'light'
 *   - 'system' | null | invalid → follow OS (prefersDark ? 'dark' : 'light')
 * Default = system (PRD §1.6, D8).
 */
export function resolveInitialTheme(stored: string | null, prefersDark: boolean): ResolvedTheme {
  if (stored === 'dark') return 'dark';
  if (stored === 'light') return 'light';
  // 'system', null, or any invalid value → follow the OS hint.
  return prefersDark ? 'dark' : 'light';
}
