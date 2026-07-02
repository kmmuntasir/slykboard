---
name: task-list-writing
description: Format a parallelizable task breakdown from structured data. Batching/dependency/parallelization strategy, developer tracks, per-task fields, and the file-naming rule for the dev-writer agent.
---

# Task List Writing

Reference skill for the `dev-writer` agent (task-breakdown task). You format a **task breakdown** from structured data handed to you by the `task-breakdown-agent`. You do not investigate or synthesize.

## File-naming rule

`{plan-basename}-tasks.md`, **alongside** the plan. (Example: `SLYK-300-plan.md` → `SLYK-300-plan-tasks.md`.)

## Granularity reminder

One task = a tightly-coupled few files (minimize merge-conflict surface). Dependencies are explicit by task number.

## Faithfulness

Render the structured data **exactly**. Do not invent tasks, dependencies, or acceptance criteria.

## Full template

````markdown
# Task Breakdown — {TICKET_ID}
**Plan:** `{path-to-plan}`
**Generated:** {ISO date}

---

## Parallelization Strategy

Tasks are grouped into batches by dependency order. Run batches sequentially;
within a batch, conflict-free tasks run in parallel.

### Batch / Dependency Diagram
```
Batch 1: [T1] ──┐
                ├──> Batch 2: [T3] ──> Batch 3: [T4]
          [T2] ─┘
```

### Merge-order rules
- Merge lower-numbered batches first.
- Within a batch, merge in stable task-number order.

### Summary
| # | Batch | Target File | Dependencies | Can Parallel With |
|---|-------|-------------|--------------|-------------------|
| T1 | 1 | `path` | None | T2 |
| T2 | 1 | `path` | None | T1 |
| T3 | 2 | `path` | T1, T2 | — |
| T4 | 3 | `path` | T3 | — |

### Suggested developer tracks
- **Track A:** T1 → T3
- **Track B:** T2 → T4

---

## Tasks

### T1 — {concise, action-oriented title}
**Description:** <detailed, with source references — file paths, line numbers, function names.>
**Acceptance criteria:**
- [ ] <verifiable outcome>
**Dependencies:** None | T<N>
**Subtasks:** *(only if complex)*
- <subtask>

### T2 — {title}
...
````
