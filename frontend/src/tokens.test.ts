import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read index.css as a string — jsdom cannot compute color (no layout engine),
// so we assert STRUCTURE / source presence only (D5). Real computed-color
// assertion is deferred to F46/F51 visual QA (or a future Playwright add).
const cssPath = resolve(__dirname, 'index.css');
const css = readFileSync(cssPath, 'utf8');

const ROOT_TOKENS = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--destructive-foreground',
  '--border',
  '--input',
  '--ring',
  '--success',
  '--success-foreground',
  '--warning',
  '--warning-foreground',
  '--danger',
  '--danger-foreground',
];

const COLOR_MAPPINGS = ROOT_TOKENS.map((t) => `--color-${t.replace(/^--/, '')}`);

describe('F32 semantic token architecture (index.css)', () => {
  it('imports tailwindcss first', () => {
    expect(css.match(/^@import\s+['"]tailwindcss['"]\s*;/m)).not.toBeNull();
  });

  it('declares the PRD §3.1 @custom-variant dark (zero-specificity :where form)', () => {
    expect(css).toContain('@custom-variant dark');
    expect(css).toContain(':where(.dark, .dark *)');
  });

  it('declares :root (light) with every required token + color-scheme: light', () => {
    const rootBlock = css.match(/:root\s*\{([^}]*)\}/s);
    expect(rootBlock, ':root block not found').not.toBeNull();
    const body = rootBlock![1];
    for (const token of ROOT_TOKENS) {
      expect(body, `missing ${token} in :root`).toContain(token);
    }
    expect(body).toContain('color-scheme: light');
  });

  it('declares .dark with every required token + color-scheme: dark', () => {
    const darkBlock = css.match(/\.dark\s*\{([^}]*)\}/s);
    expect(darkBlock, '.dark block not found').not.toBeNull();
    const body = darkBlock![1];
    for (const token of ROOT_TOKENS) {
      expect(body, `missing ${token} in .dark`).toContain(token);
    }
    expect(body).toContain('color-scheme: dark');
  });

  it('uses @theme inline (NOT plain @theme) so .dark overrides cascade', () => {
    expect(css).toContain('@theme inline');
    // Plain "@theme {" (space, no inline) must NOT appear — it would break dark mode.
    expect(css.match(/@theme\s+\{/)).toBeNull();
  });

  it('maps every token to the --color-* namespace in @theme inline', () => {
    const inlineBlock = css.match(/@theme\s+inline\s*\{([^}]*)\}/s);
    expect(inlineBlock, '@theme inline block not found').not.toBeNull();
    const body = inlineBlock![1];
    for (const mapping of COLOR_MAPPINGS) {
      expect(body, `missing ${mapping} mapping`).toContain(mapping);
    }
  });

  it('preserves the 5 seed VALUES in :root (OKLCH equivalents)', () => {
    const rootBlock = css.match(/:root\s*\{([^}]*)\}/s)![1];
    expect(rootBlock).toContain('--background: oklch(1 0 0)');
    expect(rootBlock).toContain('--foreground: oklch(0.21 0.034 264.665)');
    expect(rootBlock).toContain('--primary: oklch(0.541 0.241 262.261)');
    expect(rootBlock).toContain('--muted-foreground: oklch(0.551 0.027 264.364)');
    expect(rootBlock).toContain('--border: oklch(0.929 0.013 255.508)');
  });

  it('uses OKLCH values (D3) — no raw hex in :root/.dark token values', () => {
    const themed =
      (css.match(/:root\s*\{[^}]*\}/s)?.[0] ?? '') + (css.match(/\.dark\s*\{[^}]*\}/s)?.[0] ?? '');
    expect(themed).toContain('oklch(');
    // Token value lines should not be raw hex (#rrggbb). (Comments may mention hex for traceability.)
    const tokenValueLines = themed
      .split('\n')
      .filter((l) => l.includes(':') && /--[\w-]+:/.test(l) && !l.trim().startsWith('/*'));
    for (const line of tokenValueLines) {
      expect(line, `raw hex in token value: ${line.trim()}`).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });

  it('@layer base body rule references raw --background/--foreground (not --color-*)', () => {
    // Brace-balanced match: @layer base holds nested rules (html/body/#root + body),
    // so [^}]* (stops at first inner }) is wrong — capture lazily to the block's own
    // top-level close (`}` at column 0 on its own line).
    const baseBlock = css.match(/@layer\s+base\s*\{([\s\S]*?)^\}/m);
    expect(baseBlock, '@layer base block not found').not.toBeNull();
    const body = baseBlock![1];
    expect(body).toContain('background-color: var(--background)');
    expect(body).toContain('color: var(--foreground)');
    expect(body, '@layer base still references --color-* (would break — see §2)').not.toContain(
      '--color-background',
    );
    expect(body).not.toContain('--color-foreground');
  });
});
