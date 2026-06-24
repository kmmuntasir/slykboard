# Slykboard — Feature Breakdown

> Source of truth for scope: [`.docs/basic-PRD.md`](./basic-PRD.md). Slug: `SLYK`.
>
> This document decomposes the MVP into **small, shippable, sequential features**. Each
> feature is an independently mergeable increment that leaves the system in a working state
> and is a prerequisite for later features. Backend vs. frontend split is intentionally omitted —
> the implementing developer decides that. Features are grouped into phases only to show the
> dependency chain; within a phase, order still matters where a `Depends on` says so.

## How to read a feature

| Field | Meaning |
| --- | --- |
| **Goal** | One-sentence outcome. |
| **Ships** | What an end user can concretely do once merged. |
| **Depends on** | Features that must land first. |
| **PRD** | Linked requirement(s) from the PRD. |
| **Acceptance** | Observable checks — treat as the feature's definition of done. |
| **Edge cases** | Traps and gaps the PRD leaves open. Resolve before/during implementation. |

---

## Feature Index

> **Categories:** 🏗 Scaffolding · 🔧 Infrastructure · ✨ Feature · ⬆ Enhancement · 🚀 Deployment
>
> - 🏗 **Scaffolding** — empty skeleton, tooling, project bootstrap. No domain logic.
> - 🔧 **Infrastructure** — cross-cutting runtime plumbing (DB, API contract, auth guards) every feature leans on.
> - ✨ **Feature** — distinct user-facing capability; an end user does something concrete.
> - ⬆ **Enhancement** — refines an existing feature; not standalone.
> - 🚀 **Deployment** — packaging, hosting, release.
>
> Track progress by checking items off. Spec per feature lives in the sections below.

**Phase 0 — Foundation**
- [x] **F01** Monorepo scaffolding & dev tooling — 🏗 Scaffolding · _deps: —_
- [x] **F02** Database connection & migration pipeline — 🔧 Infrastructure · _deps: F01_
- [x] **F03** API contract layer (envelope, errors, validation) — 🔧 Infrastructure · _deps: F01_
- [x] **F04** Frontend app shell (routing, layout, providers) — 🏗 Scaffolding · _deps: F01_

**Phase 1 — Identity & Access**
- [x] **F05** Google SSO login + JWT issuance — ✨ Feature · _deps: F02, F03, F04_ — DONE (T1-T14 ✅; live Google SSO smoke passed 2026-06-22)
- [x] **F06** Onboarding, workspace restriction & roles — ✨ Feature · _deps: F05_ — DONE (T1-T6 ✅; live Google SSO smoke passed 2026-06-22)
- [x] **F07** Session lifecycle & auth guards — ✨ Feature · _deps: F05, F06_ — DONE (T1-T7 ✅; backend live smoke passed 2026-06-22; frontend browser smokes pending)

**Phase 2 — Projects & Board**
- [x] **F08** Projects: create, list, select, slug, columns — ✨ Feature · _deps: F07_
- [x] **F09** Board read (columns + cards) — ✨ Feature · _deps: F08_ — DONE (T1-T9 ✅; typecheck/lint/format/test/build 0/0/0/0/0; DB-integration smoke passed 2026-06-23)
- [x] **F10** Board auto-polling (30s) & conflict handling — ⬆ Enhancement · _deps: F09_ — DONE (T1-T4 ✅; T5 automated ✅ typecheck/test/build 129-pass/0/0; live browser smoke passed 2026-06-23)
- [x] **F11** Drag-and-drop with order persistence — ✨ Feature · _deps: F09_ — DONE (T1-T5 ✅; T6 automated ✅ typecheck/test/build 375-pass/0/0; live browser smoke passed 2026-06-23)

**Phase 3 — Tickets**
- [x] **F12** Ticket creation with sequential IDs — ✨ Feature · _deps: F09_ — DONE (T1-T9 ✅; typecheck/lint/test/build green; backend live smoke incl concurrency passed 2026-06-23; FE browser smoke passed 2026-06-23)
- [x] **F13** Ticket attributes: title, description, assignee, priority — ✨ Feature · _deps: F12_ — DONE (T1-T15 ✅; typecheck/lint/test/build green; live browser smoke passed 2026-06-23)
- [x] **F14** Labels catalog (project-scoped, color-coded) — ✨ Feature · _deps: F12_ — DONE (T1-T10 ✅; typecheck/lint/format/test/build green; 0006 migration applied + backfill verified; live browser smoke passed 2026-06-24)
- [x] **F15** Checklist — ✨ Feature · _deps: F12_ — DONE (T1-T9 ✅ + 2 bugfixes: create-404 label-tx visibility, TicketCard labels/checklist guard; 0007 migration applied; typecheck/lint/format/test/build green; live browser smoke passed 2026-06-24)
- [x] **F16** Ticket detail modal (view & edit) — ✨ Feature · _deps: F13, F14, F15_ — DONE (T1-T8 ✅; getTicket creator/assignee join, Modal a11y primitive, TicketDetailModal, deep-link nested route, unsaved guard; no migration; typecheck/lint/format/test/build green; live browser smoke passed 2026-06-24)
- [x] **F17** Ticket permissions (admin-only delete) — ✨ Feature · _deps: F16, F18_ — DONE (T1-T6 ✅; soft delete (deletedAt + migration 0009), DELETE route requireRole(ADMIN)→204, board-only isNull filter, DeleteTicketConfirm, admin-only button gate, deleted-ticket read-only form + Deleted banner, apiFetch 204 guard, logs/labels retained (archived); typecheck/lint/format/test/build green; live browser smoke passed 2026-06-24)

**Phase 4 — Audit Trail**
- [x] **F18** Activity log capture — ✨ Feature · _deps: F12_ — DONE (T1-T7 ✅; ActivityLogs table + 6-value enum incl. LABELS_CHANGED (migration 0008), recordActivity + diffTicketChanges, CREATED/STATUS_CHANGED/PRIORITY_CHANGED/ASSIGNEE_CHANGED/LABELS_CHANGED/CONTENT_UPDATED captured in-txn, label readable-name diff, no-op skip, capture-only; 399 BE tests; typecheck/lint/format/build green; live psql smoke passed 2026-06-24)
- [x] **F19** Activity feed UI — ✨ Feature · _deps: F18_ — DONE (T1-T6 ✅; backend-enriched GET activity route (actor/column/assignee resolved), ActivityFeed+ActivityItem components (show-more, relative+absolute time), describeActivity sentence-switch (REQ-5.2 grammar), CONTENT_UPDATED distinguishes title/description; no schema/migration; typecheck/lint/format/test/build green; live browser smoke passed 2026-06-24)

**Phase 5 — Time Tracking**
- [x] **F20** Server-authoritative timer (start/stop, browser-independent) — ✨ Feature · _deps: F16_ — DONE (T1-T8 ✅; TimeEntries table + partial unique index (migration 0010), timerService (auto-stop-on-start, admin-stop-any, deleteTicket auto-stop), GET /api/time clock-skew, TimerControls (live elapsed from server offset), TimeLog (entries list + total), no abandoned-timer (runs indefinitely); typecheck/lint/format/test/build green; live browser smoke passed 2026-06-24)
- [x] **F21** Manual time entry — ✨ Feature · _deps: F20_ — DONE (T1-T4 ✅; addManualEntry + POST /timer/manual, parseDuration util (2h 30m → minutes), ManualEntryForm, TimeLog Manual badge + "Logged:" display, total includes manual durations; no schema/migration; typecheck/lint/format/test/build green; live browser smoke passed 2026-06-24)
- [x] **F22** Time log list per ticket — ✨ Feature · _deps: F20_ — DONE (T1-T3 ✅; user resolution via leftJoin users in getTimeEntries, TimeLog shows who tracked each entry + avatar, "Unknown user" for deleted; ~90% shipped via F20+F21; no schema/migration; typecheck/lint/format/test/build green; live browser smoke passed 2026-06-25)

**Phase 6 — Reporting**
- [x] **F23** Time log report (per-user, weekly/monthly) — ✨ Feature · _deps: F22_ — DONE (T1-T3 ✅; reportService per-user aggregation (UTC weekly/monthly windows), GET /api/reports/time route, ReportsPage UI (toggle + nav + per-user table), open timer excluded, all authenticated users; no schema/migration; typecheck/lint/format/test/build green; live browser smoke passed 2026-06-25)
- [ ] **F24** Ticket summary report (resolved by priority) — ✨ Feature · _deps: F12_

**Phase 7 — Admin & Polish**
- [ ] **F25** User & role management (admin) — ✨ Feature · _deps: F06_
- [ ] **F26** Board search & filter — ⬆ Enhancement · _deps: F13, F14_
- [ ] **F27** Project settings (rename, columns) — ✨ Feature · _deps: F08_
- [ ] **F28** UX polish: empty / loading / error / 404 / 403 — ⬆ Enhancement · _deps: F07_
- [ ] **F29** Deployment & self-host packaging — 🚀 Deployment · _deps: all above_
- [ ] **F30** Human-readable ticket URLs (SLYK-NNN) — ⬆ Enhancement · _deps: F16_

---

## Phase 0 — Foundation

### F01 — Monorepo scaffolding & dev tooling
**Goal:** A runnable full-stack skeleton with shared conventions.
**Ships:** `npm run dev` boots a Vite React frontend and an Express backend; both respond to a health check. ESLint + Prettier + TypeScript configured end-to-end.
**Depends on:** —
**PRD:** §5 (Tech Constraints)
**Acceptance:**
- `frontend/` and `backend/` packages exist with the structure defined in `.claude/rules/js-development-rules.md`.
- Root scripts start both apps concurrently in dev.
- `.env.example` files committed for both packages; real `.env` gitignored.
- Lint + format pass on an empty change.

**Edge cases:**
- Decide monorepo tool: npm workspaces (simplest) vs. pnpm/Turborepo. Pick one and document.
- Node 24+, React 19+, Express 5 — pin versions to avoid drift.
- `.gitignore` must include `node_modules/`, `.env`, `dist/`, `build/`, `*.log`, `.DS_Store`.

### F02 — Database connection & migration pipeline
**Goal:** A versioned PostgreSQL schema the app can evolve safely.
**Ships:** `db:push` / migrate command applies the `Users` table; backend can open and close a pooled connection.
**Depends on:** F01
**PRD:** §5, §8.1
**Acceptance:**
- Postgres reachable locally (Docker compose or Supabase local).
- Migration tool wired (Prisma / Drizzle / raw `pg` + migration runner — pick one, document it).
- `Users` table matches PRD §8.1 and seeds cleanly.
- Connection pool configured with sensible defaults; app shuts down gracefully (no hanging sockets).

**Edge cases:**
- Pick the **client once** — every later feature inherits it.
- Connection retry/backoff on cold start so the app doesn't crash if DB is briefly unreachable.
- TZ: store all timestamps as UTC (`timestamptz`). Critical for time tracking (F20+).

### F03 — API contract layer
**Goal:** Every endpoint speaks one consistent shape.
**Ships:** A reusable response envelope, global error middleware, request validation, and request logging.
**Depends on:** F01
**PRD:** js-development-rules.md (Route/Middleware conventions)
**Acceptance:**
- Success envelope (e.g. `{ data }`) and error envelope (`{ error: { code, message, details? } }`) used everywhere.
- Central error handler maps validation errors → 400, auth → 401, not-found → 404, server → 500.
- Zod (or Joi) validation at the edge for request bodies/params.
- CORS locked to `FRONTEND_URL` only.

**Edge cases:**
- Never leak stack traces or internal messages in production responses.
- Decide error `code` vocabulary up front (e.g. `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION_FAILED`) so the frontend can branch on it.

### F04 — Frontend app shell
**Goal:** A navigable, themed UI with global providers and no real data yet.
**Ships:** App boots to a layout with top nav, placeholder routes (Board / Reports / Settings), TanStack Query provider, Zustand store skeleton, Tailwind theme, loading + error boundary.
**Depends on:** F01
**PRD:** §5, js-development-rules.md
**Acceptance:**
- Routes defined and guarded by an auth-gate placeholder.
- API client wrapper (`api/`) with base URL from `VITE_API_BASE_URL` and auth header injection.
- TanStack Query client mounted; Zustand store created.
- Works at mobile and desktop widths.

**Edge cases:**
- Decide path aliases (`@/`) up front — expensive to retrofit.
- Environment variables read once into a typed config module, not scattered `import.meta.env` calls.

---

## Phase 1 — Identity & Access

### F05 — Google SSO login + JWT issuance
**Goal:** Users sign in with Google; the backend issues a session.
**Ships:** "Sign in with Google" button → OAuth redirect → backend exchanges code → JWT returned → user upserted into `Users`.
**Depends on:** F02, F03, F04
**PRD:** REQ-1.1, §5
**Acceptance:**
- Google OAuth 2.0 flow (Authorization Code, PKCE) completes end to end.
- `google_id`, `email`, `full_name`, `avatar_url` populated on first login; updated on subsequent logins.
- JWT signed with `JWT_SECRET`, contains `sub`, `email`, `role`, exp claim.
- Logout clears the token client-side.

**Edge cases:**
- Token storage: HttpOnly cookie vs. in-memory + refresh token. **Recommend HttpOnly cookie** to survive reload without exposing token to JS.
- Clock skew between Google and your server can reject `iat` — validate with leeway.
- Account with no avatar/name → fallback initials avatar.

### F06 — Onboarding, workspace restriction & roles
**Goal:** Control who may enter and what role they get.
**Ships:** If `ALLOWED_DOMAIN` is set, only that G-Suite workspace can log in; the **first-ever user** is auto-promoted to `ADMIN`; later users join as `MEMBER` (unless whitelisted differently).
**Depends on:** F05
**PRD:** REQ-1.2, REQ-1.3
**Acceptance:**
- Email domain checked against `ALLOWED_DOMAIN` when set; mismatch → 403 with clear message.
- Empty `Users` table → first signup becomes `ADMIN` atomically.
- Subsequent signups → `MEMBER`.
- Role persisted on the `Users` row and carried in the JWT.

**Edge cases:**
- Race: two simultaneous first-signups could both grab admin. Guard with a counted query + unique constraint or a singleton "bootstrap admin" env var.
- Domain check must run on the verified Google email, not a raw claim (verify the ID token).
- Existing user whose domain later becomes disallowed — **DECISION: grandfather.** Domain check runs only on the insert (signup) path; the conflict path (existing `googleId`) skips it, so tightening `ALLOWED_DOMAIN` never locks out current members. Retroactive eviction belongs to the manual whitelist/blocklist → **F25**.
- Manual email whitelist (allow/block specific emails regardless of domain) — **DECISION: deferred to F25.** F06 ships ONLY `ALLOWED_DOMAIN` enforcement (Option A). F25 owns whitelist management per its spec.
- Mid-session role-change invalidation (`token_version` / `ver` claim) — **DECISION: deferred to F07.** F06's single-admin model has the only role transition at insert time (before any token exists), so no stale token to invalidate; `/me` re-fetch from the DB mitigates the symptom. F25 multi-admin demotion is the scenario that needs `token_version`.

> Full decision matrix + task breakdown: [F06 task plan](./features/F06-onboarding-workspace-roles/F06-onboarding-workspace-roles-tasks.md) (§3 decisions, §9 sign-off).

### F07 — Session lifecycle & auth guards
**Goal:** Authenticated state is enforced end to end.
**Ships:** Protected routes redirect unauthenticated users to login; API rejects requests without a valid JWT; logout invalidates the session; token refresh keeps users signed in.
**Depends on:** F05, F06
**PRD:** REQ-1.1, REQ-1.3
**Acceptance:**
- `authenticate` middleware rejects missing/expired tokens with 401.
- Frontend auth context exposes current user + role; gates UI by role.
- Refresh strategy keeps sessions alive across reloads without forcing re-login every few minutes.
- Logout clears server/client session state.

**Edge cases:**
- Role changed by an admin (F25) must take effect — either short JWT TTL or a token-version check. F06 defers `token_version` here (single-admin model has no mid-session role change yet).
- 401 from any API call → global interceptor logs the user out once, not per-request.
- Concurrent tabs: logout in one tab should reflect in others (storage event or broadcast).

---

## Phase 2 — Projects & Board

### F08 — Projects: create, list, select, slug, columns
**Goal:** Users can spin up a project and define its board columns.
**Ships:** Admin (or any user — decide) creates a project with a name + unique slug + ordered column list; project picker lists projects; selecting one routes to its board.
**Depends on:** F07
**PRD:** REQ-2.2, §8.2
**Acceptance:**
- `Projects` table per PRD §8.2 with `columns` JSONB (ordered array of `{id, name}`).
- Slug uniqueness enforced; slug format validated (uppercase alphanumerics, e.g. `SLYK`).
- Project create + list + select flows work; current project persisted (URL param or store).

**Edge cases:**
- Slug collisions / reserved slugs (e.g. `api`, `reports`).
- Who may create projects? PRD says Admin manages settings — decide: admin-only creation, or any member. Document.
- Column identity: store stable column `id`s, not just names, so renaming a column doesn't orphan tickets (tickets reference `status_column`).
- PRD has no `ProjectMembers` table → MVP treats all authenticated users as members of all projects. Flag if that's unacceptable.

### F09 — Board read (columns + cards)
**Goal:** Render a project as a Kanban board.
**Ships:** Board view fetches columns + tickets, renders cards grouped by `status_column`, sorted by position.
**Depends on:** F08
**PRD:** REQ-2.1, REQ-2.3
**Acceptance:**
- `GET /projects/:id/board` returns columns + tickets in one payload.
- Cards show title, ticket ID, assignee avatar, priority badge, labels.
- Empty column renders an empty state.

**Edge cases:**
- Ticket whose `status_column` no longer exists (deleted column) → still render (e.g. under an "Unsorted" bucket) rather than disappear.
- Large boards → paginate or virtualize columns; decide a soft cap and log it.

### F10 — Board auto-polling (30s) & conflict handling
**Goal:** The board reflects other users' changes without manual refresh.
**Ships:** TanStack Query refetches the board every 30s; concurrent edits are reconciled without clobbering the user's in-flight work.
**Depends on:** F09
**PRD:** REQ-2.4
**Acceptance:**
- `POLL_INTERVAL_SECONDS` (default 30) drives the refetch interval.
- A card another user moved appears in its new column within one poll.
- Polling pauses when the tab is hidden and resumes on focus (avoid pointless load + token churn).

**Edge cases:**
- User mid-drag when a poll returns → don't yank the card out from under them (suppress refetch or defer apply until drop).
- Optimistic UI must roll back on 409/error.
- Stale data race: last-write-wins is acceptable for MVP; document it.

### F11 — Drag-and-drop with order persistence
**Goal:** Reorder cards within a column and move them across columns; positions persist.
**Ships:** `@hello-pangea/dnd` drag (horizontal across columns, vertical within); drop persists new `status_column` and order; UI updates optimistically.
**Depends on:** F09
**PRD:** REQ-2.3
**Acceptance:**
- Moving a card calls an endpoint that updates `status_column` + position atomically.
- Reordering within a column updates neighbor positions without full rewrites where possible.
- Drag is smooth (optimistic) and rolls back on failure.

**Edge cases:**
- **PRD schema has no `position`/`sort_order` field on `Tickets`** — must add one (e.g. `position DOUBLE PRECISION` or integer gap). Flag as a schema delta.
- Concurrent reorders can collide → re-read board after a failed persist.
- Dropping into a column the user lacks permission for → reject with toast (tie to F17).
- Moving the only card out of a column → column stays (columns are project config, not derived from tickets).

---

## Phase 3 — Tickets

### F12 — Ticket creation with sequential IDs
**Goal:** Create a ticket with a deterministic, project-scoped ID.
**Ships:** "New ticket" → backend assigns next `ticket_number` per project → displayed as `[SLUG]-[NNN]` (e.g. `SLYK-101`).
**Depends on:** F09
**PRD:** REQ-3.1, §8.3
**Acceptance:**
- `Tickets` table per PRD §8.3; `ticket_number` increments per project, never globally.
- ID format `[SLUG]-[NNN]` shown in UI and stable.
- New card lands at the top/bottom of the first column (decide and document).
- `creator_id` set from the authenticated user; `status_column` defaults to the project's first column.

**Edge cases:**
- Concurrency: two creates at once must not share a number. Use a per-project counter row + `SELECT ... FOR UPDATE`, or a `(project_id, ticket_number)` unique constraint with retry.
- Starting number (e.g. 100 vs 1) — decide.
- Numbering gap on a later delete — acceptable, IDs are not reused. Document.
- Slug in the ID must reflect the project slug, which can be renamed (F27) — decide whether historical IDs change (they should not).

### F13 — Ticket attributes: title, description, assignee, priority
**Goal:** Capture the core editable fields.
**Ships:** A ticket can hold title, rich-text description, an assignee (user dropdown), `created_by` (system), and a priority enum.
**Depends on:** F12
**PRD:** REQ-3.2, §8.3
**Acceptance:**
- Title (required, non-empty), description (WYSIWYG rich text stored as HTML/Markdown).
- Assignee dropdown populated from project users; nullable.
- Priority enum `LOW | MEDIUM | HIGH | URGENT | CRITICAL`; default `MEDIUM`.
- All edits persisted; validation enforces enum + length limits.

**Edge cases:**
- WYSIWYG editor choice (TipTap / Lexical) — pick one, sanitize on save (strip scripts) to prevent stored XSS.
- Assignee removed from workspace (F25) → keep `assignee_id`, show "unknown user" rather than 500.
- Description stored as one format; rendering must handle empty/rich safely.
- Title length cap; description size cap.

### F14 — Labels catalog (project-scoped, color-coded)
**Goal:** Reusable, color-coded labels users can attach to tickets.
**Ships:** A project has a managed set of labels (name + color); tickets reference multiple; board + modal show color chips.
**Depends on:** F12
**PRD:** REQ-3.2
**Acceptance:**
- `Labels` table (project-scoped): `{id, project_id, name, color}`.
- `Tickets.labels` references label IDs (or stores denormalized — decide).
- Multi-select on the ticket; chips render with correct color on card + modal.
- Manage labels (create/rename/recolor) from project settings.

**Edge cases:**
- **PRD schema lacks a `Labels` table** — must add. Flag as schema delta.
- Deleting a label → cascade-remove from all tickets (don't leave dangling chips).
- Color validation (hex); ensure contrast/legibility with text.
- Duplicate label names within a project — allow or reject? Document.

### F15 — Checklist
**Goal:** A toggleable list of sub-items on a ticket.
**Ships:** Add/remove/toggle checklist items; progress indicator (x/y) on the card and in the modal.
**Depends on:** F12
**PRD:** REQ-3.2
**Acceptance:**
- `checklist` JSONB array of `{id, text, done}`.
- Add, edit, delete, toggle items; persist each change.
- Card shows checklist progress.

**Edge cases:**
- Concurrent edits to the same checklist JSONB can clobber — merge by item id or last-write-wins; document.
- Item text length cap; reasonable max item count.
- Reordering checklist items (drag) — in scope or defer? Recommend MVP: no reorder.

### F16 — Ticket detail modal (view & edit)
**Goal:** A single surface to read and edit everything about a ticket.
**Ships:** Clicking a card opens a modal showing all attributes, checklist, and (later) history + time; edits save in place.
**Depends on:** F13, F14, F15
**PRD:** REQ-3.2, User Journey 1
**Acceptance:**
- Modal shows title, ID, description, assignee, priority, labels, checklist, creator, timestamps.
- Inline editing of each field with optimistic save + rollback on error.
- Closes cleanly; preserves unsaved-confirm guard if mid-edit.
**Edge cases:**
- Modal state vs. board state drift (polling updates while modal open) — reconcile without losing user input.
- Deep-link to a ticket (URL param) so it can be shared/opened directly.
- Keyboard: Esc to close, focus trap, scroll lock.

### F17 — Ticket permissions (admin-only delete)
**Goal:** Enforce role rules on ticket mutations.
**Ships:** Any authenticated user can create/edit tickets; only `ADMIN` can delete; UI hides the delete control for members.
**Depends on:** F16, F18
**PRD:** REQ-3.3
**Acceptance:**
- Delete endpoint returns 403 for non-admins; success for admins.
- Confirm dialog before destructive delete.
- Deleting cascades: time entries + activity logs for that ticket are removed or archived (decide).

**Edge cases:**
- Permission check must be server-side, not just UI-hidden.
- Soft vs. hard delete — MVP can hard delete after confirm, but decide audit implications (history would lose context).
- Running timer on a deleted ticket → stop/forbid deletion, or auto-stop (see F20).

---

## Phase 4 — Audit Trail

### F18 — Activity log capture
**Goal:** Attribute changes are recorded as structured events.
**Ships:** Changing status, priority, assignee, or labels writes an `ActivityLogs` row with `old_value`/`new_value`; title/description edits write a generic `CONTENT_UPDATED` entry; creation writes `CREATED`.
**Depends on:** F12
**PRD:** REQ-5.2, REQ-5.3, §8.5
**Acceptance:**
- `ActivityLogs` table per PRD §8.5.
- Action types: `CREATED`, `STATUS_CHANGED`, `PRIORITY_CHANGED`, `ASSIGNEE_CHANGED`, `LABELS_CHANGED` (add to enum), `CONTENT_UPDATED`.
- Events authored with the acting user + timestamp.

**Edge cases:**
- Capture changes in the same transaction as the update so logs never diverge from data.
- Label changes: store a readable diff (added/removed names), not raw ID arrays.
- No-op edits (saving unchanged fields) must not create spam logs.
- Timer events are **not** in scope for activity (PRD enum excludes them) — they live in `TimeEntries`. Document so nobody adds them later by mistake.

### F19 — Activity feed UI
**Goal:** Visible history per ticket.
**Ships:** Ticket modal renders a reverse-chronological activity feed with human-readable sentences ("Muntasir changed Priority from Low to High").
**Depends on:** F18
**PRD:** REQ-5.1, REQ-5.2, User Journey 3
**Acceptance:**
- Feed shows actor, action, old→new, and relative/absolute time.
- Renders inside the ticket modal; paginates or lazy-loads if long.
- Localized time display from UTC storage.

**Edge cases:**
- Names of since-removed users/labels must still render gracefully.
- Very long feeds → cap initial render + "show more".

---

## Phase 5 — Time Tracking

### F20 — Server-authoritative timer (start/stop, browser-independent)
**Goal:** Tracked time is correct regardless of client state.
**Ships:** "Start" records `start_time` server-side; "Stop" records `end_time`; the frontend only displays elapsed; closing the browser/PC does not lose time — reopening shows correct elapsed and allows stop.
**Depends on:** F16
**PRD:** REQ-4.1, REQ-4.2, REQ-4.3, §8.4
**Acceptance:**
- `TimeEntries` table per PRD §8.4.
- Start writes `{user_id, ticket_id, start_time}`; stop fills `end_time`.
- Elapsed displayed client-side = `now - start_time` (recomputed from server time on load).
- A user has at most **one** active (open) timer globally.

**Edge cases:**
- Single-active-timer enforcement server-side (unique partial index on `user_id where end_time is null`, or explicit check + lock).
- Starting a new timer auto-stops the previous one (or rejects — decide). Document.
- Clock skew: client computes elapsed from server-issued `start_time` and a server-time offset fetched at load, not `Date.now()` blindly.
- Abandoned timers (user never stops) → a reconciliation job or "discard/claim" UI to close stale open entries. Decide policy (e.g. cap at 24h).
- Switching tickets / moving a timed ticket across columns does not stop the timer.
- Deleting a ticket with a running timer → forbid or auto-stop (tie to F17).

### F21 — Manual time entry
**Goal:** Log time without running the timer.
**Ships:** User adds a manual entry: duration + optional note (e.g. "Logged 2h 30m for research").
**Depends on:** F20
**PRD:** REQ-4.4
**Acceptance:**
- Manual entry creates a `TimeEntries` row with `manual_entry_minutes` set and `start_time`/`end_time` null (or derived).
- Duration input supports `2h 30m` style parsing + validation.
- Optional description stored.

**Edge cases:**
- Validation: non-negative, sane upper bound.
- Manual entries vs. timer entries must be distinguishable in lists/reports.
- Date attribution: manual entry needs an optional "worked on" date for correct reporting.

### F22 — Time log list per ticket
**Goal:** See all time logged against a ticket.
**Ships:** Ticket modal shows every time entry (who, duration, type, note).
**Depends on:** F20
**PRD:** §8.4
**Acceptance:**
- Lists timer + manual entries with user, duration, source, note, time.
- Shows total time on the ticket.

**Edge cases:**
- Long-running open entry shown as "in progress" with live elapsed.
- Permissions: can members see others' entries? PRD implies yes for reports — confirm and apply here too.

---

## Phase 6 — Reporting

### F23 — Time log report (per-user, weekly/monthly)
**Goal:** Workload visibility per team member.
**Ships:** Reports view shows total tracked hours per user, filterable by weekly or monthly window.
**Depends on:** F22
**PRD:** REQ-6.1, REQ-6.2, User Journey 2
**Acceptance:**
- Time aggregated per user within the selected window (sum of timer durations + manual minutes).
- Weekly / Monthly toggle; current + previous periods selectable.
- Totals formatted as hours/minutes.

**Edge cases:**
- Define week boundaries (e.g. Mon–Sun) and TZ for windowing — must match the UTC storage.
- Open timer (no `end_time`) — exclude or count up-to-now? Decide.
- Access control: PRD leaves "all users vs admin-only" open — decide and enforce server-side.
- Performance: index `TimeEntries` on `(user_id, start_time)` for windowed aggregation.

### F24 — Ticket summary report (resolved by priority)
**Goal:** Throughput visibility per member.
**Ships:** Reports view shows, per member in the window, count of tickets worked/resolved broken down by priority.
**Depends on:** F12
**PRD:** REQ-6.1, REQ-6.3, User Journey 2
**Acceptance:**
- Counts per (user, priority) in the window.
- Define "resolved/worked" — moved to a terminal column? assigned + timed? Decide and document.

**Edge cases:**
- "Resolved" semantics depend on column config (which column is Done?) — needs a column flag or convention.
- Ticket touched by multiple assignees over time — attribute to final assignee, or all? Decide.
- Window boundary (assign date vs. resolve date) — pick one and be consistent.

---

## Phase 7 — Admin & Polish

### F25 — User & role management (admin)
**Goal:** Admins govern membership.
**Ships:** Admin view lists users, promotes/demotes roles, and manages the manual whitelist.
**Depends on:** F06
**PRD:** REQ-1.2, REQ-1.3
**Acceptance:**
- Admin can change a user's role (`ADMIN` ↔ `MEMBER`).
- Whitelist management (allow/block specific emails regardless of domain).
- Cannot demote yourself if you're the last admin (prevent lockout).

**Edge cases:**
- Last-admin protection (server-enforced).
- Role change invalidation of the target's session (see F07 token-version note).
- Removing access for a user with active tickets/timers — keep their historical data, mark user inactive rather than delete.

### F26 — Board search & filter
**Goal:** Find tickets fast on growing boards.
**Ships:** Filter board by assignee, priority, label; free-text search over title.
**Depends on:** F13, F14
**PRD:** User Journey 1 (implied usability)
**Acceptance:**
- Filters combine (assignee + priority + label).
- Search matches ticket title (and ID).
- Cleared filters restore full board.

**Edge cases:**
- Empty result state.
- Server-side vs. client-side filtering — decide based on board size.
- Filtering + polling interplay (don't lose active filters on refetch).

### F27 — Project settings (rename, columns)
**Goal:** Evolve a project after creation.
**Ships:** Admin edits project name, slug rules, and columns (add/rename/reorder/delete).
**Depends on:** F08
**PRD:** REQ-2.2
**Acceptance:**
- Columns editable with stable IDs (rename keeps tickets attached).
- Add/reorder/delete columns; deleting a column moves its tickets to a chosen column or blocks deletion while non-empty (decide).
- Slug renames don't break historical ticket IDs.

**Edge cases:**
- Deleting a non-empty column — block, or force a destination column.
- Deleting the last column — block.
- Slug rename: old slug URLs break — redirect or disallow rename.

### F28 — UX polish: empty / loading / error / 404 / 403
**Goal:** Every state a user can hit is intentional.
**Ships:** Skeletons on load, friendly empty states, error retries, dedicated 404 and 403 pages, toast notifications.
**Depends on:** F07
**PRD:** §3 (frictionless UX)
**Acceptance:**
- Loading skeletons for board + modal.
- Empty states with clear CTAs (no project → "Create project"; empty board → "Add a ticket").
- Error boundaries + retry affordance on failed fetches.
- 404 for unknown routes/tickets; 403 for forbidden actions.

**Edge cases:**
- Offline / network drop → visible state, not silent failure.
- Optimistic-update rollbacks surfaced as toasts.

### F29 — Deployment & self-host packaging
**Goal:** Anyone can run Slykboard.
**Ships:** Dockerized backend + frontend, `docker-compose` with Postgres, env documentation, one-command self-host; Render (backend) + Vercel (frontend) + Supabase (DB) deploy paths documented.
**Depends on:** all above
**PRD:** §3, §5, js-development-rules.md (Deployment)
**Acceptance:**
- `docker compose up` brings up a working stack.
- Production build of frontend served by backend or a static host with correct base path.
- All required env vars documented (`.env.example` complete + a deployment guide in `docs/`).
- Migrations run on startup or via a documented release step.

**Edge cases:**
- Secret management: `JWT_SECRET`, OAuth creds, `DATABASE_URL` must never be defaulted in prod.
- CORS + OAuth callback URL must match the deployed origin.
- Health check endpoint for Render/container orchestration.
- DB migration strategy on version upgrades (forward-only, documented rollback).

### F30 — Human-readable ticket URLs (SLYK-NNN)
**Goal:** The ticket detail deep-link uses the human-readable ID `SLYK-NNN` instead of the raw UUID.
**Ships:** URL is `/projects/:slug/tickets/SLYK-4` (readable, shareable); the backend resolves the project + ticket number to the ticket.
**Depends on:** F16
**PRD:** REQ-3.1 (ID format `[SLUG]-[NNN]`)
**Acceptance:**
- Ticket detail route param is the display ID (`SLYK-4`), not the UUID.
- Backend resolves a ticket by (project slug, ticket_number) — new lookup/route.
- Existing flows (card click, deep-link, browser back) keep working with the new URL shape.
**Edge cases:**
- Parse `SLUG-NNN` from the route param; validate format; reject malformed → 404.
- Slug in the ticket param vs the path `:slug` — decide: derive the number only, or validate the prefix matches the path slug.
- Slug rename (F27): historical `SLYK-4` URLs — ticket_number is stable; the URL slug may diverge from the current project slug. Decide redirect vs resolve-by-number.
- Backwards-compat: old `/tickets/<uuid>` deep-links — redirect to the new format or 404.

---

## Schema deltas vs. PRD (resolve during F02 / per-feature)

The PRD §8 schema is a draft. These additions are required for the features above — track them explicitly:

| Delta | Reason | Feature |
| --- | --- | --- |
| `Tickets.position` (sort order) | Required for vertical card reordering. | F11 |
| `Labels` table (project-scoped, color) | Color-coded labels need a managed source. | F14 |
| `ProjectMembers` (optional) | PRD has none → all users see all projects. Add only if project isolation is required. | F08 |
| `TimeEntries` partial unique index on `user_id` where `end_time IS NULL` | Enforce single active timer. | F20 |
| `ActivityLogs.action_type` add `LABELS_CHANGED` | Label edits are an audited attribute change. | F18 |
| Column identity (`columns` JSONB as `{id, name}`) | Renaming a column must not orphan tickets. | F08 |
| `users_one_admin` partial unique index on `role` WHERE `role='ADMIN'` | Race-safe first-admin guarantee — at most one ADMIN row (DB-enforced). | F06 |
| `tickets.deletedAt` (soft-delete tombstone) | Admin-only delete is soft: NULL = live; set on delete; board filters `isNull(deletedAt)`. Deleted ticket retained + accessible via direct URL (read-only form). | F17 |

---

## Cross-cutting decisions to make up front

1. **ORM/client**: Prisma vs. Drizzle vs. raw `pg` — decide in F02, never again.
2. **Auth token storage**: HttpOnly cookie (recommended) vs. local memory + refresh.
3. **Who creates projects / tickets**: admin-only project creation? any-member ticket creation? (PRD: any member can create/edit tickets; admin manages settings.)
4. **"Resolved" definition**: which column(s) count as terminal, for F24.
5. **Stale open timers**: cap + reconciliation policy for abandoned timers (F20).
6. **Reports access**: all users vs. admin-only (PRD leaves open).
7. **Soft vs. hard delete**: affects audit history integrity (F17).

---

## Explicitly deferred (post-MVP, per PRD §4 & §9)

- Native mobile apps.
- Custom ticket fields / dynamic priority levels.
- RBAC beyond Admin/Member.
- Real-time WebSocket sync (polling used instead).
- Description content diffing (only _that_ a change occurred is logged).
- Webhook / Slack / Discord notifications.
- GitHub / GitLab PR integration (auto-move on merge).
- Workflow automation (e.g. checklist-complete → Review).
- CSV / PDF report export.
