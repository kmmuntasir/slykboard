---
name: breakdown-plan-into-tasks
description: Break a large implementation plan into small, parallelizable tasks for individual developers. Use when user requests to break down a plan into tasks.
---

# Task Breakdown Skill

Read the provided plan file. Then follow the two-phase process below. Analyze the codebase via isolated `analyst` delegations (to keep your context clean).

## Phase 1: Codebase Analysis (via `analyst` delegations)

Before breaking down tasks, **analyze the codebase** to build an accurate understanding and fill the knowledge gaps a plan may leave implicit. This prevents tasks from referencing nonexistent files, wrong abstractions, or outdated patterns.

Specifically:

- **Verify every file path and module** the plan mentions — confirm they exist, or note they need creation.
- **Map current architecture** — understand existing patterns, conventions, and interfaces the plan builds on.
- **Identify hidden coupling** — shared types, utilities, or config the plan doesn't explicitly call out but tasks will touch.
- **Check for prior art** — search for existing implementations that partially cover what the plan describes.

Dispatch **up to 3 parallel `analyst` delegations** via the delegate script to speed up this phase and keep the main context window clean:

```bash
./.pi/skills/delegate/scripts/delegate.sh --parallel \
  analyst "Verify file/module existence, map directory structure, check build/config files for plan at <path>: <plan summary or paste>." \
  analyst "Trace data flow and interfaces the plan references — read the relevant source files. Plan: <...>." \
  analyst "Search for prior art, existing utilities, and hidden coupling across the codebase relevant to plan: <...>."
```

| Delegation | Responsibility |
|------------|---------------|
| 1 | Verify file/module existence, map directory structure, check build/config files |
| 2 | Trace data flow and interfaces the plan references — read relevant source files |
| 3 | Search for prior art, existing utilities, and hidden coupling across the codebase |

Each delegation returns a concise summary. Use those summaries — not raw exploration — to inform the breakdown.

## Phase 2: Task Breakdown

Using the plan plus the codebase analysis, break the work into small, self-contained tasks that individual developers can pick up independently. Continue using **up to 3 parallel `analyst` delegations** during this phase to draft batches of tasks concurrently:

```bash
./.pi/skills/delegate/scripts/delegate.sh --parallel \
  analyst "Draft Batch 1 tasks (no dependencies) from plan <path> + analysis <...>." \
  analyst "Draft Batch 2 tasks (depends on Batch 1) from plan <path> + analysis <...>." \
  analyst "Draft Batch 3+ tasks and a visual dependency diagram from plan <path> + analysis <...>."
```

| Delegation | Responsibility |
|------------|---------------|
| 1 | Draft Batch 1 tasks (no dependencies) |
| 2 | Draft Batch 2 tasks (depends on Batch 1) |
| 3 | Draft Batch 3+ tasks and the visual dependency diagram |

Merge the delegation outputs into the final document, resolving conflicts or gaps.

## Output

Write the results to a new file alongside the plan, named `{plan-filename}-tasks.md`.

## Task Format

Each task must include:

- **Title** — concise, action-oriented (e.g., "Extract WebSocket manager into ES module")
- **Description** — detailed enough for a developer unfamiliar with the plan to execute. Include source references (file paths, line numbers, function names, codeblocks), what to create/modify, and relevant context.
- **Acceptance Criteria** — specific, verifiable checklist items.
- **Subtasks** — only if the task is complex enough to warrant them.
- **Dependencies** — exact task numbers this depends on, or "None".

## Parallelization Strategy

Include a batch-based execution model at the top of the document:

1. **Organize tasks into batches** by dependency order — all tasks within a batch can run in parallel with zero merge conflicts.
2. **Include a visual batch diagram** showing dependency flow.
3. **State merge-order rules** — which batches must merge before others can start.
4. **Provide a summary table** — columns: `#`, Batch, Target File, Dependencies, Can Parallel With.
5. **Suggest developer assignment tracks** — 2–3 developer paths through the batches.

## Key Principles

- **One task = only a few files (a tightly coupled set)** — minimize merge-conflict surface.
- **Dependencies are explicit** — every dependency listed by task number.
- **Delegate analysis, write the breakdown yourself** — keep the main context clean.
