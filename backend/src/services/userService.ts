import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { bumpTokenVersion } from './tokenVersion';
import type { GoogleUserInfo } from './googleOAuth';

export type UpsertUserInput = GoogleUserInfo;
export type UserRow = typeof users.$inferSelect;

const PG_UNIQUE_VIOLATION = '23505';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// D1 + D12: race-safe upsert by googleId. Conflict path refreshes profile +
// preserves id. SLYK-01: the global role enum is gone — new inserts take the
// schema default isPlatformAdmin=false; platform-admin provisioning is owned
// by the bootstrap service (Task E), not the login upsert. The users_one_admin
// partial unique index was dropped, so the only 23505 race is a googleId
// conflict (handled by re-read + refresh).
export async function upsertByGoogleId(input: UpsertUserInput): Promise<UserRow> {
  return db.transaction(async (tx) => {
    // Conflict on googleId -> refresh profile (F05 D9), preserve id.
    const [existing] = await tx
      .select()
      .from(users)
      .where(eq(users.googleId, input.googleId))
      .limit(1);
    if (existing) {
      const [updated] = await tx
        .update(users)
        .set({
          email: input.email,
          fullName: input.fullName,
          avatarUrl: input.avatarUrl,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existing.id))
        .returning();
      return updated!;
    }

    try {
      const [row] = await tx
        .insert(users)
        .values({
          googleId: input.googleId,
          email: input.email,
          fullName: input.fullName,
          avatarUrl: input.avatarUrl,
        })
        .returning();
      return row!;
    } catch (cause) {
      // 23505 = unique_violation. The only remaining race is a googleId conflict
      // (users_one_admin was dropped) -> re-read + refresh.
      const code = (cause as { code?: string })?.code;
      if (code !== PG_UNIQUE_VIOLATION) throw cause;
      return retryOrRefresh(tx, input);
    }
  });
}

async function retryOrRefresh(tx: Tx, input: UpsertUserInput): Promise<UserRow> {
  // googleId conflict (another request won the insert race) -> refresh.
  const [existing] = await tx
    .select()
    .from(users)
    .where(eq(users.googleId, input.googleId))
    .limit(1);
  if (!existing) throw new AppError(ErrorCode.INTERNAL_ERROR, 'User upsert race failed');
  const [updated] = await tx
    .update(users)
    .set({
      email: input.email,
      fullName: input.fullName,
      avatarUrl: input.avatarUrl,
      updatedAt: new Date(),
    })
    .where(eq(users.id, existing.id))
    .returning();
  return updated!;
}

// D4: /me re-fetch helper. Returns the DB-authoritative row for JWT re-signing.
export async function findUserById(id: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

// D1: read-only lookup by googleId. Used by the auth route to decide whether
// the current request is the insert (signup) path or the conflict path, so the
// domain gate can run only on insert. Returns null when not found.
export async function findUserByGoogleId(googleId: string): Promise<UserRow | null> {
  const [row] = await db.select().from(users).where(eq(users.googleId, googleId)).limit(1);
  return row ?? null;
}

// F25 / SLYK-01: user management list. Returns the three-tier shape
// {isPlatformAdmin, displayName} so the admin UI can render the full roster +
// deactivation state. The global role enum is gone.
export type UserOption = {
  id: string;
  email: string;
  fullName: string;
  displayName: string | null;
  isPlatformAdmin: boolean;
  avatarUrl: string | null;
  blocked: boolean;
};

export async function listUsers(): Promise<UserOption[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      displayName: users.displayName,
      isPlatformAdmin: users.isPlatformAdmin,
      avatarUrl: users.avatarUrl,
      blocked: users.blocked,
    })
    .from(users)
    .orderBy(users.fullName);
  return rows;
}

// SLYK-01 Task D: updateUserRole removed (global role enum gone; the
// PATCH /:userId/role route is removed too). Task K adds
// PATCH /:userId/isPlatformAdmin backed by a new setPlatformAdmin service method.

// F25 D6: activate/deactivate a user. bumpTokenVersion hard-expires any
// outstanding JWTs; the auth-route login gate (blocked === true -> 403) stops
// new sessions from being issued.
export async function setUserBlocked({
  targetUserId,
  blocked,
}: {
  targetUserId: string;
  blocked: boolean;
}): Promise<UserRow> {
  const [updated] = await db
    .update(users)
    .set({ blocked })
    .where(eq(users.id, targetUserId))
    .returning();
  if (!updated) {
    throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
  }
  await bumpTokenVersion(targetUserId);
  return updated;
}
