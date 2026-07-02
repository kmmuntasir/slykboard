---
name: report-writing
description: Format a verification report from structured findings. Status taxonomy, stub detection, gap tables, quick reference, and the file-naming rule for the dev-writer agent.
---

# Report Writing

Reference skill for the `dev-writer` agent (verification task). You format a **verification report** from structured findings handed to you by the `verifier`. You do not investigate or synthesize.

## File-naming rule

`{tasks-basename}-verification.md`, **alongside** the tasks file. (Example: `SLYK-300-plan-tasks.md` → `SLYK-300-plan-tasks-verification.md`.)

## Status taxonomy

`Implemented` / `Partial` / `Missing` / `Modified` (exists but differs from spec).

## Faithfulness

Render the structured findings **exactly**. Include the suggested fix per gap that the verifier supplied. Do not invent gaps or auto-fix anything.

## Stub indicators (flagged by the verifier — for reference)
`// TODO`, `throw new Error('not implemented')`, empty handlers, `return null`, `return []`, pass-through routes returning mock data.

## Full template

```markdown
# Implementation Verification Report
**Source:** `{relative-path-to-task-file}`
**Verified:** {ISO timestamp}
**Total Tasks:** {N}
**Implemented:** {X} ({X/N}%)
**Partial:** {Y}
**Missing:** {Z}
**Modified:** {W}

---

## Summary
| Status | Count | Percentage |
|--------|-------|------------|
| Implemented | X | X% |
| Partial | Y | Y% |
| Missing | Z | Z% |
| Modified | W | W% |

## Task-by-Task Results

### Implemented Tasks
| Task ID | Title | Files |
|---------|-------|-------|
| T1 | <title> | `path`, `path` |

### Partial Tasks
| Task ID | Title | Missing | Notes |
|---------|-------|---------|-------|
| T2 | <title> | `path/to/test` | Tests not written |

### Missing Tasks
| Task ID | Title | Missing Files/Features |
|---------|-------|------------------------|
| T3 | <title> | <file/feature not created> |

### Modified Tasks
| Task ID | Title | Changes |
|---------|-------|---------|
| T4 | <title> | <differs from spec — how> |

## Detailed Gap Analysis

### Backend Gaps
- <gap — task ID, what's missing, unmet acceptance criterion, suggested fix>

### Frontend Gaps
- <gap>

### Shared Gaps
- <gap>

## Verification Run
- Lint: <pass/fail/not run>
- Typecheck/Build: <pass/fail/not run>
- Tests: <pass/fail/not run — count>

## Recommendations
- <suggested next step per material gap>

## Quick Reference: Task Status
- T1: Implemented
- T2: Partial (missing tests)
- T3: Missing (file not created)
- T4: Modified
```
