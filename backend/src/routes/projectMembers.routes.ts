import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireProjectMember } from '../middleware/requireProjectMember';
import { requireProjectAdmin } from '../middleware/requireProjectAdmin';
import { validateRequest } from '../middleware/validateRequest';
import { success } from '../utils/envelope';
import { slugParamSchema } from './projects.schema';
import {
    createMemberSchema,
    addMemberBody,
    memberUserIdParamSchema,
    updateMemberRoleSchema,
    lookupMemberSchema,
} from './projectMembers.schema';
import * as membershipService from '../services/membershipService';
import { findUserByEmail, findUserById } from '../services/userService';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

// SLYK-01 Task L — project member-management routes. Bare-mounted on
// projectsRouter (mirrors projectLabelsRouter / projectReportsRouter) so the
// full paths are /api/projects/:slug/members...
//
// Layering follows the codebase's collapsed Route handler → Service idiom:
// handlers read req.project (attached by requireProjectMember) and call
// membershipService only — no direct DB access. Middleware chain order matches
// report.routes.ts: authenticate → validateRequest (parses+sets req.params,
// incl. :slug, before requireProjectMember reads it) → requireProjectMember
// (resolves project + tier, non-revealing FORBIDDEN) → requireProjectAdmin
// (PA / PROJECT_ADMIN only) on the write routes.
//
// Roles:
//   - GET roster        : any member or Platform Admin (requireProjectMember)
//   - create / promote  : Platform Admin OR PROJECT_ADMIN (requireProjectAdmin)
// Member-not-found on write paths surfaces as NOT_FOUND 'User not found'
// (non-revealing w.r.t. project existence). Role updates are idempotent —
// setting the same role still returns 200.
export const projectMembersRouter = Router();

// GET /:slug/members/lookup — read-only email probe for the Add-Member modal.
// Admins-only (PA or PROJECT_ADMIN). 200 in both branches (found / not-found)
// so the client branches on the response shape, never on exceptions. The
// payload is minimal — tokenVersion / googleId / blocked are NEVER surfaced
// (anti-oracle + privacy). Mounted ABOVE the roster route so the literal
// `/lookup` segment isn't shadowed by the `/:slug/members` prefix.
projectMembersRouter.get(
    '/:slug/members/lookup',
    authenticate,
    validateRequest(lookupMemberSchema),
    requireProjectMember(),
    requireProjectAdmin(),
    async (req, res) => {
        const { email } = req.query as { email: string };
        const user = await findUserByEmail(email);
        if (!user) {
            res.json(success({ exists: false }));
            return;
        }
        res.json(
            success({
                exists: true,
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.fullName,
                    displayName: user.displayName,
                    isPlatformAdmin: user.isPlatformAdmin,
                },
            }),
        );
    },
);

// GET /:slug/members — read-only roster. Any member (MEMBER tier included) and
// Platform Admins see the full list.
projectMembersRouter.get(
    '/:slug/members',
    authenticate,
    validateRequest({ params: slugParamSchema }),
    requireProjectMember(),
    async (req, res) => {
        const members = await membershipService.listProjectMembers(req.project!.id);
        res.json(success(members));
    },
);

// POST /:slug/members — add an EXISTING platform user to the project (resolved
// by userId directly or by email via userService.findUserByEmail). Distinct from
// POST /:slug/members/new, which provisions a brand-new user. Member-not-found
// surfaces as NOT_FOUND 'User not found' (non-revealing w.r.t. project existence).
// addExistingMember is idempotent on the composite-PK unique violation — adding an
// existing member updates their role and returns the row.
projectMembersRouter.post(
    '/:slug/members',
    authenticate,
    validateRequest({ params: slugParamSchema, body: addMemberBody }),
    requireProjectMember(),
    requireProjectAdmin(),
    async (req, res) => {
        const body = req.body as {
            email?: string;
            userId?: string;
            role?: 'PROJECT_ADMIN' | 'MEMBER';
        };
        // Resolve the target user. Direct lookup by userId takes the fast path;
        // email lookup falls back to userService.findUserByEmail. Either way a
        // missing user surfaces the non-revealing NOT_FOUND 'User not found'.
        const target = body.userId
            ? await findUserById(body.userId)
            : await findUserByEmail(body.email!);
        if (!target) {
            throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
        }
        const membership = await membershipService.addExistingMember(
            req.project!.id,
            target.id,
            body.role,
        );
        res.status(201).json(success(membership));
    },
);

// POST /:slug/members/new — create a brand-new platform user AND add them to
// the project in one transaction. createAndAddMember asserts the email's domain
// (ALLOWED_DOMAIN) BEFORE any insert, so a wrong-domain email surfaces the
// service's FORBIDDEN with zero side effects. fullName defaults to '' when the
// caller omits it (users.full_name is NOT NULL).
projectMembersRouter.post(
    '/:slug/members/new',
    authenticate,
    validateRequest({ params: slugParamSchema, body: createMemberSchema }),
    requireProjectMember(),
    requireProjectAdmin(),
    async (req, res) => {
        const body = req.body as {
            email: string;
            fullName?: string;
            displayName?: string | null;
            role?: 'PROJECT_ADMIN' | 'MEMBER';
        };
        const created = await membershipService.createAndAddMember(
            body.email,
            body.fullName ?? '',
            body.displayName ?? null,
            req.project!.id,
            body.role,
        );
        res.status(201).json(success(created));
    },
);

// PATCH /:slug/members/:userId/role — promote or demote an existing member.
// setMemberRole throws NOT_FOUND 'User not found' when the target is not a
// member (covers both directions uniformly). Idempotent: same role → still 200.
projectMembersRouter.patch(
    '/:slug/members/:userId/role',
    authenticate,
    validateRequest({ params: memberUserIdParamSchema, body: updateMemberRoleSchema }),
    requireProjectMember(),
    requireProjectAdmin(),
    async (req, res) => {
        const { userId } = req.params as { userId: string };
        const body = req.body as { role: 'PROJECT_ADMIN' | 'MEMBER' };
        await membershipService.setMemberRole(req.project!.id, userId, body.role);
        res.json(success({ userId, role: body.role }));
    },
);

// DELETE /:slug/members/:userId — remove a member. removeMember throws
// NOT_FOUND 'User not found' when no membership row exists.
projectMembersRouter.delete(
    '/:slug/members/:userId',
    authenticate,
    validateRequest({ params: memberUserIdParamSchema }),
    requireProjectMember(),
    requireProjectAdmin(),
    async (req, res) => {
        const { userId } = req.params as { userId: string };
        await membershipService.removeMember(req.project!.id, userId);
        res.json(success({ userId }));
    },
);
