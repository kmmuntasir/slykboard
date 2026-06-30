import { z } from 'zod';
import { slugParamSchema } from './projects.schema';

// SLYK-01 Task L — Zod schemas for the project member-management routes
// (mounted under /api/projects/:slug/members...). Co-located per the project's
// routes/<resource>.schema.ts convention. Mirrors the validateRequest pattern
// used by projects.schema.ts / tickets.schema.ts: on invalid input the route's
// validateRequest middleware throws AppError(ErrorCode.VALIDATION_FAILED, 400)
// with details = zod flattenError.

// Project-scoped member tier. Matches membershipService.ProjectMemberRole
// (projectMemberRoleEnum enumValues). Platform-admin is NOT a member tier —
// it lives on req.user.isPlatformAdmin, not in this enum.
export const memberRoleSchema = z.enum(['PROJECT_ADMIN', 'MEMBER']);

// Base body for creating a brand-new platform user AND adding them to the
// project in one shot (POST /:slug/members/new via createAndAddMember).
// fullName/displayName are optional at the edge; the service persists
// fullName (DB NOT NULL) with a safe default when omitted.
export const memberEmailSchema = z.object({
    email: z.email(),
    fullName: z.string().min(1).max(200).optional(),
    displayName: z.string().max(100).nullable().optional(),
});

// POST /:slug/members/new body. memberEmailSchema + an optional target role
// (defaults to 'MEMBER' in the service when omitted).
export const createMemberSchema = memberEmailSchema.extend({
    role: memberRoleSchema.optional(),
});

// PATCH /:slug/members/:userId/role body.
export const updateMemberRoleSchema = z.object({
    role: memberRoleSchema,
});

// :slug + :userId path params for PATCH/DELETE member routes. Reuses the
// project slug param shape so an invalid slug is a 400 (not a 404/403).
export const memberUserIdParamSchema = slugParamSchema.extend({
    userId: z.uuid(),
});

export type MemberEmailBody = z.infer<typeof memberEmailSchema>;
export type CreateMemberBody = z.infer<typeof createMemberSchema>;
export type UpdateMemberRoleBody = z.infer<typeof updateMemberRoleSchema>;
export type MemberUserIdParam = z.infer<typeof memberUserIdParamSchema>;
