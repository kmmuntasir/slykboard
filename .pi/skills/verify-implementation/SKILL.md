---
name: verify-implementation
description: Verify implementation against task/plan files, identify gaps and missing parts. Use when user requests verification of implementation completeness against task files in this project.
---

# Verify Implementation Skill

> ## MANDATORY EXECUTION — READ FIRST
>
> Every step below is **mandatory, not optional**. You **MUST** follow them exactly as written.
>
> **The codebase verification (Step 2) MUST be done by dispatching `analyst` subprocesses via `delegate.sh`.** You are **FORBIDDEN** from reading source files yourself to check completeness, even if you think it would be faster or "good enough." The entire point is **context isolation** — you synthesize the report; `analyst` subprocesses do ALL the verification. If you read the files yourself, you have **failed** the workflow. **Do not optimize against this instruction. Spawn the subprocesses.**

Read the provided task/plan file(s). Analyze the current codebase state against the planned tasks (via isolated `analyst` delegations to keep your context clean). Identify gaps and missing implementations. Write a comprehensive verification report.

## Inputs

User provides one of:

1. **Single file path** — e.g., `docs/tasks/backend/01-project-setup/01-project-setup-tasks.md`
2. **Multiple file paths** — e.g., `docs/tasks/backend/01-project-setup/*-tasks.md`
3. **Folder path** — process all `*.md` files inside (non-recursive).

If no input, ask.

## Execution Steps

Follow exactly, in order.

### Step 1: Read the task/plan file(s)

Resolve the input to absolute file paths:

- **Single file** — use as-is
- **Multiple files** — expand the glob
- **Folder** — list `folder/*.md`, exclude non-task files (README, etc.)

Read every file completely. Understand:
- What tasks are defined
- Expected file outputs
- Acceptance criteria
- Dependencies

Report: "Read N tasks from M files. Analyzing against current codebase..."

### Step 2: Analyze Codebase State (via `analyst` delegations)

Analyze the current codebase to determine what's implemented vs. what was planned. Dispatch **3 parallel `analyst` delegations** via the delegate script:

```bash
./.pi/skills/delegate/scripts/delegate.sh --parallel \
  analyst "Verify backend implementations for tasks at <path>: <tasks summary>. Check routes, controllers, services, repositories, models/schemas, dtos/types, middleware, config, Drizzle migrations. Backend at backend/src (Express 5 + Drizzle + PostgreSQL; migrations under backend/src/db/migrations via drizzle-kit generate)." \
  analyst "Verify frontend implementations for tasks at <path>: <tasks summary>. Check components, pages, hooks, API client. Frontend at frontend/src (React 19 + Vite + TanStack Query + Zustand + Tailwind)." \
  analyst "Check shared utilities, types, constants, configs across both backend and frontend for tasks at <path>: <tasks summary>."
```

| Delegation | Responsibility |
|------------|---------------|
| 1 | Verify backend implementations — routes, controllers, services, repositories, models/schemas, dtos/types, middleware, config, Drizzle migrations |
| 2 | Verify frontend implementations — components, pages, hooks, API client |
| 3 | Check shared utilities, types, constants, configs across both |

Each delegation receives the list of tasks from Step 1, its specific scope, and instructions to check each task's file paths and verify existence + completeness.

**Verification approach per file (each delegation applies this):**

For each file referenced in the tasks:
1. **Does it exist?** — check the file path.
2. **Is it complete?** — read content; check for stubbed code (`// TODO`, `throw new Error('not implemented')`, empty handlers, `return null`, `return []`, pass-through routes returning mock data).
3. **Does it match the spec?** — compare against acceptance criteria.
4. **Are tests present?** — check for test files if required.

### Step 3: Identify Gaps

Collect the delegation findings. Categorize each task as:

| Status | Definition |
|--------|-------------|
| ✅ **Implemented** | All files exist, code complete, matches spec |
| ⚠️ **Partial** | Files exist but incomplete or stubbed |
| ❌ **Missing** | Files don't exist or major parts missing |
| 🔄 **Modified** | Exists but differs from spec (note changes) |

For each gap, document:
- Task ID and title
- Missing files/features
- Which acceptance criteria are unmet
- Suggested fix

### Step 4: Write Verification Report

Write a comprehensive report in the **same directory as the first provided file**. Name: `{original-filename}-verification.md`.

**Template:**

```markdown
# Implementation Verification Report

**Source:** `{relative-path-to-task-file}`
**Verified:** {ISO timestamp}
**Total Tasks:** {N}
**Implemented:** {X} ({X/N}%)
**Partial:** {Y}
**Missing:** {Z}

---

## Summary

| Status | Count | Percentage |
|--------|-------|------------|
| ✅ Implemented | {N} | {X/N}% |
| ⚠️ Partial | {Y} | {Y/N}% |
| ❌ Missing | {Z} | {Z/N}% |
| 🔄 Modified | {W} | {W/N}% |

---

## Task-by-Task Results

### ✅ Implemented Tasks

| Task ID | Title | Files |
|---------|-------|-------|
| T1 | Title | backend/src/controllers/offerController.ts |

### ⚠️ Partial Tasks

| Task ID | Title | Missing | Notes |
|--------|-------|---------|-------|
| T2 | Title | backend/src/controllers/offerController.test.ts | Tests not written |

### ❌ Missing Tasks

| Task ID | Title | Missing Files/Features |
|--------|-------|----------------------|
| T3 | Title | backend/src/controllers/salesController.ts |

### 🔄 Modified Tasks

| Task ID | Title | Changes |
|--------|-------|---------|
| T4 | Title | Changed signature |

---

## Detailed Gap Analysis

### Backend Gaps
...

### Frontend Gaps
...

### Shared Gaps
...

---

## Recommendations

1. Priority fixes for missing tasks
2. Suggestions for partial implementations
3. Items needing review

---

## Quick Reference: Task Status

```
T1: ✅ Implemented
T2: ⚠️ Partial (missing tests)
T3: ❌ Missing (file not created)
...
```
```

## Error Handling

- **Can't read file** — ask the user to verify the path.
- **No tasks parsed** — report "No task headings found." Check the markdown structure.
- **Empty codebase** — report all tasks as missing (expected for early-stage verification).
- **Delegation failures** — retry individually; report which delegation failed.

## Important Rules

1. **Use parallel `analyst` delegations** — exactly 3, mandatory. Never verify inline.
2. **Report alongside source** — same directory as the first provided file.
3. **Be comprehensive** — include every task, no omissions.
4. **Document gaps clearly** — what's missing, where, what to fix.
5. **Verify actual implementation** — not just file existence; check completeness against acceptance criteria.
