# Implementation Plan — SLYK-02

**Ticket:** `docs/deliverables/SLYK-02.md`
**Type:** Feature (frontend-refinement heavy, with targeted backend additions)
**Title:** Member Management (project-scoped)
**Generated:** 2026-06-30

---

## Summary

SLYK-02 delivers project-scoped **Member Management** hosted inside Project Settings. It is largely a **frontend refinement** of the membership surface that SLYK-01 already shipped (three-tier role model + `projectMembers.routes.ts` with GET/POST/PATCH/DELETE, `POST /:slug/members` add-existing, `POST /:slug/members/new` create+add, and a basic `ProjectMembersPage.tsx`). The deliverable reshapes that surface into a **members table** with live **basic search**, **row actions** (change role, remove-with-confirm), a smart **"Add Member" modal** driven by a single email input that **auto-searches** and branches into four outcomes, and a rename of **"User Management" → "Member Management"**.

The Add-Member modal's auto-search requires a backend capability that **does not yet exist**: a read-only **user-by-email lookup** with no side effects. Two backend correctness gaps must also be closed so the modal's branch messaging matches the spec: (1) a **Platform-Admin email** must surface *"Already a Member"* **without** inserting a membership row, and (2) creating a user with a **duplicate email** must return a clean *"already exists"* error instead of a raw driver error. This plan covers those backend additions plus the full frontend rebuild of the members surface.

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| Route | `backend/src/routes/users.routes.ts` | Add `GET /lookup?email=` (new read endpoint powering modal auto-search). |
| Route schema | `backend/src/routes/users.schema.ts` | Zod schema for the lookup query param. |
| Service | `backend/src/services/userService.ts` | Expose a read-only `lookupUserByEmail` shape; used by the lookup route. |
| Service | `backend/src/services/membershipService.ts` | Platform-Admin "Already a Member" pre-check on `addExistingMember`; map email unique-violation → `CONFLICT` on `createAndAddMember`. |
| API client | `frontend/src/api/members.ts` (and/or `api/users.ts`) | Add `lookupUserByEmail(email)` client function. |
| Types | `frontend/src/types/member.ts` / `types/user.ts` | Add lookup-result type (`{ exists, user? }`). |
| Hook | `frontend/src/hooks/useProjectMembers.ts` | Add a debounced lookup query hook for the modal. |
| Component | `frontend/src/components/MemberTable.tsx` *(new)* | Shared members table primitive (avatar, name/email, role, status, row actions). |
| Component | `frontend/src/components/AddMemberModal.tsx` *(new)* | Single email-input modal with auto-search + 4 branches. |
| Component | `frontend/src/components/ConfirmDialog.tsx` *(new)* | Generic confirm dialog extracted from `DeleteTicketConfirm`/`ConfirmDiscardDialog`. |
| Component | `frontend/src/components/MemberSearchInput.tsx` *(new, optional)* | Basic search filter input. |
| Page | `frontend/src/pages/ProjectMembersPage.tsx` | Rebuild: heading "Member Management", table, search, modal trigger, confirm-on-remove. |
| Page | `frontend/src/pages/SettingsPage.tsx` | Rename H1 + copy "User Management" → "Member Management". |
| Test | `backend/src/services/membershipService.test.ts` | Add: PA "already a member", duplicate-email → CONFLICT. |
| Test | `backend/src/routes/users.routes.test.ts` *(new/extend)* | Lookup endpoint cases (exists, not-found, non-PA 403). |
| Test | `frontend/src/pages/ProjectMembersPage.test.tsx` + new component tests | Search filter, modal 4 branches, confirm-on-remove, role change. |

---

## Proposed Implementation

Build order: **backend gaps first** (lookup + correctness), then **shared frontend primitives**, then the **page rebuild**, then the **rename**.

### Backend Changes

#### 1. New read-only user-by-email lookup endpoint
- **File:** `backend/src/routes/users.routes.ts` (extend), schema in `backend/src/routes/users.schema.ts`.
- **What:** Add `GET /api/users/lookup?email=<email>`. Middleware chain: `authenticate` → `validateRequest({ query })` → **`requireProjectAdminScoped()`-equivalent guard** (see note) → handler. Response:
  - user found → `success({ exists: true, user: { id, email, fullName, displayName, isPlatformAdmin } })` (200, **no avatarUrl needed for the preview** — but include if cheap).
  - user not found → `success({ exists: false })` (200).
- **Why:** The Add-Member modal must determine branch state (exists-on-platform vs not) **without** mutating anything. Currently the only email-resolution path is *inside* `POST /:slug/members`, which immediately adds (`projectMembers.routes.ts:66-69`). `userService.findUserByEmail` (`userService.ts:18-22`) is a service helper with no route.
- **Guard note — RBAC:** `requireProjectAdmin` resolves project from `req.params.slug`; a `/users/lookup` route has no slug. Two clean options:
  - **(A — preferred)** Mount the lookup under the project scope: `GET /api/projects/:slug/members/lookup?email=` in `projectMembers.routes.ts`, reusing the existing `requireProjectMember()` → `requireProjectAdmin()` chain (`projectMembers.routes.ts:6-16`). This keeps the layered RBAC intact (only admins of the current project can probe) and is the natural home per the ticket ("available to Platform Admins and Project Admins of the current project").
  - (B) Add a global `/users/lookup` gated by `requirePlatformAdmin()` — but that excludes Project Admins, breaking the spec. **Reject B.**
  - **Choose A.** Add Zod `lookupMemberSchema` to `projectMembers.schema.ts` (`{ params: slugParamSchema, query: z.object({ email: memberEmailSchema }) }`).
- **Privacy / anti-oracle:** This endpoint does reveal "is this email a platform user?" to project admins. That is an inherent requirement of the feature (the modal branches on it). Keep the response minimal (no `tokenVersion`, `googleId`, `blocked`). No non-revealing masking needed since the caller is already an authenticated admin.

#### 2. Platform-Admin "Already a Member" pre-check
- **File:** `backend/src/services/membershipService.ts` — `addExistingMember` (around `:163-218`).
- **What:** Before attempting the insert, if the resolved user `isPlatformAdmin === true`, throw `AppError(CONFLICT, 'Already a member')` (message to match the spec's "Already a Member" — keep server text, map to user-facing string client-side). Do **not** insert a row for a Platform Admin.
- **Why:** Spec: "Email is a Platform Admin → 'Already a Member' error (platform admins are default members of all projects)." Current code is idempotent and would **insert** a real membership row for a PA (`membershipService.ts:163-218`), which contradicts the "default member, no row needed" model enforced at the gate layer (`requireProjectMember.ts:46-52`).
- **Code reference:** `findUserByEmail` already fetched in the handler; surface `isPlatformAdmin` from the user row and short-circuit. Keep the existing 23505→role-update idempotency for genuine non-PA re-adds.
- **Open decision:** Should adding a PA be a hard error (CONFLICT) or silently no-op success? Spec says **error** ("Already a Member" error). Implement as CONFLICT 409.

#### 3. Duplicate-email → clean CONFLICT
- **File:** `backend/src/services/membershipService.ts` — `createAndAddMember` (`:220-267`).
- **What:** Wrap the `users` insert. On Postgres unique-violation (SQLSTATE `23505` on `users.email`), throw `AppError(CONFLICT, 'User already exists')`. This mirrors how `addExistingMember` handles membership PK conflicts.
- **Why:** Spec: duplicate email → *"already exists"*. Current `createAndAddMember` does not catch the email unique violation, so a duplicate surfaces as a raw 500 (driver error). `assertDomainAllowed` (`accessControl.ts:25-33`) already runs first for the *"domain not allowed"* (FORBIDDEN) path — keep that ordering.

#### 4. Tests (backend)
- **File:** `backend/src/services/membershipService.test.ts` (extend), `backend/src/routes/projectMembers.routes.test.ts` (extend or new).
- **Cases:**
  - `addExistingMember` with a Platform-Admin email → throws `CONFLICT` "Already a member", **no membership row inserted**.
  - `createAndAddMember` with an existing email → throws `CONFLICT` "User already exists".
  - `createAndAddMember` with disallowed domain → throws `FORBIDDEN` (regression guard, already true).
  - Lookup endpoint: exists → `{ exists:true, user:{...} }`; not-found → `{ exists:false }`; Project Member (non-admin) → 403; unauthenticated → 401.

### Frontend Changes

#### 5. API client + types for lookup
- **File:** `frontend/src/api/members.ts` (extend), `frontend/src/types/member.ts` (extend).
- **What:** Add `lookupMember(slug, email): Promise<LookupResult>` calling `GET /projects/:slug/members/lookup?email=` (option A). Type `LookupResult = { exists: boolean; user?: { id; email; fullName; displayName; isPlatformAdmin } }`. Reuse the `apiFetch` wrapper (`api/client.ts:91`).
- **Why:** Modal auto-search needs a typed call.

#### 6. Debounced lookup hook
- **File:** `frontend/src/hooks/useProjectMembers.ts` (extend).
- **What:** `useLookupMember(slug)` — a `useQuery` keyed on `[slug, email]`, enabled only when `email` is a valid email, `staleTime` short, **debounced** (e.g. 300ms via a small `useDebouncedValue` helper or `useQuery` + manual gate). Returns `{ data, isFetching }`.
- **Why:** The modal auto-searches as the user types; React Query debouncing avoids request storms. Set query `retry: false` so a 4xx doesn't retry; rely on the response shape rather than exceptions for the "exists" determination (the endpoint returns 200 in both branches).
- **Convention:** query errors are **not** globally toasted (only mutations are — `lib/queryClient.ts:25-31`), so inline handling stays clean.

#### 7. Generic `ConfirmDialog` primitive
- **File:** `frontend/src/components/ConfirmDialog.tsx` *(new)*.
- **What:** `ConfirmDialog({ isOpen, onClose, onConfirm, title, message, confirmLabel, cancelLabel, variant, pending })` built on the shared `Modal` (`components/Modal.tsx:28-100`) — extract the shape already used by `DeleteTicketConfirm.tsx:6-46` and `ConfirmDiscardDialog.tsx:13-36`. Use `variant="destructive"` for remove.
- **Why:** Spec requires confirmation for **remove from project** and for both Add-Member **confirmation prompts** (exists-on-platform confirm; create-new-user confirm). No generic confirm dialog exists today; the remove action currently fires immediately (`ProjectMembersPage.tsx:274-280`).

#### 8. `MemberTable` primitive
- **File:** `frontend/src/components/MemberTable.tsx` *(new)*.
- **What:** Columns: **User** (Avatar + fullName + displayName + email), **Project Role** (inline `RoleSelect` for admins, badge for non-admins), **Status** (derived — see Edge Cases), **Actions** (change role select, remove button). Props: `members`, `canManage`, `currentUserId`, `onRoleChange`, `onRemove`. Reuse `Avatar` (`components/ui/Avatar.tsx`) or `AssigneeAvatar`.
- **Why:** Spec mandates a members **table**; current UI is a `<ul>` of `<Card>` rows (`ProjectMembersPage.tsx:104-113`). There is no shared table primitive in the app (the only `<table>` is hand-rolled inline in `SettingsPage.tsx:84-130`). Keep it styled with Tailwind tokens (`border-border`, `bg-background`, `text-muted-foreground`).
- **Self-lock guard:** preserve the existing behavior — cannot demote/remove self (`isSelf` disables the control).

#### 9. `AddMemberModal` (the core of the ticket)
- **File:** `frontend/src/components/AddMemberModal.tsx` *(new)*.
- **What:** Modal with a **single email input** that **auto-searches** via `useLookupMember(slug)`. While typing, show inline status. Once a valid email is entered and the lookup resolves, render one of **four branches**:
  1. **Already a member of this project** (check against the loaded roster client-side) → show *"Already a Member"* error, no action.
  2. **Platform Admin** (`user.isPlatformAdmin`) → show *"Already a Member"* error (default member of all projects).
  3. **Exists on platform** (`exists && !isPlatformAdmin && !alreadyMember`) → show user's details (avatar, name, email) + a **Project Role** selector (`Member`/`Project Admin`) + **confirmation prompt** ("Add N to this project?") → on confirm call `useAddMember` (`POST /:slug/members`) → success toast + close.
  4. **Does not exist** (`!exists`) → modal **expands** to show inputs: **Full Name**, **Display Name**, **Email (read-only, pre-filled)**, **Project Role** selector → submit enforces client-side validation → on submit call `useCreateAndAddMember` (`POST /:slug/members/new`); on success show confirm-before-final-commit if desired (spec lists a confirmation prompt for the create path) → success.
- **Error mapping (backend → modal message):**
  - `CONFLICT "Already a member"` (PA case, handled by branch 2 client-side pre-check too) → "Already a Member".
  - `FORBIDDEN "…allowed workspace"` (domain) → "domain not allowed".
  - `CONFLICT "User already exists"` (race duplicate) → "already exists".
- **Toast/inline decision:** The modal must show errors **inline inside the dialog**, not double-toast. The global `MutationCache.onError` (`lib/queryClient.ts:25-31`) toasts all mutation errors. **Opt out** by setting `meta: { suppressGlobalToast: true }` on these mutations (requires a tiny addition to `defaultMessage`/the cache to honor `meta`) **or** catch the error in the handler and swallow (returning early) so the cache never sees it. Prefer the `meta` opt-out as the project-wide convention going forward.
- **Confirmation prompts:** Use the new `ConfirmDialog` for both the "add existing" confirm and the "create new user" confirm.

#### 10. Basic search filter
- **File:** `frontend/src/pages/ProjectMembersPage.tsx` (or inline in `MemberTable`).
- **What:** A `TextInput` above the table; `useMemo` client-side filter over the roster by case-insensitive partial match on `fullName` **or** `displayName` **or** `email`. Live filter, no server round-trip (roster is already loaded via `useProjectMembers`).
- **Why:** Spec acceptance: "Searching by partial name or email filters the table live."

#### 11. Rebuild `ProjectMembersPage`
- **File:** `frontend/src/pages/ProjectMembersPage.tsx`.
- **What:**
  - Heading → **"Member Management"**.
  - Top-right **"Add Member"** button (visible only when `canManage = isPlatformAdmin || isProjectAdmin`, `:60`), opens `AddMemberModal`.
  - Remove the inline `<AddMemberSection>` card (`:93-95`, `:114-186`) and the two-mode toggle form.
  - Render `<MemberTable>` with search input.
  - Wire role-change via existing `useUpdateMemberRole`; wire remove via `useRemoveMember` **wrapped in `ConfirmDialog`**.
  - Preserve read-only fallback for non-managers.
- **Why:** Aligns the page with the spec's layout and removes the legacy inline add flow now that the modal owns it.

#### 12. Rename "User Management" → "Member Management"
- **File:** `frontend/src/pages/SettingsPage.tsx`.
- **What:** Update H1 (`:64`) and body copy (`:265`) from "User Management" → "Member Management"; update the matching assertion in `SettingsPage.test.tsx:30`.
- **Scope clarification:** There is **no sidebar/nav**; nav is a top navbar (`components/TopNav.tsx`) whose platform-admin entry is labeled **"Settings"** (`TopNav.tsx:57`) — that label is **not** "User Management" and should **not** change. Project members are reached from `ProjectSettingsPage`, not nav. So the rename is purely the page **heading + copy** (and the new project page heading). Flag in Open Questions if a nav entry rename was intended.

### Tests (frontend)
- `MemberTable.test.tsx`: renders rows; search filters by name and by email (table-driven); non-admin sees badge not select; self-lock disables self controls.
- `AddMemberModal.test.tsx`: **four branches** (table-driven) — already-member, platform-admin, exists-on-platform (confirm → add), does-not-exist (expand → fill → confirm → create); domain-not-allowed and already-exists error mapping.
- `ProjectMembersPage.test.tsx`: "Add Member" button visibility by role; remove opens confirm then deletes; role change mutation + invalidation.
- `ConfirmDialog.test.tsx`: a11y (Esc/backdrop per `blockBackdropClose`), confirm/cancel callbacks, pending state.

---

## Edge Cases & Risks

- **`status` column divergence:** The SLYK-02 table spec lists a **status** column, but `project_members` has no status column (`schema.ts:95-117`). Only `users.blocked` exists (a **global login gate**, not a per-membership status). **Decision needed** (see Open Questions). Recommended default for v1: derive status client-side — `Blocked` (from `users.blocked`, if surfaced) / `Active` (member row exists) — **without** a schema change. Out-of-scope: a real `project_members.status` column + migration.
- **Platform-Admin roster visibility:** `listProjectMembers` (`membershipService.ts:64-79`) does **not** UNION platform admins into the roster — PAs who aren't explicit members won't appear in the table. Spec implies PAs are "default members." If the table must show PAs, either UNION them server-side in `listProjectMembers` or merge client-side via a separate PA list. **Flag as an Open Question / likely in-scope.**
- **Double-toast risk:** Global `MutationCache.onError` (`queryClient.ts:25-31`) toasts every mutation error; the modal also shows inline errors. Must opt out (mutation `meta` or local swallow) to avoid duplicate toasts.
- **Lookup race / stale results:** Debounced lookup may resolve out of order if the user types fast. Key the query on email and discard stale via React Query's built-in key semantics; ignore results whose email !== current input.
- **Lookup privacy:** Reveals email-existence to project admins — acceptable per spec, but keep the response minimal and document the trust boundary.
- **Idempotency vs. error:** Backend change #2 converts "add a PA" from silent-success to CONFLICT. Any caller relying on the old idempotent behavior must handle 409. Only the members UI calls this today.
- **Self-demotion / last-admin:** Existing guards must remain (don't remove the last project admin / don't demote self). Preserve the current self-lock behavior.
- **Confirm-on-remove regression:** Today remove fires immediately; ensure no caller path skips the new confirm.
- **Race duplicate:** Even after the lookup says "does not exist," a concurrent create could 23505. Backend change #3 ensures a clean `CONFLICT` surfaces in the modal.

## Testing

*Follow project conventions — Vitest + supertest (backend) and Vitest + Testing Library (frontend); table-driven tests; one behavior per test; co-locate `*.test.ts(x)` next to source.*

- **Unit tests (backend):** `membershipService` — PA "already a member" (no row inserted); duplicate-email → `CONFLICT`; disallowed-domain → `FORBIDDEN` (regression).
- **HTTP tests (backend):** lookup endpoint — exists/not-found/403/401; add-existing PA → 409; create-new duplicate → 409.
- **Integration tests:** Add-Member end-to-end flow against the real DB (stubbed data-access per project rules): create+add a brand-new user, then confirm they can authenticate and appear in this project's roster.
- **Frontend unit tests:** `MemberTable` search (table-driven by name/email), `AddMemberModal` four-branch table-driven suite incl. domain + duplicate error mapping, `ConfirmDialog` a11y + callbacks, `ProjectMembersPage` button-visibility + remove-confirm.
- **Manual verification:** Reproduce each Add-Member branch by hand (already-member email, a PA's email, an existing non-member email, a brand-new email); verify live search; verify role change + remove-with-confirm; verify the created user can subsequently Google-login and land in the project.

## Acceptance Criteria

- [ ] Searching by partial name **or** email filters the table live.
- [ ] Add-Member branch: email already a member of this project → *"Already a Member"*.
- [ ] Add-Member branch: email is a Platform Admin → *"Already a Member"* (no membership row created).
- [ ] Add-Member branch: email exists on platform → user details + role selector + confirmation → add → success.
- [ ] Add-Member branch: email does not exist → modal expands (Full Name, Display Name, read-only Email, Project Role) → create+add → success; newly created user can Google-login and land in this project.
- [ ] Wrong-domain create blocked with *"domain not allowed"*; duplicate-email create blocked with *"already exists"*.
- [ ] Role changes (Member ↔ Project Admin) and removals take effect immediately and are reflected in project access; removal uses a confirmation prompt and does **not** delete the platform user.
- [ ] "User Management" → "Member Management" rename applied (page heading + copy + test).

## Open Questions

1. **`status` column:** Does the table need a real per-membership status (invited/active/inactive), or is a derived status (Active / Blocked via `users.blocked`) sufficient for v1? Default plan: derived, no schema change.
2. **Platform Admins in roster:** Must the members table list Platform Admins as implicit members (they have access but no membership row)? If yes, decide server-side UNION vs client-side merge. Default plan: flag as likely in-scope but confirm.
3. **Nav label:** The rename target — is it just the page H1/copy (current plan), or is a nav entry label expected to change? (Today there is no "User Management" nav entry; the platform area nav label is "Settings".)
4. **Add-PA behavior:** Confirm hard error (CONFLICT "Already a Member") vs. silent no-op. Plan assumes hard error per spec wording ("error").

## Out of Scope

- A real `project_members.status` column + migration (derive status unless owner approves otherwise).
- Inviting users by email (tokenized invite flow) — SLYK-02 creates the user directly via Google-provisioned `createAndAddMember`.
- Bulk member import / CSV.
- Changes to the global `GET /api/users` platform-wide roster (the "Settings" page) beyond the heading rename.
- Extracting a generic shared `<Table>` primitive app-wide — `MemberTable` is purpose-built for members.
