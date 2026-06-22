import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';

// F07 D3: PK lookup of the user's current token version. Used by authenticate
// to compare against the JWT `ver` claim. Indexed by PK (sub-ms).
export async function findUserTokenVersion(userId: string): Promise<number | undefined> {
  const [row] = await db
    .select({ tokenVersion: users.tokenVersion })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.tokenVersion;
}

// F07 D3 + D4: increment the user's token version, hard-expiring all outstanding
// JWTs for that user (authenticate 401s on ver mismatch). Called by:
//  - POST /api/auth/logout (T4) — session invalidation.
//  - F25 (future) — on role demotion. F07 ships the helper; F25 calls it.
// Uses SQL-side increment (atomic, concurrency-safe).
export async function bumpTokenVersion(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(eq(users.id, userId));
}
