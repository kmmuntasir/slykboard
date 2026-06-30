# Task Breakdown — SLYK-05

**Plan:** `docs/deliverables/SLYK-05-plan.md`
**Ticket:** `docs/deliverables/SLYK-05.md` (Bug)
**Title:** Prevent Self-Deactivation & Self-Removal (global self-deactivate, project self-remove, self role-change lockout, last-Platform-Admin guard)
**Generated:** 2026-06-30

> **Source of truth for line numbers:** the plan's citations are stale. The numbers below were re-verified against the current tree by `analyst` delegations and are accurate as of this writing. Any coder should still re-grep before editing — `membershipService.ts` and `MemberTable.tsx` have drifted most.

---

## Verified Codebase Facts (from Phase-1 analysis)

These ground-truth findings supersede the plan's citations where they differ. They are folded into the task descriptions.

1. **All 17 cited files exist.** No file is missing; nothing blocks implementation.
2. **`userService.setUserBlocked` (`userService.ts:172-187`) is a bare update** — it has **NO pre-fetch, NO no-op short-circuit, NO self-check, NO last-PA check**. The plan implied a no-op short-circuit already exists; it does **not**. Task-1 must *introduce* the pre-fetch, no-op check, and both guards.
3. **`setPlatformAdmin` (`userService.ts:104-134`) is the precedent to mirror.** It does: fetch existing → NOT_FOUND → no-op short-circuit (`:120-123`) → demote-branch last-PA guard (`:124-128`, throws `AppError(ErrorCode.CONFLICT, 'Cannot remove the last platform admin')` at `:127`) → update + `bumpTokenVersion`.
4. **`membershipService.removeMember` is at `:149-159`** (NOT `:126-138`); signature `(projectId, userId)`, throws `NOT_FOUND 'User not found'` on 0 deleted rows.
5. **`membershipService.setMemberRole` is at `:183-198`** (NOT `:140-160`); signature `(projectId, userId, role: ProjectMemberRole)`, same NOT_FOUND pattern.
6. **Route call sites (all behind `authenticate`, so `req.user.id` is guaranteed):**
   - `users.routes.ts:54-57` — `setUserBlocked({ targetUserId: userId, blocked: req.body.blocked })`
   - `projectMembers.routes.ts:164` — `membershipService.setMemberRole(req.project!.id, userId, body.role)`
   - `projectMembers.routes.ts:179` — `membershipService.removeMember(req.project!.id, userId)`
7. **`req.user` shape** (`middleware/auth.ts:51`, type `types/express.d.ts:3-9`): `{ id: string; email: string; isPlatformAdmin: boolean }`.
8. **Error vocabulary** (`utils/appError.ts:18-42`, `utils/envelope.ts:5-24`): single class `AppError(ErrorCode, message)`; `FORBIDDEN`→403, `CONFLICT`→409, `NOT_FOUND`→404. Last-PA message is verbatim `'Cannot remove the last platform admin'` (preserve this exact string — SLYK-01 verification noted this drift but the code kept "remove").
9. **No self-action guard exists anywhere in the backend** — this is greenfield. The `actingUserId`-threading pattern already has precedent in `ticketService.ts` (audit/`actorId` field), so the approach mirrors an existing convention.
10. **Frontend `MemberTable.tsx` self-lock is already fully implemented** for project self-removal and self role-change: `isSelf` at `:72`, `selfLockedAdmin` at `:75`, role `<SelectInput disabled={selfLockedAdmin}>` at `:110`, Remove `<Button disabled={isSelf}>` at `:142`; `currentUserId` plumbed from `useCurrentProjectMembership` via `ProjectMembersPage.tsx:61` → `<MemberTable currentUserId={...}>` at `:174`.
    - **Divergence to flag:** the UI role-lock (`selfLockedAdmin = isSelf && role === 'PROJECT_ADMIN'`) is *narrower* than the API guard in Task-2 (which rejects **all** self role-changes). Acceptable per the plan's "API is authoritative" stance; the API 403 surfaces via the global toast funnel (`queryClient.ts:20-39`) for any client-enabled self attempt.
11. **The admin user-management UI does NOT exist** — `useSetUserBlocked` (`hooks/useUserManagement.ts:16`) has zero consumers; `/settings` renders `ComingSoonPage` (`routes/index.tsx:111-114`). **F3 is deferred** until that table ships; the API guard (Task-1) is the authoritative protection meanwhile.
12. **Test mocking patterns (to clone, not reinvent):**
    - `userService.test.ts`: `vi.hoisted` "bag" (`selectLimit, selectCount, selectList, insertReturning, updateReturning, bumpTokenVersion`, capture sacks `insertValuesArg/updateSetArg`), `MOCK_USER_ROW` fixture, `resetBag()` in `beforeEach`; guard idiom `.rejects.toMatchObject({code, message})` + `expect(bag.updateReturning).not.toHaveBeenCalled()`; last-PA test pair at `:218-235` to clone.
    - `users.routes.test.ts`: `app` from `../index`, hoisted `TEST_ENV` with real `accessControl`+`verifyJwt`, service mock factory `{listUsers, setUserBlocked, setPlatformAdmin}`, `tokenFor`→`signJwt({sub:'u1',...})` (acting user id is `'u1'`), CONFLICT propagation precedent at `:408-421`, `withArgs` precedent at `:347`.
    - `projectMembers.routes.test.ts`: currently covers **ONLY** `/lookup`. Reusable scaffold: hoisted `TEST_ENV`, `db.transaction`→`{}` tx mock, `membershipMock` bag (currently `{isProjectMember, getMemberRole, listProjectMembers}` — must add `removeMember`/`setMemberRole`), `projectRow()`/`userRow()` fixtures, `tokenFor`→`sub:'u1'`, default `getMemberRole→'PROJECT_ADMIN'`.
    - `membershipService.test.ts`: `removeMember` → `bag.dbDeleteReturning`; `setMemberRole` → `bag.dbUpdateReturning`. `PROJECT_ID='proj-1'`, `USER_ID='user-1'`.

---

## Parallelization Strategy

### Batch execution model

Work is split into **three sequential batches**. Within a batch, tasks touch **disjoint files** and may run as parallel PRs with zero merge conflicts.

- **Batch 1 — Service guards + signatures** (must merge FIRST). Adds the `actingUserId` param + guards to the three services. Also includes the read-only frontend audit (parallel-safe, no code). *Caveat:* Batch 1's service-signature changes will leave `users.routes.ts` / `projectMembers.routes.ts` non-compiling until Batch 2 lands — acceptable within a tight Batch 1→2 sequence; see Merge Rule 7.
- **Batch 2 — Route wiring + last-PA demote confirm** (merges AFTER Batch 1). Threads `req.user.id` into the three call sites; confirms the existing demote guard intact.
- **Batch 3 — Tests + manual verification** (merges AFTER Batch 1 & 2). Unit tests (mocked `db`) and supertest route tests; final manual reproduce gate.

### Visual dependency diagram

```
                  SLYK-05 — Self-Deactivation Guards
                  ══════════════════════════════════

  BATCH 1  (service guards + signatures + frontend audit)   merge FIRST
  ────────────────────────────────────────────────────────
  ┌──────────────────────────────────────────────────────┐
  │ Task-1  userService.setUserBlocked                    │  backend/src/services/
  │         + self-FORBIDDEN + last-PA-on-block CONFLICT   │      userService.ts
  │         sig: { targetUserId, blocked, actingUserId }   │
  └────┬────────────────────────────────────┬─────────────┘
       │                                    │
  ┌────┴─────────────────────────┐  ┌───────┴──────────────────────┐
  │ Task-2  removeMember +        │  │ Task-3  Frontend verify-only │
  │         setMemberRole         │  │         audit (read-only)    │
  │         + self-FORBIDDEN x2   │  │         MemberTable.tsx,     │
  │         (membershipService.ts)│  │         ProjectMembersPage   │
  └───────────────┬──────────────┘  └──────────────────────────────┘
                  │ (signatures frozen; Task-3 is independent)
                  ▼
  BATCH 2  (route wiring — thread req.user.id)              merge AFTER Batch 1
  ────────────────────────────────────────────────────────
  ┌────────────────────────────┐  ┌─────────────────────────────────┐
  │ Task-4  users.routes        │  │ Task-5  projectMembers.routes    │
  │   PATCH /:userId/blocked    │  │   DELETE /:slug/members/:userId  │
  │   → actingUserId wired      │  │   PATCH  /:slug/members/:userId/ │
  └─────────────┬──────────────┘  │           role                   │
                │                 └────────────────┬────────────────┘
                │   ┌──────────────────────────────┘
                │   │  (Task-6 is read-only; can ride with Batch 2)
                ▼   ▼
  BATCH 3  (tests + final integration)                      merge AFTER 1 & 2
  ────────────────────────────────────────────────────────
  ┌──────────────────────┐   ┌──────────────────────────┐   ← parallel-safe
  │ Task-7 userService   │   │ Task-8 membershipService  │     (disjoint files)
  │   .test.ts unit      │   │   .test.ts unit           │
  └──────────┬───────────┘   └──────────┬───────────────┘
             ▼                          ▼
  ┌──────────────────────┐   ┌──────────────────────────┐
  │ Task-9 users.routes  │   │ Task-10 projectMembers    │
  │   .routes.test.ts    │   │   .routes.test.ts         │
  │   supertest          │   │   supertest (net-new)     │
  └──────────┬───────────┘   └──────────┬───────────────┘
             └─────────────┬────────────┘
                           ▼
            Manual reproduce-steps verification gate
```

### Merge-order rules

1. **Strict batch ordering:** Batch 1 → Batch 2 → Batch 3.
2. **Batch 2 cannot open until Batch 1 merges** — routes reference the new `actingUserId` params; merging Batch 2 first breaks the build (argument-count mismatch).
3. **Batch 3 cannot open until Batch 2 merges** — tests assert `actingUserId` in `toHaveBeenCalledWith`; they need the route wiring.
4. **Within Batch 1:** Task-1, Task-2, Task-3 are **independent** (disjoint files) → parallel PRs; all must merge before Batch 2.
5. **Within Batch 2:** Task-4 (users.routes) and Task-5 (projectMembers.routes) are independent → parallel PRs. Task-6 is read-only verification; group it with whichever Batch-2 PR is convenient (no code).
6. **Within Batch 3:** Task-7 ↔ Task-8 are parallel-safe; Task-9 ↔ Task-10 are parallel-safe. Each test task follows its Batch-1/2 prerequisite + its sibling unit-test reference shapes.
7. **Build-green caveat for Batch 1:** Task-1/Task-2 change public service signatures, which leaves `users.routes.ts` / `projectMembers.routes.ts` non-compiling until Batch 2. To keep each commit green, **Batch 1 and its matching Batch 2 wiring should land as one PR per route file** (recommended), OR Batch 1 lands with the explicit understanding that `rtk tsc` is red until Batch 2. Orchestrator's choice.
8. **Rebase-and-merge only** (per `AGENTS.md`) — no squash, no merge commits. If a sibling lands first, rebase the others on it before opening.
9. **Never run `git` without explicit user approval** (`AGENTS.md` sacred rule) — these tasks describe code, not commits.

### Summary table

| # | Batch | Target File(s) | Dependencies | Can Parallel With |
|---|-------|----------------|--------------|-------------------|
| Task-1 | 1 | `backend/src/services/userService.ts` | None | Task-2, Task-3 |
| Task-2 | 1 | `backend/src/services/membershipService.ts` | None | Task-1, Task-3 |
| Task-3 | 1 | `frontend/src/components/MemberTable.tsx`, `frontend/src/pages/ProjectMembersPage.tsx`, `frontend/src/lib/queryClient.ts` (read-only) | None | Task-1, Task-2 |
| Task-4 | 2 | `backend/src/routes/users.routes.ts` | Task-1 | Task-5, Task-6 |
| Task-5 | 2 | `backend/src/routes/projectMembers.routes.ts` | Task-2 | Task-4, Task-6 |
| Task-6 | 2 | `backend/src/services/userService.ts` (read-only) | None | Task-4, Task-5 |
| Task-7 | 3 | `backend/src/services/userService.test.ts` | Task-1 | Task-8 |
| Task-8 | 3 | `backend/src/services/membershipService.test.ts` | Task-2 | Task-7 |
| Task-9 | 3 | `backend/src/routes/users.routes.test.ts` | Task-1, Task-4, Task-7 | Task-10 |
| Task-10 | 3 | `backend/src/routes/projectMembers.routes.test.ts` | Task-2, Task-5, Task-8 | Task-9 |

### Developer assignment tracks

- **Track A (backend user/deactivate):** Task-1 → Task-4 → Task-7 → Task-9. Owns the global self-deactivate + last-PA story end to end.
- **Track B (backend project membership):** Task-2 → Task-5 → Task-8 → Task-10. Owns project self-remove + self role-change end to end.
- **Track C (frontend / verification):** Task-3 → Task-6. Read-only audit + last-PA demote confirm; can assist either track in Batch 3.

Two developers (A + B) can run fully in parallel after Batch 1 lands; a third (C) handles the audit and confirm tasks and joins the test effort in Batch 3.

---

## Tasks

### Task-1 — `userService.setUserBlocked`: self-deactivation guard + last-PA-on-block guard + pre-fetch + no-op short-circuit

**Batch:** 1
**Files touched:** `backend/src/services/userService.ts` (only)
**Dependencies:** None

**Description**

Today `setUserBlocked` (`userService.ts:172-187`) is a bare update with **no pre-fetch, no no-op short-circuit, no self-check, no last-PA check**:

```ts
// userService.ts:172-187 (current)
export async function setUserBlocked({
  targetUserId,
  blocked,
}: {
  targetUserId: string;
  blocked: boolean;
}): Promise<UserRow> {
  const [updated] = await db
    .update(users)
    .set({ blocked })
    .where(eq(users.id, targetUserId))
    .returning();
  if (!updated) {
    throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
  }
  await bumpTokenVersion(targetUserId);
  return updated;
}
```

Rewrite it to mirror the structure of `setPlatformAdmin` (`userService.ts:104-134`), the in-file precedent for pre-fetch → no-op → last-PA guard. Exact shape:

```ts
export async function setUserBlocked({
  targetUserId,
  blocked,
  actingUserId,
}: {
  targetUserId: string;
  blocked: boolean;
  actingUserId: string;
}): Promise<UserRow> {
  // 1. SELF-DEACTIVATION GUARD — runs FIRST, before the no-op short-circuit,
  //    so re-POSTing an already-blocked self-row is still rejected.
  if (blocked === true && targetUserId === actingUserId) {
    throw new AppError(ErrorCode.FORBIDDEN, 'You cannot deactivate yourself');
  }

  // 2. PRE-FETCH existing row (mirrors setPlatformAdmin prefetch).
  const [existing] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!existing) {
    throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
  }

  // 3. NO-OP SHORT-CIRCUIT (mirrors setPlatformAdmin): value unchanged → return row
  //    without the last-PA guard or the token bump.
  if (existing.blocked === blocked) {
    return existing;
  }

  // 4. LAST-PA-ON-BLOCK GUARD (CONFLICT) — mirrors the demote guard verbatim.
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
```

**Ordering rationale:** self-check → pre-fetch → no-op → last-PA → write. The self-check **must** precede the no-op short-circuit (plan §"No-op self-block ordering") so re-**blocking** an already-blocked self-row still rejects FORBIDDEN. A PA blocking themselves when sole PA hits the more-specific self-FORBIDDEN first (plan §"isPlatformAdmin self-block precedence"). `count` is already imported; `AppError`/`ErrorCode` already imported. **Do not modify the route in this task** — Task-4 threads the new param.

**Acceptance Criteria**
- [ ] Signature changed to `setUserBlocked({ targetUserId, blocked, actingUserId })`.
- [ ] Self-deactivation: `blocked === true && targetUserId === actingUserId` throws `AppError(ErrorCode.FORBIDDEN, 'You cannot deactivate yourself')` **before** any DB read.
- [ ] Pre-fetch added; `NOT_FOUND 'User not found'` thrown when target row is absent (now via read-then-update).
- [ ] No-op short-circuit: `existing.blocked === blocked` returns the row **without** calling `bumpTokenVersion`.
- [ ] Last-PA-on-block: when `blocked === true && existing.isPlatformAdmin === true` and `paCount <= 1`, throws `AppError(ErrorCode.CONFLICT, 'Cannot remove the last platform admin')` (verbatim message).
- [ ] Blocking a **non-last** PA still succeeds; unblocking (`blocked === false`) any user (including self) succeeds.
- [ ] `bumpTokenVersion` fires only on an actual write.
- [ ] No other method in `userService.ts` is modified.

---

### Task-2 — `membershipService.removeMember` + `setMemberRole`: self-removal and self-role-change guards

**Batch:** 1
**Files touched:** `backend/src/services/membershipService.ts` (only)
**Dependencies:** None

**Description**

Re-grepped current line numbers (plan's `:126-138`/`:140-160` are stale):

- `removeMember` → `membershipService.ts:149-159`
- `setMemberRole` → `membershipService.ts:183-198`

```ts
// removeMember (current)
export async function removeMember(projectId: string, userId: string): Promise<void> {
  const deleted = await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .returning();
  if (deleted.length === 0) {
    throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
  }
}

// setMemberRole (current)
export async function setMemberRole(
  projectId: string,
  userId: string,
  role: ProjectMemberRole,
): Promise<void> {
  const updated = await db
    .update(projectMembers)
    .set({ role })
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .returning();
  if (updated.length === 0) {
    throw new AppError(ErrorCode.NOT_FOUND, 'User not found');
  }
}
```

Append `actingUserId` and add a self-check **at the top of each method, before any DB write** — so a Platform Admin self-targeting these routes (they are not a `project_members` row) sees FORBIDDEN rather than the current NOT_FOUND (plan §"PA self-targeting member routes"):

```ts
export async function removeMember(
  projectId: string,
  userId: string,
  actingUserId: string,
): Promise<void> {
  if (userId === actingUserId) {
    throw new AppError(ErrorCode.FORBIDDEN, 'You cannot remove yourself from a project');
  }
  // ...existing delete + NOT_FOUND unchanged
}

export async function setMemberRole(
  projectId: string,
  userId: string,
  role: ProjectMemberRole,
  actingUserId: string,
): Promise<void> {
  if (userId === actingUserId) {
    throw new AppError(ErrorCode.FORBIDDEN, 'You cannot change your own role');
  }
  // ...existing update + NOT_FOUND unchanged
}
```

**Notes:**
- Both guards use `ErrorCode.FORBIDDEN` (403) — consistent with the closed vocab (`utils/envelope.ts:5-24`).
- **Self role-change scope (Open Question):** leading approach = reject **all** self role-changes (matches frontend `selfLockedAdmin`, `MemberTable.tsx:75`). Proceed with the broad block unless product says otherwise; flag in the PR description.
- `AppError`/`ErrorCode` already imported (`membershipService.ts:4-5`).
- **Do not modify the routes in this task** — Task-5 threads the new params. Do **not** touch `addMember`, `addExistingMember`, or `promoteToProjectAdmin`.

**Acceptance Criteria**
- [ ] `removeMember` signature is `(projectId, userId, actingUserId)`.
- [ ] `removeMember`: `userId === actingUserId` throws `AppError(ErrorCode.FORBIDDEN, 'You cannot remove yourself from a project')` **before** any DB write.
- [ ] `setMemberRole` signature is `(projectId, userId, role, actingUserId)`.
- [ ] `setMemberRole`: `userId === actingUserId` throws `AppError(ErrorCode.FORBIDDEN, 'You cannot change your own role')` **before** any DB write.
- [ ] Existing NOT_FOUND behaviors preserved for non-self, non-existent targets.
- [ ] No other method in `membershipService.ts` is modified (`promoteToProjectAdmin` untouched).
- [ ] Guards run before the DB mutation so a PA self-targeting these routes gets FORBIDDEN, not NOT_FOUND.

---

### Task-3 — Frontend verify-only audit: confirm `MemberTable` self-lock idiom and toast funnel are intact

**Batch:** 1
**Files touched:** none (read-only). If a defect is found, record it as a follow-up task proposal — **do not patch in this task.**
**Files inspected:** `frontend/src/components/MemberTable.tsx`, `frontend/src/pages/ProjectMembersPage.tsx`, `frontend/src/lib/queryClient.ts`
**Dependencies:** None

**Description**

The project-side self-lock idiom is **already fully implemented** for project self-removal and self role-change (criteria b and the project half of c). This task is a **read-only audit** to confirm that with evidence and flag any leak. Verified facts:

- `MemberTable.tsx:72` — `const isSelf = member.userId === currentUserId;`
- `MemberTable.tsx:75` — `const selfLockedAdmin = isSelf && member.role === 'PROJECT_ADMIN';`
- `MemberTable.tsx:110` — role `<SelectInput disabled={selfLockedAdmin}>` (locks self **PROJECT_ADMIN** row only — the narrower self-demotion guard).
- `MemberTable.tsx:142` — Remove `<Button disabled={isSelf}>`.
- `ProjectMembersPage.tsx:61` — `const currentUserId = membership?.userId;` (from `useCurrentProjectMembership(slug)` at `:53`).
- `ProjectMembersPage.tsx:174` — `<MemberTable currentUserId={currentUserId} />`.
- Mutations `useUpdateMemberRole` / `useRemoveMember` wired at `ProjectMembersPage.tsx:54-55`; removal is confirm-gated (`:79`).
- `queryClient.ts:20-39` — global toast funnel renders `FORBIDDEN`/`CONFLICT` messages with no string-mapping needed.

**Divergence to flag in writing:** the UI role-lock is narrower (`selfLockedAdmin` = self **PROJECT_ADMIN** only) than the Task-2 API guard (all self role-changes). Acceptable per the plan's "API is authoritative" stance; once the API guard lands, a self-MEMBER attempting a role change is client-enabled but server-rejected (403 surfaces via the toast funnel). Recommend a follow-up to broaden the UI lock if product wants symmetric client-side locking. **Do not broaden in this task.**

**F3 confirmation:** no admin user-management table exists; `/settings` → `ComingSoonPage` (`routes/index.tsx:111-114`). F3 is deferred until that component ships.

**Acceptance Criteria**
- [ ] Report (as task output) confirms `MemberTable.tsx:72/75/110/142` self-lock is present and wired to `currentUserId`.
- [ ] Report confirms `ProjectMembersPage.tsx:61` derives `currentUserId` and passes it to `<MemberTable>` at `:174`.
- [ ] Report confirms `queryClient.ts:20-39` surfaces `FORBIDDEN`/`CONFLICT` messages without new frontend string-mapping.
- [ ] UI-vs-API role-lock divergence flagged in writing with recommendation.
- [ ] F3 deferred status confirmed (`/settings` → `ComingSoonPage`).
- [ ] **No files modified.**

---

### Task-4 — Thread `actingUserId` into the `users.routes.ts` block handler

**Batch:** 2
**Files touched:** `backend/src/routes/users.routes.ts` (block handler `:54-57`)
**Dependencies:** Task-1

**Description**

Task-1 changes `setUserBlocked` to `setUserBlocked({ targetUserId, blocked, actingUserId })`. Update the only call site — the route handler — to pass `req.user.id` (the only place `req.user` exists, `middleware/auth.ts:51`):

```ts
// Before (users.routes.ts:54-57)
const updated = await setUserBlocked({
  targetUserId: userId,
  blocked: req.body.blocked,
});

// After
const updated = await setUserBlocked({
  targetUserId: userId,
  blocked: req.body.blocked,
  actingUserId: req.user.id,
});
```

The handler sits behind `authenticate` + `requirePlatformAdmin()`, so `req.user.id` is guaranteed present — no null-guard needed.

**Acceptance Criteria**
- [ ] `setUserBlocked` call at `users.routes.ts:54-57` passes `actingUserId: req.user.id`.
- [ ] No other behavioral change (response envelope, status codes unchanged).
- [ ] `rtk tsc` (backend) type-checks clean after this + Task-1 land.
- [ ] (Asserted in Task-9) handler invokes the mocked `setUserBlocked` with `actingUserId` matching the signed-in user.

---

### Task-5 — Thread `req.user.id` into `projectMembers.routes.ts` (`removeMember` + `setMemberRole`)

**Batch:** 2
**Files touched:** `backend/src/routes/projectMembers.routes.ts` (role handler `:164`, remove handler `:179`)
**Dependencies:** Task-2

**Description**

Task-2 extends `removeMember` and `setMemberRole` with a trailing `actingUserId` param. Update both call sites in this file:

```ts
// Role handler (:164) — Before
await membershipService.setMemberRole(req.project!.id, userId, body.role);
// After
await membershipService.setMemberRole(req.project!.id, userId, body.role, req.user.id);

// Remove handler (:179) — Before
await membershipService.removeMember(req.project!.id, userId);
// After
await membershipService.removeMember(req.project!.id, userId, req.user.id);
```

Both handlers sit behind `authenticate` (then `requireProjectMember()` / `requireProjectAdmin()`), so `req.user.id` is present.

**Acceptance Criteria**
- [ ] `setMemberRole` call at `:164` passes `req.user.id` as the 4th argument.
- [ ] `removeMember` call at `:179` passes `req.user.id` as the 3rd argument.
- [ ] No other behavioral change (envelope/status unchanged).
- [ ] `rtk tsc` (backend) type-checks clean after this + Task-2 land.
- [ ] (Asserted in Task-10) self-target → 403, valid other-target → service called with `actingUserId`.

---

### Task-6 — Verify the existing last-PA demote guard is intact (READ-ONLY)

**Batch:** 2
**Files touched:** none (read-only). If a gap is found, report it — do not fix in this task.
**Files inspected:** `backend/src/services/userService.ts` (`setPlatformAdmin`, `:104-134`), `backend/src/utils/envelope.ts`, `backend/src/services/userService.test.ts`
**Dependencies:** None (may be done in parallel with Task-4/Task-5)

**Description**

Criterion (c) has two halves: (1) extend the last-PA guard to the **block/deactivate** path (Task-1), and (2) **confirm** the existing last-PA guard on the **demote** path is intact. This task is half (2): a read-only verification.

The guard lives in `setPlatformAdmin` (`userService.ts:104-134`). It fires only on demotion (`!isPlatformAdmin`), counts rows where `isPlatformAdmin === true`, and throws `CONFLICT 'Cannot remove the last platform admin'` at `:127` when `paCount <= 1`. Verify:

1. The demote-branch guard exists and is reached (the no-op short-circuit at `:120-123` skips the guard only when the value isn't changing).
2. The thrown error is `new AppError(ErrorCode.CONFLICT, 'Cannot remove the last platform admin')` (`:127`).
3. `ErrorCode.CONFLICT` maps to HTTP 409 (`utils/envelope.ts:5-24`).
4. Existing unit coverage in `userService.test.ts` exercises the last-PA demote reject path (cite the test, ~`:218-235`).

**Acceptance Criteria**
- [ ] Demote-branch last-PA guard confirmed present at `setPlatformAdmin` (`:104-134`), throws `AppError(ErrorCode.CONFLICT, 'Cannot remove the last platform admin')` at `:127`.
- [ ] Guard fires only on actual demotion (no-op short-circuit at `:120-123` does not bypass a real demote).
- [ ] `ErrorCode.CONFLICT` → 409 mapping confirmed.
- [ ] Regression test exists in `userService.test.ts` for last-PA demote → CONFLICT (cite it).
- [ ] No code modified.

---

### Task-7 — `userService.test.ts`: self-block + last-PA-on-block unit cases + signature update

**Batch:** 3
**Files touched:** `backend/src/services/userService.test.ts`
**Dependencies:** Task-1

**Description**

Reuse the existing `vi.hoisted` bag (`selectLimit, selectCount, selectList, insertReturning, updateReturning, bumpTokenVersion`), `MOCK_USER_ROW` fixture, `resetBag()` in `beforeEach`. Guard idiom: `.rejects.toMatchObject({code, message})` + `expect(bag.updateReturning).not.toHaveBeenCalled()`. Last-PA pair to clone lives at `:218-235`.

**(a) Update existing call sites** — the `describe('setUserBlocked', ...)` block (`:288-323`) currently calls `setUserBlocked({ targetUserId, blocked })`. Add `actingUserId: 'u-other'` (≠ target). Because Task-1 adds a prefetch (`selectLimit`) and a PA count (`selectCount`) on `blocked:true`, the happy-path tests must seed `bag.selectLimit` with the existing (non-PA) row:

```ts
it.each([
  { name: 'blocks a non-self user (true)', blocked: true },
  { name: 'reactivates a user (false)',    blocked: false },
])('$name', async ({ blocked }) => {
  bag.selectLimit.mockResolvedValueOnce([{ ...MOCK_USER_ROW, isPlatformAdmin: false, blocked: !blocked }]);
  bag.updateReturning.mockResolvedValueOnce([{ ...MOCK_USER_ROW, blocked }]);
  const result = await setUserBlocked({ targetUserId: 'u-admin', blocked, actingUserId: 'u-other' });
  expect(result.blocked).toBe(blocked);
  expect(bag.updateSetArg.blocked).toBe(blocked);
  expect(bag.bumpTokenVersion).toHaveBeenCalledWith('u-admin');
});
```

The NOT_FOUND case keeps its shape with `actingUserId: 'u-other'`; pin to whether NOT_FOUND fires at the prefetch (`selectLimit`→`[]`) and assert accordingly.

**(b) Add net-new unit cases:**

| Case | Mock setup | Assertion |
|------|-----------|-----------|
| Self-block FORBIDDEN | none (self-check first) | `setUserBlocked({targetUserId:'u1',blocked:true,actingUserId:'u1'})` → `.rejects.toMatchObject({code:FORBIDDEN, message:'You cannot deactivate yourself'})`; `bag.updateReturning` + `bag.selectLimit` not called |
| Self-unblock allowed | `selectLimit`→blocked row, `updateReturning`→unblocked row | resolves; `bumpTokenVersion` called |
| Block a non-last PA ok | `selectLimit`→PA row, `selectCount`→`[{count:2}]`, `updateReturning`→updated | resolves; `bumpTokenVersion` called with target |
| Block the LAST PA → CONFLICT | `selectLimit`→PA row, `selectCount`→`[{count:1}]` | `.rejects.toMatchObject({code:CONFLICT, message:'Cannot remove the last platform admin'})`; `updateReturning` + `bumpTokenVersion` not called (clone `:218-235`) |
| Defensive count→0 → CONFLICT | `selectLimit`→PA row, `selectCount`→`[]` | `.rejects.toMatchObject({code:CONFLICT})`; `updateReturning` not called (mirror `:237-244`) |
| Re-block already-blocked self → still FORBIDDEN | none | proves self-check runs **before** the no-op short-circuit; `updateReturning` not called |

**Acceptance Criteria**
- [ ] All existing `setUserBlocked` call sites pass `actingUserId`.
- [ ] Self-block FORBIDDEN asserts the verbatim message and that `updateReturning`/`selectLimit` were not called.
- [ ] Self-unblock proves the guard gates only `blocked:true`.
- [ ] Last-PA-on-block CONFLICT clones `:218-235` shape (count:1 → CONFLICT, no update, no token bump).
- [ ] Defensive `selectCount→[]` → CONFLICT case present.
- [ ] Re-block-already-blocked-self case proves FORBIDDEN fires before the no-op short-circuit.
- [ ] `npm test -- src/services/userService.test.ts` green; no sibling test file regresses.

---

### Task-8 — `membershipService.test.ts`: self-FORBIDDEN unit cases + signature update

**Batch:** 3
**Files touched:** `backend/src/services/membershipService.test.ts`
**Dependencies:** Task-2

**Description**

The existing bag provides `removeMember` → `bag.dbDeleteReturning`, `setMemberRole` → `bag.dbUpdateReturning`. Constants: `PROJECT_ID='proj-1'`, `USER_ID='user-1'`. Task-2 changes signatures to `removeMember(projectId, userId, actingUserId)` and `setMemberRole(projectId, userId, role, actingUserId)`.

**(a) Update existing call sites:** both the `removeMember` happy-path/NOT_FOUND tests and the `setMemberRole` `it.each`/NOT_FOUND tests add `actingUserId: 'user-other'` (≠ `USER_ID`) in the trailing position.

**(b) Add net-new unit cases** (self-checks run before any DB access — no mock seeding needed for FORBIDDEN cases):

```ts
describe('removeMember — self-removal guard (SLYK-05)', () => {
  it('rejects FORBIDDEN when userId === actingUserId', async () => {
    await expect(removeMember(PROJECT_ID, USER_ID, USER_ID)).rejects.toMatchObject({
      code: ErrorCode.FORBIDDEN, message: 'You cannot remove yourself from a project',
    });
    expect(bag.dbDeleteReturning).not.toHaveBeenCalled();
  });
  it('regression: a different acting id still deletes the row', async () => {
    bag.dbDeleteReturning.mockResolvedValueOnce([{ projectId: PROJECT_ID, userId: USER_ID }]);
    await expect(removeMember(PROJECT_ID, USER_ID, 'user-other')).resolves.toBeUndefined();
  });
});

describe('setMemberRole — self role-change guard (SLYK-05)', () => {
  it.each(['PROJECT_ADMIN', 'MEMBER'] as const)(
    'rejects FORBIDDEN when changing own role to %s', async (role) => {
      await expect(setMemberRole(PROJECT_ID, USER_ID, role, USER_ID)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN, message: 'You cannot change your own role',
      });
      expect(bag.dbUpdateReturning).not.toHaveBeenCalled();
    });
  it('regression: a different acting id still updates the role', async () => {
    bag.dbUpdateReturning.mockResolvedValueOnce([{ projectId: PROJECT_ID, userId: USER_ID }]);
    await setMemberRole(PROJECT_ID, USER_ID, 'MEMBER', 'user-other');
    expect(bag.dbUpdateSetArg.role).toBe('MEMBER');
  });
});
```

**Acceptance Criteria**
- [ ] All existing `removeMember`/`setMemberRole` call sites pass `actingUserId`.
- [ ] `removeMember` self-target → FORBIDDEN, `dbDeleteReturning` not called.
- [ ] `setMemberRole` self-target → FORBIDDEN for both role values, `dbUpdateReturning` not called.
- [ ] Regression cases (different actor) still delete/update successfully.
- [ ] `npm test -- src/services/membershipService.test.ts` green; no sibling service test regresses.

---

### Task-9 — `users.routes.test.ts`: supertest 403 self-block + 409 last-PA + regression

**Batch:** 3
**Files touched:** `backend/src/routes/users.routes.test.ts`
**Dependencies:** Task-1, Task-4, Task-7

**Description**

Reuse the existing scaffold verbatim: `app` import, hoisted `TEST_ENV`, service mock factory `{listUsers, setUserBlocked, setPlatformAdmin}`, `tokenFor`→`signJwt({sub:'u1',...})`. **The signed-in user id is `'u1'`**, so self-block tests target `:userId === 'u1'`. The service is mocked, so route-layer asserts **propagation** + **call shape**, not guard logic (guards are unit-tested in Task-7).

**(a) Update existing `withArgs` assertions** (~`:347` and the block-false case) to include `actingUserId`:

```ts
expect(mockedSetBlocked).toHaveBeenCalledWith({
  targetUserId: 'u-target',
  blocked: true,
  actingUserId: 'u1',
});
```

**(b) Add net-new supertest cases** inside the `PATCH /api/users/:userId/blocked` describe block:

| Case | Mock setup | Assertion |
|------|-----------|-----------|
| Self-block → 403 FORBIDDEN | `mockedSetBlocked.mockRejectedValue(new AppError(FORBIDDEN, 'You cannot deactivate yourself'))` | `PATCH /api/users/u1/blocked` + `{blocked:true}` → `res.status===403`, `error.code==='FORBIDDEN'` (clone `:408-421`) |
| Block-last-PA → 409 CONFLICT | `mockedSetBlocked.mockRejectedValue(new AppError(CONFLICT, 'Cannot remove the last platform admin'))` | `PATCH /api/users/u-target/blocked` + `{blocked:true}` → `409`, `error.code==='CONFLICT'` (verbatim clone of `:408-421`) |
| Self-unblock allowed (regression) | `mockedSetBlocked.mockResolvedValue({...blocked:false})` | `PATCH /api/users/u1/blocked` + `{blocked:false}` → `200`; `toHaveBeenCalledWith({targetUserId:'u1', blocked:false, actingUserId:'u1'})` |
| Non-PA caller → 403 (existing regression) | none | unchanged existing case; `mockedSetBlocked` not called |

Because the guard lives in the **service**, the route test mocks `setUserBlocked` to throw `AppError` and asserts the error middleware maps it — exactly the CONFLICT precedent at `:408-421`. Do **not** replicate guard logic in the route.

**Acceptance Criteria**
- [ ] Existing block/unblock `withArgs` assertions include `actingUserId: 'u1'`.
- [ ] Self-block case returns 403 FORBIDDEN via mocked AppError propagation.
- [ ] Block-last-PA case returns 409 CONFLICT (clone of `:408-421`).
- [ ] Self-unblock case returns 200 and asserts `actingUserId` threaded.
- [ ] Non-PA 403 regression case unchanged and green.
- [ ] `npm test -- src/routes/users.routes.test.ts` green.

---

### Task-10 — `projectMembers.routes.test.ts`: net-new DELETE + PATCH route suites

**Batch:** 3
**Files touched:** `backend/src/routes/projectMembers.routes.test.ts`
**Dependencies:** Task-2, Task-5, Task-8

**Description**

This file currently covers **only** `/lookup`. Add two **net-new** `describe` blocks for `DELETE /:slug/members/:userId` and `PATCH /:slug/members/:userId/role`. Reuse the existing scaffold: hoisted `TEST_ENV`, `db.transaction`→`{}` tx mock, `projectRow()`/`userRow()` fixtures, `tokenFor`→`sub:'u1'`, default `membershipMock.getMemberRole→'PROJECT_ADMIN'`.

**(a) Extend the service mock factory** — add `removeMember` and `setMemberRole`:

```ts
const membershipMock = vi.hoisted(() => ({
  isProjectMember: vi.fn(),
  getMemberRole: vi.fn(),
  listProjectMembers: vi.fn(),
  removeMember: vi.fn(),    // NEW
  setMemberRole: vi.fn(),   // NEW
}));
vi.mock('../services/membershipService', () => ({
  isProjectMember: membershipMock.isProjectMember,
  getMemberRole: membershipMock.getMemberRole,
  listProjectMembers: membershipMock.listProjectMembers,
  removeMember: membershipMock.removeMember,
  setMemberRole: membershipMock.setMemberRole,
}));
```

**(b) DELETE suite** (route handler at `projectMembers.routes.ts:169-180`):

| Case | Mock setup | Assertion |
|------|-----------|-----------|
| Self-remove → 403 FORBIDDEN | `mockedGetBySlug`→`projectRow()`; `removeMember.mockRejectedValue(new AppError(FORBIDDEN, 'You cannot remove yourself from a project'))` | `DELETE /api/projects/SLYK/members/u1` → `403`, `error.code==='FORBIDDEN'` (mirror `users.routes.test.ts:408-421`) |
| Valid other-target → 200, called with actingUserId | `removeMember.mockResolvedValue(undefined)` | `DELETE /api/projects/SLYK/members/u-target` → `200`; `toHaveBeenCalledWith('p1', 'u-target', 'u1')` |
| NOT_FOUND propagation | `removeMember.mockRejectedValue(new AppError(NOT_FOUND, 'User not found'))` | `404` |

**(c) PATCH role suite** (route handler at `projectMembers.routes.ts:152-167`):

| Case | Mock setup | Assertion |
|------|-----------|-----------|
| Self role-change → 403 FORBIDDEN | `setMemberRole.mockRejectedValue(new AppError(FORBIDDEN, 'You cannot change your own role'))` | `PATCH /api/projects/SLYK/members/u1/role` + `{role:'MEMBER'}` → `403`, `error.code==='FORBIDDEN'` |
| Valid other-target → 200, called with actingUserId | `setMemberRole.mockResolvedValue(undefined)` | `PATCH /api/projects/SLYK/members/u-target/role` + `{role:'PROJECT_ADMIN'}` → `200`; `toHaveBeenCalledWith('p1','u-target','PROJECT_ADMIN','u1')` |
| Validation: bad role → 400 | none | `{role:'SUPERUSER'}` → `400 VALIDATION_FAILED`; `setMemberRole` not called |

Because the guards live in the **service**, the route tests mock the service to throw `AppError(FORBIDDEN,...)` and assert 403 propagates. The route-layer concern is the `actingUserId: req.user.id` threading, asserted via `toHaveBeenCalledWith`.

**Acceptance Criteria**
- [ ] `membershipMock` factory includes `removeMember` + `setMemberRole`.
- [ ] DELETE self-remove → 403; DELETE other-target → 200 and asserts `removeMember('p1','<target>','u1')`.
- [ ] PATCH self-role-change → 403; PATCH other-target → 200 and asserts `setMemberRole('p1','<target>','<role>','u1')`.
- [ ] DELETE/PATCH NOT_FOUND + 400-validation propagation cases present.
- [ ] Existing `/lookup` suite stays green; `npm test -- src/routes/projectMembers.routes.test.ts` green.

---

## Final integration check (manual verification gate — not a coded task)

After Task-7…Task-10 are green, re-run the ticket's reproduce steps end-to-end against a running stack:

1. As a PA, `PATCH /users/:me/blocked {blocked:true}` → **403**.
2. `DELETE /projects/:slug/members/:me` → **403**.
3. `PATCH /projects/:slug/members/:me/role` → **403**.
4. As the last PA, attempt to deactivate the last PA (self when sole, or another PA when sole) → **409**.
5. Confirm the UI disables the own-row controls (Remove button, role SelectInput for PROJECT_ADMIN self row).

No additional automated test file is required — guards are pure pre-write checks with no cross-table transactional effect (plan §Testing: "Integration … none required beyond the above").

---

## Open Questions carried forward from the plan

- **Self role-change scope:** reject all self role-changes (leading; matches frontend `selfLockedAdmin`) or only self-demotion? Task-2 proceeds with the broad block pending product confirmation.
- **Admin user-management UI:** does not exist today; F3 deferred until it ships. API guard (Task-1) is authoritative meanwhile.
- **Last-PA TOCTOU race:** out of scope; the new block-path guard inherits the existing demote-guard safety level. A separate hardening ticket should wrap the count+update in a locking transaction (cf. `projectSequences` FOR UPDATE at `schema.ts:202-204`).
