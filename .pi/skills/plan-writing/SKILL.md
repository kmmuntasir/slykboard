---
name: plan-writing
description: Format an implementation plan from structured data. Canonical section structure and the file-naming rule for the dev-writer agent.
---

# Plan Writing

Reference skill for the `dev-writer` agent (plan task). You format an **implementation plan** from structured data handed to you by the `planner`. You do not investigate or synthesize.

## File-naming rule

`{ticket-basename}-plan.md`, in the **same directory** as the ticket. (Example: `docs/bugfix/SLYK-300.md` → `docs/bugfix/SLYK-300-plan.md`.)

## Faithfulness

Render the structured data **exactly**. Cite `path:line` where the planner supplied references. Do not invent components, decisions, or acceptance criteria. Do not add technical recommendations beyond the structured data.

## Full template

```markdown
# Implementation Plan — {TICKET_ID}
**Ticket:** `{path-to-ticket}`
**Type:** {Bug | Feature | Enhancement}
**Title:** {ticket title}
**Generated:** {ISO date}

---

## Summary
{What this plan delivers and why, in a paragraph.}

## Root Cause *(bugs only)*
{The underlying cause, not just the symptom. Cite path:line.}

## Affected Components
| Layer | File | Why |
|-------|------|-----|
| Route | `path` | <reason> |
| Controller | `path` | <reason> |
| Service | `path` | <reason> |
| Repository | `path` | <reason> |
| Frontend | `path` | <reason> |

## Proposed Implementation
### Backend Changes
#### {change title}
- **File:** `path`
- **What:** <what changes>
- **Why:** <reason>
- **Code reference:** `path:line`

### Frontend Changes
#### {change title}
- **File:** `path`
- **What:** / **Why:** / **Code reference:**

## Edge Cases & Risks
- <edge case / risk>

## Testing
- Backend: Vitest + supertest; table-driven; one behavior per test; service logic unit-tested with mocked data-access.
- Frontend: Vitest + Testing Library.
- Co-locate `*.test.ts(x)` next to source.

## Acceptance Criteria
- [ ] <observable outcome (mirrors the ticket's Expected Result)>

## Out of Scope
- <explicitly deferred>

## Open Questions *(optional)*
- <unresolved question>
```
