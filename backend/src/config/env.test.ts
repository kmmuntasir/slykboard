import { describe, it, expect } from 'vitest';
import { loadConfig } from './env';
import type { Config } from './env';

type Case = {
  name: string;
  input: Record<string, string | undefined>;
  expectThrow?: boolean;
  field?: keyof Config;
  value?: unknown;
};

describe('loadConfig', () => {
  const cases: Case[] = [
    { name: 'throws when FRONTEND_URL missing', input: { PORT: '3000' }, expectThrow: true },
    { name: 'throws when FRONTEND_URL empty', input: { FRONTEND_URL: '' }, expectThrow: true },
    {
      name: 'returns config when FRONTEND_URL present',
      input: { FRONTEND_URL: 'http://localhost:5173' },
      field: 'frontendUrl',
      value: 'http://localhost:5173',
    },
    {
      name: 'defaults PORT to 3000 when unset',
      input: { FRONTEND_URL: 'http://x' },
      field: 'port',
      value: 3000,
    },
    {
      name: 'defaults DATABASE_URL to empty',
      input: { FRONTEND_URL: 'http://x' },
      field: 'databaseUrl',
      value: '',
    },
    {
      name: 'defaults NODE_ENV to development',
      input: { FRONTEND_URL: 'http://x' },
      field: 'nodeEnv',
      value: 'development',
    },
  ];

  cases.forEach(({ name, input, expectThrow, field, value }) => {
    if (expectThrow) {
      it(name, () => {
        expect(() => loadConfig(input as NodeJS.ProcessEnv)).toThrow();
      });
      return;
    }

    it(name, () => {
      const config = loadConfig(input as NodeJS.ProcessEnv);
      expect(config[field as keyof Config]).toBe(value);
    });
  });
});
