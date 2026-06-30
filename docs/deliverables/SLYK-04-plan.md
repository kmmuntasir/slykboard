# Implementation Plan — SLYK-04

**Ticket:** `docs/deliverables/SLYK-04.md`
**Type:** Feature
**Title:** Project Deactivation (reversible soft-hide)
**Generated:** 2026-06-30

---

## Summary

SLYK-04 introduces a reversible **deactivate** capability so a Platform Admin can
retire a project without deleting it. The `projects.isActive` boolean column
already exists (added in SLYK-01 Task A, deferred to DEL-04), so this ticket is
**behavior-only — no schema/migration changes.** Deactivation (a) stops every
running timer in the project immediately, (b) hides the project from the picker
for Members and Project Admins, (c) makes any `…/projects/:slug/…` deep link
return a **non-revealing** FORBIDDEN to non-Platform-Admins, while Platform
Admins continue to see deactivated projects (badged "Deactivated") and can
**Reactivate** them. A user whose only project is deactivated lands on an
empty-state page ("You have no Projects. Contact Admin") and can still reach the
profile menu and Account Settings.

The implementation extends the existing PA-only `PATCH /api/projects/:slug`
endpoint to accept an optional `isActive` flag (mirroring the
`PATCH /:userId/blocked` user-deactivation precedent), adds a member-scoped
`isActive=true` list filter, gates `getProjectBySlug` so deactivated projects are
indistinguishable from non-existent/non-member for non-PAs, and adds a
transactional `stopTimersForProject` to `timerService`.

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| Schema (no change) | `backend/src/db/schema.ts:95` | `isActive` column already present; cite for context only |
| Service | `backend/src/services/projectService.ts` | `listProjects` member filter, `getProjectBySlug` non-revealing deny, `updateProject` deactivation tx |
| Service | `backend/src/services/timerService.ts` | new `stopTimersForProject(tx, projectId)` |
| Service test | `backend/src/services/projectService.test.ts` | deactivate/reactivate + bulk-stop delegation cases |
| Service test | `backend/src/services/timerService.test.ts` | **new file** — `stopTimersForProject` unit tests |
| Route | `backend/src/routes/projects.routes.ts` | extend `PATCH /:slug` to accept `isActive` |
| Schema (Zod) | `backend/src/routes/projects.schema.ts` | add `isActive?: boolean` to `updateProjectBodySchema` |
| Route test | `backend/src/routes/projects.routes.test.ts` | non-revealing deny on deactivated deep-link; deactivate/reactivate happy path |
| Types | `frontend/src/types/project.ts` | add `isActive: boolean` to `Project`; `isActive?` to `UpdateProjectDto` |
| API client | `frontend/src/api/projects.ts` | `updateProject` carries `isActive` (no new verb) |
| Hook | `frontend/src/hooks/useUpdateProject.ts` (and/or new wrappers) | deactivate/reactivate mutation + invalidation |
| Page | `frontend/src/pages/ProjectSettingsPage.tsx` | PA-only Deactivate/Reactivate section + `ConfirmDialog` |
| Component | `frontend/src/components/ProjectPicker.tsx` | "Deactivated" badge for PA |
| Page | `frontend/src/pages/ProjectsPage.tsx` | "Deactivated" badge (PA) + member empty-state copy |
| Store | `frontend/src/stores/useProjectStore.ts` | clear `lastSelectedSlug` if it was deactivated |

No migration is generated (column already shipped in `0000_dear_mattie_franklin.sql`).
No audit logging is added (consistent with the `setUserBlocked` precedent — reversible
toggles are not audited; the `requestLogger` middleware already logs the request).

## Proposed Implementation

Build order: backend service → timer bulk-stop → route/Zod → backend tests →
frontend types/api/hooks → UI sections/badges/empty-state.

### Backend Changes

#### 1. `stopTimersForProject` in `timerService`

- **File:** `backend/src/services/timerService.ts`
- **What:** Add a `Tx`-accepting bulk-stop that closes every running timer whose
  ticket belongs to `projectId`, mirroring `stopTimerForTicket(tx, ticketId)`
  (`timerService.ts:117-123`).
- **Why:** Deactivation must stop all running timers in the project atomically.
  `timeEntries` has no `projectId` column (`schema.ts:276-300`), so the update
  joins through `tickets.projectId`. Reuse the `stopTimerForTicket` tx-idiom so it
  runs inside the deactivation transaction.
- **Code reference:** `stopTimerForTicket` (`timerService.ts:117-123`); auto-stop
  precedent `startTimer` (`timerService.ts:32-37`). Only `endTime` is set
  (`durationMs` is computed at read time — `timerService.ts:144-152`), so no
  duration math is needed.
- **Shape:**
  ```ts
  export async function stopTimersForProject(tx: Tx, projectId: string) {
    await tx.update(timeEntries)
      .set({ endTime: new Date() })
      .where(and(
        isNull(timeEntries.endTime),
        inArray(timeEntries.ticketId,
          db.select({ id: tickets.id }).from(tickets).where(eq(tickets.projectId, projectId))),
      ));
  }
  ```

#### 2. `getProjectBySlug` non-revealing deny for deactivated projects

- **File:** `backend/src/services/projectService.ts` (`getProjectBySlug`)
- **What:** After the PA bypass (`projectService.ts:107-109`), if `!row.isActive`
  and the caller is not a Platform Admin, throw the **byte-identical**
  non-revealing FORBIDDEN: `throw new AppError(ErrorCode.FORBIDDEN, 'You do not have access to this project')`.
  Do **not** change the PA branch — PAs must see deactivated projects.
- **Why:** This is the single chokepoint used by `requireProjectMember`
  (`middleware/requireProjectMember.ts:42`) and `resolveProject`
  (`middleware/resolveProject.ts:22`), so gating here denies every deep link
  (`/board`, tickets, labels, timers, settings for non-PA) uniformly while keeping
  deactivated indistinguishable from non-existent/non-member (anti-oracle).
- **Code reference:** existing identical throws at `projectService.ts:103-104`
  (not-found) and `:131-133` (non-member); `AppError`/`ErrorCode.FORBIDDEN`
  (`utils/appError.ts:24`, `utils/envelope.ts:10`).

#### 3. `listProjects` member-scoped `isActive` filter

- **File:** `backend/src/services/projectService.ts` (`listProjects`, member branch)
- **What:** Add `eq(projects.isActive, true)` to the member branch `where` clause.
  Leave the PA branch unchanged (PA sees all, badged).
- **Why:** Hides deactivated projects from Members and Project Admins in the picker
  and `/projects` page. Backend filtering is chosen over client filtering to match
  the codebase's non-revealing philosophy (no leak of deactivated-project
  existence via cache/state).
- **Code reference:** member branch `projectService.ts:97-110`; the existing
  comment there explicitly defers this filter to DEL-04.

#### 4. `updateProject` deactivation transaction

- **File:** `backend/src/services/projectService.ts` (`updateProject`, `:131-202`)
- **What:** Accept an optional `isActive` in the input. Wrap the update in
  `db.transaction` (precedent: `createProject` `:79-99`). When `isActive` is being
  set to `false`, call `stopTimersForProject(tx, project.id)` inside the same
  transaction before/with the `isActive` flip. When set to `true` (reactivate), no
  timer action (stopped timers remain stopped — data preserved). Slug remains
  non-editable.
- **Why:** Atomicity — deactivation + timer teardown must not partially succeed.
  Reactivation is a pure flag flip (acceptance: full access restored, all data
  intact).
- **Code reference:** `db.transaction` idiom `createProject` (`:79-99`),
  `createAndAddMember` (`membershipService.ts:201-241`); `stopTimersForProject`
  from step 1.

#### 5. Route + Zod: extend `PATCH /:slug` with `isActive`

- **File:** `backend/src/routes/projects.routes.ts` (`PATCH /:slug`, `:104-122`),
  `backend/src/routes/projects.schema.ts` (`updateProjectBodySchema`, `:33-46`)
- **What:** Add `isActive: z.boolean().optional()` to `updateProjectBodySchema`.
  No new route, no new middleware — the existing `authenticate → requirePlatformAdmin() → validateRequest`
  stack already gates the toggle to Platform Admins only
  (`requirePlatformAdmin.ts:18-30`).
- **Why:** Mirrors the user-deactivation precedent exactly: `PATCH /:userId/blocked`
  body `{ blocked: z.boolean() }` (`users.routes.ts:58-74`) +
  `userService.setUserBlocked` (`userService.ts:169-187`). Reusing `PATCH /:slug`
  keeps Project Settings → General's single save surface coherent and avoids a
  bespoke verb pair.
- **Code reference:** `updateProjectBodySchema` (`projects.schema.ts:33-46`),
  `slugParamSchema` (`projects.schema.ts:28-32`), `requirePlatformAdmin`
  (`middleware/requirePlatformAdmin.ts`).

### Frontend Changes

#### 6. `Project` type + `UpdateProjectDto`

- **File:** `frontend/src/types/project.ts` (`:3-11`, `:19-23`)
- **What:** Add `isActive: boolean` to `Project`; add `isActive?: boolean` to
  `UpdateProjectDto`.
- **Why:** The deactivated state must be representable; `useProject(slug)` already
  feeds the full `project` object into `ProjectSettingsPage` (`:47`) and the picker.

#### 7. API client + hooks

- **File:** `frontend/src/api/projects.ts` (`updateProject`, `:20-26`),
  `frontend/src/hooks/useUpdateProject.ts`
- **What:** No new API verb — `updateProject` already PATCHes `/projects/:slug`;
  the `isActive` field now rides along once the DTO is extended. Add thin
  `useDeactivateProject(slug)` / `useReactivateProject(slug)` wrappers (or a single
  `useToggleProjectActive`) that call `updateProject(slug, { isActive: false|true })`
  and on success invalidate `projectKeys.detail(slug)` and `projectKeys.lists()`
  (`frontend/src/api/queryKeys.ts:1-6`). Keep the `meta.revertMessage` toast pattern
  (`useUpdateProject.ts:11`).
- **Why:** Distinct UI action, but reuses the existing PATCH mutation machinery.
  List invalidation re-filters the picker (PA keeps the row, now badged; members
  drop it).

#### 8. Project Settings → General: PA-only Deactivate/Reactivate section

- **File:** `frontend/src/pages/ProjectSettingsPage.tsx` (`renderGeneral`, `:166-186`)
- **What:** Inside the General pane fragment, add a new `<section>` rendered
  **only when `isPlatformAdmin`** (NOT `canManage` — Project Admins must not
  deactivate; `isPlatformAdmin` is already wired at `:48`). Show a
  `ConfirmDialog`-guarded button: "Deactivate project" (`variant="destructive"`)
  when `project.isActive`, else "Reactivate project". Wire `pending` to the
  mutation's `isPending` and `onConfirm` to the deactivate/reactivate mutation.
  Include copy explaining that running timers will be stopped and members will
  lose access (data preserved).
- **Why:** Matches the ticket's "Project Settings → General, Platform Admins only"
  requirement. `ConfirmDialog` precedent: `DeleteTicketConfirm.tsx` /
  `ConfirmDiscardDialog.tsx`; `ConfirmDialog` API at `frontend/src/components/ConfirmDialog.tsx:24-52`.

#### 9. "Deactivated" badge in picker + projects page (PA only)

- **File:** `frontend/src/components/ProjectPicker.tsx` (`:113-145`),
  `frontend/src/pages/ProjectsPage.tsx` (`:85-95`)
- **What:** When `p.isActive === false && isAdmin`, render
  `<Badge variant="secondary">Deactivated</Badge>` next to the project name.
  Members/ProjectAdmins never receive deactivated rows (backend filter), so they
  never see the badge.
- **Why:** PA visibility requirement ("badged"). Reuse the existing
  `Badge` component (`frontend/src/components/ui/Badge.tsx`, `variant="secondary"`
  or `"warning"`).

#### 10. Member empty-state: "You have no Projects. Contact Admin"

- **File:** `frontend/src/pages/ProjectsPage.tsx` (empty branch, `:62-78`)
- **What:** When `useProjects()` returns `[]` and `!isAdmin`, render `EmptyState`
  with title "You have no Projects" and description "Contact Admin" (no action —
  Members cannot create). Keep the existing "Create project" action for PAs.
- **Why:** A member whose only project is deactivated now gets `[]` from the
  backend and lands here. `EmptyState` is the existing reusable component
  (`frontend/src/components/EmptyState.tsx`).

#### 11. Clear stale `lastSelectedSlug`

- **File:** `frontend/src/stores/useProjectStore.ts`
- **What:** When the deactivate mutation succeeds for the currently-selected
  project, clear `lastSelectedSlug` so `IndexRedirect` (`routes/index.tsx:18-27`)
  does not land the user on a 404 `BoardPage`. (Alternatively, rely on the deep-link
  non-revealing deny to fall through — but clearing is cleaner UX.)
- **Why:** Prevents a deactivated project from being re-selected on next app load.
  Profile menu / Account Settings remain reachable regardless (they live in
  `TopNav.tsx:185-243`, under `AppLayout` with no `/projects/:slug` dependency;
  routes `/settings`, `/account` at `routes/index.tsx:121-130`).

## Edge Cases & Risks

- **Anti-oracle integrity:** the deactivated-project FORBIDDEN must be byte-identical
  to the not-found / non-member throw so a non-PA cannot distinguish "deactivated"
  from "never existed". Single chokepoint = `getProjectBySlug`. Verified by reusing
  the exact `ErrorCode.FORBIDDEN` + literal.
- **PA must not be denied:** the `isActive` gate in `getProjectBySlug` is placed
  **after** the PA bypass (`:107-109`); PA branch of `listProjects` is unchanged.
- **Race — timer started during deactivation:** a user could `startTimer` in the
  window between the tx read and commit. Mitigated by (a) running the `isActive`
  flip and `stopTimersForProject` in one `db.transaction`, and (b) post-commit the
  project is unreachable (list filter + non-revealing deny) so no new starts can
  occur on its tickets.
- **Multiple users' timers:** the partial unique index `time_entries_one_active`
  (`schema.ts:335-340`) allows one open timer per user; a project may have many
  users each with one open timer. The single bulk `UPDATE … WHERE endTime IS NULL`
  handles all of them.
- **Reactivation does not restart timers:** correctly preserved stopped timers stay
  stopped (data intact). Reactivation only flips `isActive=true` and restores
  access — acceptance criterion satisfied.
- **Stale `lastSelectedSlug`:** handled in step 11 to avoid a 404 land.
- **Board polling for an already-selected deactivated project:** out of scope for
  realtime push (polling-only codebase). The non-revealing deny on next poll/refresh
  will redirect the affected user.
- **No migration risk:** column already shipped; no `drizzle-kit generate` needed.
- **Audit:** none added — consistent with `setUserBlocked` precedent; `requestLogger`
  records the PATCH.

## Testing

*Vitest + supertest (backend); Vitest + Testing Library (frontend). Table-driven,
one behavior per test; co-locate `*.test.ts(x)` next to source.*

- **Unit — `timerService.test.ts` (new file):** mock `../db/client` per the
  `projectService.test.ts` `vi.hoisted` fluent-mock convention; assert
  `stopTimersForProject` issues an `UPDATE timeEntries SET endTime=… WHERE
  endTime IS NULL AND ticketId IN (tickets where projectId=…)`.
- **Unit — `projectService.test.ts` (append):**
  - `deactivateProject` path: asserts `isActive=false` write + that
    `stopTimersForProject` is invoked within the same tx (table-driven: active→inactive,
    already-inactive idempotency).
  - `reactivateProject` path: asserts `isActive=true` write and **no** timer call.
  - `listProjects` member branch filters out `isActive=false` rows; PA branch still
    returns them.
  - `getProjectBySlug` non-PA on deactivated row throws the identical FORBIDDEN;
    PA still returns the row.
- **HTTP — `projects.routes.test.ts`:**
  - `PATCH /:slug { isActive: false }` as PA → 200, project deactivated, running
    timers in the project stopped.
  - `PATCH /:slug { isActive: false }` as non-PA (Member/ProjectAdmin) → 403
    (`requirePlatformAdmin`).
  - Deep-link deny: `GET /:slug`, `GET /:slug/board`, `GET /:slug/tickets/…` for a
    deactivated project as a non-PA → 403 with the **exact** `FORBIDDEN_PROJECT`
    literal already declared at `projects.routes.test.ts:99-102` (assert identical
    body to a non-member access of a random slug).
  - Reactivate (`{ isActive: true }`) as PA restores member access (previously-denying
    deep-link now 200).
- **Frontend — `ProjectSettingsPage` + `ProjectPicker` + `ProjectsPage`:**
  - General pane shows Deactivate button only when `isPlatformAdmin` && `isActive`;
    Reactivate when `!isActive`. Non-PA sees no section.
  - ConfirmDialog flows: confirm triggers mutation; pending state disables button.
  - Picker renders "Deactivated" badge only for PA on `isActive=false` rows.
  - `ProjectsPage` empty branch: non-PA with `[]` shows "You have no Projects.
    Contact Admin" with no action; PA with `[]` shows create form.
- **Manual verification:** deactivate a project with a running timer (as another
  user) — confirm timer stops; confirm the member's picker no longer lists it;
  confirm a deep link 403s non-revealingly for the member; confirm PA still sees
  it badged and can reactivate; confirm a member of only that project lands on the
  empty state and can still open profile menu / Account Settings; confirm a member
  of other projects is unaffected; reactivate and confirm full access restored.

## Acceptance Criteria

- [ ] Deactivating a project stops its running timers at that moment (atomic tx).
- [ ] The project disappears from the picker for Members/ProjectAdmins but remains
      visible (badged "Deactivated") to Platform Admins.
- [ ] All data (tickets, labels, members, time entries) is intact after
      deactivation and after reactivation.
- [ ] A member of only that project sees the "You have no Projects. Contact Admin"
      empty state and can still reach the profile menu / Account Settings.
- [ ] A member of other projects is not affected.
- [ ] Deep links to the deactivated project are denied **non-revealingly** to
      project users (identical FORBIDDEN to not-found/non-member).
- [ ] Reactivation restores full access for project users.
- [ ] No DB migration is generated (column already exists).

## Open Questions  *(optional)*

- None blocking. (Badge variant choice — `secondary` vs `warning` — is a cosmetic
  detail left to the implementer; `warning` better signals the impaired state.)

## Out of Scope

- Realtime/websocket push of timer-stop to active users (codebase is polling-only).
- Project-level audit logging (no audit table/enum exists; reversible toggles are
  not audited per `setUserBlocked` precedent — a separate cross-cutting effort).
- Archival/cleanup of deactivated projects or their data.
- Any change to the `projects.isActive` schema or a new migration.
- A dedicated `POST /:slug/deactivate` / `POST /:slug/reactivate` verb pair (the
  `PATCH /:slug { isActive }` shape is preferred for precedent consistency).
