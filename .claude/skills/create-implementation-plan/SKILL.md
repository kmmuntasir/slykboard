---
name: create-implementation-plan
description: Read a ticket file (bug, feature, or enhancement), analyze the codebase, and write a comprehensive implementation plan. Use when the user hands you a ticket file path and wants an implementation plan generated.
---

# Create Implementation Plan Skill

Read the provided ticket carefully, understand what needs to be delivered, analyze the codebase, then write a complete and comprehensive implementation plan as a new markdown file in the **same folder** as the ticket.

The ticket may be a **bug**, **feature**, or **enhancement** — adapt the analysis focus and plan shape to the ticket type.

## Inputs

User provides a **ticket file path**, e.g.:

- `docs/bugfix/some-bug-ticket.md`
- `docs/feature/notification-matrix/some-ticket.md`
- Absolute or relative path to a single `*.md` ticket

If no input is provided, **ask** for the ticket file path. Do not guess.

## Execution Steps

Follow exactly, in order.

### Step 1: Read & understand the ticket

Resolve the input to an absolute path and read it **completely**. Extract and hold in context:

- **Ticket ID** (e.g., `SLUG-TICKET_NUMBER`) — derive from the filename or the ticket heading
- **Ticket type** — bug / feature / enhancement. Infer from content: repro steps + expected/actual → **bug**; a new capability → **feature**; a modification/tweak to something existing → **enhancement**. State the assumption explicitly.
- **What needs to be delivered** — the requirement or defect, in your own words
- **Named endpoints, entities, roles, domains** (backend / frontend)
- For bugs: the **steps to reproduce** + expected vs. actual result

State your understanding back before analyzing: "Read ticket SLYK-300 (bug) — <one-line summary>. Analyzing codebase..." (swap the type and summary as appropriate).

### Step 2: Analyze the codebase

Use up to **3 parallel `analyst` subagents** (via the Agent tool, `subagent_type: analyst`) to investigate and keep the main context window clean. **The split adapts to the ticket type.**

**For a bug** — focus on the defect:

| Subagent | Responsibility |
|----------|---------------|
| **Repro path** | Trace the reproduction path end-to-end. Locate the routes/controllers/services named in the ticket, read the exact code path, and confirm where the buggy behavior occurs. Cite `path:line`. |
| **Root cause** | Pinpoint the defect — the missing guard / wrong branch / bad assumption, *why* it allows the bad behavior, and where the correct check belongs (respect the layered rule: Route → Controller → Service → Repository). |
| **Prior art & fix surface** | Map patterns to reuse: similar existing guards, the right error classes / HTTP error shapes, error-message conventions, Zod validation schemas, relevant test fixtures, and any frontend impact. |

**For a feature / enhancement** — focus on the design surface:

| Subagent | Responsibility |
|----------|---------------|
| **Integration points** | Where the new/changed capability plugs in: relevant routes/controllers/services/repositories, the Drizzle schema it extends, the next Drizzle migration, and any new API contract. Cite `path:line`. |
| **Patterns & conventions** | Existing precedents to mirror: analogous features already implemented (Drizzle models/schemas, DTOs/types, RBAC middleware, queues/schedulers, Google OAuth/JWT), naming, Zod validation, centralized error handling, config externalization via env vars. |
| **Cross-cutting & frontend** | Shared types/utilities, security/RBAC implications, scheduling/job touches, and frontend impact (API client, hooks, components, pages, routes, stores). |

Backend lives at `backend/src` (Express 5 + Drizzle ORM + PostgreSQL; Drizzle migrations generated via `drizzle-kit generate` and committed under `backend/src/db/migrations`). Frontend lives at `frontend/src` (React 19 + Vite + TanStack Query + Zustand + Tailwind).

Each subagent returns a **curated digest** with `path:line` evidence — not raw file dumps. Work from those digests.

If the ticket is clearly single-layer or small, drop to 1–2 subagents. Add more `analyst` calls only if a digest surfaces a new area worth a focused probe.

### Step 3: Synthesize the approach

Combine the digests into a single coherent picture:

- **Bug** → state the root cause (what + why) and the minimal, convention-correct fix set
- **Feature / enhancement** → state the design: new/changed Drizzle schema, DTOs/types, services, routes/controllers, API contract, migrations, frontend pieces — and a sensible build order (schema → repository → service → controller → route → frontend)
- **Both** → list edge cases & risks (concurrency, RBAC, related paths needing the same change, regressions, migration concerns) and any open questions

Respect project conventions: services own business logic; controllers exchange DTOs/types only; Drizzle migrations are the only schema path; errors handled via centralized Express error middleware; never expose raw DB rows from controllers.

### Step 4: Write the implementation plan

Write the plan to the **same directory as the ticket**, named `{ticket-filename}-plan.md` — e.g. ticket `docs/bugfix/SLYK-300.md` → `docs/bugfix/SLYK-300-plan.md`. Use the template below; include the **Root Cause** section **only for bugs**.

## Plan Template

```markdown
# Implementation Plan — {TICKET_ID}

**Ticket:** `{path-to-ticket}`
**Type:** {Bug | Feature | Enhancement}
**Title:** {ticket title}
**Generated:** {ISO date}

---

## Summary

{1–2 paragraph restatement of what needs to be delivered, in your own words.}

## Root Cause  *(bugs only — omit for feature/enhancement)*

{The precise defect: what is wrong and why it happens, with `path:line` evidence.}

## Affected Components

| Layer | File | Why |
|-------|------|-----|
| Route | `backend/src/routes/xxxRoutes.ts` | ... |
| Controller | `backend/src/controllers/xxxController.ts` | ... |
| Service | `backend/src/services/xxxService.ts` | ... |
| Repository | `backend/src/repositories/xxxRepository.ts` | ... |
| Schema | `backend/src/db/schema.ts` | ... |
| ... | ... | ... |

## Proposed Implementation

{Step-by-step. One sub-section per change, each with **File** / **What** / **Why** / **Code reference** (existing method/line the change builds on). Group backend and frontend separately. For features/enhancements, order changes by build dependency.}

### Backend Changes
...

### Frontend Changes
*(only if the ticket or fix touches the frontend)*
...

## Edge Cases & Risks

- {concurrency / RBAC / related paths / regressions / migration concerns}

## Testing

*Follow project conventions — Vitest + supertest (backend) and Vitest + Testing Library (frontend); table-driven tests; one behavior per test; co-locate `*.test.ts(x)` next to source.*

- **Unit tests:** {service/repository-level cases}
- **HTTP tests:** {route/controller via supertest, if applicable}
- **Integration tests:** {critical flows only — exercise the real DB or stub the data-access layer per project rules}
- **Manual verification:** {re-run the ticket's reproduce steps for bugs / exercise the new capability for features}

## Acceptance Criteria

- [ ] {verifiable outcome — mirrors the ticket's "Expected Result" / acceptance criteria}
- [ ] ...

## Open Questions  *(optional)*

- {anything needing a product/owner decision}

## Out of Scope

- {anything explicitly not addressed}
```

## Error Handling

- **Can't read ticket** — ask the user to verify the path; do not proceed.
- **Ticket has no ID** — derive a slug from the filename; flag it in the plan.
- **Ticket type unclear** — state your best inference and why; proceed on that basis and note it.
- **Approach ambiguous** (e.g. unclear root cause, or a feature with multiple valid designs) — document the leading approach with evidence, list the alternatives, and mark what needs confirmation. Do not fabricate `path:line` citations.
- **Subagent failure** — retry the failed `analyst` individually; note in the plan if an area could not be fully investigated.

## Key Principles

- **Delegate analysis, write yourself.** Keep the main context clean — investigate via `analyst` subagents, synthesize and write the plan directly.
- **Evidence-backed.** Every code claim cites `path:line`. No guesses presented as fact.
- **Convention-correct.** Respect the layered call rule and the project's style/exception/testing conventions; never propose exposing entities from controllers or putting business logic in controllers.
- **Adapt to the ticket type.** Bugs hunt a root cause; features/enhancements lay out a design. Same plan skeleton, type-appropriate emphasis.
- **Comprehensive but minimal.** Cover the full surface (including related paths needing the same change) without scope creep. Out-of-scope items are called out explicitly.
