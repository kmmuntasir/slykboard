---
description: Read a ticket file (bug, feature, or enhancement), analyze the codebase, and write a comprehensive implementation plan.
tools: read, write, edit, bash, grep, find, ls
model: inherit
thinking: high
max_turns: 80
---

Read the provided ticket carefully, understand what needs to be delivered, analyze the codebase via `Explore` subagents (to keep your context clean), then write a complete and comprehensive implementation plan as a new markdown file in the **same folder** as the ticket.

The ticket may be a **bug**, **feature**, or **enhancement** — adapt the analysis focus and plan shape to the ticket type.

## Inputs

User provides a **ticket file path**. If no input is provided, **ask** for the ticket file path. Do not guess.

## Execution Steps

Follow exactly, in order.

### Step 1: Read & understand the ticket

Resolve the input to an absolute path and read it **completely**. Extract and hold in context:

- **Ticket ID** (e.g., `SLUG-TICKET_NUMBER`) — derive from the filename or the ticket heading
- **Ticket type** — bug / feature / enhancement. Infer from content.
- **What needs to be delivered** — the requirement or defect, in your own words
- **Named endpoints, entities, roles, domains** (backend / frontend)

State your understanding back: "Read ticket SLYK-300 (bug) — <one-line summary>. Analyzing codebase..."

### Step 2: Analyze the codebase (via Explore subagents) — MANDATORY

**You MUST spawn `Explore` subagents to investigate the codebase. Do NOT read the source files yourself.** Spawn **3 parallel `Explore` agents** to investigate. The split adapts to the ticket type.

**For a bug** — focus on the defect:

| Agent | Responsibility |
|-------|---------------|
| **Repro path** | Trace the reproduction path end-to-end. Locate the routes/controllers/services named in the ticket, read the exact code path, and confirm where the buggy behavior occurs. Cite `path:line`. |
| **Root cause** | Pinpoint the defect — the missing guard / wrong branch / bad assumption, *why* it allows the bad behavior, and where the correct check belongs. |
| **Prior art & fix surface** | Map patterns to reuse: similar existing guards, error classes, validation schemas, test fixtures, and any frontend impact. |

**For a feature / enhancement** — focus on the design surface:

| Agent | Responsibility |
|-------|---------------|
| **Integration points** | Where the new/changed capability plugs in: relevant routes/controllers/services/repositories, the Drizzle schema it extends, and any new API contract. Cite `path:line`. |
| **Patterns & conventions** | Existing precedents to mirror: analogous features, naming, Zod validation, centralized error handling, config externalization via env vars. |
| **Cross-cutting & frontend** | Shared types/utilities, security/RBAC implications, and frontend impact (API client, hooks, components, pages, routes, stores). |

Each agent returns a **curated digest** with `path:line` evidence — not raw file dumps. Work from those digests.

### Step 3: Synthesize the approach

Combine the digests into a single coherent picture:

- **Bug** → state the root cause (what + why) and the minimal, convention-correct fix set
- **Feature / enhancement** → state the design: new/changed schema, DTOs/types, services, routes/controllers, API contract, migrations, frontend pieces — and a sensible build order
- **Both** → list edge cases & risks and any open questions

### Step 4: Write the implementation plan

Write the plan to the **same directory as the ticket**, named `{ticket-filename}-plan.md`.

## Plan Template

```markdown
# Implementation Plan — {TICKET_ID}

**Ticket:** `{path-to-ticket}`
**Type:** {Bug | Feature | Enhancement}
**Title:** {ticket title}
**Generated:** {ISO date}

---

## Summary

{1–2 paragraph restatement of what needs to be delivered.}

## Root Cause  *(bugs only)*

{The precise defect with `path:line` evidence.}

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| Route | `backend/src/routes/xxxRoutes.ts` | ... |
| Controller | `backend/src/controllers/xxxController.ts` | ... |
| Service | `backend/src/services/xxxService.ts` | ... |
| ... | ... | ... |

## Proposed Implementation

### Backend Changes
...

### Frontend Changes
...

## Edge Cases & Risks

- {concurrency / RBAC / related paths / regressions / migration concerns}

## Testing

- **Unit tests:** {service/repository-level cases}
- **HTTP tests:** {route/controller via supertest, if applicable}
- **Integration tests:** {critical flows only}
- **Manual verification:** {re-run the ticket's reproduce steps for bugs}

## Acceptance Criteria

- [ ] {verifiable outcome}
- [ ] ...

## Out of Scope

- {anything explicitly not addressed}
```

## Key Principles

- **Delegate analysis, write yourself.** Investigate ONLY via `Explore` subagents; synthesize and write the plan yourself.
- **Evidence-backed.** Every code claim cites `path:line`.
- **Convention-correct.** Respect the layered call rule and the project's style.
- **Adapt to the ticket type.** Bugs hunt a root cause; features lay out a design.
