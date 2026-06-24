# F25 — User & role management (admin): Plan + Task Breakdown

> **Feature:** F25 — User & role management (admin) (Phase 7 — Admin & Polish)
> **Feature index:** [features.md](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F06 (DONE ✅) · **PRD ref:** REQ-1.2, REQ-1.3
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), project rules (`.claude/rules/`), dependency task doc: [F06](../F06-onboarding-workspace-roles/F06-onboarding-workspace-roles-tasks.md)

---

## 1. F25 Recap

**Goal:** Admins govern membership — promote/demote roles + manage the manual email whitelist.

**Ships:** An admin-only view at `/settings` (existing `SettingsPage.tsx` stub) listing all users with their roles. Admin can promote (`MEMBER`→`ADMIN`) / demote (`ADMIN`→`MEMBER`). **Cannot demote yourself if you're the last admin** (prevent lockout). The manual email whitelist (allow/block specific emails regardless of `ALLOWED_DOMAIN`) is owned by F25 per F06's deferred decision.

**Acceptance (definition of done):**
- Admin can change a user's role (`ADMIN` ↔ `MEMBER`).
- Cannot demote yourself if you're the last admin (server-enforced).
- Role change invalidates the target's session (bump `token_version` — F07).
- Removing access for a user with active tickets/timers → keep historical data, mark user inactive rather than delete.
- Whitelist management (allow/block specific emails) — **DECISION: defer whitelist to post-F25.** F25 ships ONLY role management (promote/demote + last-admin guard). The whitelist is a separate concern (an allow/block table + middleware check); it adds scope without being the primary value. Document the deferral.

**Edge cases:**
- Last-admin protection — **server-enforced** (count ADMIN rows; reject demotion if count ≤ 1). The `users_one_admin` partial unique index (`schema.ts:49`) is NOT the right guard (it prevents zero admins, but allows exactly one — which IS the last-admin scenario). F25 needs an explicit count check in the service.
- Role change invalidation — bump `token_version` on the target user (F07 `bumpTokenVersion`); the target's next authenticated request sees a `ver` mismatch → 401 → re-login with the new role in the JWT.
- Removing access — **DECISION: do NOT delete users.** Toggle a `blocked` flag (or rely on role alone — a blocked user can't log in). For MVP, role management (MEMBER/ADMIN) is sufficient; a separate "block" is out of scope. Historical data (tickets, time entries, activity) keeps `userId` (FK SET NULL on delete preserves it; we don't delete).

---

## 2. Codebase Analysis Summary

- **State:** F06 (DONE ✅) ships roles (`ADMIN`/`MEMBER`), the first-admin race-safe guard (`users_one_admin` partial unique index), and `ALLOWED_DOMAIN` enforcement. F07 (DONE ✅) ships `authenticate` + `token_version` + `bumpTokenVersion`. F25 adds the admin UI + promote/demote endpoint.
- **Existing structure (citations):**
  - `users` table (`schema.ts:26-51`): `role` enum default 'MEMBER' (`:34`), `tokenVersion` integer default 0 (`:38`). `users_one_admin` partial unique index on `role WHERE role='ADMIN'` (`:49`).
  - `userService` (`backend/src/services/userService.ts`) — `listUsers()` already returns `{id, fullName, email, role, avatarUrl}` (used by the board's assignee dropdown). F25 extends with `updateUserRole`.
  - `bumpTokenVersion(userId)` (`backend/src/services/tokenVersion.ts`) — F07's helper for session invalidation.
  - `users.routes.ts` — `GET /api/users` (list, `:10-13`) exists + is authenticated. F25 adds `PATCH /api/users/:id/role` (admin-only).
  - `requireRole('ADMIN')` middleware (`requireRole.ts:9-23`) — ready, mounted for project create + label mutations + ticket delete.
  - `SettingsPage.tsx` (`frontend/src/pages/SettingsPage.tsx`) — EXISTS as a stub, routed at `/settings` inside a `RequireRole('ADMIN')` wrapper (`routes/index.tsx:56-60`). F25 fills it with the user table.
  - `useAuthStore` (`stores/useAuthStore.ts`) — holds `user.role`; the client role gate.
- **Files F25 creates:** none new (extends existing).
- **Files F25 modifies:** `backend/src/services/userService.ts` (updateUserRole + last-admin guard), `backend/src/routes/users.routes.ts` (PATCH role route + requireRole), `frontend/src/pages/SettingsPage.tsx` (user table + promote/demote), `frontend/src/api/users.ts` or new api fn, `frontend/src/hooks/useUpdateUserRole.ts` (new hook), `frontend/src/types/user.ts` (extend if needed).
- **Schema delta: NONE.** `users.role` + `users.tokenVersion` already exist.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Role change endpoint | `PATCH /api/users/:userId/role` — `requireRole('ADMIN')` + body `{ role: 'ADMIN' \| 'MEMBER' }`. Admin can change ANY user's role (including their own — but last-admin guard blocks self-demotion). | RESTful; admin-only via `requireRole`. F06/F07 precedent. |
| D2 | Last-admin guard | **Server-enforced count check** in `updateUserRole`: `SELECT COUNT(*) FROM users WHERE role='ADMIN'`. If the target is an ADMIN and the count ≤ 1 → reject with `CONFLICT`. | `users_one_admin` index prevents zero admins at the DB layer but doesn't prevent demoting the last one to MEMBER (which would leave zero). The explicit count check is the application-level guard. Race-safe via `db.transaction` + `FOR UPDATE` or the partial index as backstop. |
| D3 | Session invalidation | Call `bumpTokenVersion(targetUserId)` after the role change. The target's next request has a stale `ver` → 401 → re-login with the new role. | F07's mechanism. `tokenVersion.ts:bumpTokenVersion`. |
| D4 | No self-demotion when last admin | If `req.user.id === targetUserId AND target.role === 'ADMIN' AND adminCount <= 1` → `409 CONFLICT 'Cannot demote the last admin'`. | Spec: "Cannot demote yourself if you're the last admin." |
| D5 | Whitelist deferred | F25 ships ONLY role management. Whitelist (allow/block specific emails) deferred — adds a table + middleware scope. Document. | F06 §9: "Manual email whitelist — deferred to F25." But whitelist is a separate concern; F25's primary value is role management. |
| D6 | No user deletion | Historical data (tickets, time entries, activity) must survive. Users are never deleted; role management is the access control. | Spec: "keep historical data, mark user inactive." MVP: role alone suffices. |
| D7 | SettingsPage route | Already routed at `/settings` inside `RequireRole('ADMIN')`. F25 fills the stub with the user table. No route changes. | `routes/index.tsx:56-60`. |

---

## 4. Architecture Overview

```
backend/src/services/userService.ts        # MODIFY — updateUserRole (last-admin guard + bumpTokenVersion)
backend/src/routes/users.routes.ts        # MODIFY — PATCH /:userId/role (requireRole ADMIN)
frontend/src/api/users.ts                # MODIFY or CREATE — updateUserRole fn
frontend/src/hooks/useUpdateUserRole.ts    # NEW — mutation hook
frontend/src/pages/SettingsPage.tsx       # MODIFY — user table with promote/demote buttons
```

---

## 5. Tasks

### T1 — Backend: updateUserRole + PATCH route + last-admin guard

**Batch:** 1 · **Depends on:** F06/F07 (DONE)

**Description:**
1. Add `updateUserRole({ targetUserId, newRole, actingUserId })` to `userService.ts`:
   - In a `db.transaction`: load the target user. If `newRole === 'MEMBER'` AND `target.role === 'ADMIN'`: count ADMINs. If count ≤ 1 → throw `AppError(CONFLICT, 'Cannot demote the last admin')`.
   - `UPDATE users SET role = newRole WHERE id = targetUserId`.
   - Call `bumpTokenVersion(targetUserId)` (invalidates the target's session).
   - Return the updated user row.
2. Add `PATCH /:userId/role` to `users.routes.ts`:
   - `authenticate` + `requireRole('ADMIN')` + Zod body `{ role: z.enum(['ADMIN', 'MEMBER']) }` + `validateRequest({ params: userIdParam, body })`.
   - Call `userService.updateUserRole({ targetUserId, newRole: body.role, actingUserId: req.user!.id })`.
   - Return `success(updatedUser)`.
3. Tests: 200 promote member→admin; 200 demote admin→member (when >1 admin); 409 last-admin demotion; 403 member tries to change role; 401 no-token.

**Acceptance:**
- [ ] `updateUserRole` updates role + bumps token version.
- [ ] Last-admin guard: demotion rejected with CONFLICT when admin count ≤ 1.
- [ ] `PATCH /api/users/:userId/role` admin-only; 403 for members.
- [ ] `rtk tsc` + `rtk vitest run` (BE) pass.

### T2 — FE: api + hook + SettingsPage user table

**Batch:** 2 · **Depends on:** T1

**Description:**
1. `api/users.ts` (or a new fn) — `updateUserRole(userId, role)` → `apiFetch('/users/${userId}/role', { method: 'PATCH', body: JSON.stringify({ role }) })`.
2. `hooks/useUpdateUserRole.ts` — mutation; `onSuccess` invalidates the user list query.
3. `SettingsPage.tsx` — REPLACE the stub:
   - `useQuery` to fetch `GET /api/users` (list all users).
   - Table: rows per user (avatar + name + email + current role badge).
   - Promote/Demote button per row (MEMBER→"Promote to Admin"; ADMIN→"Demote to Member"). Calls `updateUserRole` mutation.
   - Disable the demote button for yourself if you're the last admin (client-side hint — server is the real guard).
   - On success → invalidate the user list (refetch).

**Acceptance:**
- [ ] SettingsPage renders all users with role badges.
- [ ] Promote/Demote buttons work (optimistic or invalidate-on-success).
- [ ] Last-admin self-demotion blocked (client hint + server CONFLICT).
- [ ] `rtk tsc` + `rtk vitest run` (FE) pass.

### T3 — Verification

Typecheck/lint/format/test/build. Live smoke: admin navigates to `/settings` → sees user table → promotes a member → the member's next request 401s (session invalidated) → member re-logs in with the new role.

---

## 6. Final F25 Acceptance Checklist

- [ ] Admin can change a user's role (ADMIN ↔ MEMBER).
- [ ] Cannot demote the last admin (server CONFLICT).
- [ ] Role change bumps token_version (target's session invalidated).
- [ ] `PATCH /api/users/:userId/role` admin-only (403 for members).
- [ ] SettingsPage at `/settings` shows all users + promote/demote.
- [ ] No user deletion (historical data preserved).
- [ ] Whitelist deferred (documented).
- [ ] No schema/migration.
- [ ] All tests pass; typecheck/lint/format/build green.

---

## 7. Schema deltas owned by this feature

**F25 owns NONE.** `users.role` + `users.tokenVersion` already exist (F06/F07). No migration, no schema change.

---

## 8. Cross-cutting decisions — owner sign-off needed

1. **Whitelist deferred.** F25 ships ONLY role management (promote/demote). Whitelist (allow/block specific emails) deferred — recommend defer. **Needs confirmation.**
2. **No user deletion.** Users are never deleted; role management is the access control. Historical data preserved via FK SET NULL (but we don't delete). **Needs confirmation.**
3. **Last-admin guard mechanism.** Explicit count check in the service (not the partial unique index). The index prevents zero-admin at DB level but the count check prevents the last demotion. **Needs confirmation.**

---

**Sources:**
- PRD REQ-1.2 (two roles: Admin, Member).
- PRD REQ-1.3 (Admin manages settings; first user is Admin).
- F06 task doc (roles + first-admin guard + ALLOWED_DOMAIN + whitelist deferral to F25).
- F07 task doc (token_version session invalidation).
- Grounding: `backend/src/db/schema.ts:26-51` (users); `backend/src/services/userService.ts` (listUsers); `backend/src/services/tokenVersion.ts` (bumpTokenVersion); `backend/src/middleware/requireRole.ts`; `backend/src/routes/users.routes.ts`; `frontend/src/pages/SettingsPage.tsx`; `frontend/src/routes/index.tsx:56-60` (/settings route + RequireRole).
- Project rules: `.claude/rules/git-guidelines.md`, `.claude/rules/js-development-rules.md`, `.claude/rules/js-style-guide.md`, `.claude/rules/js-testing-rules.md`, `.claude/rules/persona.md`.
