import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  THEME_STORAGE_KEY,
  resolveInitialTheme,
  type ThemePreference,
  type ResolvedTheme,
} from './theme';

describe('THEME_STORAGE_KEY', () => {
  it('is the PRD §3.2 / decision #2 fixed key (never rename)', () => {
    expect(THEME_STORAGE_KEY).toBe('slykboard-theme');
  });
});

describe('resolveInitialTheme (D4 rule — pure)', () => {
  // Table-driven per js-testing-rules.md. Covers stored explicit, system, null, invalid.
  const cases: Array<{
    name: string;
    stored: string | null;
    prefersDark: boolean;
    expected: ResolvedTheme;
  }> = [
    { name: "stored 'dark' → dark", stored: 'dark', prefersDark: false, expected: 'dark' },
    {
      name: "stored 'dark' → dark (even if OS is light)",
      stored: 'dark',
      prefersDark: true,
      expected: 'dark',
    },
    { name: "stored 'light' → light", stored: 'light', prefersDark: true, expected: 'light' },
    {
      name: "stored 'light' → light (even if OS is dark)",
      stored: 'light',
      prefersDark: false,
      expected: 'light',
    },
    {
      name: "stored 'system' + OS dark → dark",
      stored: 'system',
      prefersDark: true,
      expected: 'dark',
    },
    {
      name: "stored 'system' + OS light → light",
      stored: 'system',
      prefersDark: false,
      expected: 'light',
    },
    {
      name: 'null (unset) + OS dark → dark (default = system)',
      stored: null,
      prefersDark: true,
      expected: 'dark',
    },
    {
      name: 'null (unset) + OS light → light (default = system)',
      stored: null,
      prefersDark: false,
      expected: 'light',
    },
    {
      name: "invalid 'garbage' + OS dark → dark (falls back to system)",
      stored: 'garbage',
      prefersDark: true,
      expected: 'dark',
    },
    {
      name: "invalid 'garbage' + OS light → light (falls back to system)",
      stored: 'garbage',
      prefersDark: false,
      expected: 'light',
    },
    {
      name: "empty string '' + OS dark → dark (invalid → system)",
      stored: '',
      prefersDark: true,
      expected: 'dark',
    },
    {
      name: "uppercase 'DARK' is invalid → system fallback (case-sensitive)",
      stored: 'DARK',
      prefersDark: false,
      expected: 'light',
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(resolveInitialTheme(c.stored, c.prefersDark)).toBe(c.expected);
    });
  }

  it('is pure: same inputs → same output (no DOM/IO)', () => {
    const a = resolveInitialTheme('system', true);
    const b = resolveInitialTheme('system', true);
    expect(a).toBe(b);
    expect(a).toBe('dark');
  });

  it('tolerates all ThemePreference values as input', () => {
    const all: ThemePreference[] = ['light', 'dark', 'system'];
    for (const pref of all) {
      expect(['light', 'dark']).toContain(resolveInitialTheme(pref, true));
    }
  });
});

// Source-presence guard for the HTML bootstrap (D2/D3). jsdom cannot paint, so we
// assert the index.html source contains the meta + a plain (non-module) inline
// <script> wired to the right key + DOM symbols. The real FOUC check is F51.
// NOTE: these assertions pass only AFTER T2 lands the index.html edit. T1 lands
// the function-side green; T2 makes these green.
describe('index.html no-flash bootstrap (source-presence, D6)', () => {
  const htmlPath = resolve(__dirname, '..', '..', 'index.html');
  const html = readFileSync(htmlPath, 'utf8');

  it('declares <meta name="color-scheme" content="light dark"> (PRD §3.1)', () => {
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
  });

  it('has a plain inline <script> in <head> (no src, not a module — D2)', () => {
    // A plain inline script: opening <script> tag NOT carrying type="module" and NOT carrying src=.
    expect(html).toMatch(/<script>(?![^>]*type="module")/);
    expect(html).not.toMatch(/<script\s+[^>]*type="module"[^>]*>[\s\S]*slykboard-theme/);
  });

  it('script references the fixed storage key (PRD §3.2, decision #2)', () => {
    expect(html).toContain('slykboard-theme');
  });

  it('script adds .dark to documentElement (activates F32 .dark block)', () => {
    expect(html).toContain('document.documentElement');
    expect(html).toMatch(/classList\.add\(\s*['"]dark['"]\s*\)/);
  });

  it('script reads prefers-color-scheme via matchMedia', () => {
    expect(html).toContain("matchMedia('(prefers-color-scheme: dark)')");
  });

  it('script has a try/catch fallback (D8 — never throw on first paint)', () => {
    expect(html).toMatch(/try\s*\{/);
    expect(html).toMatch(/catch\s*\(/);
  });

  it('script precedes the main.tsx module mount (ordering — decision #3)', () => {
    const scriptIdx = html.search(/<script>[^<]/);
    const mountIdx = html.indexOf('/src/main.tsx');
    expect(scriptIdx, 'inline script must come before the main.tsx module').toBeGreaterThan(-1);
    expect(mountIdx, 'main.tsx module reference not found').toBeGreaterThan(-1);
    expect(scriptIdx).toBeLessThan(mountIdx);
  });

  it('script sits before <title> (after viewport, before title — decision #3)', () => {
    const scriptIdx = html.search(/<script>[^<]/);
    const titleIdx = html.indexOf('<title>');
    expect(scriptIdx).toBeLessThan(titleIdx);
  });
});
