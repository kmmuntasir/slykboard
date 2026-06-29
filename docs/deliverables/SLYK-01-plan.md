# Implementation Plan — SLYK-01

**Ticket:** `docs/deliverables/SLYK-01.md`
**Type:** Feature
**Title:** Three-Tier Roles & Project Membership
**Generated:** 2026-06-30

---

## Summary

SLYK-01 is the foundational authorization rework. It replaces the current single
workspace-global `ADMIN`/`MEMBER` enum (a two-value `role` column on `users`) and
the creator-or-admin membership heuristic with a proper three-tier model:

1. **Platform Admin** — a boolean `users.isPlatformAdmin` (workspace-wide
   superuser; bypasses all project membership checks; can manage any project and
   any user).
2. **Project Admin / Project Member** — rows in a new `project_members` join table
   scoped per project.

The deliverable discards the entire existing migration chain and authors **one
fresh initial migration** (`0000`) reflecting the new schema (no data preservation
required). It adds `users.isPlatformAdmin`, `users.displayName`, the
`project_members` table, and an `isActive` flag on `projects` (the flag column is
owned here; deactivation *behavior* is owned by DEL-04). It implements a
**bootstrap Platform Admin** at server boot driven by env vars, rewrites the
**Google login gate** to reject unknown emails, link `googleId` on first login,
and reject blocked users, enforces `ALLOWED_DOMAIN` only at user creation,
rewrites **project visibility** to be membership-scoped (plus Platform Admin
bypass) with non-revealing forbidden responses, and enforces the binding
permission matrix across every project-scoped action.

> **Convention note (important):** The project's `AGENTS.md` prescribes a
> `Route → Controller → Service → Repository` layering, but the **actual codebase
> collapses this to `Route handler → Service (Drizzle ORM)`** — `controllers/` and
> `repositories/` contain only `.gitkeep`, services import the singleton `db`
> directly and own business logic + persistence + transactions. This plan follows
> the **actual** convention (Route → Service) rather than the aspirational one, to
> stay consistent with the existing code. Errors are thrown as `AppError` and
> serialized by the centralized Express error middleware; responses use the
> `success()`/`error()` envelope.

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| Schema | `backend/src/db/schema.ts` | Replace `roleEnum` with `users.isPlatformAdmin`; add `users.displayName`; add `project_members` table + its enum; add `projects.isActive`. |
| Migrations | `backend/src/db/migrations/**` | Discard the entire chain (`0000`–`0012` + `meta/`); regenerate one fresh `0000`. |
| Config | `backend/src/config/env.ts` | Add `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_FULL_NAME`, `BOOTSTRAP_ADMIN_DISPLAY_NAME`. |
| Bootstrap | `backend/src/services/bootstrapService.ts` (new) + `backend/src/index.ts` | Boot-time idempotent Platform Admin creation, domain-validated. |
| Auth | `backend/src/routes/auth.routes.ts` | Rewrite login gate: reject unknown email, link `googleId`, reject blocked. |
| Auth | `backend/src/services/userService.ts` | Replace signup-time first-user-admin logic; add `findUserByEmail`, `linkGoogleId`, `createUserFromMemberMgmt`; remove dead `users_one_admin` code. |
| Auth | `backend/src/services/accessControl.ts` | Keep `assertDomainAllowed` (creation-time only). |
| Types | `backend/src/types/express.d.ts` | `AuthenticatedUser.role` → `AuthenticatedUser.isPlatformAdmin`; add `req.project`, member context. |
| JWT | `backend/src/utils/jwt.ts` | Claim `role` → `pa` (platform-admin boolean); keep `ver`. |
| Middleware | `backend/src/middleware/auth.ts` | Sets `req.user.isPlatformAdmin`. |
| Middleware | `backend/src/middleware/requireRole.ts` → rename `requirePlatformAdmin.ts` | Global Platform-Admin gate. |
| Middleware | `backend/src/middleware/requireProjectMember.ts` | Replace heuristic with real `project_members` lookup + Platform-Admin bypass. |
| Middleware (new) | `backend/src/middleware/requireProjectAdmin.ts` | Project-Admin-or-Platform-Admin gate for member/label/ticket-management actions. |
| Service (new) | `backend/src/services/membershipService.ts` | `isMember`, `getMemberRole`, `listMembers`, `addMember`, `removeMember`, `promoteToProjectAdmin`, `createAndAddMember`. |
| Service | `backend/src/services/projectService.ts` | Membership-scoped `listProjects`/`getProjectBySlug`; non-revealing FORBIDDEN. |
| Routes | `backend/src/routes/projects.routes.ts` | Visibility + matrix enforcement; create/rename → Platform Admin only. |
| Routes (new) | `backend/src/routes/projectMembers.routes.ts` | `GET/POST/DELETE /:slug/members`, `PATCH /:slug/members/:userId/role`. |
| Routes | `backend/src/routes/tickets.routes.ts` | Resolve `ticketId → projectId`; enforce membership/role per matrix. |
| Routes | `backend/src/routes/labels.routes.ts` | Replace global `requireRole('ADMIN')` with project-scoped `requireProjectAdmin`. |
| Routes | `backend/src/routes/report.routes.ts` | Remove deprecated global `/api/reports/*` (or gate to Platform Admin). |
| Routes | `backend/src/routes/users.routes.ts` | Adapt to `isPlatformAdmin`; global deactivate = Platform Admin only. |
| Seed | `backend/src/db/seed.ts` | Update fixtures for new schema; drop `users_one_admin` references. |
| Frontend types | `frontend/src/types/*.ts`, `frontend/src/api/auth.ts`, `frontend/src/api/users.ts` | `role` → `isPlatformAdmin`; add `displayName`; add member types. |
| Frontend API | `frontend/src/api/projects.ts` (+ new `members.ts`) | Member-management client methods. |
| Frontend store/hooks | `frontend/src/stores/useAuthStore.ts`, `frontend/src/hooks/useRequireRole.ts` | `role` → `isPlatformAdmin`. |
| Frontend API client | `frontend/src/api/client.ts` | Consistent 403 (non-revealing) UX. |
| Frontend pages/components | `RequireRole.tsx`, `ProjectsPage.tsx`, `ProjectSettingsPage.tsx`, `routes/index.tsx`, new member-management UI | Role model + greenfield member management. |

## Proposed Implementation

Ordered by build dependency: schema → migration → config → bootstrap → auth/login
gate → membership primitives → middleware → visibility → matrix enforcement →
member-management endpoints → frontend.

### Backend Changes

#### 1. Rewrite the Drizzle schema — `backend/src/db/schema.ts`

**What:**
- **Remove** `roleEnum` (`schema.ts:19`/`:21`) and the `users.role` column.
- **Add** `users.isPlatformAdmin`: `boolean('is_platform_admin').notNull().default(false)`.
- **Add** `users.displayName`: `text('display_name')` (nullable).
- Keep `users.googleId` but make it **nullable** (bootstrap admin is created with
  `googleId = null` until first login links it) and drop its `UNIQUE`-if-blocking
  nature only if needed; keep UNIQUE nullable (Postgres allows multiple NULLs) so
  linking remains safe. Add a partial unique index on `email` is already UNIQUE.
- **Add** `projects.isActive`: `boolean('is_active').notNull().default(true)`
  (column only; behavior is DEL-04).
- **Add** `projectMemberRoleEnum = pgEnum('ProjectMemberRole', ['PROJECT_ADMIN', 'MEMBER'])`.
- **Add** `projectMembers` table:
  ```ts
  export const projectMembers = pgTable(
    'project_members',
    {
      projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
      userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
      role: projectMemberRoleEnum('role').notNull().default('MEMBER'),
      createdAt: timestamptz('created_at').notNull().defaultNow(),
    },
    (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
  );
  ```
  The composite PK enforces the unique `(projectId, userId)` constraint required by
  the ticket. (Also add an index on `userId` for "list my projects" queries.)

**Why:** Foundation for the entire three-tier model. Single source of truth for
the fresh migration.

**Code reference:** existing `Users` table `schema.ts:25-52`; `Projects`
`schema.ts:66-78`; enum pattern `schema.ts:19`.

#### 2. Discard migration chain, author fresh `0000`

**What:**
- Delete every file under `backend/src/db/migrations/` (all `*.sql` and
  `meta/_journal.json` + `meta/*_snapshot.json`).
- Run `npm run db:generate` (`drizzle-kit generate`, `package.json:11`) to emit a
  single `0000_*.sql` + fresh `meta/`.
- **Target databases must be reset** (drop schema / recreate) before applying,
  since the journal hash changes. Document this in the PR description and the
  project README if present.
- Update `backend/src/db/seed.ts` to the new schema (no `role`; set
  `isPlatformAdmin` where appropriate; drop dead `users_one_admin` references at
  `seed.ts:24-27`).

**Why:** The ticket explicitly mandates discarding the chain; no data preservation
required.

**Code reference:** migration runner `backend/src/index.ts:runMigrations()`
(`:84-105`); config `backend/drizzle.config.ts`.

#### 3. Extend env config — `backend/src/config/env.ts`

**What:** Add to the `Config` interface and `loadConfig()`:
- `bootstrapAdminEmail` — optional `string` (email).
- `bootstrapAdminFullName` — optional `string`.
- `bootstrapAdminDisplayName` — optional `string` (nullable short name).

Keep them optional at the loader level (so the app can boot without them in
non-prod), but **`bootstrapService` will fail-exit if `bootstrapAdminEmail` is set
without a matching `ALLOWED_DOMAIN`** (see Step 4). If `bootstrapAdminEmail` is
unset, skip bootstrap entirely (dev convenience; log a warning).

**Why:** Externalize config per project convention; fail-fast at boot.

**Code reference:** existing optional-var pattern `env.ts:51-62`; required-var
fail-fast `env.ts:25-47`.

#### 4. Bootstrap Platform Admin at boot — `backend/src/services/bootstrapService.ts` (new)

**What:** `ensureBootstrapAdmin()`:
1. Read `env.bootstrapAdminEmail`. If unset → return (skip, log info).
2. If `env.allowedDomain` is set and the email domain (via
   `accessControl.normalizeEmailDomain`, `accessControl.ts:7`) does **not** match
   → `process.exit(1)` with a clear log (per acceptance criterion).
3. Idempotent: query `users` by `email`. If a row exists:
   - If `isPlatformAdmin === true` → no-op (idempotent success).
   - If `isPlatformAdmin === false` → promote it to `isPlatformAdmin = true`
     (this is the documented "exactly one Platform Admin" intent; admin-promotion
     of the bootstrap email is safe and idempotent).
4. If no row → insert one with `email`, `fullName = bootstrapAdminFullName`,
   `displayName = bootstrapAdminDisplayName`, `isPlatformAdmin = true`,
   `googleId = null`, `blocked = false`.
5. Wrap in a transaction; log the outcome.

**Where:** Call from `backend/src/index.ts:start()` **after** `runMigrations()`
succeeds and **before** `app.listen(...)` — i.e. at the natural insertion point
`index.ts:126`, mirroring the `try/catch → process.exit(1)` pattern of
`connectWithRetry`/`runMigrations`.

**Why:** Decouples the first-admin from signup-time; satisfies "fresh deployment
boots, creates exactly one Platform Admin from env, exits if domain violates
`ALLOWED_DOMAIN`."

**Code reference:** `index.ts:start()` sequence `:107-148`; existing (now-removed)
signup-time first-admin logic `userService.upsertByGoogleId` (`:26-69`) — this
moves to boot-time.

#### 5. Rewrite the Google login gate — `backend/src/routes/auth.routes.ts`

**What (new `POST /google` flow):**
1. `exchangeCodeForUser(code)` unchanged (`services/googleOAuth.ts:18`) — still
   requires `email_verified === true`.
2. **Lookup by email** (not by `googleId`): `userService.findUserByEmail(email)`.
3. **Reject unknown email:** if no row → `throw AppError(UNAUTHENTICATED,
   'No account for this email')` (clear error; satisfies "rejected with a clear
   error"). User provisioning now happens **only** via bootstrap or Member
   Management — never via ad-hoc Google login.
4. **Reject blocked:** if `user.blocked` → `throw AppError(FORBIDDEN, 'Account
   deactivated')` (keep existing behavior `auth.routes.ts:45`).
5. **Link `googleId` on first login:** if `user.googleId === null` →
   `userService.linkGoogleId(user.id, info.googleId)` (sets `google_id`; safe
   because the column is UNIQUE-nullable). If `user.googleId` is set and differs
   from `info.googleId` → `FORBIDDEN 'Account identity mismatch'` (defensive).
6. `ALLOWED_DOMAIN` is **not** re-checked here for existing users
   (grandfathering + ticket: "Enforce `ALLOWED_DOMAIN` only at user creation").
7. Issue JWT with the new claim shape (Step 6) and respond.

**Why:** Matches acceptance criteria for login gate rewrite and removes the
signup-time domain check from the login path.

**Code reference:** current login flow `auth.routes.ts:14-62`; domain gate
currently at `auth.routes.ts:34` (move to creation paths only).

#### 6. JWT + `AuthenticatedUser` + auth middleware — claim rename

**What:**
- `backend/src/utils/jwt.ts`: claim `role: 'ADMIN'|'MEMBER'` (`jwt.ts:14,17`)
  → `pa: boolean` (platform admin). Keep `ver` (tokenVersion) and bump semantics.
  Update `verifyJwt` narrowing (`jwt.ts:31`).
- `backend/src/types/express.d.ts`: `AuthenticatedUser` (`:3-7`) →
  `{ id: string; email: string; isPlatformAdmin: boolean }`. Keep `req.project`
  (`:8`) and add `req.projectMember?: 'PROJECT_ADMIN' | 'MEMBER'` (set by
  `requireProjectMember`).
- `backend/src/middleware/auth.ts`: set `req.user.isPlatformAdmin` from the JWT
  (`auth.ts:55`). (No DB role lookup needed; `ver` already re-checks
  `tokenVersion`.)
- `auth.routes.ts` `GET /me` response (`auth.routes.ts:62-70`) and `POST /google`
  response (`auth.routes.ts:45-53`): return `isPlatformAdmin` (and `displayName`)
  instead of `role`.

**Why:** Project-admin/project-member status is project-scoped and cannot live in
a single global JWT claim; only the platform-admin boolean belongs there.

**Code reference:** JWT `utils/jwt.ts:14-31`; `authenticate` `middleware/auth.ts:22-55`.

#### 7. Membership primitives — `backend/src/services/membershipService.ts` (new)

**What:**
- `isProjectMember(tx, projectId, userId): Promise<boolean>` — exists in
  `project_members`.
- `getMemberRole(projectId, userId): Promise<'PROJECT_ADMIN' | 'MEMBER' | null>`.
- `listProjectMembers(projectId)` — join `users` for display fields.
- `addMember(projectId, userId, role='MEMBER')` — insert; idempotent on conflict
  (23505 → update role).
- `removeMember(projectId, userId)`.
- `promoteToProjectAdmin(projectId, userId)`.
- `createAndAddMember({ email, fullName, displayName, projectId, role })` —
  creates a `users` row (`googleId=null`, `isPlatformAdmin=false`,
  `blocked=false`), applies `assertDomainAllowed(email)` **at creation**, then
  inserts the membership row. Wraps both in one transaction. This is the
  "Project/Admin creates brand-new platform users" path.

**Why:** Centralizes all `project_members` access; reused by middleware, services,
and the member-management routes.

**Code reference:** service conventions in `services/userService.ts` (singleton
`db` import, `db.transaction`, `AppError`, `Tx` type alias `:19`).

#### 8. Middleware rewrites

**What:**
- **Rename** `middleware/requireRole.ts` → `requirePlatformAdmin.ts`: gate on
  `req.user.isPlatformAdmin === true`; else `FORBIDDEN 'This action requires
  Platform Admin'`. (Keep defensive `UNAUTHENTICATED` if `!req.user`.)
- **Rewrite** `middleware/requireProjectMember.ts` (`:17-39`):
  - Resolve project by slug (already does this).
  - **Platform Admin bypass:** if `req.user.isPlatformAdmin` → attach
    `req.project`, set `req.projectMember = null` (or a sentinel), allow.
  - Else `membershipService.isMember(project.id, req.user.id)`; on false →
    non-revealing `FORBIDDEN 'Project not found'` (same wording for unknown slug
    and non-member, `requireProjectMember.ts:30,39`). On true → attach
    `req.project` + `req.projectMember = role`.
- **New** `middleware/requireProjectAdmin.ts`: runs after
  `requireProjectMember`; allows if `req.user.isPlatformAdmin` **or**
  `req.projectMember === 'PROJECT_ADMIN'`; else `FORBIDDEN`.

**Why:** Replaces the creator-or-admin heuristic with the real join table; gives
every project-scoped route a uniform membership context.

**Code reference:** `requireProjectMember.ts:35` (the line being replaced).

#### 9. Project visibility — `backend/src/services/projectService.ts`

**What:**
- `listProjects(userId, isPlatformAdmin)`:
  - Platform Admin → all projects.
  - Else → `projects` inner-join `project_members` on `userId`, optionally
    filtered `projects.isActive = true` **only for non-members viewing**; members
    always see their projects. (DEL-04 owns active-filtering behavior; here just
    scope to membership.)
- `getProjectBySlug(slug, userId, isPlatformAdmin)`:
  - Resolve project; if not found **or** (not Platform Admin and not a member) →
    non-revealing `FORBIDDEN 'Project not found'` (do **not** 404 — avoids leaking
    slug existence).
  - Return the project.

**Why:** "list/get/board endpoints return only projects the user is a member of,
plus all projects for Platform Admins. Unknown/inaccessible slugs return a
non-revealing forbidden response."

**Code reference:** current `projectService.listProjects` (`:59`),
`getProjectBySlug` (`:64`).

#### 10. Matrix enforcement across routes

**`routes/projects.routes.ts`:**
- `GET /`, `GET /:slug`, `GET /:slug/board` — rely on the now-membership-scoped
  service (Step 9). For `/:slug` and `/:slug/board`, add `requireProjectMember`
  (currently `authenticate` only, `projects.routes.ts:19,26,45`).
- `POST /` (create) — `requirePlatformAdmin` (was `requireRole('ADMIN')`,
  `projects.routes.ts:124`).
- `PATCH /:slug` (rename/columns) — Platform Admin **only** per matrix
  ("Create / rename project" → Platform Admin). Currently `requireRole('ADMIN')`
  (`projects.routes.ts:142`); replace with `requirePlatformAdmin`. *(Note: this is
  stricter than today — Project Admins currently cannot rename; confirm in Open
  Questions if Project Admins may rename their own project. Matrix says no.)*
- `POST /:slug/tickets`, `GET /:slug/tickets/:displayId` — `requireProjectMember`
  (any member can manage tickets per matrix).

**`routes/tickets.routes.ts` (global `/api/tickets/:ticketId*`):**
- These bypass the slug. Add a `resolveTicketProject` step that loads the ticket's
  `projectId` and then runs the membership check:
  - `GET/PATCH /:ticketId`, `GET /:ticketId/activity`, timer endpoints — require
    project membership (matrix: members manage tickets/timers).
  - `DELETE /:ticketId` (soft delete) — currently `requireRole('ADMIN')`
    (`tickets.routes.ts:104`); per matrix, ticket management is allowed for any
    member, but **deletion** semantics aren't in the matrix. Keep
    `requireProjectAdmin` (Project Admin or Platform Admin) as the safe default —
    flag in Open Questions.
- Implement as a `requireTicketProject` middleware (loads ticket → projectId →
  reuses membership logic) to avoid duplicating the resolution in each handler.

**`routes/labels.routes.ts`:**
- `GET /:slug/labels` — `requireProjectMember` (was `authenticate` only,
  `labels.routes.ts:18`).
- `POST /:slug/labels`, `PATCH /labels/:id`, `DELETE /labels/:id` — currently
  `requireRole('ADMIN')` (`labels.routes.ts:30,50,65`); replace with
  `requireProjectAdmin` (matrix: Project Admin + Platform Admin manage
  labels/columns). For `PATCH/DELETE /labels/:id` (not slug-scoped), resolve the
  label → projectId first (mirror the ticket-resolution middleware).

**`routes/report.routes.ts`:**
- `/:slug/reports/*` already uses `requireProjectMember` (`report.routes.ts:27,43`)
  — keep. Reports are readable by any member (matrix doesn't restrict read).
- Deprecated global `GET /api/reports/{time,tickets}` (`report.routes.ts:60,71`)
  — gate with `requirePlatformAdmin` (or remove). Flag in Open Questions; default
  to `requirePlatformAdmin` to avoid leaking cross-project data.

**`routes/users.routes.ts`:**
- `GET /` — currently `authenticate` only (`users.routes.ts:18`). Per matrix,
  member management needs a user-picker scoped to the project; the global user
  list should be **Platform Admin only** (global user list = global user
  deactivate = Platform Admin). Replace with `requirePlatformAdmin`. Project-scoped
  user lookups go through the new member-management routes (Step 11).
- `PATCH /:userId/role` — **remove** (role enum is gone). Global role management
  is replaced by `PATCH /:userId/isPlatformAdmin` (Platform Admin only) — or omit
  entirely if not required by this deliverable (matrix: "Global user deactivate →
  Platform Admin"; platform-admin promotion is bootstrap-only here). Flag in Open
  Questions; default: provide `PATCH /:userId/isPlatformAdmin` (Platform Admin
  only) with a last-platform-admin guard.
- `PATCH /:userId/blocked` — `requirePlatformAdmin` (was `requireRole('ADMIN')`,
  `users.routes.ts:51`).

**Why:** Makes every matrix row enforceable with the right 403 for the wrong role.

**Code reference:** route-by-route inventory in the analyst digest
(`projects.routes.ts`, `tickets.routes.ts`, `labels.routes.ts`,
`report.routes.ts`, `users.routes.ts`).

#### 11. Member-management endpoints — `routes/projectMembers.routes.ts` (new)

Mount under `projectsRouter` so paths are `/api/projects/:slug/members`:

| Method+Path | Guard | Service | Matrix row |
|---|---|---|---|
| `GET /:slug/members` | `requireProjectMember` (any member can view) | `membershipService.listProjectMembers` | See project |
| `POST /:slug/members` (add existing platform user by email/id) | `requireProjectAdmin` | `membershipService.addMember` | Add members |
| `POST /:slug/members/new` (create brand-new platform user + add) | `requireProjectAdmin` | `membershipService.createAndAddMember` (applies `assertDomainAllowed` at creation) | Create brand-new platform users |
| `PATCH /:slug/members/:userId/role` | `requireProjectAdmin` | `membershipService.promoteToProjectAdmin` / demote | Promote member → Project Admin |
| `DELETE /:slug/members/:userId` | `requireProjectAdmin` (Platform Admin can remove from any; Project Admin from own) | `membershipService.removeMember` | Remove members |

Validation schemas in a co-located `routes/projectMembers.schema.ts` (Zod:
`memberRoleSchema`, `addMemberBodySchema`, `createMemberBodySchema`), per the
`routes/<resource>.schema.ts` convention.

**Why:** The matrix requires add/remove/promote/create-user actions; this surface
is currently greenfield (no member UI or routes exist).

**Code reference:** route mounting pattern `index.ts:84-91`; schema co-location
`routes/projects.schema.ts`.

#### 12. Clean up dead code & adapt services

- `services/userService.ts`: remove signup-time first-user-admin logic
  (`:26-69`), `updateUserRole` (`:118+`), and dead `users_one_admin` references
  (`:36,62,74-95`). Replace with `findUserByEmail`, `linkGoogleId`,
  `setPlatformAdmin`, `createUser` (used by `createAndAddMember`), keep
  `bumpTokenVersion` semantics.
- `db/seed.ts`: update fixtures (no `role`; seed a Platform Admin via
  `isPlatformAdmin`, seed members in `project_members`).

### Frontend Changes

*(Required because the role model is renamed and member management is greenfield.)*

#### F1. Types + auth store — `frontend/src/api/auth.ts`, `frontend/src/types/*.ts`, `frontend/src/stores/useAuthStore.ts`

- `AuthResponseUser.role: 'ADMIN'|'MEMBER'` → `isPlatformAdmin: boolean`; add
  `displayName?: string | null`. Mirror in `frontend/src/api/users.ts`
  (`WorkspaceUser`).
- `useAuthStore` `AuthUser` (`:11`) → `isPlatformAdmin`.

#### F2. Role guard — `frontend/src/hooks/useRequireRole.ts`, `frontend/src/components/RequireRole.tsx`

- Rename/replace `useRequireRole('ADMIN')` with `useRequirePlatformAdmin()`;
  update `<RequireRole role="ADMIN">` usages in `routes/index.tsx:81`,
  `ProjectsPage.tsx:17`, `ProjectSettingsPage.tsx:43`.

#### F3. 403 UX — `frontend/src/api/client.ts`

- Today only `ReportsPage` handles 403 (`ReportsPage.tsx:64,77-79`). With
  membership tightened on board/project routes, add consistent non-revealing 403
  handling (e.g. surface "You don't have access to this project" + redirect to
  `/projects`) — either a shared `<RequireProjectAccess>` wrapper or a global
  handler that lets the route decide. Keep 401 behavior unchanged.

#### F4. Member-management UI (new)

- `frontend/src/api/projects.ts` (or new `members.ts`): `listMembers`,
  `addMember`, `createAndAddMember`, `updateMemberRole`, `removeMember`.
- `frontend/src/hooks/useProjectMembers.ts`: TanStack Query hooks.
- `frontend/src/pages/ProjectMembersPage.tsx` (or a panel in
  `ProjectSettingsPage.tsx`): list members, add (by email) + create-new-user,
  promote/demote, remove — gated by Project Admin / Platform Admin.
- Add a `/projects/:slug/members` route under `RequireAuth`.

## Edge Cases & Risks

- **Migration reset blast radius:** the fresh `0000` changes the drizzle journal
  hash; every environment (dev, staging, prod) must drop/recreate its schema.
  Communicate loudly; ensure `db:push` is not used to "patch" existing DBs.
- **`googleId` nullable + UNIQUE:** Postgres allows multiple NULLs, so the
  bootstrap admin (and any member-created user before first login) coexist safely.
  Confirm the partial/unique index in the regenerated migration reflects nullable.
- **Bootstrap idempotency + promotion side-effect:** re-running bootstrap promotes
  an existing non-admin row to Platform Admin. This is intentional but must be
  documented so operators understand `BOOTSTRAP_ADMIN_EMAIL` is authoritative.
- **Race on first-login `googleId` linking:** two concurrent logins for the same
  email could both try to `linkGoogleId`. Use an atomic conditional UPDATE
  (`UPDATE ... WHERE google_id IS NULL`) and handle 23505; the second request
  should then verify the stored `googleId` matches.
- **Non-revealing FORBIDDEN:** ensure no 404 path leaks slug existence on
  `getProjectBySlug` / board / members; the error must be identical for
  "not found" and "not a member."
- **Global ticket routes (`/api/tickets/:ticketId`) now need project resolution:**
  an extra DB read per ticket request. Acceptable; cache `projectId` on the ticket
  row lookup that already happens. Ensure membership is checked **after** the
  ticket is resolved so a non-member gets the same non-revealing FORBIDDEN.
- **Last Platform Admin guard:** if `PATCH /:userId/isPlatformAdmin` is exposed,
  prevent demoting the last Platform Admin (mirror the old last-admin guard at
  `userService.ts:131`), and `bumpTokenVersion` after the change.
- **`ALLOWED_DOMAIN` grandfathering:** existing users must still log in after a
  domain tightening; the login path must **not** re-check the domain (only
  creation paths do).
- **Deprecated global reports:** leaving them open leaks cross-project data to any
  authenticated user; gating with `requirePlatformAdmin` (or removing) is the safe
  default until removed.
- **Frontend role rename is breaking:** every `role === 'ADMIN'` check must be
  migrated atomically with the backend deploy; deploy backend + frontend together.

## Testing

*Follow project conventions — Vitest + supertest (backend) and Vitest + Testing
Library (frontend); table-driven tests; one behavior per test; co-locate
`*.test.ts(x)` next to source.*

- **Unit tests:**
  - `membershipService`: member/non-member, role lookup, add/remove/promote,
    `createAndAddMember` applies `assertDomainAllowed` and is transactional.
  - `bootstrapService`: idempotent create, idempotent promote, domain-mismatch
    exits, skip-when-unset.
  - `userService.findUserByEmail`, `linkGoogleId` (atomic conditional update +
    mismatch rejection), `createUser` applies domain gate.
  - `accessControl.normalizeEmailDomain` / `assertDomainAllowed` (already tested —
    keep).
- **HTTP tests (supertest against the app with a test DB / stubbed data-access):**
  - Login gate: unknown email → 401; blocked → 403; first-login links `googleId`;
    existing `googleId` mismatch → 403; domain **not** re-checked for existing
    users.
  - Bootstrap on boot: covered by a startup test or an exported `ensureBootstrapAdmin`.
  - Visibility: member sees own projects only; Platform Admin sees all;
    inaccessible slug → non-revealing 403 (identical body to unknown slug).
  - Matrix enforcement (table-driven over the route inventory): for each action,
    assert 200/2xx for the allowed role(s) and 403 for the disallowed role(s).
    Cover: create/rename project (Platform Admin only), label CRUD (Project
    Admin), ticket/timer ops (Member), member add/remove/promote (Project Admin),
    global user deactivate (Platform Admin).
  - Member routes: add existing user, create-new-user (domain gate), promote,
    remove, last-project-admin guard if applicable.
- **Integration tests:** critical flows only — full login → list projects → open
  board → create ticket as a Member; promote-to-Project-Admin flow; Platform Admin
  accessing a project they're not a member of.
- **Manual verification:**
  - Fresh DB boots and creates exactly one Platform Admin from env; setting a
    wrong-domain `BOOTSTRAP_ADMIN_EMAIL` with `ALLOWED_DOMAIN` set → process exits.
  - Google login for an email with no row is rejected; an existing user's first
    login links `googleId`; a blocked user cannot log in.
  - A Member cannot deep-link into a non-member project (non-revealing error); a
    Platform Admin can enter every project.

## Acceptance Criteria

- [ ] Fresh deployment boots, creates exactly one Platform Admin from
  `BOOTSTRAP_ADMIN_EMAIL`/`_FULL_NAME`/`_DISPLAY_NAME`, and exits if the bootstrap
  email violates `ALLOWED_DOMAIN`.
- [ ] A Google login for an email with no `users` row is rejected with a clear
  error.
- [ ] An existing user's first Google login links their `googleId` and succeeds.
- [ ] A deactivated (`blocked`) user cannot log in.
- [ ] A Project Member cannot see or deep-link into a project they are not a
  member of (non-revealing error identical to unknown-slug).
- [ ] A Platform Admin can see and enter every project.
- [ ] Every action in the permission matrix is allowed for the right roles and
  denied (403) for the wrong roles.
- [ ] `ALLOWED_DOMAIN`, when unset, allows any domain at creation time; when set,
  rejects wrong-domain creations (bootstrap + member-create paths).
- [ ] The migration chain is a single fresh `0000`; old migrations and the
  `roleEnum` are removed.

## Open Questions

- **Project rename by Project Admin?** Matrix says "Create / rename project →
  Platform Admin only." Confirm Project Admins should **not** rename their own
  project (plan currently enforces Platform-Admin-only).
- **Ticket deletion tier?** Soft-delete (`DELETE /api/tickets/:id`) isn't in the
  matrix. Plan defaults it to Project Admin / Platform Admin. Confirm.
- **Platform-admin promotion UI?** Bootstrap creates the first Platform Admin.
  Should `PATCH /:userId/isPlatformAdmin` (with last-admin guard) be exposed in
  this deliverable, or deferred? Plan defaults to exposing it (Platform Admin
  only).
- **Deprecated global `/api/reports/*`:** remove now, or gate to Platform Admin?
  Plan defaults to gating.
- **Seed/dev fixtures:** confirm desired seed users (Platform Admin + members) for
  the new schema.

## Out of Scope

- **Project deactivation *behavior*** (DEL-04) — this deliverable only adds the
  `projects.isActive` column and leaves filtering/endpoint behavior to DEL-04.
- **UI polish / full member-management design** beyond a functional MVP page.
- **Audit logging of membership changes** (the `ActivityLogs` table exists; wiring
  membership events into it is not required here unless trivial).
- **Any data migration** from the old `role` enum (chain is discarded; no
  preservation).
