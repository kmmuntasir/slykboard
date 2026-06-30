import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { projectMemberRoleEnum, projectMembers, users } from '../db/schema';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { assertDomainAllowed } from './accessControl';
import { findUserById } from './userService';

// SLYK-01 Task F — centralizes ALL project_members access. No other layer should
// read/write the join table directly. Mirrors the project's collapsed layering
// (Route handler → Service with the singleton Drizzle `db`); there is no
// repository layer in this codebase (controllers/ and repositories/ are empty).

// Project transaction-client alias — identical idiom to userService.ts:19.
// Middleware (requireProjectMember) passes its own tx into isProjectMember /
// getMemberRole so the membership read shares the caller's transactional read.
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// PG unique_violation — composite PK (projectId, userId) is the only unique
// constraint on project_members, so 23505 here always means "membership already
// exists". addMember turns that into an idempotent role upsert.
const PG_UNIQUE_VIOLATION = '23505';

export type ProjectMemberRole = (typeof projectMemberRoleEnum.enumValues)[number];

// Joined row shape for listProjectMembers — the display fields the member-management
// UI renders, plus the membership role + when it was created.
export type ProjectMemberRow = {
  userId: string;
  email: string;
  fullName: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: ProjectMemberRole;
  createdAt: Date;
};

// Membership row shape returned by addExistingMember (POST /:slug/members — add an
// EXISTING user to a project). Mirrors the `membership` sub-object of CreatedMember
// so both add paths surface the same shape to the frontend.
export type MembershipRow = {
  projectId: string;
  userId: string;
  role: ProjectMemberRole;
  createdAt: Date;
};

// Result of createAndAddMember — the freshly inserted user + their membership row.
export type CreatedMember = {
  user: {
    id: string;
    email: string;
    fullName: string;
    displayName: string | null;
    isPlatformAdmin: boolean;
  };
  membership: {
    projectId: string;
    userId: string;
    role: ProjectMemberRole;
    createdAt: Date;
  };
};

// 1. Membership existence check. Takes a tx (NOT the db singleton) so middleware
//    can run it inside the same transactional read as project resolution.
export async function isProjectMember(
  tx: Tx,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(
      and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
    )
    .limit(1);
  return rows.length > 0;
}

// 2. Role lookup. Returns the enum value or null for non-members. Takes a tx so it
//    composes with the caller's transactional read (e.g. requireProjectMember).
export async function getMemberRole(
  tx: Tx,
  projectId: string,
  userId: string,
): Promise<ProjectMemberRole | null> {
  const rows = await tx
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(
      and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
    )
    .limit(1);
  return rows.length > 0 ? rows[0]!.role : null;
}

// 3. Roster for the member-management UI. Inner-join users, ordered by fullName asc.
export async function listProjectMembers(projectId: string): Promise<ProjectMemberRow[]> {
  return db
    .select({
      userId: users.id,
      email: users.email,
      fullName: users.fullName,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
      role: projectMembers.role,
      createdAt: projectMembers.createdAt,
    })
    .from(projectMembers)
    .innerJoin(users, eq(projectMembers.userId, users.id))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(users.fullName);
}

// 4. Idempotent add. Runs in its OWN transaction (db.transaction) so the 23505
//    catch + role update are atomic w.r.t. the insert attempt. On a duplicate
//    (projectId, userId) the unique violation is caught and the existing row's
//    role is updated instead — net effect is an idempotent upsert of the role.
export async function addMember(
  projectId: string,
  userId: string,
  role: ProjectMemberRole = 'MEMBER',
): Promise<void> {
  await db.transaction(async (tx) => {
    try {
      await tx.insert(projectMembers).values({ projectId, userId, role });
    } catch (cause) {
      // 23505 = unique_violation on the composite PK (projectId, userId) — the
      // membership already exists. Treat as an idempotent upsert: update the role
      // on the existing row instead of surfacing the conflict. Any other error is
      // rethrown (no swallowed exceptions).
      const code = (cause as { code?: string })?.code;
      if (code !== PG_UNIQUE_VIOLATION) throw cause;
      await tx
        .update(projectMembers)
        .set({ role })
        .where(
          and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
        );
    }
  });
}

// 5. Delete a membership. Throws NOT_FOUND when no row exists (zero rows affected).
//    Non-revealing by design — the message is the generic 'User not found' so it
//    does not leak whether the project itself exists.
export async function removeMember(projectId: string, userId: string): Promise<void> {
  const deleted = await db
    .delete(projectMembers)
    .where(
      and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
    )
    .returning();
  if (deleted.length === 0) {
    throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
  }
}

// 6. Promote an existing member to PROJECT_ADMIN. NOT_FOUND if they aren't a member.
export async function promoteToProjectAdmin(
  projectId: string,
  userId: string,
): Promise<void> {
  const updated = await db
    .update(projectMembers)
    .set({ role: 'PROJECT_ADMIN' })
    .where(
      and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
    )
    .returning();
  if (updated.length === 0) {
    throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
  }
}

// 6b. Set an existing member's tier to an arbitrary role (promote OR demote).
// Used by the PATCH /:slug/members/:userId/role route. Unlike addMember (which
// idempotently INSERTS on a missing row), this throws NOT_FOUND when the user
// is not already a member — so demoting a non-member correctly surfaces
// 'User not found' instead of silently creating a membership. NOT_FOUND if absent.
export async function setMemberRole(
  projectId: string,
  userId: string,
  role: ProjectMemberRole,
): Promise<void> {
  const updated = await db
    .update(projectMembers)
    .set({ role })
    .where(
      and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
    )
    .returning();
  if (updated.length === 0) {
    throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
  }
}

// 6c. Add an EXISTING platform user to a project (POST /:slug/members — the
// add-existing path, complementing createAndAddMember which provisions a brand-new
// user). Idempotent on the 23505 unique-violation exactly like addMember: if the
// user is already a member, the existing row's role is updated and returned (net
// effect is an idempotent upsert of the role). Returns the membership row in the
// same shape as createAndAddMember's `membership` sub-object.
export async function addExistingMember(
  projectId: string,
  userId: string,
  role: ProjectMemberRole = 'MEMBER',
): Promise<MembershipRow> {
  // Resolve the target user BEFORE any insert. A Platform Admin is a default
  // member of every project (enforced at the gate layer — requireProjectMember),
  // so adding an explicit row is meaningless and is rejected as a conflict with
  // no row inserted. An unknown user surfaces the non-revealing 'User not found'
  // (matches removeMember / setMemberRole).
  const target = await findUserById(userId);
  if (!target) throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
  if (target.isPlatformAdmin) {
    throw new AppError(ErrorCode.CONFLICT, 'Already a member');
  }

  const columns = {
    projectId: projectMembers.projectId,
    userId: projectMembers.userId,
    role: projectMembers.role,
    createdAt: projectMembers.createdAt,
  };

  return db.transaction(async (tx) => {
    try {
      const [inserted] = await tx
        .insert(projectMembers)
        .values({ projectId, userId, role })
        .returning(columns);
      if (inserted) return inserted;
    } catch (cause) {
      // 23505 = unique_violation on the composite PK (projectId, userId) — the
      // membership already exists. Idempotent upsert: update the role on the
      // existing row and return it. Any other error is rethrown.
      const code = (cause as { code?: string })?.code;
      if (code !== PG_UNIQUE_VIOLATION) throw cause;
      const [updated] = await tx
        .update(projectMembers)
        .set({ role })
        .where(
          and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
        )
        .returning(columns);
      if (updated) return updated;
    }
    // Defense in depth — returning() is empty only on a catastrophic driver error.
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'Failed to add member');
  });
}

// 7. Provisioning path for Member Management. ONE db.transaction: domain-gate the
//    email BEFORE any insert (zero side effects on a wrong-domain email), then
//    insert the user (googleId=null, isPlatformAdmin=false, blocked=false), then
//    insert the project_members row. Returns the new user + membership.
export async function createAndAddMember(
  email: string,
  fullName: string,
  displayName: string | null,
  projectId: string,
  role: ProjectMemberRole = 'MEMBER',
): Promise<CreatedMember> {
  // Domain gate first — throws FORBIDDEN before any DB write on mismatch.
  assertDomainAllowed(email);

  return db.transaction(async (tx) => {
    let userRow;
    try {
      [userRow] = await tx
        .insert(users)
        .values({
          email,
          fullName,
          displayName,
          googleId: null,
          isPlatformAdmin: false,
          blocked: false,
        })
        .returning({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          displayName: users.displayName,
          isPlatformAdmin: users.isPlatformAdmin,
        });
    } catch (cause) {
      // 23505 = unique_violation on users.email — the email is already
      // registered. Surface a clean CONFLICT and do NOT fall through to the
      // project_members insert (zero side effects on the conflict path). Any
      // other error is rethrown.
      const code = (cause as { code?: string })?.code;
      if (code === PG_UNIQUE_VIOLATION) {
        throw new AppError(ErrorCode.CONFLICT, 'User already exists');
      }
      throw cause;
    }
    if (!userRow) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'Failed to create user');
    }

    const [membershipRow] = await tx
      .insert(projectMembers)
      .values({
        projectId,
        userId: userRow.id,
        role,
      })
      .returning({
        projectId: projectMembers.projectId,
        userId: projectMembers.userId,
        role: projectMembers.role,
        createdAt: projectMembers.createdAt,
      });
    if (!membershipRow) {
      throw new AppError(ErrorCode.INTERNAL_ERROR, 'Failed to create membership');
    }

    return { user: userRow, membership: membershipRow };
  });
}
