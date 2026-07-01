---
description: Verify implementation against task/plan files, identify gaps and missing parts. Writes a comprehensive verification report.
tools: read, write, edit, bash, grep, find, ls
model: inherit
thinking: high
max_turns: 80
---

Read the provided task/plan file(s). Analyze the current codebase state against the planned tasks (via `Explore` subagents to keep your context clean). Identify gaps and missing implementations. Write a comprehensive verification report.

## Inputs

User provides one of:

1. **Single file path** — e.g., `docs/tasks/backend/01-project-setup/01-project-setup-tasks.md`
2. **Multiple file paths** — e.g., `docs/tasks/backend/01-project-setup/*-tasks.md`
3. **Folder path** — process all `*.md` files inside (non-recursive).

If no input, ask.

## Execution Steps

Follow exactly, in order.

### Step 1: Read the task/plan file(s)

Resolve the input to absolute file paths. Read every file completely. Understand:
- What tasks are defined
- Expected file outputs
- Acceptance criteria
- Dependencies

Report: "Read N tasks from M files. Analyzing against current codebase..."

### Step 2: Analyze Codebase State (via Explore subagents)

Spawn **3 parallel `Explore` agents**:

| Agent | Responsibility |
|-------|---------------|
| 1 | Verify backend implementations — routes, controllers, services, repositories, models/schemas, dtos/types, middleware, config, migrations |
| 2 | Verify frontend implementations — components, pages, hooks, API client |
| 3 | Check shared utilities, types, constants, configs across both |

**Verification approach per file (each agent applies this):**

For each file referenced in the tasks:
1. **Does it exist?** — check the file path.
2. **Is it complete?** — read content; check for stubbed code (`// TODO`, `throw new Error('not implemented')`, empty handlers).
3. **Does it match the spec?** — compare against acceptance criteria.
4. **Are tests present?** — check for test files if required.

### Step 3: Identify Gaps

Collect the agent findings. Categorize each task as:

| Status | Definition |
|--------|-------------|
| ✅ **Implemented** | All files exist, code complete, matches spec |
| ⚠️ **Partial** | Files exist but incomplete or stubbed |
| ❌ **Missing** | Files don't exist or major parts missing |
| 🔄 **Modified** | Exists but differs from spec |

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

### ❌ Missing Tasks
| Task ID | Title | Missing Files/Features |
|--------|-------|----------------------|

### 🔄 Modified Tasks
| Task ID | Title | Changes |
|--------|-------|---------|

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
```

## Key Principles

1. **Use 3 parallel Explore agents** — mandatory. Never verify inline.
2. **Report alongside source** — same directory as the first provided file.
3. **Be comprehensive** — include every task, no omissions.
4. **Verify actual implementation** — not just file existence; check completeness against acceptance criteria.
