import { beforeEach, describe, expect, it, vi } from 'vitest';
import { users } from '../db/schema';
import type { GoogleUserInfo } from './googleOAuth';

const MOCK_ROW = {
  id: 'u1',
  googleId: 'g1',
  email: 'a@b.com',
  fullName: 'A',
  avatarUrl: null,
  role: 'MEMBER' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Module-level capture vars — reset in beforeEach; read inside tests.
// vi.mock is hoisted, but the factory closure only runs at import time and
// reads these lazily via the chain methods, so this pattern is safe.
let valuesArg: Record<string, unknown>;
let conflictArg: { target: unknown; set: Record<string, unknown> };

vi.mock('../db/client', () => {
  const chain = {
    insert() {
      return this;
    },
    values(v: Record<string, unknown>) {
      valuesArg = v;
      return this;
    },
    onConflictDoUpdate(c: { target: unknown; set: Record<string, unknown> }) {
      conflictArg = c;
      return this;
    },
    returning() {
      return Promise.resolve([MOCK_ROW]);
    },
  };
  return { db: { insert: () => chain } };
});

import { upsertByGoogleId } from './userService';

describe('upsertByGoogleId', () => {
  beforeEach(() => {
    valuesArg = {} as Record<string, unknown>;
    conflictArg = { target: null, set: {} };
  });

  const input: GoogleUserInfo = {
    googleId: 'g1',
    email: 'a@b.com',
    fullName: 'A',
    avatarUrl: null,
  };

  it('inserts a new user and returns the row', async () => {
    const result = await upsertByGoogleId(input);
    expect(result.id).toBe('u1');
    expect(result.role).toBe('MEMBER');
  });

  it('updates email/name/avatar on conflict', async () => {
    await upsertByGoogleId({
      googleId: 'g1',
      email: 'new@b.com',
      fullName: 'New',
      avatarUrl: 'http://avatar',
    });
    expect(conflictArg.target).toBe(users.googleId);
    expect(conflictArg.set.email).toBe('new@b.com');
    expect(conflictArg.set.fullName).toBe('New');
    expect(conflictArg.set.avatarUrl).toBe('http://avatar');
  });

  it('preserves role on conflict', async () => {
    await upsertByGoogleId(input);
    expect(conflictArg.set).not.toHaveProperty('role');
  });

  it('preserves id on conflict', async () => {
    await upsertByGoogleId(input);
    expect(conflictArg.set).not.toHaveProperty('id');
  });

  it('passes null avatarUrl through', async () => {
    await upsertByGoogleId({ googleId: 'g1', email: 'a@b.com', fullName: 'A', avatarUrl: null });
    expect(valuesArg.avatarUrl).toBeNull();
  });
});
