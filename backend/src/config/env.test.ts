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
  // F05: full valid base — happy-path cases extend it; throw cases build partial inputs.
  const validBase: Record<string, string | undefined> = {
    FRONTEND_URL: 'http://localhost:5173',
    DATABASE_URL: 'postgresql://x:x@localhost:5432/x',
    JWT_SECRET: 'x'.repeat(32),
    GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    GOOGLE_CALLBACK_URL: 'postmessage',
  };

  const cases: Case[] = [
    { name: 'throws when FRONTEND_URL missing', input: { PORT: '3000' }, expectThrow: true },
    { name: 'throws when FRONTEND_URL empty', input: { FRONTEND_URL: '' }, expectThrow: true },
    {
      name: 'throws when DATABASE_URL missing',
      input: { FRONTEND_URL: 'http://localhost:5173' },
      expectThrow: 'DATABASE_URL is required',
    },
    {
      name: 'throws when JWT_SECRET missing',
      input: {
        FRONTEND_URL: 'http://localhost:5173',
        DATABASE_URL: 'postgresql://x:x@localhost:5432/x',
      },
      expectThrow: 'Missing JWT_SECRET',
    },
    {
      name: 'throws when JWT_SECRET shorter than 32 chars',
      input: { ...validBase, JWT_SECRET: 'too-short' },
      expectThrow: 'JWT_SECRET must be >= 32 chars',
    },
    {
      name: 'throws when GOOGLE_CLIENT_ID missing',
      input: { ...validBase, GOOGLE_CLIENT_ID: undefined },
      expectThrow: 'Missing GOOGLE_CLIENT_ID',
    },
    {
      name: 'throws when GOOGLE_CLIENT_SECRET missing',
      input: { ...validBase, GOOGLE_CLIENT_SECRET: undefined },
      expectThrow: 'Missing GOOGLE_CLIENT_SECRET',
    },
    {
      name: 'throws when GOOGLE_CALLBACK_URL missing',
      input: { ...validBase, GOOGLE_CALLBACK_URL: undefined },
      expectThrow: 'Missing GOOGLE_CALLBACK_URL',
    },
    {
      name: 'returns config when FRONTEND_URL present',
      input: { ...validBase },
      field: 'frontendUrl',
      value: 'http://localhost:5173',
    },
    {
      name: 'accepts DATABASE_URL',
      input: { ...validBase },
      field: 'databaseUrl',
      value: 'postgresql://x:x@localhost:5432/x',
    },
    {
      name: 'defaults PORT to 3000 when unset',
      input: { ...validBase, PORT: undefined },
      field: 'port',
      value: 3000,
    },
    {
      name: 'defaults NODE_ENV to development',
      input: { ...validBase, NODE_ENV: undefined },
      field: 'nodeEnv',
      value: 'development',
    },
    {
      name: 'exposes F05 JWT signing key',
      input: { ...validBase },
      field: 'jwtSecret',
      value: 'x'.repeat(32),
    },
    // SLYK-0130: agent-mode env validation
    {
      name: 'SLYK-0130: plain mode boots with none of the four agent vars set',
      input: {
        ...validBase,
        SLYKBOARD_AGENT_MODE: undefined,
        SLYKBOARD_DISPATCHER_URL: undefined,
        SLYKBOARD_DISPATCHER_TOKEN: undefined,
        SLYKBOARD_SLACK_ESCALATION_WEBHOOK: undefined,
      },
      field: 'agentMode',
      value: false,
    },
    {
      name: 'SLYK-0130: agent mode without dispatcher URL names the missing var',
      input: { ...validBase, SLYKBOARD_AGENT_MODE: 'true' },
      expectThrow: 'SLYKBOARD_DISPATCHER_URL required when SLYKBOARD_AGENT_MODE=true',
    },
    {
      name: 'SLYK-0130: agent mode without dispatcher token names the missing var',
      input: {
        ...validBase,
        SLYKBOARD_AGENT_MODE: 'true',
        SLYKBOARD_DISPATCHER_URL: 'http://localhost:4001',
      },
      expectThrow: 'SLYKBOARD_DISPATCHER_TOKEN required when SLYKBOARD_AGENT_MODE=true',
    },
    {
      name: 'SLYK-0130: agent mode with short dispatcher token throws',
      input: {
        ...validBase,
        SLYKBOARD_AGENT_MODE: 'true',
        SLYKBOARD_DISPATCHER_URL: 'http://localhost:4001',
        SLYKBOARD_DISPATCHER_TOKEN: 'a'.repeat(63),
      },
      expectThrow: 'Invalid agent-mode env vars',
    },
    {
      name: 'SLYK-0130: agent mode with valid URL + 64-char token parses',
      input: {
        ...validBase,
        SLYKBOARD_AGENT_MODE: 'true',
        SLYKBOARD_DISPATCHER_URL: 'http://localhost:4001',
        SLYKBOARD_DISPATCHER_TOKEN: 'a'.repeat(64),
      },
      field: 'agentMode',
      value: true,
    },
    {
      name: 'SLYK-0130: bad SLYKBOARD_AGENT_MODE enum value is a Zod error',
      input: { ...validBase, SLYKBOARD_AGENT_MODE: 'yes' },
      expectThrow: 'Invalid agent-mode env vars',
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
