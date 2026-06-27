// F34 — useTheme hook. Reads ThemeContext; throws if used outside <ThemeProvider>.
import { useContext } from 'react';
import { ThemeContext } from '@/components/ThemeProvider';
import type { ThemeContextValue } from '@/components/ThemeProvider';

/**
 * Read the theme controller. MUST be called inside <ThemeProvider>.
 * Returns { theme, setTheme, resolvedTheme }.
 * Throws a clear Error if called outside a provider (no silent undefined) — D7.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx === undefined) {
    throw new Error('useTheme must be used within a <ThemeProvider>.');
  }
  return ctx;
}
