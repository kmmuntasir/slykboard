# SLYK-01 · [Feature] · Three-Tier Roles & Project Membership

> **Source:** [`docs/deliverables.md`](../deliverables.md) (DEL-01)

## Problem

Today there is a single workspace-global `ADMIN`/`MEMBER` enum and
**no project-membership table** (membership is a creator-or-admin heuristic). Every
authenticated user can list every project, and "admin" means one global thing. This
blocks Member Management, project-scoped access, project deactivation, and a correct
self-protection model.

## Solution (end-to-end)

- **Discard the entire existing migration chain** and author **one fresh initial
  migration** reflecting the new schema. No data preservation required.
- Add `users.isPlatformAdmin` (boolean, default false) and `users.displayName`
  (nullable short name).
- Add a `project_members` table: `{projectId, userId, role: 'PROJECT_ADMIN' |
  'MEMBER'}`, with a unique `(projectId, userId)` constraint.
- Add a soft-delete/active flag on projects to support deactivation (see DEL-04);
  this deliverable owns the **column**; DEL-04 owns the **behavior**.
- Implement **bootstrap admin** on first boot: read `BOOTSTRAP_ADMIN_EMAIL`,
  `BOOTSTRAP_ADMIN_FULL_NAME`, `BOOTSTRAP_ADMIN_DISPLAY_NAME` from env; if
  `ALLOWED_DOMAIN` is set and the bootstrap email's domain does not match,
  **fail and exit**; otherwise create exactly one Platform Admin (idempotent).
- Rewrite the **login gate**: reject Google logins for emails with no existing user
  row; for existing rows, link `googleId` on first login; reject deactivated users
  (already partially in place).
- Enforce `ALLOWED_DOMAIN` **only at user creation** (not at login for existing
  users).
- Rewrite project **visibility**: list/get/board endpoints return only projects the
  user is a member of, **plus** all projects for Platform Admins. Unknown/inaccessible
  slugs return a **non-revealing** forbidden response.
- Replace the membership heuristic with a real `project_members` lookup, with
  Platform Admins bypassing the check.
- Enforce the **permission matrix** below across all project-scoped actions
  (create/rename/deactivate project, manage members, manage tickets/columns/labels,
  timers, reports).

## Permission matrix (binding)

| Action | Platform Admin | Project Admin | Project Member |
| --- | --- | --- | --- |
| Create / rename project | ✅ | ❌ | ❌ |
| Deactivate / reactivate project | ✅ | ❌ | ❌ |
| See all projects | ✅ | own only | own only |
| Add/remove project members | ✅ (any) | ✅ (own) | ❌ |
| Promote member → Project Admin | ✅ (any) | ✅ (own) | ❌ |
| Manage tickets/columns/labels/timers | ✅ (any) | ✅ (own) | ✅ (own) |
| Create brand-new platform users (via Member Mgmt) | ✅ | ✅ (within own project) | ❌ |
| Global user deactivate (block login) | ✅ | ❌ | ❌ |

## Acceptance criteria

- A fresh deployment boots, creates exactly one Platform Admin from env, and exits
  if the bootstrap email violates `ALLOWED_DOMAIN`.
- A Google login for an email with no user row is rejected with a clear error.
- An existing user's first Google login links their `googleId` and succeeds.
- A deactivated user cannot log in.
- A Project Member cannot see or deep-link into a project they are not a member of
  (non-revealing error).
- A Platform Admin can see and enter every project.
- Every action in the permission matrix is allowed for the right roles and denied
  (403) for the wrong roles.
- `ALLOWED_DOMAIN`, when unset, allows any domain at creation time; when set,
  rejects wrong-domain creations.

## Dependencies

None (foundational).
