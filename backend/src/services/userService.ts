import { count, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { bumpTokenVersion } from './tokenVersion';
import type { GoogleUserInfo } from './googleOAuth';

export type UpsertUserInput = GoogleUserInfo;
export type UserRow = typeof users.$inferSelect;

const ADMIN_ROLE = 'ADMIN' as const;
const MEMBER_ROLE = 'MEMBER' as const;
const PG_UNIQUE_VIOLATION = '23505';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// D1 + D12: race-safe upsert. Conflict path preserves role + id (F05 D9).
// Insert path: count users in txn — 0 -> ADMIN, else MEMBER.
// The users_one_admin partial unique index is the hard guarantee against
// double-admin under concurrency; the 23505 retry is the app-layer backstop.
export async function upsertByGoogleId(input: UpsertUserInput): Promise<UserRow> {
  return db.transaction(async (tx) => {
    // Conflict on googleId -> refresh profile (F05 D9), preserve role + id.
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

    // Insert path: first-user -> ADMIN, else MEMBER.
    const [countRow] = await tx.select({ rowCount: count() }).from(users);
    const isFirstUser = Number(countRow?.rowCount) === 0;
    const role = isFirstUser ? ADMIN_ROLE : MEMBER_ROLE;

    try {
      const [row] = await tx
        .insert(users)
        .values({
          googleId: input.googleId,
          email: input.email,
          fullName: input.fullName,
          avatarUrl: input.avatarUrl,
          role,
        })
        .returning();
      return row!;
    } catch (cause) {
      // 23505 = unique_violation. Two races possible:
      //  (a) googleId conflict (another request inserted same googleId first)
      //      -> re-read + refresh, return that row.
      //  (b) users_one_admin conflict (count said 0 but another ADMIN insert landed)
      //      -> retry as MEMBER.
      const code = (cause as { code?: string })?.code;
      if (code !== PG_UNIQUE_VIOLATION) throw cause;
      return retryAsMemberOrRefresh(tx, input);
    }
  });
}

async function retryAsMemberOrRefresh(tx: Tx, input: UpsertUserInput): Promise<UserRow> {
  // Try MEMBER insert (covers users_one_admin race).
  try {
    const [row] = await tx
      .insert(users)
      .values({
        googleId: input.googleId,
        email: input.email,
        fullName: input.fullName,
        avatarUrl: input.avatarUrl,
        role: MEMBER_ROLE,
      })
      .returning();
    return row!;
  } catch (cause) {
    const code = (cause as { code?: string })?.code;
    if (code !== PG_UNIQUE_VIOLATION) throw cause;
    // googleId conflict (another request won the insert race) -> refresh.
    const [existing] = await tx
      .select()
      .from(users)
      .where(eq(users.googleId, input.googleId))
      .limit(1);
    if (!existing) throw cause; // shouldn't happen — defensive
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

// F25: user management list. Now exposes email/role/blocked so the admin
// user-management UI can render the full roster + deactivation state.
export type UserOption = {
  id: string;
  email: string;
  fullName: string;
  role: 'ADMIN' | 'MEMBER';
  avatarUrl: string | null;
  blocked: boolean;
};

export async function listUsers(): Promise<UserOption[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      avatarUrl: users.avatarUrl,
      blocked: users.blocked,
    })
    .from(users)
    .orderBy(users.fullName);
  // roleEnum infers ('ADMIN' | 'MEMBER')[], so the row shape already matches;
  // the assertion is a belt-and-braces guard against future schema widening.
  return rows as UserOption[];
}

// F25 D6: change a user's role. Guards the last-admin demote (CONFLICT) and
// bumps tokenVersion on any change so outstanding JWTs reflect the new role.
// actingUserId is reserved by the spec contract (audit/permission checks);
// it is intentionally read-only here — noUnusedParameters is not enabled, so
// it stays in the public signature untouched.
export async function updateUserRole({
  targetUserId,
  newRole,
  actingUserId,
}: {
  targetUserId: string;
  newRole: 'ADMIN' | 'MEMBER';
  actingUserId: string;
}): Promise<UserRow> {
  void actingUserId;
  const updated = await db.transaction(async (tx): Promise<UserRow> => {
    const [target] = await tx.select().from(users).where(eq(users.id, targetUserId)).limit(1);
    if (!target) {
      throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
    }
    if (target.role !== newRole) {
      const isDemote = target.role === ADMIN_ROLE && newRole === MEMBER_ROLE;
      if (isDemote) {
        const [agg] = await tx
          .select({ value: count() })
          .from(users)
          .where(eq(users.role, ADMIN_ROLE));
        if ((agg?.value ?? 0) <= 1) {
          throw new AppError(ErrorCode.CONFLICT, 'Cannot demote the last admin');
        }
      }
      await tx.update(users).set({ role: newRole }).where(eq(users.id, targetUserId));
    }
    const [row] = await tx.select().from(users).where(eq(users.id, targetUserId)).limit(1);
    // row is guaranteed post-select on an existing PK; the NOT_FOUND branch above
    // already covered the missing case.
    return row!;
  });
  await bumpTokenVersion(targetUserId);
  return updated;
}

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
