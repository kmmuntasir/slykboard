---
name: pr-review
description: Comprehensive PR review covering the Node 24 / Express 5 / TypeScript backend and React 19 / TypeScript / Tailwind CSS frontend: architecture, correctness, security, and test coverage. Use when user requests to review a pull request or compare branches for code review.
---

# PR Review Skill

When user requests **PR review** or to **compare branches**:

### Branch Defaults

- **Source branch**: Current local branch. Determine with `git branch --show-current`.
- **Target branch**: `main`, unless user explicitly specifies different branch.
- If user specifies both branches, use those values.

### Pre-Review: Branch Synchronisation

Before review, both branches must be up-to-date and source must be rebased onto target.

**Standard mode** (online):

```bash
# 1. Fetch all remotes
git fetch --all

# 2. Reset target to origin
git checkout <target-branch> && git reset --hard origin/<target-branch>

# 3. Reset source to origin
git checkout <source-branch> && git reset --hard origin/<source-branch>

# 4. Rebase source onto target
git rebase <target-branch>
```

**Offline mode**: If user says **"offline"** when invoking this skill, skip steps 1-3 entirely. Only run rebase (step 4) against local copy of target branch. Allows reviewing purely local state without network access.

**Conflict handling**: If rebase in step 4 produces merge conflicts, **stop entire review**. Abort rebase (`git rebase --abort`), inform user of conflicts, do not proceed with any review steps.

**If rebase succeeds**: Proceed to review steps below.

### Parallel Subagent Strategy

Review accelerates using **up to 3 parallel subagents** (via `Agent` tool). Split independent review tasks across subagents to save context window and speed process. Example parallelisation:

| Subagent | Scope | Agent Type |
|----------|-------|------------|
| 1 | Diff analysis + architecture review | `general-purpose` |
| 2 | Stack-specific checks (Express backend + React/Tailwind frontend) | `general-purpose` |
| 3 | Test coverage assessment + code quality checklist | `general-purpose` |

**When to parallelise:** Always use parallel subagents when diff is non-trivial (more than few files). For tiny diffs (1-2 files, cosmetic changes), single-pass review fine.

**How to parallelise:** Launch all independent subagents in single message using multiple `Agent` tool calls. Each subagent receives diff (via `git diff`) and its specific review scope. After all subagents return, synthesize findings into final review summary (step 6).

## 1. Run Complete Diff

Compare source branch against target branch. Analyze **actual code changes**, not just commit messages.

```bash
git diff target..source
git log target..source --oneline
```

## 2. Identify Change Types

Determine what each change represents:
- Feature addition
- Bug fix
- Refactor
- Cleanup
- Potential breaking change

Note: missing tests, incomplete docs, inconsistencies.

## 3. Assess Code Quality & Impact

Evaluate:
- **Correctness**: Does code work as intended?
- **Readability**: Is code understandable?
- **Maintainability**: Will this be easy to modify later?
- **Architectural Alignment**: Does it follow project's patterns?
- **Performance Implications**: Any performance concerns?
- **Security Considerations**: Any vulnerabilities?

Check whether tests adequately cover changes.

## 4. Stack-Specific Review Items

### 4a. Node 24 / Express 5 / TypeScript Backend

**Layering**
- Route → middleware → service → db layering respected (no business logic dumped in middleware, no ad-hoc DB access in routes)?
- Routes thin (HTTP only: validate via co-located Zod schemas, call services, shape the response)?
- Services own business logic and query Drizzle directly; `controllers/` and `repositories/` stay empty?
- Transactions live in services (`db.transaction`), not spread across route handlers?

**Persistence & Schema**
- Drizzle ORM over the pg Pool singleton (`src/db/client.ts`, max 5) — no ad-hoc connections elsewhere?
- Parameterized Drizzle queries (`sql` template literal only when raw SQL is needed) — no string-concatenated SQL (injection risk)?
- Schema changes in `backend/src/db/schema.ts` followed by a journal migration: `make migrate-generate` then `make migrate` (never push-sync)?
- Durations/timestamps written from the **server clock** into `timeEntries`; client clock advisory/display-only?
- Soft deletes on tickets respected in every read path (lists, reports, boards — deleted tickets behave as absent)?

**Auth & Security**
- Google OAuth **auth-code** exchanged server-side (`services/googleOAuth.ts`); audience = `GOOGLE_CLIENT_ID`; client identity never trusted?
- Platform admin rides JWT claim `pa` (`users.isPlatformAdmin`); platform-admin-level operations gated by `requirePlatformAdmin` middleware — hiding UI is not the boundary?
- Project roles (`PROJECT_ADMIN | MEMBER`) enforced by `authenticate` → `resolveProject` → `requireProjectMember` / `requireProjectAdmin`, with decisions centralized in `services/accessControl.ts`?
- JWT signed/verified with `jose` (`utils/jwt.ts`) carrying `{ sub, email, pa, ver }`; TTL = `JWT_TTL` (default 8h); logout bumps token version to invalidate prior tokens?
- `ALLOWED_DOMAIN` enforced when set?
- All rich text sanitized in both directions via `utils/sanitizeHtml.ts` (`javascript:` / `data:` URIs rejected; http(s) image URLs only)?
- Client-supplied board positions validated server-side rather than trusted verbatim?
- CORS restricted to `FRONTEND_URL` (no wildcards in prod)?
- No secrets/tokens/JWTs/payloads logged?

**Error Handling**
- Consistent envelope `{ data: T }` on success, `{ error: { code, message, details? } }` on failure, with codes from the fixed set (`VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_ERROR`)?
- Errors thrown as `AppError` (`utils/appError.ts`) and handled centrally by `middleware/errorMiddleware.ts` — no hand-written status codes in routes?
- No leaking stack traces, SQL, or secrets in responses?
- No swallowed exceptions (empty `catch {}`)?

**Logging**
- Structured logging via pino / pino-http (`config/logger.ts`, `middleware/requestLogger.ts`) — no `console.log`/`console.error` in production paths?

### 4b. React 19 / TypeScript / Tailwind CSS Frontend

**State Management**
- State split respected: React Query for all server state; Zustand only for the three client stores (`useAuthStore` user + JWT with localStorage persistence, `useProjectStore` last project, `useBoardUiStore` filters/search/drag)?
- No new state libraries introduced? `useState` for genuinely local state?
- localStorage persistence handled cleanly (user + JWT persisted; no stale-closure bugs around refreshed tokens)?

**Hooks**
- Custom hooks extracted for reusable logic (`useAuthSync` coalesced 401 refresh / cross-tab logout sync)?
- `useEffect`/`useMemo`/`useCallback` dependencies correct? Cleanup for timers/intervals (server-time-synced elapsed on timer controls, board polling per `VITE_POLL_INTERVAL_SECONDS`)?

**TypeScript**
- Explicit types instead of `any` (use `unknown` when truly unknown)?
- Interfaces/types defined for props and API payloads, matching the backend envelope exactly (`{ data }` unwrapping reflected in return types — no invented shapes)?
- Proper null handling? `import type` used for type-only imports?

**Error Handling**
- Errors caught and handled appropriately? `async`/`await` wrapped in `try/catch`?
- API failures surfaced as `ApiClientError(status, code, details)`; 401 triggers coalesced refresh + single retry via `useAuthSync` (single logout when refresh fails); project-scoped 403 redirects to `/projects`?
- React error boundaries for component crashes?

**Component Design**
- Components focused (single responsibility)? Prop drilling avoided where a store/query hook is idiomatic?
- Functional components with hooks only? DnD reorder math kept in `utils/boardReorder.ts` rather than components?
- Destructive or role-changing actions (delete, deactivate, promote/demote) go through a confirmation modal before executing?

**Routing**
- Route guards via `RequireAuth` on app routes and `RequirePlatformAdmin` on `/settings` (`src/routes/index.tsx`, `createBrowserRouter`); platform-admin UI hidden from non-admins?
- Lazy-loaded routes with Suspense + ErrorBoundary? Ticket detail rendered as modal-overlay route `/projects/:slug/tickets/:displayId`?

**Styling**
- Tailwind v4 CSS-first config (`src/index.css`): `@theme` OKLCH tokens + `.dark` variant referenced instead of hex literals / stray arbitrary values? Semantic CSS variables used over raw colors?
- Radix-based primitives under `components/ui` reused rather than one-off re-implementations? No new styling system introduced?

**Security**
- Secrets only in environment variables (`VITE_*`)? Bearer token sourced from `useAuthStore` inside `apiFetch` only — never logged or embedded in markup?
- Raw HTML injection avoided (`dangerouslySetInnerHTML`); rich text rendered from sanitized server content; image URLs restricted to http(s)?
- 401 → refresh flow working (coalesced across concurrent requests) and logging out synced across tabs?

**API Client**
- All requests through `api/client.ts` `apiFetch<T>()` — attaches Bearer, unwraps `{ data }`, throws typed errors? Domain modules live in `api/*.ts` with typed returns? No ad-hoc `fetch`/request libraries?

## 5. Test Coverage

- **Backend tests** present for new logic: Vitest + supertest against the exported Express app, real Postgres test DB injected by `backend/vitest.config.ts`; `jose` and Google OAuth mocked?
- **Frontend tests** use Vitest + Testing Library (jsdom via `src/test-setup.ts`), mocking at the api-module boundary with `vi.mock` — never real network? DnD components wrapped with `renderInDnd` from `src/test/dndWrapper.tsx`?
- Slykboard edge cases covered alongside happy paths: membership matrix (non-member → 403 `FORBIDDEN`; MEMBER vs PROJECT_ADMIN gates), soft-delete → 404 semantics, validation → 400 `VALIDATION_FAILED`, conflict paths (duplicate slug / duplicate label name), auth expiry (401 + refresh flow), ticket position moves mid-board, timer ownership (one running timer per user), cross-project id access denied?
- Mocks appropriate (`vi.fn()` / api-module mocks for frontend; mocks of `jose` and OAuth at module boundary for backend)?
- Coverage: business logic >80%, components >70%?
- **Gate:** `make gate` (typecheck + build + lint + prettier + test across workspaces) must pass green before any pre-review/pre-report verdict — authoritative merge-gate signal. Single-file reruns use e.g. `npm run test -w backend -- src/utils/jwt.test.ts`.

## 6. Provide Senior-Level Review Summary

Offer direct, actionable feedback:
- Call out risks
- Highlight strengths
- Suggest improvements
- Indicate whether changes ready to merge or need revisions (backed by a green `make gate` run)

## 7. Aim for Practical, High-Value Feedback

Goal: emulate real PR review from experienced engineer — clear, specific, focused on what matters.

## 8. Write Comprehensive PR Review Report

Write comprehensive PR review report as markdown file, save in `./.docs/ai-generated` directory. Report includes:
- Summary of changes
- Code quality assessment
- Performance considerations
- Security implications
- Testing coverage
- Recommendations
- Whether changes ready to merge or need revisions

---

## Express / React Code Review Checklist

### Architecture & Design
- [ ] Follows standard project structure (`backend/src/routes|middleware|services|db`, `frontend/src/`)
- [ ] Proper separation of concerns (route vs middleware vs service vs db; component vs hook vs store/query)
- [ ] React Query owns server state; Zustand owns client state — no overlap or duplication
- [ ] Components focused with single responsibility

### TypeScript
- [ ] Explicit types instead of `any`
- [ ] Interfaces defined for props and API payloads (envelope-aware)
- [ ] Proper null handling
- [ ] Type-only imports use `import type`

### Express (Backend)
- [ ] Parameterized Drizzle queries (`sql` template literal only where raw SQL is required) — no string-built SQL / injection surface
- [ ] Multi-statement mutations wrapped in `db.transaction` inside services (e.g. label reorder + activity log, member promote/demote)
- [ ] Pool singleton respected (`src/db/client.ts`, max 5) — no ad-hoc connections
- [ ] Schema changes land as journal migrations (`make migrate-generate` → `make migrate`), never push-sync; enum partial-index placeholders reconciled to literals before applying
- [ ] Durations/timestamps persisted from server clock into `timeEntries`; client clock advisory/display-only
- [ ] Soft-deleted tickets excluded from every read path (lists, boards, reports, timers) with 404 semantics on direct access
- [ ] Rich text sanitized both directions via `utils/sanitizeHtml.ts`; `javascript:`/`data:` URIs rejected; http(s) images only
- [ ] Client-supplied board positions validated server-side
- [ ] Validation at the route edge (co-located Zod schemas)
- [ ] JWT verify middleware on protected routes; platform-admin ops gated by `requirePlatformAdmin`; project access via `authenticate` → `resolveProject` → `requireProjectMember`/`requireProjectAdmin`; decisions centralized in `services/accessControl.ts`
- [ ] No swallowed exceptions (empty catch blocks); errors thrown as `AppError`
- [ ] No `console.log` — structured logging via pino / pino-http

### React (Frontend)
- [ ] Functional components with hooks
- [ ] Custom hooks for reusable logic (`useAuthSync`)
- [ ] No unnecessary re-renders (`useMemo`/`useCallback` where measured)
- [ ] React Query for server state; Zustand stores for auth/project/board UI only
- [ ] Tailwind v4 CSS-first tokens (OKLCH `@theme` in `src/index.css`, `.dark` variant) — semantic vars over hex, no magic values
- [ ] Radix-based `components/ui` primitives reused
- [ ] Routes gated: `RequireAuth` app-wide, `RequirePlatformAdmin` for `/settings`
- [ ] DnD position math kept in `utils/boardReorder.ts`; ticket detail as modal-overlay route
- [ ] Confirmation modal required for destructive / role-changing actions (delete, deactivate, promote/demote)

### Error Handling
- [ ] `try/catch` for async operations
- [ ] React error boundaries
- [ ] Consistent envelope: `{ data }` success / `{ error: { code, message, details? } }` failure with fixed code set
- [ ] API errors surfaced as `ApiClientError(status, code, details)`; 401 coalesced refresh + single retry; project-scoped 403 redirects to `/projects`
- [ ] Meaningful error messages

### Security
- [ ] No secrets in code — all via env vars
- [ ] Input validation server-side
- [ ] OAuth auth-code exchanged server-side (`services/googleOAuth.ts`, audience = `GOOGLE_CLIENT_ID`); JWT claims `{ sub, email, pa, ver }` via `jose`, TTL `JWT_TTL` (default 8h), logout = token-version bump; never logged
- [ ] CORS configured explicitly (frontend URL only)
- [ ] `ALLOWED_DOMAIN` enforced when set

### Performance
- [ ] No unnecessary re-renders (frontend)
- [ ] No N+1-style query patterns (backend)
- [ ] Lazy loading for routes (`React.lazy`) where appropriate
- [ ] Database indexes for new query/filter columns

### Testing
- [ ] Backend tests present (Vitest + supertest against exported app, real Postgres test DB from `backend/vitest.config.ts`; `jose` and OAuth mocked)
- [ ] Frontend tests use Vitest + Testing Library, `vi.mock` at api-module boundary; DnD tests use `src/test/dndWrapper.tsx`
- [ ] Error cases covered (membership matrix, soft-delete 404, validation 400, conflicts, auth expiry/refresh, position moves, timer ownership, cross-project access)
- [ ] Mocks appropriate
- [ ] `make gate` passes green (authoritative pre-review gate)

### Code Quality
- [ ] Follows naming conventions
- [ ] Proper import organization
- [ ] No magic numbers — constants defined
- [ ] Early returns to reduce nesting
- [ ] Commit messages follow `SLYK-<id>: <subject>` convention