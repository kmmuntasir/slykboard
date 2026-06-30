import { apiFetch } from './client';
import type {
  Member,
  MemberRole,
  MembershipRow,
  CreatedMember,
  MemberRoleUpdateResult,
  MemberRemoveResult,
} from '@/types/member';

// SLYK-01 Task N — typed client for the project member-management endpoints
// (backend/src/routes/projectMembers.routes.ts). Mirrors the apiFetch idiom used
// by projects.ts / reports.ts: apiFetch unwraps the success `.data` envelope and
// throws ApiClientError (with .status + parsed body) on failure. The 403 on these
// project-scoped paths is centralized in apiFetch (non-revealing project-access
// denial → redirect to /projects); other FORBIDDENs (wrong-domain email on
// createAndAddMember) propagate to the caller for inline surfacing.
//
// Return types match the backend response shapes EXACTLY (see
// membershipService.ts) rather than a uniform `Member`, since the endpoints are
// heterogeneous (roster row vs. membership-only row vs. {user, membership}).

// GET /projects/:slug/members — read-only roster (any member + Platform Admins).
export function listMembers(slug: string): Promise<Member[]> {
  return apiFetch<Member[]>(`/projects/${slug}/members`);
}

// POST /projects/:slug/members — add an EXISTING platform user (by userId or
// email). Idempotent: re-adding a member updates their role. Returns the
// membership row (MembershipRow), not a full roster row.
export function addMember(
  slug: string,
  body: { email?: string; userId?: string; role?: MemberRole },
): Promise<MembershipRow> {
  return apiFetch<MembershipRow>(`/projects/${slug}/members`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// POST /projects/:slug/members/new — create a brand-new platform user AND add
// them to the project in one transaction. Domain-gated server-side: a wrong-
// domain email surfaces FORBIDDEN with zero side effects. Returns {user, membership}.
export function createAndAddMember(
  slug: string,
  body: { email: string; fullName?: string; displayName?: string | null; role?: MemberRole },
): Promise<CreatedMember> {
  return apiFetch<CreatedMember>(`/projects/${slug}/members/new`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// PATCH /projects/:slug/members/:userId/role — promote/demote within the project.
// Idempotent. Returns { userId, role }.
export function updateMemberRole(
  slug: string,
  userId: string,
  role: MemberRole,
): Promise<MemberRoleUpdateResult> {
  return apiFetch<MemberRoleUpdateResult>(`/projects/${slug}/members/${userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

// DELETE /projects/:slug/members/:userId — remove a member. Returns { userId }.
export function removeMember(slug: string, userId: string): Promise<MemberRemoveResult> {
  return apiFetch<MemberRemoveResult>(`/projects/${slug}/members/${userId}`, {
    method: 'DELETE',
  });
}
