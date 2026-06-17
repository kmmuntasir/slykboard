---
name: pr-review
description: Comprehensive PR review covering the Node.js/Express + PostgreSQL backend and React/TypeScript frontend: architecture, correctness, security, and test coverage. Use when user requests to review a pull request or compare branches for code review.
---

# PR Review Skill

When user requests **PR review** or to **compare branches**:

### Branch Defaults

- **Source branch**: Current local branch. Determine with `git branch --show-current`.
- **Target branch**: `main`, unless user explicitly specifies different branch.
- If user specifies both branches, use those values.

### Pre-Review: Branch Synchronisation

Before review, both branches must be up-to-date and source must be rebased onto target (project uses **Rebase and Merge** on GitHub).

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
| 2 | Stack-specific checks (Express/Node backend + React/TS frontend) | `general-purpose` |
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

### 4a. Node.js / Express + PostgreSQL Backend

**Layering**
- Route → Controller → Service → Repository flow respected (no controller/route → DB shortcuts)?
- Controllers thin (HTTP only: parse/validate input, call service, shape response), business logic in service layer?

**Data Access & Migrations**
- Parameterized queries / ORM query builder used (no string-concatenated SQL / injection)?
- Migrations ordered and reversible (Prisma migrate / Drizzle Kit / Knex / raw SQL migrations)?
- PostgreSQL indexes added for new query/filter columns?
- No N+1 queries — joins / includes / `with` relations used for associations?

**Validation**
- Every request validated at the edge (Zod/Joi/express-validator) on `body`/`params`/`query`?
- Validation errors surfaced as `400` with the project's consistent error shape?

**Transactions & Concurrency**
- Multi-statement mutations wrapped in a single DB transaction (e.g. ticket move + activity log)?
- Timer start/stop and `ticket_number` sequence generation race-safe?

**Error Handling**
- All errors funnelled through a centralized error-handling middleware?
- No leaking raw stack traces, SQL, internal paths, or secrets in responses?
- No swallowed exceptions (empty `catch {}`)?

**Auth & Authorization**
- Google OAuth/JWT & Admin/Member role enforcement applied to new endpoints (via middleware, not inline)?
- Token issue/verify follows existing project pattern?

**Logging**
- Project logger (pino/winston/morgan) used — no `console.log`, no secrets/PII/credentials logged?

### 4b. React 19 / TypeScript Frontend

**State Management**
- React Query used for server state (board polling/caching at 30s interval)?
- Zustand used for client/global UI state, useState for local state?
- Unnecessary re-renders?

**Hooks**
- Custom hooks extracted for reusable logic?
- Dependencies in useEffect/useMemo/useCallback correctly specified?
- Stale closures?

**TypeScript**
- Explicit types used instead of `any`?
- Interfaces defined for props and API responses?
- Proper null handling in place?

**Error Handling**
- Errors caught and handled appropriately?
- async/await calls wrapped in try/catch?
- API calls handle error responses gracefully?

**Component Design**
- Components focused (single responsibility)?
- Props drilling avoided (use Zustand or composition)?
- Components using functional components with hooks?

**Drag-and-Drop**
- `@hello-pangea/dnd` used per project convention; optimistic UI reconciled with server truth on poll?

**Security**
- Secrets only in environment variables?
- Input validation done server-side?
- API tokens handled securely?

**API Client**
- fetch or axios used with proper error handling?
- Environment variables properly accessed (`import.meta.env.VITE_*` for frontend)?
- Authentication token included in requests?

## 5. Test Coverage

- Backend tests present for new logic (Vitest/Jest, supertest for HTTP, mocked or test DB)?
- Frontend tests use Vitest + Testing Library (`@testing-library/react`) when adopted?
- Error cases covered alongside happy paths?
- Mocks appropriately used (`vi.fn()` for frontend, data-access mocks for backend)?

## 6. Provide Senior-Level Review Summary

Offer direct, actionable feedback:
- Call out risks
- Highlight strengths
- Suggest improvements
- Indicate whether changes ready to merge or need revisions

## 7. Aim for Practical, High-Value Feedback

Goal: emulate real PR review from experienced engineer — clear, specific, focused on what matters.

## 8. Write Comprehensive PR Review Report

Write comprehensive PR review report as markdown file, save in `./docs/ai_generated` directory. Report includes:
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
- [ ] Follows standard project structure (`backend/src/...`, `frontend/src/...`)
- [ ] Proper separation of concerns (route vs controller vs service vs repository; components vs hooks vs utils vs stores)
- [ ] Zustand / React Context used appropriately for client/global state
- [ ] Components focused with single responsibility

### TypeScript (Frontend)
- [ ] Explicit types instead of `any`
- [ ] Interfaces defined for props and API responses
- [ ] Proper null handling
- [ ] Type-only imports use `type` keyword

### Node.js / Express (Backend)
- [ ] `async` route handlers wrapped so rejections reach the error middleware
- [ ] No swallowed exceptions (empty catch blocks)
- [ ] Repository / query builder uses parameterized queries (no string concat / injection)
- [ ] `const` applied where idiomatic
- [ ] No `console.log` — logging via project logger (pino/winston)
- [ ] Constructor / module-level DI consistent with project; secrets only via env config

### React (Frontend)
- [ ] Functional components with hooks
- [ ] Custom hooks for reusable logic
- [ ] No unnecessary re-renders (useMemo, useCallback where needed)
- [ ] Zustand / Context used appropriately for global state

### Error Handling
- [ ] try/catch for async operations
- [ ] Error boundaries for React components
- [ ] API errors handled gracefully
- [ ] Meaningful error messages

### Security
- [ ] No secrets in code — all via environment variables
- [ ] Input validation on server (Zod/Joi at the edge)
- [ ] API tokens / JWTs handled securely
- [ ] CORS configured properly (frontend URL only)

### Performance
- [ ] No unnecessary re-renders
- [ ] No N+1 queries
- [ ] Lazy loading for routes (React.lazy) where appropriate

### Testing
- [ ] Backend tests present (Vitest/Jest + supertest for new logic)
- [ ] Frontend tests use Vitest + Testing Library (when adopted)
- [ ] Error cases covered
- [ ] Mocks appropriately used (vi.fn() for frontend, data-access mocks for backend)

### Code Quality
- [ ] Follows naming conventions
- [ ] Proper import organization
- [ ] No magic numbers — constants defined
- [ ] Early returns to reduce nesting
