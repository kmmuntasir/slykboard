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

State your understanding back before analyzing: "Read ticket MRC-300 (bug) — <one-line summary>. Analyzing codebase..." (swap the type and summary as appropriate).

### Step 2: Analyze the codebase

Use up to **3 parallel `analyst` subagents** (via the Agent tool, `subagent_type: analyst`) to investigate and keep the main context window clean. **The split adapts to the ticket type.**

**For a bug** — focus on the defect:

| Subagent | Responsibility |
|----------|---------------|
| **Repro path** | Trace the reproduction path end-to-end. Locate the endpoints/services named in the ticket, read the exact code path, and confirm where the buggy behavior occurs. Cite `path:line`. |
| **Root cause** | Pinpoint the defect — the missing guard / wrong branch / bad assumption, *why* it allows the bad behavior, and where the correct check belongs (respect the layered rule: Controller → Service → Repository). |
| **Prior art & fix surface** | Map patterns to reuse: similar existing guards, the right custom exception(s), error-message conventions, validation utilities, relevant test fixtures, and any frontend impact. |

**For a feature / enhancement** — focus on the design surface:

| Subagent | Responsibility |
|----------|---------------|
| **Integration points** | Where the new/changed capability plugs in: relevant controllers/services/repositories/entities, the package structure it extends, the next Flyway migration version, and any new API contract. Cite `path:line`. |
| **Patterns & conventions** | Existing precedents to mirror: analogous features already implemented (entities, DTOs, mappers, RBAC, messaging, scheduling), naming, validation, error handling, config externalization. |
| **Cross-cutting & frontend** | Shared types/utilities, security/RBAC implications, RabbitMQ/scheduling/Feign touches, and frontend impact (services, components, models, routes, context). |

Backend lives at `backend/mrc` (base package `com.bkash.mrc`, Flyway migrations under `backend/mrc/src/main/resources/db/migration`). Frontend lives at `frontend/src`.

Each subagent returns a **curated digest** with `path:line` evidence — not raw file dumps. Work from those digests.

If the ticket is clearly single-layer or small, drop to 1–2 subagents. Add more `analyst` calls only if a digest surfaces a new area worth a focused probe.

### Step 3: Synthesize the approach

Combine the digests into a single coherent picture:

- **Bug** → state the root cause (what + why) and the minimal, convention-correct fix set
- **Feature / enhancement** → state the design: new/changed entities, DTOs, mappers, services, endpoints, API contract, migrations, frontend pieces — and a sensible build order (schema/entity → repository → service → controller → DTO/mapper → frontend)
- **Both** → list edge cases & risks (concurrency, RBAC, related paths needing the same change, regressions, migration concerns) and any open questions

Respect project conventions: service owns business logic; controllers exchange DTOs only; Flyway is the only schema path; custom exceptions via `@ControllerAdvice`; never expose entities.

### Step 4: Write the implementation plan

Write the plan to the **same directory as the ticket**, named `{ticket-filename}-plan.md` — e.g. ticket `docs/bugfix/MRC-300.md` → `docs/bugfix/MRC-300-plan.md`. Use the template below; include the **Root Cause** section **only for bugs**.

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
| Controller | `backend/.../XxxController.java` | ... |
| Service | `backend/.../XxxService.java` | ... |
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

*Follow project conventions — JUnit 5 + Mockito + AssertJ; method names `should<Expectation>_when<Condition>`; AAA layout; one behavior per test.*

- **Unit tests:** {service-level cases}
- **Slice tests:** {controller/repository, if applicable}
- **Integration tests:** {critical flows only}
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
