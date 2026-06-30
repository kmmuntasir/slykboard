// SLYK-01 Task N — frontend mirror of the project member-management backend
// contract. Source of truth: backend/src/services/membershipService.ts
// (ProjectMemberRole / ProjectMemberRow / MembershipRow / CreatedMember) and
// backend/src/routes/projectMembers.schema.ts (memberRoleSchema). Dates cross the
// wire as ISO strings (JSON has no Date type), so createdAt is `string` here.

// Project-scoped member tier. Matches membershipService.ProjectMemberRole and
// the projectMemberRoleEnum enumValues ('PROJECT_ADMIN' | 'MEMBER'). Platform-
// admin is NOT a member tier — it lives on AuthUser.isPlatformAdmin.
export const MEMBER_ROLES = ['PROJECT_ADMIN', 'MEMBER'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

// Roster row returned by GET /:slug/members (membershipService.listProjectMembers
// → ProjectMemberRow). This is the canonical "Member" the management UI renders.
export interface Member {
  userId: string;
  email: string;
  fullName: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: MemberRole;
  createdAt: string;
}

// Membership-only row returned by POST /:slug/members (addExistingMember) — the
// minimal join-table tuple, no user profile fields.
export interface MembershipRow {
  projectId: string;
  userId: string;
  role: MemberRole;
  createdAt: string;
}

// Result of POST /:slug/members/new (createAndAddMember) — the freshly provisioned
// user plus their membership row. Mirrors membershipService.CreatedMember.
export interface CreatedMember {
  user: {
    id: string;
    email: string;
    fullName: string;
    displayName: string | null;
    isPlatformAdmin: boolean;
  };
  membership: MembershipRow;
}

// Result of PATCH /:slug/members/:userId/role and DELETE /:slug/members/:userId —
// the route handlers echo back { userId, role } / { userId }.
export interface MemberRoleUpdateResult {
  userId: string;
  role: MemberRole;
}

export interface MemberRemoveResult {
  userId: string;
}
