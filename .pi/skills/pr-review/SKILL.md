---
name: pr-review
description: Comprehensive PR review covering the Node.js/Express + PostgreSQL backend and React/TypeScript frontend — architecture, correctness, security, and test coverage. Use when the user requests a review of a pull request or a branch comparison.
---

# PR Review Skill

When the user requests a **PR review** or to **compare branches**:

### Branch Defaults

- **Source branch**: current local branch (`git branch --show-current`).
- **Target branch**: `main`, unless the user explicitly specifies a different branch.
- If the user specifies both, use those.

### Pre-Review: Branch Synchronisation

Before review, both branches must be up-to-date and the source must be rebased onto the target (the project uses **Rebase and Merge** on GitHub).

> ⚠️ These steps reset local branches to `origin` and discard uncommitted local changes. Confirm with the user before running if there's any uncommitted work.

**Standard mode** (online):

```bash
git fetch --all
git checkout <target-branch> && git reset --hard origin/<target-branch>
git checkout <source-branch> && git reset --hard origin/<source-branch>
git rebase <target-branch>
```

**Offline mode**: if the user says **"offline"** when invoking this skill, skip steps 1–3 entirely. Only run the rebase (step 4) against the local copy of the target branch — review purely local state without network access.

**Conflict handling**: if the rebase in step 4 produces merge conflicts, **stop the entire review**. Abort the rebase (`git rebase --abort`), inform the user of the conflicts, and do not proceed with any review steps.

If the rebase succeeds, proceed to the review steps below.

### Parallel Agent Strategy

Accelerate the review using **3 parallel `Explore` agents** (read-only, so they can't mutate the tree). Split independent review tasks across agents to save your context window and speed up the process.

Spawn 3 `Explore` agents in parallel via the Agent tool:

| Agent | Scope |
|-------|-------|
| 1 | **Diff analysis + architecture review** — Run `git diff <target>..<source>` and `git log <target>..<source> --oneline`. Identify change types, assess correctness/readability/maintainability/architectural alignment/performance/security. Cite `path:line`. |
| 2 | **Stack-specific checks** — Express/Node backend layering, data access/migrations, validation, transactions, error handling, auth/logging; React/TS frontend state/hooks/types/error handling/component design/drag-and-drop/security/API client. |
| 3 | **Test coverage + code quality** — Backend Vitest/supertest, frontend Vitest + Testing Library, error cases, mocks; plus naming/import/constant/early-return checklist. |

**When to parallelise:** **always** use parallel agents — even for tiny diffs. **Never review inline.** The 3-agent fan-out is mandatory; do not reduce it.

## 1. Run Complete Diff

Compare the source branch against the target branch. Analyze **actual code changes**, not just commit messages.

```bash
git diff <target>..<source>
git log <target>..<source> --oneline
```

## 2. Identify Change Types

Determine what each change represents: feature addition, bug fix, refactor, cleanup, potential breaking change. Note missing tests, incomplete docs, inconsistencies.

## 3. Assess Code Quality & Impact

Evaluate: **correctness** (does it work?), **readability**, **maintainability**, **architectural alignment** (project patterns), **performance implications**, **security considerations**. Check whether tests adequately cover the changes.

## 4. Stack-Specific Review Items

### 4a. Node.js / Express + PostgreSQL Backend

**Layering** — Route → Controller → Service → Repository flow respected? Controllers thin (HTTP only), business logic in the service layer?

**Data Access & Migrations** — parameterized queries / ORM query builder (no string-concat SQL / injection)? Migrations ordered and reversible? PostgreSQL indexes added for new query/filter columns? No N+1 queries?

**Validation** — every request validated at the edge (Zod/Joi) on `body`/`params`/`query`? Errors surfaced as `400` with the project's consistent error shape?

**Transactions & Concurrency** — multi-statement mutations wrapped in a single DB transaction?

**Error Handling** — all errors funnelled through centralized error-handling middleware? No leaking raw stack traces / SQL / paths / secrets? No swallowed exceptions?

**Auth & Authorization** — Google OAuth/JWT & Admin/Member role enforcement via middleware (not inline) on new endpoints?

**Logging** — project logger used (no `console.log`, no secrets/PII/credentials)?

### 4b. React 19 / TypeScript Frontend

**State Management** — React Query for server state? Zustand for client/global UI, `useState` for local? Unnecessary re-renders?

**Hooks** — custom hooks for reusable logic? Correct `useEffect`/`useMemo`/`useCallback` deps? Stale closures?

**TypeScript** — explicit types instead of `any`? Interfaces for props/API responses? Proper null handling?

**Error Handling** — try/catch around async/await? API errors handled gracefully?

**Component Design** — focused (single responsibility)? Props drilling avoided? Functional components + hooks?

**Drag-and-Drop** — `@hello-pangea/dnd` per convention; optimistic UI reconciled with server truth on poll?

**Security** — secrets only in env vars? Input validated server-side? API tokens handled securely?

**API Client** — fetch/axios with proper error handling? `import.meta.env.VITE_*`? Auth token included?

## 5. Test Coverage

Backend tests present for new logic (Vitest + supertest, mocked or test DB)? Frontend tests use Vitest + Testing Library? Error cases covered alongside happy paths? Mocks appropriate?

## 6. Provide Senior-Level Review Summary

Offer direct, actionable feedback: call out risks, highlight strengths, suggest improvements, and indicate whether the changes are ready to merge or need revisions.

## 7. Aim for Practical, High-Value Feedback

The goal is to emulate a real PR review from an experienced engineer — clear, specific, focused on what matters.

## 8. Write Comprehensive PR Review Report

Write the comprehensive PR review report as a markdown file, saved in `./docs/ai_generated`. The report includes: summary of changes, code quality assessment, performance considerations, security implications, testing coverage, recommendations, and whether the changes are ready to merge or need revisions.

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
- [ ] Type-only imports use the `type` keyword

### Node.js / Express (Backend)
- [ ] `async` route handlers wrapped so rejections reach the error middleware
- [ ] No swallowed exceptions (empty catch blocks)
- [ ] Repository / query builder uses parameterized queries (no string concat / injection)
- [ ] No `console.log` — logging via the project logger
- [ ] Secrets only via env config

### React (Frontend)
- [ ] Functional components with hooks
- [ ] Custom hooks for reusable logic
- [ ] No unnecessary re-renders (`useMemo`, `useCallback` where needed)
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
- [ ] Lazy loading for routes (`React.lazy`) where appropriate

### Testing
- [ ] Backend tests present (Vitest + supertest for new logic)
- [ ] Frontend tests use Vitest + Testing Library
- [ ] Error cases covered
- [ ] Mocks appropriately used (`vi.fn()` frontend, data-access mocks backend)

### Code Quality
- [ ] Follows naming conventions
- [ ] Proper import organization
- [ ] No magic numbers — constants defined
- [ ] Early returns to reduce nesting
