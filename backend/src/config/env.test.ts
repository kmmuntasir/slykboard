import { describe, it, expect } from 'vitest';
import { loadConfig } from './env';
import type { Config } from './env';

type Case = {
  name: string;
  input: Record<string, string | undefined>;
  expectThrow?: boolean | string;
  field?: keyof Config;
  value?: unknown;
};

describe('loadConfig', () => {
  const cases: Case[] = [
    { name: 'throws when FRONTEND_URL missing', input: { PORT: '3000' }, expectThrow: true },
    { name: 'throws when FRONTEND_URL empty', input: { FRONTEND_URL: '' }, expectThrow: true },
    {
      name: 'throws when DATABASE_URL missing',
      input: { FRONTEND_URL: 'http://localhost:5173' },
      expectThrow: 'DATABASE_URL is required',
    },
    {
      name: 'returns config when FRONTEND_URL present',
      input: {
        FRONTEND_URL: 'http://localhost:5173',
        DATABASE_URL: 'postgresql://x:x@localhost:5432/x',
      },
      field: 'frontendUrl',
      value: 'http://localhost:5173',
    },
    {
      name: 'accepts DATABASE_URL',
      input: {
        FRONTEND_URL: 'http://localhost:5173',
        DATABASE_URL: 'postgresql://x:x@localhost:5432/x',
      },
      field: 'databaseUrl',
      value: 'postgresql://x:x@localhost:5432/x',
    },
    {
      name: 'defaults PORT to 3000 when unset',
      input: {
        FRONTEND_URL: 'http://x',
        DATABASE_URL: 'postgresql://x:x@localhost:5432/x',
      },
      field: 'port',
      value: 3000,
    },
    {
      name: 'defaults NODE_ENV to development',
      input: {
        FRONTEND_URL: 'http://x',
        DATABASE_URL: 'postgresql://x:x@localhost:5432/x',
      },
      field: 'nodeEnv',
      value: 'development',
    },
  ];

  cases.forEach(({ name, input, expectThrow, field, value }) => {
    if (expectThrow) {
      it(name, () => {
        if (typeof expectThrow === 'string') {
          expect(() => loadConfig(input as NodeJS.ProcessEnv)).toThrow(expectThrow);
        } else {
          expect(() => loadConfig(input as NodeJS.ProcessEnv)).toThrow();
        }
      });
      return;
    }

    it(name, () => {
      const config = loadConfig(input as NodeJS.ProcessEnv);
      expect(config[field as keyof Config]).toBe(value);
    });
  });
});
