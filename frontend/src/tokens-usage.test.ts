import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILES = [
  'components/TopNav.tsx',
  'components/ProjectPicker.tsx',
  'components/TicketCard.tsx',
  'components/Loading.tsx',
  'components/Retry.tsx',
  'components/ErrorFallback.tsx',
  'components/TicketNotFound.tsx',
  'components/TicketDetailModal.tsx',
  'pages/NotFoundPage.tsx',
  'pages/ForbiddenPage.tsx',
  'pages/ProjectsPage.tsx',
] as const;

const BARE_TEXT_MUTED = /\btext-muted\b(?![-\w])/;

describe('SLYK-06 — no bare text-muted (surface-as-text) in scope', () => {
  it.each(FILES.map((f) => ({ f })))('no bare text-muted in $f', ({ f }) => {
    const src = readFileSync(resolve(__dirname, f), 'utf8');
    expect(src, `bare text-muted found in ${f}`).not.toMatch(BARE_TEXT_MUTED);
  });
});
