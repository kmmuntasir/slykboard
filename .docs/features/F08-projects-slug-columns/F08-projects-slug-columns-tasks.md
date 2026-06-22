# F08 — Projects: create, list, select, slug, columns: Plan + Task Breakdown

> **Feature:** F08 — Projects: create, list, select, slug, columns (Phase 1 — Board Foundation)
> **Feature index:** [`features.md`](../../features.md)
> **Slug:** `SLYK` · **Depends on:** F07 (merged) · **PRD ref:** REQ-2.2, PRD §8.2
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), `.claude/rules/{js-development-rules,js-style-guide,js-testing-rules,git-guidelines,persona}.md`, plus dependency task doc: [F07](../F07-session-lifecycle-auth-guards/F07-session-lifecycle-auth-guards-tasks.md)

---

## 1. F08 Recap

**Goal:** Authenticated users can spin up a project with a unique slug and an ordered column list; any authed member can list projects and select one to route to its board.

**Ships:** An ADMIN creates a project (name + uppercase alphanumeric slug + ordered `{id,name}` columns, with sensible defaults); any authenticated member sees the project list; selecting a project navigates to `/projects/:slug`; the "current project" is persisted via URL param (primary) + a Zustand "last selected" store (for `/` redirect).

**Acceptance (definition of done):**

1. `Projects` table per PRD §8.2 exists: `id uuid PK`, `name text`, `slug text unique`, `columns jsonb` (ordered array of `{id, name}`), plus F08-added `creator_id` FK, `created_at`, `updated_at`.
2. Slug uniqueness enforced at DB (`unique`) + service pre-check (`CONFLICT`/409 on collision); slug format validated (`^[A-Z][A-Z0-9]{1,15}$`); reserved slugs blocked.
3. Create flow: `POST /api/projects` (ADMIN-only via `requireRole('ADMIN')`) accepts name + slug + optional columns (defaults applied); returns the created project.
4. List flow: `GET /api/projects` (any authed user) returns all projects.
5. Select flow: `GET /api/projects/:slug` (any authed user) returns the project; frontend navigates to `/projects/:slug`.
6. Column identity = stable `id`s (`crypto.randomUUID()`); renaming a column's `name` does NOT orphan tickets (id is the stable handle).
7. Current project persisted via URL param `/projects/:slug`; optional Zustand `useProjectStore` records `lastSelectedSlug` so `/` redirects to the last board.
8. (Edge resolutions below are part of DoD.)

**Edge cases — resolved up front:**

- **Slug collisions** → **Decision:** DB `unique` constraint (D-Slug-Uniqueness) + service-layer pre-check returning `CONFLICT`/409 with a `details` field naming the colliding slug. DB constraint is the authoritative guard; service pre-check gives a cleaner error than a raw PG unique violation.
- **Reserved slugs** → **Decision:** block `API,AUTH,HEALTH,REPORTS,SETTINGS,LOGIN,NEW,ADMIN` (D-Reserved-Slugs) via `RESERVED_SLUGS` set in `backend/src/utils/slug.ts`; service rejects with `VALIDATION_FAILED`/400.
- **Who may create projects** → **Decision:** ADMIN-only `POST` via `authenticate` + `requireRole('ADMIN')` (D-Who-Creates). Rationale: PRD REQ-1.3 two-role model; `requireRole` exists (F07) but unmounted — F08 is its first mount. **Sign-off flagged (§9a).**
- **Column identity / rename orphans** → **Decision:** `columns` = JSONB ordered array of `{id, name}` where `id = crypto.randomUUID()` (D-Column-Identity). Tickets (future F09+) reference column `id`, not `name`; renaming a column updates `name` only. PRD §8.2 specified a string array; F08 upgrades to `{id,name}` objects (schema delta vs PRD — documented §8).
- **No `ProjectMembers` table** → **Decision:** Defer (D-ProjectMembers). All authed users see all projects (no per-project membership). PRD §8 omits this table. **Sign-off flagged (§9b).**
- **Default columns when caller omits** → **Decision:** service supplies `[{name:'To Do'},{name:'In Progress'},{name:'Done'}]` with generated `id`s (D-Default-Columns). Caller may supply a custom ordered list. REQ-2.2.

**Scope boundary (explicit deferrals):**

- **`ProjectMembers` table (per-project membership/roles)** → a later feature (likely F25 or a dedicated access-control feature). F08 treats all authed users as members of all projects.
- **Board view (tickets, drag-and-drop, polling)** → **F09+**. F08 ships the project shell + column definition; tickets land next.
- **Column add/remove/reorder API** → F08 creates columns at project-create time only. Mutating columns post-create is F09+ (the `{id,name}` identity scheme is chosen precisely to make this safe later).
- **Project update/delete (archive)** → future feature. F08 ships create + list + get.

---

## 2. Codebase Analysis Summary

- **State:** **Greenfield for projects.** F05/F06/F07 (SSO, onboarding, session lifecycle, role gates) are merged on `main`. No `Projects` table, route, service, store, picker, or slug util exists. F08 is the first board-foundation feature.
- **Existing structure F08 builds on (with path citations):**
  - **ORM Drizzle 0.45 (pg-core):** `backend/src/db/schema.ts`. Only `Users` + `roleEnum` exist (`:9-34`). `Users`: `id uuid PK`, `googleId`, `email`, `fullName`, `avatarUrl`, `role (roleEnum default 'MEMBER' notNull)`, `tokenVersion` (F07), `createdAt`, `updatedAt`. `usersOneAdminIdx` partial unique index (F06). Migrations applied: `0000`, `0001`, `0002`. Migration runner `backend/src/db/migrate.ts`; scripts `npm run db:generate`, `npm run db:migrate` (drizzle-kit). DB client `backend/src/db/client.ts`.
  - **App entry:** `backend/src/index.ts`. MW order: helmet → cors (`credentials:true`, `origin: env.frontendUrl`) → requestLogger → express.json → `/api/auth` → `/health` → `notFound` → `errorHandler`. F08 adds `app.use('/api/projects', projectsRouter)` after `/api/auth` (~L48).
  - **Envelope:** `backend/src/utils/envelope.ts`. Success `{data}`, error `{error:{code,message,details?}}`. Closed `ErrorCode`: `VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, INTERNAL_ERROR`. `codeToStatus`: VALIDATION_FAILED→400, UNAUTHENTICATED→401, FORBIDDEN→403, NOT_FOUND→404, CONFLICT→409. F08 uses VALIDATION_FAILED, FORBIDDEN, NOT_FOUND, CONFLICT.
  - **`AppError`:** `backend/src/utils/appError.ts:18-33`. Constructor `(code, message, details?)`. Error MW `errorMiddleware.ts:9-39` maps `AppError` → envelope + status.
  - **Validation MW:** `backend/src/middleware/validateRequest.ts:33-66`. `validateRequest({ body?, params?, query? })` factory; schemas co-located `routes/*.schema.ts` (ref `auth.schema.ts`). Zod v4.
  - **Auth MW:** `authenticate` `backend/src/middleware/auth.ts:9-43` (F07 `ver` compare included) → `req.user={id,email,role}` (`types/express.d.ts:1-11`). `requireRole(...roles)` `backend/src/middleware/requireRole.ts:9-23` (F07, throws `FORBIDDEN`→403; **UNMOUNTED — F08 first mount**). JWT claims `{sub,email,role,ver}`.
  - **Data-access convention:** `services/` directory exists (F07 `tokenVersion.ts`). `repositories/` is empty by convention — F08 uses `services/projectService.ts` (D-Data-Access-Layer).
  - **Frontend API client:** `frontend/src/api/client.ts:45` `apiFetch<T>(path, init?)` — token auto-injected from `useAuthStore`, 401 interceptor (F07) inherited, `/auth/*` exempt. `ApiClientError({code, status, details})`.
  - **QueryClient:** `frontend/src/lib/queryClient.ts` — `staleTime 30_000`, `retry 3`, `refetchOnWindowFocus true`, 401 retry suppressed.
  - **Store pattern:** `frontend/src/stores/useAuthStore.ts` — Zustand + `persist` (`'slyk-auth'`). F08 mirrors this for `useProjectStore` (`'slyk-project'`, optional persist).
  - **Router:** React Router 7, `frontend/src/routes/index.tsx:21-49`. `<RequireAuth>`, `<RequireRole role="ADMIN">` (F07), `<AppLayout>`. Routes: `/login`, `/`, `/reports`, `/settings` (admin-gated). F08 adds `/projects`, `/projects/:slug`.
  - **TopNav:** `frontend/src/components/TopNav.tsx` — nav links + sign-out. F08 adds a project picker dropdown.
  - **Env:** `frontend/src/config/env.ts` (`apiBaseUrl`, `googleClientId` via `VITE_*`). F08 adds NO env var.
- **Net-new logic F08 creates (no files yet):**
  - `backend/src/db/migrations/0003_*.sql` — `CREATE TABLE "Projects"`.
  - `backend/src/utils/slug.ts` — `isValidSlug`, `normalizeSlug`, `RESERVED_SLUGS`.
  - `backend/src/services/projectService.ts` — `createProject`, `listProjects`, `getProjectBySlug`.
  - `backend/src/routes/projects.schema.ts` — Zod create body + slug param.
  - `backend/src/routes/projects.routes.ts` — GET `/`, GET `/:slug`, POST `/`.
  - `frontend/src/types/project.ts` — `Project`, `Column`, `CreateProjectDto`.
  - `frontend/src/api/projects.ts` — `listProjects`, `getProjectBySlug`, `createProject`.
  - `frontend/src/hooks/useProjects.ts` — TanStack Query hooks + `projectKeys`.
  - `frontend/src/stores/useProjectStore.ts` — `lastSelectedSlug`.
  - `frontend/src/pages/ProjectsPage.tsx` — list + create form.
  - `frontend/src/components/ProjectPicker.tsx` — dropdown.
- **Prior art / partial work:** None for projects. F08 is the inaugural board-foundation feature.
- **File paths the plan references that do NOT exist yet (will be created):** listed above + co-located `*.test.ts(x)`.
- **File paths the plan MODIFIES (exist on `main`):**
  - `backend/src/db/schema.ts` (add `projects` table + `Column` type).
  - `backend/src/index.ts` (mount `projectsRouter`).
  - `frontend/src/routes/index.tsx` (add `/projects`, `/projects/:slug`; `/` redirect).
  - `frontend/src/components/TopNav.tsx` (picker dropdown).
- **Project rules this plan must satisfy:** `js-development-rules.md` (RESTful routes `/api/projects/:slug`, JSON envelope, layering routes→services, roles via `requireRole`, parameterized queries via Drizzle, env table — F08 adds no env var), `js-style-guide.md` (PascalCase components, camelCase hooks/utils, SCREAMING_SNAKE constants, 4-space JSX / 2-space TS, trailing commas, `import type`, `any` banned, no inline styles, no magic numbers, import order), `js-testing-rules.md` (Vitest, co-located, table-driven, RTL priority getByRole→getByLabelText→getByText→getByTestId, coverage >80% business / >70% components), `git-guidelines.md` (branch `feature/SLYK-F08-projects-slug-columns`, single-line commits `SLYK-F08: <msg>`, rebase-only), `persona.md` (React 19 + Express 5 + Postgres + Vite + Tailwind).
- **Hidden coupling to plan for:**
  - **MEMORY `drizzle-partial-index-enum-dollar1`:** `drizzle-kit generate` emits unapplyable `$1` SQL for the F06 enum partial index when regenerating. Incremental generate is diff-based so the bug *should not* fire on a pure additive `CREATE TABLE`, but T1 MUST inspect `0003_*.sql` and confirm no `WHERE "role" = $1`; if present, hand-edit to literal `'ADMIN'`.
  - **`requireRole('ADMIN')` first mount.** F07 shipped the middleware unmounted. F08's `POST /api/projects` is its first real consumer — the route is the seam that proves the middleware works end-to-end. T5 keeps `requireRole` REAL (not mocked) in route tests to exercise it.
  - **`creator_id` FK → `Users.id`.** PRD §8.2 omits this column. F08 adds it (aligns with PRD §8.3 Tickets having a creator/owner FK). Schema delta vs PRD — sign-off flagged (§9c).
  - **Timestamps.** PRD §8.2 omits `created_at`/`updated_at` on Projects. F08 adds them (aligns with `Users` schema). Sign-off flagged (§9d).
  - **Column `{id,name}` vs PRD string array.** PRD §8.2 says `columns` JSONB of strings. F08 upgrades to `{id,name}` objects for stable identity across renames (D-Column-Identity). This is the key schema delta — future F09+ tickets reference column `id`.
  - **`crypto.randomUUID()` server-side.** Node 24 has global `crypto.randomUUID()` — no import needed for id generation in the service.
  - **Express 5 async.** Rejected promises in async MW/routes auto-caught by `errorHandler`. No try/catch wrapper for control-flow throws.
  - **`verbatimModuleSyntax`.** Type-only imports use `import type` (`Column`, `CreateProjectDto`, `Project`).
  - **Zod v4.** Schemas co-located in `routes/*.schema.ts`; `validateRequest` mounts them.
  - **No env var added.** F08 needs no new env (DATABASE_URL already present). Document this explicitly so reviewers don't expect one.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale (cite source) |
|---|----------|--------|-----------|
| D-Column-Identity | **Column shape** | **`columns` = JSONB ordered array of `{id, name}`; `id = crypto.randomUUID()`** | Stable identity across renames — tickets (F09+) reference column `id`, not `name`, so renaming a column never orphans tickets. PRD §8.2 specified a string array; F08 upgrades (schema delta vs PRD). Cite features.md L213, L580, L220. |
| D-Who-Creates | **Who may POST a project** | **ADMIN-only via `authenticate` + `requireRole('ADMIN')`** | PRD REQ-1.3 two-role model; F07 `requireRole` exists unmounted — F08 first mount. Members LIST/SELECT. **Sign-off (§9a).** Cite PRD REQ-1.3 L48, `requireRole.ts:9`. |
| D-ProjectMembers | **Per-project membership** | **Defer — all authed users see all projects** | PRD §8 omits a `ProjectMembers` table; MVP treats workspace as flat. A later feature adds membership. **Sign-off (§9b).** Cite features.md L221/577. |
| D-Slug-Format | **Slug regex** | **`^[A-Z][A-Z0-9]{1,15}$` (len 2–16)** | Uppercase alphanumerics, starts with a letter. Normalize (upper + strip non-alnum) before uniqueness check so `'slyk'` input → `'SLYK'`. Cite features.md L214. |
| D-Reserved-Slugs | **Reserved slugs** | **Block `API,AUTH,HEALTH,REPORTS,SETTINGS,LOGIN,NEW,ADMIN`** | Route-namespace collisions. Cite features.md L218. |
| D-Slug-Uniqueness | **Uniqueness enforcement** | **DB `unique` constraint + service pre-check → `CONFLICT`/409** | DB constraint is authoritative; service pre-check yields a clean error envelope with `details` naming the slug. Cite `envelope.ts:5-12`. |
| D-Creator-FK | **`creator_id` column** | **Add `creator_id uuid NOT NULL REFERENCES "Users"(id)`** | PRD omits; aligns with §8.3 Tickets (creator/owner FK). Audit trail + future permission checks. **Sign-off (§9c) — schema delta vs PRD.** |
| D-Timestamps | **`created_at`/`updated_at`** | **Add both as `timestamptz NOT NULL`; `updated_at` via `$onUpdate`** | Aligns with `Users` schema (`schema.ts:9-34`). UTC. **Sign-off (§9d) — schema delta vs PRD.** |
| D-Current-Project | **Current project persistence** | **URL param `/projects/:slug` primary; Zustand `useProjectStore` for "last selected" → `/` redirect** | URL is the source of truth (shareable, reloadable); store is a UX convenience for the `/` landing. Cite features.md L215. |
| D-Data-Access-Layer | **Data-access module** | **`services/projectService.ts` (NOT `repositories/`)** | `repositories/` empty by convention; F07 established `services/` pattern. Cite codebase convention. |
| D-Default-Columns | **Default columns** | **`[{name:'To Do'},{name:'In Progress'},{name:'Done'}]` with randomUUID ids if caller omits** | Sensible Kanban default; caller may supply a custom ordered list. REQ-2.2 L53. |

> **Out of F08 scope (explicitly deferred):**
> - **`ProjectMembers` table (per-project membership/roles)** → a later access-control feature. F08 treats all authed users as members of all projects.
> - **Board view (tickets, DnD, polling)** → F09+.
> - **Column add/remove/reorder API** → F09+. F08 defines columns at create-time only (the `{id,name}` scheme makes future mutation safe).
> - **Project update/delete/archive** → future feature.

> **Owner sign-off needed:** D-Who-Creates (ADMIN-only POST?), D-ProjectMembers (defer membership?), D-Creator-FK (add `creator_id` vs PRD?), D-Timestamps (add timestamps vs PRD?). See §9.

---

## 4. Architecture Overview (Target Tree)

```
slykboard/                                                  # repo root
├── backend/
│   └── src/
│       ├── db/
│       │   ├── schema.ts                                   # MODIFY (T1) — add projects table + Column type
│       │   └── migrations/
│       │       └── 0003_<auto>.sql                         # NEW (T1) — CREATE TABLE "Projects"
│       ├── utils/
│       │   ├── slug.ts                                     # NEW (T2) — isValidSlug, normalizeSlug, RESERVED_SLUGS
│       │   └── slug.test.ts                                # NEW (T2)
│       ├── services/
│       │   ├── projectService.ts                           # NEW (T3) — createProject, listProjects, getProjectBySlug
│       │   └── projectService.test.ts                      # NEW (T3)
│       ├── routes/
│       │   ├── projects.schema.ts                          # NEW (T4) — Zod create body + slug param
│       │   ├── projects.routes.ts                          # NEW (T5) — GET /, GET /:slug, POST /
│       │   └── projects.routes.test.ts                     # NEW (T5)
│       └── index.ts                                        # MODIFY (T5) — mount /api/projects
└── frontend/
    └── src/
        ├── types/
        │   └── project.ts                                  # NEW (T6) — Project, Column, CreateProjectDto
        ├── api/
        │   ├── projects.ts                                 # NEW (T6) — listProjects, getProjectBySlug, createProject
        │   └── queryKeys.ts                                # NEW (T7) — projectKeys factory (or colocate in projects.ts)
        ├── hooks/
        │   ├── useProjects.ts                              # NEW (T7) — useProjects, useProject(slug)
        │   └── useProjects.test.ts                         # NEW (T7)
        ├── stores/
        │   └── useProjectStore.ts                          # NEW (T8) — lastSelectedSlug
        ├── pages/
        │   ├── ProjectsPage.tsx                            # NEW (T9) — list + create form
        │   └── ProjectsPage.test.tsx                       # NEW (T9)
        ├── components/
        │   ├── ProjectPicker.tsx                           # NEW (T9) — dropdown
        │   └── TopNav.tsx                                  # MODIFY (T10) — picker dropdown
        └── routes/
            └── index.tsx                                   # MODIFY (T10) — /projects, /projects/:slug, / redirect
```

**Request lifecycle (POST /api/projects, post-F08):**

1. Client `createProject({name, slug, columns?})` → `apiFetch('/projects', {method:'POST', body})` → Bearer injected.
2. `authenticate` (F07): verifies JWT + `ver` compare → `req.user={id,email,role}`.
3. `requireRole('ADMIN')` (F07, first mount): `req.user.role !== 'ADMIN'` → `FORBIDDEN`/403.
4. `validateRequest({body: createProjectBodySchema})`: Zod parses name/slug/columns → `VALIDATION_FAILED`/400 on bad shape.
5. Handler calls `projectService.createProject({name, slug, columns, creatorId: req.user.id})`:
   - `normalizeSlug(slug)` → uppercase; `isValidSlug` re-check; reserved check → `VALIDATION_FAILED`/400.
   - Defaults columns if omitted (randomUUID ids).
   - Pre-check uniqueness (`getProjectBySlug`) → `CONFLICT`/409 if exists.
   - `db.insert(projects)` → returns row.
6. Returns `{data: project}`.

**Select lifecycle (frontend, post-F08):**

1. `/projects` route → `ProjectsPage` → `useProjects()` (TanStack Query) → lists projects.
2. Click project → `setLastSelectedSlug(slug)` (Zustand) + `navigate('/projects/:slug')`.
3. `/projects/:slug` route (board placeholder) → reads `:slug` param → future F09 renders board. F08 renders a placeholder.

---

## 5. Parallelization Strategy

Tasks grouped into **4 batches** by dependency order. Within a batch, tasks touch **disjoint file sets** → zero merge conflicts. Backend (B1–B2) and frontend (B3) are disjoint trees → two developers, zero conflicts.

### Batch dependency diagram

```
              ┌─────────────────────────────────────────────────────────────┐
   Batch 1    │ T1  projects table + migration 0003                           │
   (foundation│     [db/schema.ts, db/migrations/0003_*.sql]                 │
   blocks all)│ T2  slug util + Column type                                   │
              │     [utils/slug.ts+test] (T1 & T2 disjoint: db vs utils —    │
              │      zero overlap; parallel ok)                              │
              └──────────────┬──────────────────────────────────────────────┘
                             │ (table + slug util exist)
                             ▼
              ┌─────────────────────────────────────────────────────────────┐
   Batch 2    │ T3  projectService (createProject/listProjects/getProjectBy  │
   (backend,  │      Slug; normalize+reserved+CONFLICT+defaults)             │
   after B1)  │     [services/projectService.ts+test]                        │
              │ T4  Zod schema (projects.schema.ts)                          │
              │     [routes/projects.schema.ts] (T3 & T4 disjoint: services  │
              │      vs routes — parallel ok)                                │
              └──────────────┬──────────────────────────────────────────────┘
                             │ (service + schema exist)
                             ▼
              ┌─────────────────────────────────────────────────────────────┐
   Batch 2    │ T5  routes (GET /, GET /:slug, POST /) + mount index.ts +    │
   (cont.)    │      supertest tests (REAL authenticate+requireRole, mock    │
              │      projectService)                                         │
              │     [routes/projects.routes.ts+test, index.ts]               │
              └──────────────┬──────────────────────────────────────────────┘
                             │ (backend API stable)
                             ▼
              ┌─────────────────────────────────────────────────────────────┐
   Batch 3    │ T6  api/projects.ts + types/project.ts                       │
   (frontend, │ T7  hooks/useProjects.ts + projectKeys                       │
   after API  │ T8  stores/useProjectStore.ts                                │
   stable)    │ T9  pages/ProjectsPage.tsx + components/ProjectPicker.tsx    │
              │ T10 routes/index.tsx wiring + TopNav.tsx picker              │
              │     (all disjoint files — split across devs)                 │
              └──────────────┬──────────────────────────────────────────────┘
                             │ (frontend complete)
                             ▼
              ┌─────────────────────────────────────────────────────────────┐
   Batch 4    │ T11 Acceptance gate (terminal)                                │
   (gate)     │     (no files; lint/typecheck/test/build/db:migrate + smoke) │
              └─────────────────────────────────────────────────────────────┘
```

- **B1 → B2 hard barrier:** service + routes depend on the table + slug util.
- **B2 (T5) → B3 hard barrier:** frontend api/hooks need the stable contract (endpoints + envelope shape).
- **Within B2: T3 ‖ T4 (disjoint).** T5 depends on both.
- **Within B3: T6 ‖ T7 ‖ T8 ‖ T9 ‖ T10 (disjoint files).** T9 (page/picker) consumes T6/T7/T8 types but can stub them in tests; final wiring in T10.

### Merge order rules

1. **B1: (T1 ‖ T2) merge first, any order.** Disjoint files. Both branch off `main`.
2. **B2: (T3 ‖ T4) merge second, any order; then T5.** T5 branches off post-T3/T4 `main`.
3. **B3: (T6 ‖ T7 ‖ T8 ‖ T9 ‖ T10) merge in parallel, any order after T5.** Disjoint frontend trees. Coordinate type contracts (T6 types are consumed by T7/T9; if split across devs, agree the `Project`/`Column`/`CreateProjectDto` shapes up front).
4. **B4 (T11) merges last.** Terminal verification; owns no files.

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | B1 | `backend/src/db/schema.ts`, `backend/src/db/migrations/0003_*.sql` | F07 | T2 |
| **T2** | B1 | `backend/src/utils/slug.ts` (NEW), `backend/src/utils/slug.test.ts` (NEW) | — | T1 |
| **T3** | B2 | `backend/src/services/projectService.ts` (NEW), `backend/src/services/projectService.test.ts` (NEW) | T1, T2 | T4 |
| **T4** | B2 | `backend/src/routes/projects.schema.ts` (NEW) | T2 | T3 |
| **T5** | B2 | `backend/src/routes/projects.routes.ts` (NEW), `backend/src/routes/projects.routes.test.ts` (NEW), `backend/src/index.ts` | T3, T4 | — (backend) |
| **T6** | B3 | `frontend/src/types/project.ts` (NEW), `frontend/src/api/projects.ts` (NEW) | T5 | T7, T8, T9, T10 |
| **T7** | B3 | `frontend/src/hooks/useProjects.ts` (NEW), `frontend/src/hooks/useProjects.test.ts` (NEW), `frontend/src/api/queryKeys.ts` (NEW) | T6 | T8, T9, T10 |
| **T8** | B3 | `frontend/src/stores/useProjectStore.ts` (NEW) | — | T6, T7, T9, T10 |
| **T9** | B3 | `frontend/src/pages/ProjectsPage.tsx` (NEW), `frontend/src/pages/ProjectsPage.test.tsx` (NEW), `frontend/src/components/ProjectPicker.tsx` (NEW) | T6, T7, T8 | T10 |
| **T10** | B3 | `frontend/src/routes/index.tsx`, `frontend/src/components/TopNav.tsx` | T9 | — (frontend) |
| **T11** | B4 | (no files — terminal verification) | T5, T10 | — |

### Developer assignment tracks

- **Solo (recommended):** (T1 ‖ T2) → (T3 ‖ T4) → T5 → (T6 ‖ T7 ‖ T8 ‖ T9 ‖ T10) → T11. ~2 days.
- **2 devs (max parallelism):**
  - **Dev-A (backend):** (T1 ‖ T2) → (T3 ‖ T4) → T5 → help T11.
  - **Dev-B (frontend):** waits for T5 contract, then (T6 ‖ T7 ‖ T8 ‖ T9 ‖ T10) → help T11.
  - Merge order: B1 → B2 → B3 ‖ (B3 starts once T5 contract is agreed, even before B2 fully merges, if types are pinned up front).
- **3 devs:**
  - **Dev-A (backend core):** T1 → T3 → T5.
  - **Dev-B (backend support):** T2 → T4.
  - **Dev-C (frontend):** (T6 ‖ T7 ‖ T8 ‖ T9 ‖ T10) → T11.

---

## 6. Tasks

### T1 — Backend: Drizzle `projects` schema + migration 0003

**Batch:** B1 · **Depends on:** F07 (merged) · **Parallel with:** T2

**Description:** Add the `projects` table to Drizzle schema (D-Column-Identity, D-Creator-FK, D-Timestamps, schema delta §8) and generate migration `0003`. This is the storage foundation — T3 (service) depends on it. The `columns` column is JSONB typed as `Column[]` (`{id, name}`); `creator_id` is an FK to `Users.id`; both timestamps are `timestamptz NOT NULL`.

Create / Modify:

- **`backend/src/db/schema.ts`** (MODIFY). Add `Column` type + `projects` table.

  Add `jsonb` to the `drizzle-orm/pg-core` import. Add the `Column` type + table after the `users` block:

  ```typescript
  // F08 D-Column-Identity: column identity is {id, name}, NOT a bare string.
  // id = crypto.randomUUID() (stable across renames); name is the display label.
  // PRD §8.2 specified a string array; F08 upgrades to {id, name} (schema delta §8).
  export interface Column {
    id: string;
    name: string;
  }

  export const projects = pgTable('Projects', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    // F08 D-Column-Identity: ordered array of {id, name}. JSONB; Drizzle $type for TS shape.
    columns: jsonb('columns').$type<Column[]>().notNull(),
    // F08 D-Creator-FK: PRD omits; aligns with §8.3 Tickets creator FK.
    creatorId: uuid('creator_id').notNull().references(() => users.id),
    // F08 D-Timestamps: PRD omits; aligns with Users schema.
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  });
  ```

  Add `jsonb` to imports:
  ```typescript
  import { pgTable, uuid, text, timestamp, pgEnum, uniqueIndex, integer, jsonb, eq } from 'drizzle-orm/pg-core';
  ```
  (Add `jsonb` only if not already present; `eq` may already be imported elsewhere — keep schema.ts import minimal, move `eq` to client/query files if cleaner.)

  Notes: (a) `slug` `.unique()` → DB-level unique constraint (authoritative guard, D-Slug-Uniqueness). (b) `creatorId` camelCase access key → `creator_id` snake_case column. (c) `.$type<Column[]>()` gives TS the shape without a runtime check — Zod validates at the edge (T4). (d) **DO NOT touch `usersOneAdminIdx`** (F06). (e) No partial index on `projects` → MEMORY `drizzle-partial-index-enum-dollar1` should NOT fire (pure additive CREATE TABLE), but T1 still inspects `0003_*.sql`.

- **Generate the migration** from `backend/`:
  ```bash
  npm run db:generate -w backend
  ```
  Produces `backend/src/db/migrations/0003_<auto-name>.sql`. Verify it contains only the CREATE TABLE:
  ```sql
  CREATE TABLE IF NOT EXISTS "Projects" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL,
    "slug" text NOT NULL,
    "columns" jsonb NOT NULL,
    "creator_id" uuid NOT NULL,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
  );
  CREATE UNIQUE INDEX "projects_slug_unique" ON "Projects" USING btree ("slug");
  ALTER TABLE "Projects" ADD CONSTRAINT "projects_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "Users"("id") ON DELETE no action ON UPDATE no action;
  ```
  (Exact DDL varies by drizzle-kit version — confirm shape, not wording.)

  **CRITICAL — inspect for `$1` regression:** open `0003_*.sql`; confirm NO `WHERE "role" = $1` anywhere (the enum-partial-index bug). If present (unlikely on additive CREATE TABLE), hand-edit to literal `'ADMIN'`. Cite MEMORY `drizzle-partial-index-enum-dollar1`.

  Apply locally:
  ```bash
  npm run db:migrate -w backend
  psql "$DATABASE_URL" -c '\d "Projects"'
  ```
  Confirm all 7 columns + the slug unique index + the creator_id FK appear.

**Acceptance Criteria:**
- [ ] `schema.ts` declares `Column` interface + `projects` table with `id`, `name`, `slug` (unique), `columns` (`$type<Column[]>`), `creatorId` (FK→users.id), `createdAt`, `updatedAt`.
- [ ] `0003_*.sql` generated; contains CREATE TABLE + slug unique index + creator_id FK; NO `$1` regression (or hand-reconciled).
- [ ] `npm run db:migrate` applies cleanly; `\d "Projects"` shows all columns + constraints.
- [ ] `usersOneAdminIdx` UNCHANGED (F06 not regressed).
- [ ] `npm run typecheck -w backend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** F07 (schema, migration runner). No dependency on T2.

---

### T2 — Backend: slug utility + unit tests

**Batch:** B1 · **Depends on:** None · **Parallel with:** T1

**Description:** Ship `backend/src/utils/slug.ts` (D-Slug-Format, D-Reserved-Slugs): `isValidSlug`, `normalizeSlug`, and the `RESERVED_SLUGS` set. Pure functions, no DB — the service (T3) composes them. Table-driven unit tests cover format, normalization, and reserved slugs.

Create / Modify:

- **`backend/src/utils/slug.ts`** (NEW).

  ```typescript
  // F08 D-Slug-Format: uppercase alphanumerics, start with letter, len 2–16.
  export const SLUG_REGEX = /^[A-Z][A-Z0-9]{1,15}$/;

  // F08 D-Reserved-Slugs: route-namespace collisions blocked.
  export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
    'API', 'AUTH', 'HEALTH', 'REPORTS', 'SETTINGS', 'LOGIN', 'NEW', 'ADMIN',
  ]);

  // Normalize: uppercase + strip non-alphanumerics. Applied BEFORE uniqueness check
  // so 'slyk' / 'Slyk ' / 'sly-k' inputs all converge to 'SLYK' / 'SLYK'.
  export function normalizeSlug(input: string): string {
    return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  export function isValidSlug(slug: string): boolean {
    return SLUG_REGEX.test(slug);
  }

  export function isReservedSlug(slug: string): boolean {
    return RESERVED_SLUGS.has(slug.toUpperCase());
  }
  ```

  Notes: (a) `normalizeSlug` strips ALL non-alphanumerics (spaces, hyphens, underscores) → `'SLY K'` becomes `'SLYK'`. (b) `isValidSlug` checks the ALREADY-NORMALIZED form; the service calls `normalizeSlug` first, then `isValidSlug`. (c) `SLUG_REGEX` len 2–16: `[A-Z]` (1) + `[A-Z0-9]{1,15}` (1–15) = 2–16 total. (d) `RESERVED_SLUGS` is `ReadonlySet` (immutable). (e) SCREAMING_SNAKE for constants (style guide).

- **`backend/src/utils/slug.test.ts`** (NEW). Table-driven.

  ```typescript
  import { describe, it, expect } from 'vitest';
  import { SLUG_REGEX, RESERVED_SLUGS, normalizeSlug, isValidSlug, isReservedSlug } from './slug';

  describe('normalizeSlug', () => {
    const tests = [
      { name: 'lowercase → uppercase', input: 'slyk', expected: 'SLYK' },
      { name: 'strips spaces', input: 'SLY K', expected: 'SLYK' },
      { name: 'strips hyphens', input: 'sly-k', expected: 'SLYK' },
      { name: 'strips underscores', input: 'sly_k', expected: 'SLYK' },
      { name: 'mixed case + symbols', input: ' My-Project_1 ', expected: 'MYPROJECT1' },
      { name: 'empty string', input: '', expected: '' },
      { name: 'only symbols', input: '---', expected: '' },
    ];
    tests.forEach(({ name, input, expected }) => {
      it(name, () => expect(normalizeSlug(input)).toBe(expected));
    });
  });

  describe('isValidSlug', () => {
    const valid = ['SL', 'SLYK', 'PROJECT1', 'AB', 'A1', 'ABCDEFG123456789']; // 2..16 chars
    const invalid = [
      '', 'A', // too short (<2)
      'A'.repeat(16) + 'X', // too long (>16)
      'slyk', '1ABC', '_ABC', 'A B C', 'A-B', // lowercase, leading digit, symbols, spaces
    ];
    valid.forEach((s) => it(`accepts ${s}`, () => expect(isValidSlug(s)).toBe(true)));
    invalid.forEach((s) => it(`rejects '${s}'`, () => expect(isValidSlug(s)).toBe(false)));
  });

  describe('isReservedSlug', () => {
    it('blocks known reserved slugs', () => {
      ['API', 'AUTH', 'HEALTH', 'REPORTS', 'SETTINGS', 'LOGIN', 'NEW', 'ADMIN'].forEach((s) =>
        expect(isReservedSlug(s)).toBe(true),
      );
    });
    it('allows non-reserved slugs', () => {
      expect(isReservedSlug('SLYK')).toBe(false);
    });
    it('case-insensitive', () => {
      expect(isReservedSlug('api')).toBe(true);
    });
  });
  ```

  Notes: Verify the `valid`/`invalid` arrays match the regex (len 2–16). `'ABCDEFG123456789'` is 16 chars; `'A'.repeat(16) + 'X'` is 17.

**Acceptance Criteria:**
- [ ] `slug.ts` exports `SLUG_REGEX`, `RESERVED_SLUGS` (ReadonlySet), `normalizeSlug`, `isValidSlug`, `isReservedSlug`.
- [ ] `normalizeSlug` uppercases + strips non-alphanumerics.
- [ ] `isValidSlug` enforces `^[A-Z][A-Z0-9]{1,15}$` (len 2–16, leading letter).
- [ ] `isReservedSlug` case-insensitive, blocks the 8 reserved slugs.
- [ ] All table-driven scenarios pass.
- [ ] `npm run typecheck -w backend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** None.

---

### T3 — Backend: `projectService` + unit tests

**Batch:** B2 · **Depends on:** T1, T2 · **Parallel with:** T4

**Description:** Ship the data-access layer (D-Data-Access-Layer): `backend/src/services/projectService.ts` exporting `createProject`, `listProjects`, `getProjectBySlug`. `createProject` normalizes the slug, validates format + reserved, pre-checks uniqueness (CONFLICT/409), applies default columns (D-Default-Columns) with randomUUID ids, and inserts with `creatorId`. Unit tests mock `db` and the slug utils.

Create / Modify:

- **`backend/src/services/projectService.ts`** (NEW).

  ```typescript
  import { randomUUID } from 'node:crypto';
  import { eq } from 'drizzle-orm';
  import { db } from '../db/client';
  import { projects, type Column } from '../db/schema';
  import { AppError } from '../utils/appError';
  import { ErrorCode } from '../utils/envelope';
  import { normalizeSlug, isValidSlug, isReservedSlug } from '../utils/slug';

  // F08 D-Default-Columns: applied when caller omits columns. REQ-2.2.
  const DEFAULT_COLUMNS: ReadonlyArray<Pick<Column, 'name'>> = [
    { name: 'To Do' },
    { name: 'In Progress' },
    { name: 'Done' },
  ];

  function withIds(columns: ReadonlyArray<Pick<Column, 'name'>>): Column[] {
    return columns.map((c) => ({ id: randomUUID(), name: c.name }));
  }

  export interface CreateProjectInput {
    name: string;
    slug: string;
    columns?: Column[]; // optional; caller may supply pre-id'd columns
    creatorId: string;
  }

  export async function createProject(input: CreateProjectInput) {
    // F08 D-Slug-Format: normalize then validate.
    const slug = normalizeSlug(input.slug);
    if (!isValidSlug(slug)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `Invalid slug format: '${slug}'`, { slug });
    }
    // F08 D-Reserved-Slugs.
    if (isReservedSlug(slug)) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `Slug '${slug}' is reserved`, { slug });
    }

    // F08 D-Slug-Uniqueness: pre-check (DB unique is the authoritative backstop).
    const existing = await getProjectBySlug(slug);
    if (existing) {
      throw new AppError(ErrorCode.CONFLICT, `Project slug '${slug}' already exists`, { slug });
    }

    // F08 D-Default-Columns + D-Column-Identity: ensure every column has an id.
    const columns: Column[] =
      input.columns && input.columns.length > 0
        ? input.columns.map((c) => ({ id: c.id ?? randomUUID(), name: c.name }))
        : withIds(DEFAULT_COLUMNS);

    const [row] = await db
      .insert(projects)
      .values({
        name: input.name,
        slug,
        columns,
        creatorId: input.creatorId,
      })
      .returning();
    return row;
  }

  export async function listProjects() {
    return db.select().from(projects).orderBy(projects.createdAt);
  }

  export async function getProjectBySlug(slug: string) {
    const [row] = await db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    return row ?? null;
  }
  ```

  Notes: (a) `normalizeSlug` before `isValidSlug` — so `'slyk'` input passes. (b) `isReservedSlug` is case-insensitive. (c) The pre-check (`getProjectBySlug`) gives a clean `CONFLICT` envelope; the DB unique index is the authoritative guard against races (a concurrent insert between pre-check and insert would throw a PG unique violation → caught by error MW as 500 — acceptable for MVP; a unique-violation→CONFLICT mapper is F09+ polish). (d) `withIds` ensures default columns get stable `id`s; caller-supplied columns keep their `id` (or get one if missing). (e) `listProjects` orders by `createdAt` (oldest first). (f) `getProjectBySlug` returns `null` (not throws) — the route handler decides 404. (g) `node:crypto` `randomUUID` — Node 24 global; explicit import for clarity.

- **`backend/src/services/projectService.test.ts`** (NEW). Mock `db` fluent chain (F06/F07 pattern).

  - **createProject: normalizes slug, inserts, returns row with default columns** — input `{name:'Slyk', slug:'slyk', creatorId:'u1'}`; mock `getProjectBySlug` → `null`; mock `db.insert().values().returning()` → `[{id, name, slug:'SLYK', columns:[3 items w/ ids], creatorId, createdAt, updatedAt}]`; assert `columns` length 3, each has `id` + `name`; assert insert called with `slug:'SLYK'`.
  - **createProject: keeps caller columns + ids** — input columns `[{id:'c1',name:'Todo'}]`; assert returned columns preserve `id:'c1'`.
  - **createProject: VALIDATION_FAILED on bad slug format** — `slug:'1abc'` (leading digit after normalize); assert `AppError` `VALIDATION_FAILED`.
  - **createProject: VALIDATION_FAILED on reserved slug** — `slug:'API'`; assert `VALIDATION_FAILED`, message includes 'reserved'.
  - **createProject: CONFLICT on existing slug** — mock `getProjectBySlug` → row; assert `AppError` `CONFLICT`, details has slug.
  - **listProjects: returns rows ordered by createdAt** — mock `db.select().from().orderBy()` → `[row1, row2]`; assert returned.
  - **getProjectBySlug: returns row when found** — mock → `[row]`; assert `row`.
  - **getProjectBySlug: returns null when not found** — mock → `[]`; assert `null`.

  Notes: Drizzle fluent-chain mock pattern from F06 `userService.test.ts`. Mock `../db/client` `db` as an object with chainable methods. `randomUUID` can be mocked via `vi.mock('node:crypto', ...)` to assert id assignment, or left real (assert it's a string matching UUID regex).

**Acceptance Criteria:**
- [ ] `projectService.ts` exports `createProject` (normalize→validate→reserved→pre-check→defaults→insert), `listProjects` (ordered), `getProjectBySlug` (returns `null` if absent).
- [ ] `createProject` throws `VALIDATION_FAILED` on bad format + reserved; `CONFLICT` on existing slug; applies default columns with randomUUID ids when caller omits.
- [ ] All 8 scenarios pass.
- [ ] `npm run typecheck -w backend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T1 (`projects` table), T2 (`slug` utils).

---

### T4 — Backend: Zod validation schemas

**Batch:** B2 · **Depends on:** T2 · **Parallel with:** T3

**Description:** Ship `backend/src/routes/projects.schema.ts` (Zod v4): `createProjectBodySchema` (name non-empty + len cap, slug regex, columns array `{id, name}` min 1) and `slugParamSchema`. Co-located with the route (T5 mounts via `validateRequest`). Follows `auth.schema.ts` convention.

Create / Modify:

- **`backend/src/routes/projects.schema.ts`** (NEW).

  ```typescript
  import { z } from 'zod';

  // F08 D-Slug-Format: validated server-side again (service also normalizes+checks).
  // Accepts the raw input here; service normalizes. Lenient on case so 'slyk' is accepted then normalized.
  export const createProjectBodySchema = z.object({
    name: z.string().min(1, 'Name is required').max(100, 'Name must be ≤100 chars'),
    slug: z.string().min(2).max(64).regex(/^[A-Za-z][A-Za-z0-9 _-]*$/, 'Slug must be alphanumeric (letters, digits, space, _, -)'),
    columns: z
      .array(
        z.object({
          id: z.string().uuid().optional(),
          name: z.string().min(1).max(50),
        }),
      )
      .min(1, 'At least one column is required')
      .max(20, 'Too many columns (max 20)')
      .optional(),
  });

  export const slugParamSchema = z.object({
    slug: z.string().min(2).max(16).regex(/^[A-Z][A-Z0-9]{1,15}$/, 'Invalid slug'),
  });

  export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;
  ```

  Notes: (a) The Zod slug regex here is LENIENT (accepts lowercase + separators) because the service normalizes — this avoids double-rejection of `'slyk'`. The `slugParamSchema` (for GET `/:slug`) is STRICT (uppercase only) because the URL is the normalized form. (b) `columns` optional — service applies defaults if absent. If present, min 1. (c) `id` optional on each column — service assigns if missing. (d) `max(100)` on name, `max(50)` on column name, `max(20)` columns — no magic numbers (style guide); these are explicit limits. (e) `z.infer` gives the TS body shape (T5 uses it for the handler param type).

**Acceptance Criteria:**
- [ ] `projects.schema.ts` exports `createProjectBodySchema`, `slugParamSchema`, `CreateProjectBody`.
- [ ] `name` non-empty, ≤100; `slug` lenient alphanumeric; `columns` optional array of `{id?, name}` min 1 max 20.
- [ ] `slugParamSchema` strict uppercase regex.
- [ ] `npm run typecheck -w backend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T2 (slug format convention — informs the regex). No dependency on T1 or T3.

---

### T5 — Backend: routes + mount + supertest tests

**Batch:** B2 · **Depends on:** T3, T4 · **Parallel with:** — (backend terminal)

**Description:** Ship `backend/src/routes/projects.routes.ts`: `GET /` (any authed), `GET /:slug` (any authed), `POST /` (ADMIN-only via `requireRole('ADMIN')` — first mount). Mount at `index.ts`. Supertest tests use REAL `authenticate` + `requireRole` (exercise the seam) and mock only `projectService`. Follows `auth.routes.test.ts` gold pattern (F07).

Create / Modify:

- **`backend/src/routes/projects.routes.ts`** (NEW).

  ```typescript
  import { Router } from 'express';
  import { authenticate } from '../middleware/auth';
  import { requireRole } from '../middleware/requireRole';
  import { validateRequest } from '../middleware/validateRequest';
  import { success } from '../utils/envelope';
  import { AppError } from '../utils/appError';
  import { ErrorCode } from '../utils/envelope';
  import * as projectService from '../services/projectService';
  import { createProjectBodySchema, slugParamSchema } from './projects.schema';

  export const projectsRouter = Router();

  // F08: any authenticated user can list projects (D-ProjectMembers: no membership yet).
  projectsRouter.get('/', authenticate, async (_req, res) => {
    const rows = await projectService.listProjects();
    res.json(success(rows));
  });

  // F08: any authenticated user can fetch a project by slug.
  projectsRouter.get('/:slug', authenticate, validateRequest({ params: slugParamSchema }), async (req, res) => {
    const project = await projectService.getProjectBySlug(req.params.slug);
    if (!project) {
      throw new AppError(ErrorCode.NOT_FOUND, `Project '${req.params.slug}' not found`);
    }
    res.json(success(project));
  });

  // F08 D-Who-Creates: ADMIN-only. First mount of requireRole (F07 shipped it unmounted).
  projectsRouter.post(
    '/',
    authenticate,
    requireRole('ADMIN'),
    validateRequest({ body: createProjectBodySchema }),
    async (req, res) => {
      const project = await projectService.createProject({
        name: req.body.name,
        slug: req.body.slug,
        columns: req.body.columns,
        creatorId: req.user!.id,
      });
      res.status(201).json(success(project));
    },
  );
  ```

  Notes: (a) MW order: `authenticate` → `requireRole` → `validateRequest` → handler. `requireRole` needs `req.user` (set by authenticate); `validateRequest` needs the parsed body. (b) `req.user!.id` — non-null assertion (authenticate guarantees it; TS doesn't know). (c) POST returns 201 (created). (d) GET `/:slug` uses `slugParamSchema` (strict) — a lowercase URL hits VALIDATION_FAILED before the service (cleaner than 404). (e) `import * as projectService` — namespace import so tests can `vi.mock('../services/projectService', ...)` cleanly. (f) Express 5 async handlers auto-caught.

- **`backend/src/index.ts`** (MODIFY). Mount the router.

  Add after the `app.use('/api/auth', authRouter)` line (~L48):
  ```typescript
  import { projectsRouter } from './routes/projects.routes';
  // ...
  app.use('/api/projects', projectsRouter);
  ```
  Notes: Keep MW order — `/api/projects` mounts after `/api/auth`, before `notFound`. Confirm `authenticate`/`requireRole` imports unaffected.

- **`backend/src/routes/projects.routes.test.ts`** (NEW). Supertest vs real app; REAL `authenticate` + `requireRole`; mock `projectService`.

  Follow `auth.routes.test.ts` (F07): `vi.hoisted` for env, `vi.mock('../services/projectService')`, build app via `index.ts` or a test app factory. Sign real JWTs via `signJwt` (don't mock the JWT layer — exercises the F07 `ver` compare too).

  - **GET / returns 200 + list (authed)** — sign JWT (ADMIN); mock `listProjects` → `[proj1, proj2]`; GET `/api/projects` w/ Bearer; assert 200, `body.data` length 2.
  - **GET / returns 401 without Bearer** — no auth header; assert 401.
  - **GET /:slug returns 200 when found** — mock `getProjectBySlug('SLYK')` → row; assert 200, `body.data.slug === 'SLYK'`.
  - **GET /:slug returns 404 when not found** — mock → `null`; assert 404 `NOT_FOUND`.
  - **GET /:slug returns 400 on invalid slug format** — GET `/api/projects/slyk` (lowercase); assert 400 `VALIDATION_FAILED` (slugParamSchema rejects).
  - **POST / returns 201 + created project (ADMIN)** — sign JWT (ADMIN, ver matches); mock `createProject` → `{id, name:'Slyk', slug:'SLYK', columns:[...], ...}`; POST `/api/projects` w/ Bearer + body `{name:'Slyk', slug:'slyk'}`; assert 201, `body.data.slug === 'SLYK'`; assert `createProject` called with `creatorId === req.user.id`.
  - **POST / returns 403 for MEMBER** — sign JWT (MEMBER); POST; assert 403 `FORBIDDEN` (requireRole first-mount proof); assert `createProject` NOT called.
  - **POST / returns 401 without Bearer** — no auth; assert 401.
  - **POST / returns 400 on invalid body** — POST `{name:''}` (empty name); assert 400 `VALIDATION_FAILED`; assert `createProject` NOT called.
  - **POST / propagates CONFLICT from service** — mock `createProject` → `throw new AppError(CONFLICT, ...)`; POST; assert 409.

  Notes: (a) REAL `authenticate` + `requireRole` — do NOT mock the middleware. This proves F08 is the first real consumer of F07's `requireRole`. (b) Mock `projectService` entirely (the DB layer is tested in T3). (c) Sign JWTs with real `signJwt` + mock `findUserTokenVersion` → matching `ver` (so `authenticate`'s ver compare passes). Pattern from F07 `auth.routes.test.ts`.

**Acceptance Criteria:**
- [ ] `projects.routes.ts` exports `projectsRouter` with `GET /`, `GET /:slug`, `POST /` (ADMIN-only).
- [ ] MW order correct (authenticate → requireRole → validateRequest → handler).
- [ ] `index.ts` mounts `/api/projects` after `/api/auth`.
- [ ] POST returns 201; MEMBER gets 403; no-Bearer gets 401.
- [ ] GET `/:slug` 404 when absent, 400 on bad slug format.
- [ ] All 10 supertest scenarios pass.
- [ ] `npm run typecheck -w backend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T3 (`projectService`), T4 (schemas), F07 (`authenticate`, `requireRole`, `signJwt`).

---

### T6 — Frontend: types + API client

**Batch:** B3 · **Depends on:** T5 (API contract stable) · **Parallel with:** T7, T8, T9, T10

**Description:** Ship `frontend/src/types/project.ts` (`Project`, `Column`, `CreateProjectDto`) and `frontend/src/api/projects.ts` (`listProjects`, `getProjectBySlug`, `createProject` via `apiFetch`). Mirror the backend envelope shapes.

Create / Modify:

- **`frontend/src/types/project.ts`** (NEW).

  ```typescript
  // F08 D-Column-Identity: {id, name}. id is stable across renames.
  export interface Column {
    id: string;
    name: string;
  }

  export interface Project {
    id: string;
    name: string;
    slug: string;
    columns: Column[];
    creatorId: string;
    createdAt: string; // ISO timestamp
    updatedAt: string;
  }

  // Sent to POST /api/projects. slug is raw (service normalizes). columns optional.
  export interface CreateProjectDto {
    name: string;
    slug: string;
    columns?: Column[];
  }
  ```

- **`frontend/src/api/projects.ts`** (NEW).

  ```typescript
  import { apiFetch } from './client';
  import type { Project, CreateProjectDto } from '@/types/project';

  export function listProjects(): Promise<Project[]> {
    return apiFetch<Project[]>('/projects');
  }

  export function getProjectBySlug(slug: string): Promise<Project> {
    return apiFetch<Project>(`/projects/${slug}`);
  }

  export function createProject(dto: CreateProjectDto): Promise<Project> {
    return apiFetch<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(dto),
    });
  }
  ```

  Notes: (a) `apiFetch` auto-injects Bearer + handles 401 interceptor (F07). (b) POST body must be `JSON.stringify` (apiFetch sets Content-Type when `body` present). (c) No env var (apiBaseUrl already in `env.ts`).

**Acceptance Criteria:**
- [ ] `types/project.ts` exports `Column`, `Project`, `CreateProjectDto` matching backend shapes.
- [ ] `api/projects.ts` exports `listProjects`, `getProjectBySlug`, `createProject` via `apiFetch`.
- [ ] `npm run typecheck -w frontend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T5 (contract). T7/T9 consume these types — agree shapes up front if parallel.

---

### T7 — Frontend: TanStack Query hooks + queryKeys

**Batch:** B3 · **Depends on:** T6 · **Parallel with:** T8, T9, T10

**Description:** Ship `frontend/src/hooks/useProjects.ts` (`useProjects`, `useProject(slug)`) and a `projectKeys` factory. Co-located tests mock `api/projects`.

Create / Modify:

- **`frontend/src/api/queryKeys.ts`** (NEW). Query-key factory (centralizes keys for invalidation).

  ```typescript
  export const projectKeys = {
    all: ['projects'] as const,
    lists: () => [...projectKeys.all, 'list'] as const,
    detail: (slug: string) => [...projectKeys.all, 'detail', slug] as const,
  };
  ```

  Notes: If a `queryKeys.ts` already exists (check `frontend/src/api/`), add `projectKeys` to it instead of creating a new file.

- **`frontend/src/hooks/useProjects.ts`** (NEW).

  ```typescript
  import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
  import { listProjects, getProjectBySlug, createProject } from '@/api/projects';
  import { projectKeys } from '@/api/queryKeys';
  import type { CreateProjectDto } from '@/types/project';

  export function useProjects() {
    return useQuery({
      queryKey: projectKeys.lists(),
      queryFn: listProjects,
    });
  }

  export function useProject(slug: string | undefined) {
    return useQuery({
      queryKey: projectKeys.detail(slug ?? ''),
      queryFn: () => getProjectBySlug(slug!),
      enabled: !!slug,
    });
  }

  export function useCreateProject() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (dto: CreateProjectDto) => createProject(dto),
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
      },
    });
  }
  ```

  Notes: (a) `useProject` gated on `!!slug` (skip fetch if no slug). (b) `useCreateProject` invalidates the list on success (TanStack refetch). (c) `staleTime 30s` + `refetchOnWindowFocus` inherited from queryClient defaults.

- **`frontend/src/hooks/useProjects.test.ts`** (NEW). Mock `api/projects`.

  - **useProjects: returns data on success** — wrap in QueryClientProvider; mock `listProjects` → `[proj]`; assert `result.current.data` matches.
  - **useProject: enabled only when slug present** — `slug=undefined` → assert not fetched; `slug='SLYK'` → fetched.
  - **useCreateProject: invalidates list on success** — mock `createProject` + `queryClient.invalidateQueries`; trigger mutate; assert invalidate called with `projectKeys.lists()`.

  Notes: Wrap hooks in a test `QueryClientProvider` (per js-testing-rules). Use `renderHook` from `@testing-library/react`.

**Acceptance Criteria:**
- [ ] `queryKeys.ts` exports `projectKeys` (all, lists, detail).
- [ ] `useProjects.ts` exports `useProjects`, `useProject`, `useCreateProject`.
- [ ] `useProject` gated on slug; `useCreateProject` invalidates list.
- [ ] All 3 scenarios pass.
- [ ] `npm run typecheck -w frontend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T6 (`api/projects`, types).

---

### T8 — Frontend: `useProjectStore` (last selected)

**Batch:** B3 · **Depends on:** None · **Parallel with:** T6, T7, T9, T10

**Description:** Ship `frontend/src/stores/useProjectStore.ts` (Zustand + optional `persist` `'slyk-project'`) tracking `lastSelectedSlug` (D-Current-Project). Mirrors `useAuthStore` pattern.

Create / Modify:

- **`frontend/src/stores/useProjectStore.ts`** (NEW).

  ```typescript
  import { create } from 'zustand';
  import { persist } from 'zustand/middleware';

  interface ProjectState {
    lastSelectedSlug: string | null;
    setLastSelectedSlug: (slug: string) => void;
    clear: () => void;
  }

  // F08 D-Current-Project: URL param is primary; this store records the last
  // selected slug so '/' can redirect to the last board (UX convenience).
  export const useProjectStore = create<ProjectState>()(
    persist(
      (set) => ({
        lastSelectedSlug: null,
        setLastSelectedSlug: (slug) => set({ lastSelectedSlug: slug }),
        clear: () => set({ lastSelectedSlug: null }),
      }),
      { name: 'slyk-project' },
    ),
  );
  ```

  Notes: (a) `persist` key `'slyk-project'` (mirrors `'slyk-auth'`). (b) Single field — no project object (URL is source of truth). (c) `clear` for logout-time reset (optional — the store is harmless if stale; a future F07 logout hook could call it).

**Acceptance Criteria:**
- [ ] `useProjectStore` exports `lastSelectedSlug`, `setLastSelectedSlug`, `clear`.
- [ ] Persisted under `'slyk-project'`.
- [ ] `npm run typecheck -w frontend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** None.

---

### T9 — Frontend: ProjectsPage + ProjectPicker

**Batch:** B3 · **Depends on:** T6, T7, T8 · **Parallel with:** T10

**Description:** Ship `frontend/src/pages/ProjectsPage.tsx` (list + create form, ADMIN-gated create via `useRequireRole('ADMIN')` or `<RequireRole>`) and `frontend/src/components/ProjectPicker.tsx` (dropdown in TopNav). Selecting a project navigates to `/projects/:slug` + sets `lastSelectedSlug`.

Create / Modify:

- **`frontend/src/components/ProjectPicker.tsx`** (NEW).

  ```tsx
  import { useNavigate } from 'react-router';
  import { useProjects } from '@/hooks/useProjects';
  import { useProjectStore } from '@/stores/useProjectStore';

  interface ProjectPickerProps {
      /** Compact mode for TopNav (dropdown); full mode for ProjectsPage. */
      variant?: 'compact' | 'full';
  }

  export function ProjectPicker({ variant = 'compact' }: ProjectPickerProps) {
      const navigate = useNavigate();
      const { data: projects, isLoading } = useProjects();
      const setLastSelectedSlug = useProjectStore((s) => s.setLastSelectedSlug);

      const handleSelect = (slug: string) => {
          setLastSelectedSlug(slug);
          void navigate(`/projects/${slug}`);
      };

      if (isLoading) {
          return <span className="text-sm text-muted-foreground">Loading…</span>;
      }

      if (!projects || projects.length === 0) {
          return <span className="text-sm text-muted-foreground">No projects</span>;
      }

      return (
          <select
              aria-label="Select project"
              className="rounded border border-input bg-background px-2 py-1 text-sm"
              defaultValue=""
              onChange={(e) => e.target.value && handleSelect(e.target.value)}
          >
              <option value="" disabled>
                  Select project…
              </option>
              {projects.map((p) => (
                  <option key={p.id} value={p.slug}>
                      {p.name} ({p.slug})
                  </option>
              ))}
          </select>
      );
  }
  ```

  Notes: (a) Native `<select>` (accessible by default, getByRole). Could upgrade to a Radix dropdown later. (b) `aria-label` for RTL getByLabelText. (c) `variant` prop reserved for future full/compact styling (currently unused — keep or drop per style guide "no unused"). DECISION: drop `variant` for now (YAGNI); add when ProjectsPage needs a distinct layout.

- **`frontend/src/pages/ProjectsPage.tsx`** (NEW). List + create form.

  ```tsx
  import { useState } from 'react';
  import { useNavigate } from 'react-router';
  import { useProjects, useCreateProject } from '@/hooks/useProjects';
  import { useAuthStore } from '@/stores/useAuthStore';
  import { ApiClientError } from '@/api/client';

  export function ProjectsPage() {
      const navigate = useNavigate();
      const { data: projects, isLoading } = useProjects();
      const createProject = useCreateProject();
      const role = useAuthStore((s) => s.user?.role);
      const isAdmin = role === 'ADMIN';

      const [name, setName] = useState('');
      const [slug, setSlug] = useState('');
      const [error, setError] = useState<string | null>(null);

      const handleSelect = (selectedSlug: string) => {
          void navigate(`/projects/${selectedSlug}`);
      };

      const handleCreate = async (e: React.FormEvent) => {
          e.preventDefault();
          setError(null);
          try {
              const project = await createProject.mutateAsync({ name, slug });
              void navigate(`/projects/${project.slug}`);
          } catch (err) {
              if (err instanceof ApiClientError) {
                  setError(err.details ? `${err.message}` : err.message);
              } else {
                  setError('Failed to create project');
              }
          }
      };

      if (isLoading) {
          return <div className="p-4">Loading projects…</div>;
      }

      return (
          <div className="mx-auto max-w-2xl space-y-6 p-4">
              <h1 className="text-2xl font-bold">Projects</h1>

              <ul className="space-y-2">
                  {projects?.map((p) => (
                      <li key={p.id}>
                          <button
                              type="button"
                              onClick={() => handleSelect(p.slug)}
                              className="text-left"
                          >
                              <span className="font-medium">{p.name}</span>{' '}
                              <span className="text-sm text-muted-foreground">({p.slug})</span>
                          </button>
                      </li>
                  ))}
              </ul>

              {isAdmin && (
                  <form onSubmit={handleCreate} className="space-y-2 rounded border p-4">
                      <h2 className="text-lg font-semibold">New Project</h2>
                      <input
                          aria-label="Project name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Name"
                          className="block w-full rounded border px-2 py-1"
                      />
                      <input
                          aria-label="Project slug"
                          value={slug}
                          onChange={(e) => setSlug(e.target.value)}
                          placeholder="SLUG (e.g. SLYK)"
                          className="block w-full rounded border px-2 py-1"
                      />
                      {error && <p className="text-sm text-destructive">{error}</p>}
                      <button
                          type="submit"
                          disabled={createProject.isPending}
                          className="rounded bg-primary px-3 py-1 text-primary-foreground"
                      >
                          {createProject.isPending ? 'Creating…' : 'Create'}
                      </button>
                  </form>
              )}
          </div>
      );
  }
  ```

  Notes: (a) ADMIN gate is client-side UX (`isAdmin`) — the server `requireRole('ADMIN')` is the real gate. Could wrap the form in `<RequireRole role="ADMIN">` instead; either is fine. (b) Form errors display the `ApiClientError` message (CONFLICT/slug-taken, VALIDATION_FAILED/bad-format). (c) On success, navigate to the new project's board URL. (d) No `console.log` (style guide). (e) Tailwind classes (no inline styles).

- **`frontend/src/pages/ProjectsPage.test.tsx`** (NEW). RTL.

  - **renders project list** — mock `useProjects` → `[proj1, proj2]`; render; assert both names visible (getByText).
  - **clicking a project navigates** — mock `useNavigate`; click button; assert navigate called with `/projects/SLYK`.
  - **create form visible for ADMIN** — mock `useAuthStore` → `role:'ADMIN'`; assert form present (getByLabelText 'Project name').
  - **create form hidden for MEMBER** — `role:'MEMBER'`; assert form absent (queryByLabelText returns null).
  - **create form submits + navigates on success** — mock `useCreateProject.mutateAsync` → project; fill inputs; submit; assert navigate called.
  - **create form shows error on CONFLICT** — mock mutateAsync → `ApiClientError(409, 'slug taken')`; submit; assert error visible.

  Notes: Wrap in `<MemoryRouter>` + `<QueryClientProvider>` (test client, no retries). Mock `@/hooks/useProjects` + `@/stores/useAuthStore`.

**Acceptance Criteria:**
- [ ] `ProjectPicker` renders a `<select aria-label>` of projects; selecting navigates + sets lastSelectedSlug.
- [ ] `ProjectsPage` renders list; create form ADMIN-gated; submit calls mutateAsync + navigates; errors display.
- [ ] All 6 scenarios pass.
- [ ] `npm run typecheck -w frontend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T6 (api/types), T7 (hooks), T8 (store).

---

### T10 — Frontend: route wiring + TopNav picker

**Batch:** B3 · **Depends:** T9 · **Parallel with:** — (frontend terminal)

**Description:** Wire routes in `frontend/src/routes/index.tsx` (`/projects`, `/projects/:slug`, `/` redirect via lastSelectedSlug) and add the `ProjectPicker` to `TopNav.tsx`.

Create / Modify:

- **`frontend/src/routes/index.tsx`** (MODIFY). Add routes.

  Inside the `<AppLayout>` children (alongside `/reports`, `/settings`):
  ```tsx
  <Route path="/projects" element={<ProjectsPage />} />
  <Route path="/projects/:slug" element={<BoardPlaceholder />} />
  ```
  Update the `/` route to redirect to the last project if one exists (read `useProjectStore`):
  ```tsx
  function IndexRedirect() {
      const lastSlug = useProjectStore((s) => s.lastSelectedSlug);
      return <Navigate to={lastSlug ? `/projects/${lastSlug}` : '/projects'} replace />;
  }
  // ...
  <Route path="/" element={<IndexRedirect />} />
  ```

  `BoardPlaceholder` (inline or a tiny component) renders "Board for :slug (F09)" — F08 ships the shell, F09 renders the actual board.

  Notes: (a) Import `ProjectsPage`, `useProjectStore`. (b) `<Navigate>` from `react-router`. (c) Keep `/settings` wrapped in `<RequireRole role="ADMIN">` (F07) — unchanged.

- **`frontend/src/components/TopNav.tsx`** (MODIFY). Add picker.

  Add `<ProjectPicker />` near the nav links (before sign-out). Import from `./ProjectPicker`.

  ```tsx
  <nav className="...">
      <ProjectPicker />
      {/* existing NAV_LINKS */}
  </nav>
  ```

  Notes: Picker is compact by default (native `<select>`). No role gate (members can select).

**Acceptance Criteria:**
- [ ] `/projects` renders `ProjectsPage`; `/projects/:slug` renders a placeholder; `/` redirects to last project (or `/projects` if none).
- [ ] `TopNav` renders `<ProjectPicker>`.
- [ ] Existing routes (`/login`, `/reports`, `/settings`) unaffected.
- [ ] `npm run typecheck -w frontend`, `npm run lint`, `npm run format:check` pass.

**Dependencies:** T9 (`ProjectsPage`, `ProjectPicker`).

---

### T11 — Acceptance gate & sign-off

**Batch:** B4 (terminal) · **Depends on:** all prior · **Parallel with:** —

**Description:** The final definition-of-done gate. Run every tool against the as-merged feature, fix gaps, record proof.

Steps:

1. **Backend:**
   ```bash
   cd backend && npm run typecheck && npm run lint && npm run format:check && npm test
   npm run db:migrate  # apply 0003
   psql "$DATABASE_URL" -c '\d "Projects"'  # confirm table + indexes + FK
   ```
2. **Frontend:**
   ```bash
   cd frontend && npm run typecheck && npm run lint && npm run format:check && npm test
   npm run build  # production build
   ```
3. **Live smoke (backend running + seeded ADMIN/MEMBER JWTs):**
   - `POST /api/projects` (ADMIN) `{name:'Slyk', slug:'slyk'}` → 201, `body.data.slug === 'SLYK'`, `columns` length 3 (defaults) each with `id`.
   - `POST /api/projects` (ADMIN) `{name:'Custom', slug:'CUSTOM', columns:[{name:'Backlog'},{name:'Live'}]}` → 201, columns length 2 with ids.
   - `POST /api/projects` (ADMIN) `{name:'Dup', slug:'SLYK'}` → 409 CONFLICT (slug collision).
   - `POST /api/projects` (ADMIN) `{name:'Res', slug:'API'}` → 400 VALIDATION_FAILED (reserved).
   - `POST /api/projects` (ADMIN) `{name:'Bad', slug:'1abc'}` → 400 (format — leading digit after normalize).
   - `POST /api/projects` (MEMBER) `{name:'X', slug:'X'}` → 403 FORBIDDEN (requireRole first-mount proof).
   - `POST /api/projects` (no Bearer) → 401.
   - `GET /api/projects` (authed) → 200, list includes the created projects.
   - `GET /api/projects/SLYK` → 200, columns round-trip `{id, name}` intact.
   - `GET /api/projects/NOPE` → 404 NOT_FOUND.
   - `GET /api/projects/slyk` → 400 (lowercase slug param rejected by strict schema).
4. **Frontend smoke (browser):**
   - Login as ADMIN → `/projects` → see list + create form.
   - Create 'Demo' with slug `demo` → navigates to `/projects/DEMO`.
   - Reload `/projects/DEMO` → persists (URL is source of truth).
   - Login as MEMBER → `/projects` → see list, NO create form.
   - Picker in TopNav → selecting navigates.
5. **Record proof:** commit SHAs, sample API responses, screenshot paths.

**Acceptance Criteria:**
- [ ] Every F08 Acceptance bullet (§1 items 1–8) satisfied; record commit SHAs + responses.
- [ ] `Projects` table exists with all 7 columns + slug unique index + creator_id FK.
- [ ] Slug collision → 409; reserved → 400; bad format → 400; MEMBER POST → 403; no-Bearer → 401.
- [ ] Column `{id, name}` round-trips intact (create with custom columns → GET returns same shape + ids).
- [ ] Frontend: ADMIN create flow works; MEMBER sees no form; picker navigates; URL persists on reload.
- [ ] Lint/format/typecheck/test/build exit codes: `0 / 0 / 0 / 0 / 0`.

**Dependencies:** T5, T10 (all prior).

---

## 7. Final F08 Acceptance Checklist

- [ ] `Projects` table per PRD §8.2 (with F08-added `creator_id`, `created_at`, `updated_at`) exists and migrates cleanly.
- [ ] `columns` JSONB is ordered `{id, name}` array (D-Column-Identity); `id = crypto.randomUUID()`.
- [ ] Slug uniqueness enforced (DB unique + service pre-check → 409); format validated (`^[A-Z][A-Z0-9]{1,15}$`); reserved slugs blocked.
- [ ] `POST /api/projects` is ADMIN-only (`requireRole('ADMIN')` — first mount, proven via 403 test).
- [ ] `GET /api/projects` + `GET /api/projects/:slug` accessible to any authed user.
- [ ] Frontend: project list renders; create form ADMIN-gated; selecting navigates to `/projects/:slug`; URL persists on reload; picker in TopNav.
- [ ] Current project persisted (URL primary + `useProjectStore.lastSelectedSlug` for `/` redirect).
- [ ] No `ProjectMembers` table (deferred — sign-off §9b).
- [ ] Lint + format checks pass on an empty change.
- [ ] Typecheck + test pass (backend + frontend).
- [ ] `npm run build` (frontend) succeeds.

**Integration record (fill during T11):**
- Feature commit SHA: `________`
- `0003_*.sql` applied; `\d "Projects"` output captured: `________`
- Sample POST /api/projects response (201): `________`
- Sample CONFLICT (409) response: `________`
- Lint/format/typecheck/test/build exit codes: `0 / 0 / 0 / 0 / 0`

---

## 8. Schema deltas owned by this feature

F08 owns the `Projects` table (PRD §8.2) with three deltas vs the PRD: `columns` shape (`{id,name}` not strings), added `creator_id` FK, added timestamps.

| Delta | Detail | Migration |
| --- | --- | --- |
| `Projects` table | `id uuid PK defaultRandom`, `name text`, `slug text unique`, `columns jsonb $type<Column[]>`, `creator_id uuid FK→Users.id`, `created_at timestamptz NOT NULL defaultNow`, `updated_at timestamptz NOT NULL defaultNow $onUpdate` | `CREATE TABLE "Projects" (...) + unique index on slug + FK creator_id→Users(id)` — `0003_*.sql` |
| `columns` shape (vs PRD) | PRD §8.2: string array. F08: `{id, name}[]` with `id = crypto.randomUUID()`. Stable identity across renames so F09+ tickets reference `id`. | Schema-level (`$type<Column[]>`); no extra migration (jsonb). |
| `creator_id` (vs PRD) | PRD §8.2 omits. F08 adds `creator_id uuid NOT NULL REFERENCES "Users"(id)`. Aligns with §8.3 Tickets. Audit trail + future permission checks. | `ALTER TABLE` / inline in CREATE TABLE. **Sign-off §9c.** |
| `created_at` / `updated_at` (vs PRD) | PRD §8.2 omits. F08 adds both `timestamptz NOT NULL`. Aligns with `Users` schema. `updated_at` via `$onUpdate(() => new Date())`. | Inline in CREATE TABLE. **Sign-off §9d.** |

---

## 9. Sign-off list

Owner sign-off needed on these irreversible / cross-cutting decisions (surface in chat):

- **(a) D-Who-Creates:** ADMIN-only `POST /api/projects` (vs any authed user). Rationale: PRD REQ-1.3 two-role model; `requireRole` exists (F07) unmounted — F08 is its first mount. **Default if no response: ADMIN-only.**
- **(b) D-ProjectMembers:** Defer per-project membership — all authed users see all projects (no `ProjectMembers` table). Rationale: PRD §8 omits; MVP flat workspace. **Default if no response: defer.**
- **(c) D-Creator-FK:** Add `creator_id uuid NOT NULL REFERENCES "Users"(id)` (PRD §8.2 omits). Rationale: aligns with §8.3 Tickets; audit trail. **Schema delta vs PRD — explicit sign-off required. Default if no response: add it.**
- **(d) D-Timestamps:** Add `created_at` / `updated_at timestamptz NOT NULL` (PRD §8.2 omits). Rationale: aligns with `Users` schema; every entity should be auditable. **Schema delta vs PRD — explicit sign-off required. Default if no response: add them.**
