# Implementation Plan — SLYK-05

**Ticket:** `docs/deliverables/SLYK-05.md`
**Type:** Bug
**Title:** Prevent Self-Deactivation & Self-Removal (global self-deactivate, project self-remove, self role-change lockout, last-Platform-Admin guard)
**Generated:** 2026-06-30

---

## Summary

A user can currently lock themselves out in three ways, none of which are guarded today:
(1) globally **deactivate/block themselves** via `PATCH /users/:userId/blocked`; (2) **remove
themselves from a project** via `DELETE /projects/:slug/members/:userId`; (3) **change their own
role** in a project via `PATCH /projects/:slug/members/:userId/role`. Additionally, the existing
last-Platform-Admin demote guard in `userService.setPlatformAdmin` (`userService.ts:104-111`) does
**not** cover the block/deactivate path — a Platform Admin can be deactivated today even though
they cannot be demoted, defeating the spirit of the last-PA guarantee.

This plan closes all four holes on **both** the API (authoritative reject) and the UI (control
disabled), per the acceptance criteria. The project-side frontend (`MemberTable`) already implements
a self-lock idiom (`disabled={isSelf}`, `selfLockedAdmin`) — so for project self-removal and self
role-change the UI work is largely **verify-and-confirm**; the substantive work is the API guards,
threading the acting-user id into the three services, and extending the last-PA guard to the block
path.

## Root Cause

There is **no self-target check anywhere** and the **last-PA guard does not span the block path**.
Evidence:

- `PATCH /users/:userId/blocked` → `users.routes.ts:42-49` → `userService.setUserBlocked`
  (`userService.ts:163-185`). The route handler has `req.user.id` (`auth.ts:51`) but never compares
  it to the target `userId`; the service signature `setUserBlocked({ targetUserId, blocked })`
  (`users.routes.ts:47`) takes **no acting-user param**, so no self-check is possible. The method
  also has **no PA-count check** before flipping `blocked=true` on a Platform Admin — unlike
  `setPlatformAdmin`'s demote branch (`userService.ts:104-111`), which throws
  `AppError(CONFLICT, 'Cannot remove the last platform admin')`. So a PA can be deactivated today.
- `DELETE /projects/:slug/members/:userId` → `projectMembers.routes.ts:169` →
  `membershipService.removeMember(projectId, userId)` (`membershipService.ts:126-138`). Signature
  has **no acting-user param**; handler has `req.user.id` but does not compare.
- `PATCH /projects/:slug/members/:userId/role` → `projectMembers.routes.ts:152` →
  `membershipService.setMemberRole(projectId, userId, role)` (`membershipService.ts:140-160`).
  Signature has **no acting-user param**; no self-check.
- Acting-user identity is readily available: `req.user = { id, email, isPlatformAdmin }`
  (`middleware/auth.ts:51`, type at `types/express.d.ts:4-9`).
- There is a single error class — `AppError(ErrorCode, message)` (`utils/appError.ts:23-42`) — with a
  closed `ErrorCode` vocabulary (`utils/envelope.ts:7-26`): `FORBIDDEN→403`, `CONFLICT→409`, etc.
  The frontend global toast funnel (`lib/queryClient.ts:20-39`) already renders these messages.

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| Route | `backend/src/routes/users.routes.ts` | Thread `req.user.id` into `setUserBlocked` call (`:42-49`) |
| Route | `backend/src/routes/projectMembers.routes.ts` | Thread `req.user.id` into `removeMember` (`:169`) and `setMemberRole` (`:152`) |
| Service | `backend/src/services/userService.ts` | Add self-deactivation guard + extend last-PA guard to the block path in `setUserBlocked` (`:163-185`) |
| Service | `backend/src/services/membershipService.ts` | Add self-removal guard in `removeMember` (`:126-138`); add self role-change guard in `setMemberRole` (`:140-160`) |
| Test | `backend/src/services/userService.test.ts` | New cases: self-block FORBIDDEN; block-last-PA CONFLICT |
| Test | `backend/src/services/membershipService.test.ts` | New cases: self-remove FORBIDDEN; self role-change FORBIDDEN |
| Test | `backend/src/routes/users.routes.test.ts` | New supertest cases: 403 self-block; 409 block-last-PA |
| Test | `backend/src/routes/projectMembers.routes.test.ts` | New supertest cases: 403 self-remove; 403 self role-change (route layer — currently only `/lookup` is covered) |
| Frontend | `frontend/src/components/MemberTable.tsx` | Verify/confirm self-lock on Remove (`disabled={isSelf}`) and role-change (`selfLockedAdmin`) already present (`:103-156`) |
| Frontend | `frontend/src/pages/ProjectMembersPage.tsx` | Confirm self-row controls disabled; error surfacing via global toast funnel (already wired) |
| Frontend | admin user-management table (not yet built — see Open Questions) | When shipped, its own-row Deactivate control must be disabled |

## Proposed Implementation

Conventions to mirror: single error class `AppError(ErrorCode.X, msg)`; self-action = `FORBIDDEN`
(403) with a clear message; last-admin style = `CONFLICT` (409) `'Cannot remove the last platform
admin'` (verbatim from `userService.ts:104-111`); guards placed in the **service layer** (matching
the existing `setPlatformAdmin` precedent), not in controllers/routes; services own business logic.
The acting-user id is only available at the route handler (`req.user.id`), so it must be **threaded
into each service call**.

### Backend Changes

#### 1. `userService.setUserBlocked` — self-deactivation + last-PA-on-block guards

**File:** `backend/src/services/userService.ts` (`setUserBlocked`, ~`:163-185`)
**What:**
- Change the signature to accept the acting user, e.g. `setUserBlocked({ targetUserId, blocked, actingUserId })`.
- **Self-deactivation guard** (FORBIDDEN): when `blocked === true && targetUserId === actingUserId`,
  throw `new AppError(ErrorCode.FORBIDDEN, 'You cannot deactivate yourself')`. (Unblocking yourself
  is permitted.)
- **Last-PA guard on block** (CONFLICT): when `blocked === true`, after fetching the existing user,
  if `existing.isPlatformAdmin === true`, count remaining PAs exactly as `setPlatformAdmin` does
  (`userService.ts:104-111`) and if `paCount <= 1` throw
  `new AppError(ErrorCode.CONFLICT, 'Cannot remove the last platform admin')`.
- Preserve the existing no-op short-circuit (`userService.ts` style at `:93-97`): if
  `existing.blocked === blocked`, return before any guard that could 409 — but the **self-deactivation
  check must run regardless** (a user re-deactivating an already-blocked self-row should still be
  rejected; simplest is to place the self-check first, before the no-op short-circuit).

**Why:** This is the authoritative rejection layer for criterion (a) and the last-PA-deactivate half
of criterion (c). Placing it in the service (not the route) matches the existing `setPlatformAdmin`
guard and keeps all business rules in one layer.

**Code reference:** `setPlatformAdmin` last-PA guard at `userService.ts:104-111`; `AppError` +
`ErrorCode` usage at `userService.ts` / `requirePlatformAdmin.ts:27-29`.

#### 2. Route wiring for the block path

**File:** `backend/src/routes/users.routes.ts` (`:42-49`)
**What:** Pass `actingUserId: req.user.id` into `setUserBlocked({ targetUserId: userId, blocked: req.body.blocked, actingUserId: req.user.id })`.
**Why:** The only place `req.user` exists is the handler; the service needs the acting id.
**Code reference:** `req.user` shape at `middleware/auth.ts:51`; the current call at `users.routes.ts:47`.

#### 3. `membershipService.removeMember` — self-removal guard

**File:** `backend/src/services/membershipService.ts` (`removeMember`, `:126-138`)
**What:**
- Change signature to `removeMember(projectId, userId, actingUserId)`.
- At the top, if `userId === actingUserId`, throw
  `new AppError(ErrorCode.FORBIDDEN, 'You cannot remove yourself from a project')`.
- Note: Platform Admins are not stored as `project_members` rows (they bypass membership), so a PA
  self-targeting this route already hits the existing NOT_FOUND (`membershipService.ts:132-135`) — no
  special-casing needed; the self-check runs first and is harmless for PAs.

**Why:** Authoritative rejection for criterion (b). Mirrors the frontend self-lock already present in
`MemberTable.tsx` (`disabled={isSelf}`).

**Code reference:** existing NOT_FOUND pattern at `membershipService.ts:132-135`.

#### 4. Route wiring for member removal

**File:** `backend/src/routes/projectMembers.routes.ts` (`:169`)
**What:** Pass `req.user.id` as the acting id: `membershipService.removeMember(req.project!.id, userId, req.user.id)`.
**Why:** Thread acting identity to the service guard.

#### 5. `membershipService.setMemberRole` — self role-change guard

**File:** `backend/src/services/membershipService.ts` (`setMemberRole`, `:140-160`)
**What:**
- Change signature to `setMemberRole(projectId, userId, role, actingUserId)`.
- At the top, if `userId === actingUserId`, throw
  `new AppError(ErrorCode.FORBIDDEN, 'You cannot change your own role')`.
  *(Leading approach — matches the frontend `selfLockedAdmin` lock in `MemberTable.tsx:108-128`.
  Narrower alternative: only reject when the change reduces the acting user's privileges, i.e.
  self-demotion `PROJECT_ADMIN → MEMBER`. See Open Questions.)*

**Why:** Authoritative rejection for the self-role-change half of criterion (c) ("a user must not
change their own role in a way that locks them out"). Placing it in the service makes it
unbypassable and consistent with the other guards.

**Code reference:** existing NOT_FOUND pattern at `membershipService.ts:156-158`.

#### 6. Route wiring for role change

**File:** `backend/src/routes/projectMembers.routes.ts` (`:152`)
**What:** Pass `req.user.id`: `membershipService.setMemberRole(req.project!.id, userId, body.role, req.user.id)`.
**Why:** Thread acting identity to the service guard.

#### 7. Confirm the last-PA demote guard already spans demote (no change expected)

**File:** `backend/src/services/userService.ts` (`setPlatformAdmin`, `:104-111`)
**What:** Verify the existing demote-branch last-PA guard is intact and confirm it throws
`CONFLICT 'Cannot remove the last platform admin'`. No code change expected — this is the
"confirm last-PA guard exists for demote" half of criterion (c). (The deactivate half is added in
Change #1.)

### Frontend Changes

*(The project member-management UI already implements the self-lock idiom per
`MemberTable.tsx:103-156`. Work here is primarily verify-and-confirm, plus the admin deactivate
control which depends on UI that Probe B reports is not yet built — see Open Questions.)*

#### F1. Verify project self-lock on Remove and Role-change

**File:** `frontend/src/components/MemberTable.tsx` (`:103-156`)
**What:** Confirm the Remove button is `disabled={isSelf}` (`:144-156`) and the role `<SelectInput>`
is locked for the self row via `selfLockedAdmin` (`:108-128`), with `currentUserId` sourced from
`useCurrentProjectMembership` (`useProjectMembers.ts:70-88`). If either gate is missing or leaky,
add/repair it so a self row cannot trigger the mutation client-side.

**Why:** Criterion (b) requires the UI disable in addition to the API reject.

#### F2. Verify error surfacing for these mutations

**Files:** `frontend/src/pages/ProjectMembersPage.tsx` (`:67-84`), `frontend/src/lib/queryClient.ts` (`:20-39`)
**What:** Confirm the new `FORBIDDEN`/`CONFLICT` messages surface to the user via the existing global
toast funnel (`queryClient.ts:20-39` — `FORBIDDEN` branch + default `error.message`). The API now
returns clear messages ("You cannot deactivate yourself", etc.) so no frontend string-mapping is
needed; toast funnel handles it. No new code expected.

**Why:** Criterion "Errors are surfaced clearly at the point of attempt."

#### F3. Admin user-management deactivate control (own-row disable) — conditional

**File:** the admin user-management table that consumes `useSetUserBlocked` (Probe B: **no UI consumer
exists today**; `/settings` renders `ComingSoonPage`, `routes/index.tsx:115-119`).
**What:** **When that table ships**, its own-row Deactivate/Block control must be disabled for the row
whose id === `useAuthStore((s) => s.user?.id)` (`stores/useAuthStore.ts:18-31`), mirroring the
`MemberTable` self-lock idiom. Read `currentUserId` directly from `useAuthStore` (there is no roster
to derive from). **Until that UI exists, the API guard (Change #1) is the authoritative protection.**
**Why:** Criterion (a) requires both UI disable and API 403. The API half is unconditionally in scope;
the UI half is blocked on the missing component — flagged in Open Questions.

## Edge Cases & Risks

- **Last-PA TOCTOU race (pre-existing):** `setPlatformAdmin`'s count-then-update is **not
  transactional and uses no row lock** (`userService.ts:116-134`); two concurrent demotions of the
  last 2 PAs can both read `count=2` and succeed, leaving zero PAs. SLYK-05's new block-path last-PA
  guard inherits the same race. A proper fix (wrap read-count + update in `db.transaction` with a
  row lock, like `projectSequences` FOR UPDATE at `schema.ts:202-204`) is **out of scope** here but
  noted; the SLYK-05 guard matches the existing demote-guard safety level exactly.
- **No-op self-block ordering:** The self-deactivation FORBIDDEN must be evaluated **before** the
  no-op short-circuit, otherwise re-POSTing an already-blocked self-row would not be rejected.
- **PA self-targeting member routes:** A Platform Admin is not a `project_members` row, so
  `DELETE`/`PATCH` on `:userId === self` for a PA currently yields NOT_FOUND from the service. The
  new self-checks run **first** (FORBIDDEN), which is the more correct and user-friendly outcome —
  no special-casing needed.
- **Last-*Project*-Admin gap is out of scope:** No last-PROJECT_ADMIN guard exists anywhere
  (`membershipService.setMemberRole`/`removeMember`/`promoteToProjectAdmin` do no project-admin
  count). The ticket's last-admin requirement is scoped to **Platform** Admin only. Flagged in Out
  of Scope.
- **`isPlatformAdmin` self-block precedence:** A PA blocking themselves when they are the last PA
  should hit the **self-deactivation** FORBIDDEN first (more specific message). Order the checks:
  self-check, then last-PA check, then write.
- **Regression:** Existing `setUserBlocked`/`removeMember`/`setMemberRole` tests assume the old
  signatures; adding an `actingUserId` param will require updating those call sites and the route
  tests. The route-layer supertest suite for `projectMembers.routes.ts` currently covers **only
  `/lookup`** — the new self-guard route tests also fill that gap.
- **Reactivation is unaffected:** All guards gate only the "lockout" direction (`blocked=true`,
  remove, role-change-on-self). Reactivating/unblocking oneself and others continues to work.

## Testing

*Follow project conventions — Vitest + mocked `db` (services) and Vitest + supertest (routes);
table-driven where natural; one behavior per test; co-locate `*.test.ts` next to source. Mirror the
exact patterns in `userService.test.ts` and `users.routes.test.ts`.*

- **Unit (service-layer, mocked `db`):**
  - `userService.test.ts`: (a) self-block (`target===acting`, `blocked=true`) → rejects
    `FORBIDDEN 'You cannot deactivate yourself'`; (b) self-unblock (`blocked=false`) → allowed; (c)
    block a non-last PA → succeeds; (d) **block the last PA** (`existing.isPlatformAdmin && count=1`)
    → rejects `CONFLICT 'Cannot remove the last platform admin'`; (e) re-block an already-blocked
    self-row → still rejects FORBIDDEN (no-op ordering).
  - `membershipService.test.ts`: (a) `removeMember` with `userId===actingUserId` → rejects `FORBIDDEN`;
    (b) `setMemberRole` with `userId===actingUserId` → rejects `FORBIDDEN`; (c) normal
    remove/role-change with a different acting id still succeed (regression).
- **HTTP (route-layer via supertest):** mirror `users.routes.test.ts:444-501` /
  `users.routes.test.ts:332-372`.
  - `users.routes.test.ts`: `PATCH /:userId/blocked` with target id === signed-in user id and
    `blocked:true` → **403 FORBIDDEN**; block-last-PA (service mocked to throw CONFLICT) → **409**;
    non-PA caller → existing 403 (unchanged, regression).
  - `projectMembers.routes.test.ts` (net-new coverage for `DELETE /:userId` and `PATCH /:userId/role`):
    self-target → **403 FORBIDDEN**, service NOT called; valid other-target → service called with
    `actingUserId` asserted.
- **Integration (critical flows only):** none required beyond the above — guards are pure
  pre-write checks with no cross-table transactional effect.
- **Manual verification:** re-run the ticket's reproduce steps — (1) as a PA, try to deactivate
  yourself via `PATCH /users/:me/blocked {blocked:true}` → 403; (2) try to remove yourself from a
  project via `DELETE /projects/:slug/members/:me` → 403; (3) try to change your own project role →
  403; (4) as the last PA, try to deactivate another PA... actually try to deactivate **the last PA**
  (yourself when sole PA, or another PA when you are sole PA and block is attempted) → 409; (5) confirm
  the UI disables the own-row controls.

## Acceptance Criteria

- [ ] A user cannot deactivate themselves via `PATCH /users/:userId/blocked` — API returns **403
  FORBIDDEN** ("You cannot deactivate yourself"); the own-row deactivate control is disabled in any
  admin user-management UI that consumes it.
- [ ] A user cannot remove themselves from a project via `DELETE /projects/:slug/members/:userId` —
  API returns **403 FORBIDDEN**; the project `MemberTable` own-row Remove button stays disabled.
- [ ] A user cannot strand themselves via self role-change (`PATCH /projects/:slug/members/:userId/role`)
  — API returns **403 FORBIDDEN**; the project `MemberTable` own-row role control stays locked.
- [ ] The last Platform Admin cannot be **deactivated** (block path) — API returns **409 CONFLICT**
  ("Cannot remove the last platform admin").
- [ ] The last Platform Admin cannot be **demoted** — existing `setPlatformAdmin` guard confirmed
  intact (`userService.ts:104-111`), returns **409 CONFLICT**.
- [ ] All four guards exist on **both** the API (authoritative reject) and, where the UI exists, the
  UI (disabled control).
- [ ] Errors surface clearly (global toast funnel renders the API message) at the point of attempt.

## Open Questions  *(optional)*

- **Self role-change scope:** Should the API reject **all** self role-changes (leading approach,
  matches frontend `selfLockedAdmin`), or only self-**demotions** (`PROJECT_ADMIN → MEMBER`)? The
  ticket says "in a way that locks them out"; demotion does not strictly lock a user out (they remain
  a MEMBER). Recommend the broader block for simplicity and consistency with the UI. Needs product
  confirmation.
- **Admin user-management UI:** Probe B reports the block/deactivate UI does **not yet exist**
  (`/settings` → `ComingSoonPage`; `useSetUserBlocked` has zero consumers). The user's ticket context
  says a SettingsPage/Member-Management UI is in place. **Resolution needed:** if a user-list table
  exists somewhere Probe B missed, its own-row Deactivate control must be disabled (Change F3); if it
  does not exist, the UI half of criterion (a) is deferred until that component ships, with the API
  guard (Change #1) as the authoritative protection in the meantime.
- **Last-PA TOCTOU race:** Out of scope here, but should a follow-up ticket wrap the count+update in
  a locking transaction?

## Out of Scope

- **Last-*Project*-Admin guard** (preventing a project from losing its last `PROJECT_ADMIN` via
  demotion/removal) — the ticket scopes the last-admin requirement to Platform Admin only.
- **Transactional/locking fix for the last-PA TOCTOU race** — matches existing demote-guard safety
  level; a separate hardening ticket.
- **Building the admin user-management table itself** — that is a separate deliverable; SLYK-05 only
  ensures its own-row deactivate control is disabled **when** it ships.
- **Global role column / RBAC refactor** — none needed; `isPlatformAdmin` boolean + `project_members.role`
  enum already suffice (no schema/migration change required for this ticket).
