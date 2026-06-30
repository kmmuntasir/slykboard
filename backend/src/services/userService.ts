import { and, count, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { assertDomainAllowed } from './accessControl';
import { bumpTokenVersion } from './tokenVersion';

export type UserRow = typeof users.$inferSelect;

const PG_UNIQUE_VIOLATION = '23505';

// Project-wide transaction-client idiom (services wrap multi-step mutations in
// db.transaction). Exported so peer services (bootstrapService, membershipService)
// share one typed alias instead of re-deriving it.
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// SLYK-01 Task G: login-gate lookup by email (replaces the old findUserByGoogleId
// path). User provisioning no longer happens via Google login — accounts are
// created by the bootstrap service or Member Management — so login resolves the
// existing account by email and links the googleId on first login. Returns the
// row or undefined when no account exists for the email.
export async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row;
}

// D4: /me re-fetch helper. Returns the DB-authoritative row for JWT re-signing.
export async function findUserById(id: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

// SLYK-01 Task G: first-login googleId link, race-safe. The conditional
// UPDATE (WHERE google_id IS NULL) only mutates a not-yet-linked account, so two
// concurrent first-logins cannot both win — exactly one returns a row; the loser
// gets rowCount=0 and re-reads to distinguish "already linked by me (same id)"
// from "linked to a different identity (mismatch)". A unique-index hit (23505)
// means the googleId already belongs to another account → same mismatch path.
export async function linkGoogleId(userId: string, googleId: string): Promise<UserRow> {
  try {
    const rows = await db
      .update(users)
      .set({ googleId })
      .where(and(eq(users.id, userId), isNull(users.googleId)))
      .returning();
    if (rows.length > 0) return rows[0]!;

    // 0 rows: either the account is missing or a googleId is already set
    // (concurrent link won the race or a different identity is bound).
    const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!row) {
      throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
    }
    if (row.googleId !== googleId) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Account identity mismatch');
    }
    // Concurrent first-login won the race with the same googleId — return the row.
    return row;
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    const code = (cause as { code?: string })?.code;
    // 23505 = unique_violation on users_google_id_uniq → the googleId is bound
    // to a different account. Surface as identity mismatch (never leak which).
    if (code === PG_UNIQUE_VIOLATION) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Account identity mismatch');
    }
    throw cause;
  }
}

// SLYK-01 Task G: member-management user creation. Creation-time domain gate
// (assertDomainAllowed) runs BEFORE any insert, so a wrong-domain email throws
// FORBIDDEN with zero side effects. New users are never platform admins and
// have no Google identity until first login links one.
export async function createUser({
  email,
  fullName,
  displayName,
}: {
  email: string;
  fullName: string;
  displayName?: string | null;
}): Promise<UserRow> {
  assertDomainAllowed(email);
  const [row] = await db
    .insert(users)
    .values({
      email,
      fullName,
      displayName: displayName ?? null,
      googleId: null,
      isPlatformAdmin: false,
      blocked: false,
    })
    .returning();
  return row!;
}

// SLYK-01 Task G: toggle the platform-admin flag with a last-platform-admin
// guard. Demoting the only remaining PA would leave the system unmanageable, so
// it throws CONFLICT. Any actual change bumps the token version so outstanding
// JWTs are hard-expired and the new claim (pa) takes effect on next issue.
export async function setPlatformAdmin(
  userId: string,
  isPlatformAdmin: boolean,
): Promise<UserRow> {
  const [existing] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!existing) {
    throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
  }

  // No-op when the value isn't changing — still return the row, skip the guard
  // and the token bump.
  if (existing.isPlatformAdmin === isPlatformAdmin) {
    return existing;
  }

  if (!isPlatformAdmin) {
    // Demote: enforce the last-platform-admin guard.
    const countRows = await db
      .select({ count: count() })
      .from(users)
      .where(eq(users.isPlatformAdmin, true));
    const paCount = countRows[0]?.count ?? 0;
    if (paCount <= 1) {
      throw new AppError(ErrorCode.CONFLICT, 'Cannot remove the last platform admin');
    }
  }

  const [updated] = await db
    .update(users)
    .set({ isPlatformAdmin })
    .where(eq(users.id, userId))
    .returning();
  await bumpTokenVersion(userId);
  return updated!;
}

// F25 / SLYK-01: user management list. Returns the three-tier shape
// {isPlatformAdmin, displayName} so the admin UI can render the full roster +
// deactivation state. No global role field (the enum is gone).
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

// F25 D6: activate/deactivate a user. bumpTokenVersion hard-expires any
// outstanding JWTs; the auth-route login gate (blocked === true -> 403) stops
// new sessions from being issued.
export async function setUserBlocked({
  targetUserId,
  blocked,
  actingUserId,
}: {
  targetUserId: string;
  blocked: boolean;
  actingUserId: string;
}): Promise<UserRow> {
  // 1. SELF-DEACTIVATION GUARD — FIRST, before no-op short-circuit
  if (blocked === true && targetUserId === actingUserId) {
    throw new AppError(ErrorCode.FORBIDDEN, 'You cannot deactivate yourself');
  }
  // 2. PRE-FETCH existing row
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (!existing) {
    throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
  }
  // 3. NO-OP SHORT-CIRCUIT — return row without last-PA guard or token bump
  if (existing.blocked === blocked) {
    return existing;
  }
  // 4. LAST-PA-ON-BLOCK GUARD (CONFLICT)
  if (blocked === true && existing.isPlatformAdmin === true) {
    const countRows = await db
      .select({ count: count() })
      .from(users)
      .where(eq(users.isPlatformAdmin, true));
    const paCount = countRows[0]?.count ?? 0;
    if (paCount <= 1) {
      throw new AppError(ErrorCode.CONFLICT, 'Cannot remove the last platform admin');
    }
  }
  const [updated] = await db
    .update(users)
    .set({ blocked })
    .where(eq(users.id, targetUserId))
    .returning();
  await bumpTokenVersion(targetUserId);
  return updated!;
}
