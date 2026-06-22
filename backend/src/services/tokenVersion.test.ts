import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock wiring ------------------------------------------------------------
//
// vi.mock is hoisted above all imports, so any binding it closes over must be
// created via vi.hoisted (also hoisted). We hold the mutable terminal fns and
// capture vars in one hoisted bag; the factory builds the fluent mock objects
// from it, and tests read/reset the same references.
//
// Call shapes:
//   db.select({tokenVersion}).from(users).where(...).limit(1)  -> Promise<array>  [find]
//   db.update(users).set(...).where(...)                       -> Promise         [bump]
// Find path's terminal is `.limit()`; bump path's terminal is `.where()`.

const bag = vi.hoisted(() => ({
  selectLimit: vi.fn(),
  updateWhere: vi.fn(),
  updateSetArg: {} as Record<string, unknown>,
}));

vi.mock('../db/client', () => {
  const db = {
    select: vi.fn(() => {
      const chain = {
        from: () => chain,
        where: () => chain,
        limit: () => bag.selectLimit(),
      };
      return chain;
    }),
    update: vi.fn(() => ({
      set: (s: Record<string, unknown>) => {
        bag.updateSetArg = s;
        return { where: () => bag.updateWhere() };
      },
    })),
  };
  return { db };
});

import { findUserTokenVersion, bumpTokenVersion } from './tokenVersion';

function resetBag() {
  bag.selectLimit.mockReset();
  bag.updateWhere.mockReset();
  bag.updateSetArg = {};
}

describe('findUserTokenVersion', () => {
  beforeEach(resetBag);

  const cases = [
    { name: 'returns column value when found', row: [{ tokenVersion: 3 }], expected: 3 },
    { name: 'returns undefined when not found', row: [], expected: undefined },
  ];

  cases.forEach(({ name, row, expected }) => {
    it(name, async () => {
      bag.selectLimit.mockResolvedValueOnce(row);

      const result = await findUserTokenVersion('u1');

      expect(bag.selectLimit).toHaveBeenCalledTimes(1);
      expect(result).toBe(expected);
    });
  });
});

describe('bumpTokenVersion', () => {
  beforeEach(resetBag);

  it('increments via SQL and reaches .where', async () => {
    bag.updateWhere.mockResolvedValueOnce(undefined);

    await bumpTokenVersion('u1');

    expect(bag.updateSetArg).toEqual(expect.objectContaining({ tokenVersion: expect.anything() }));
    expect(bag.updateSetArg.tokenVersion).toBeTruthy();
    expect(bag.updateWhere).toHaveBeenCalledTimes(1);
  });

  it('no-throw on success', async () => {
    bag.updateWhere.mockResolvedValueOnce(undefined);

    await expect(bumpTokenVersion('u1')).resolves.toBeUndefined();
  });
});
