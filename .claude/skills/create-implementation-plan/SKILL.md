---
name: create-implementation-plan
description: Read a ticket file (bug, feature, or enhancement), analyze the codebase, and write a comprehensive implementation plan. Use when the user hands you a ticket file path and wants an implementation plan generated.
---

# Create Implementation Plan Skill

Read the provided ticket carefully, understand what needs to be delivered, analyze the codebase, then write a complete and comprehensive implementation plan as a new markdown file in the **same folder** as the ticket.

The ticket may be a **bug**, **feature**, or **enhancement** — adapt the analysis focus and plan shape to the ticket type.

## Inputs

User provides a **ticket file path**, e.g.:

- `docs/bugfix/SLYK-300.md`
- `docs/feature/notification-matrix/some-ticket.md`
- Absolute or relative path to a single `*.md` ticket

(Path patterns are illustrative — always derive the real ticket path and ID from what the user hands you.)

If no input is provided, **ask** for the ticket file path. Do not guess.

## Execution Steps

Follow exactly, in order.

### Step 1: Read & understand the ticket

Resolve the input to an absolute path and read it **completely**. Extract and hold in context:

- **Ticket ID** (e.g., `SLYK-300`) — derive from the filename or the ticket heading
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
| **Repro path** | Trace the reproduction path end-to-end. Locate the routes/middleware/db queries named in the ticket, read the exact code path, and confirm where the buggy behavior occurs. Cite `path:line`. |
| **Root cause** | Pinpoint the defect — the missing guard / wrong branch / bad assumption, *why* it allows the bad behavior, and where the correct check belongs (respect the layered rule: route → middleware → service → db). |
| **Prior art & fix surface** | Map patterns to reuse: similar existing guards, the right error envelope shapes, validation, relevant test fixtures, and any frontend impact. |

**For a feature / enhancement** — focus on the design surface:

| Subagent | Responsibility |
|----------|---------------|
| **Integration points** | Where the new/changed capability plugs in: relevant routes, middleware, services, the Drizzle schema (`backend/src/db/schema.ts`) it extends plus the journal migration to generate (`make migrate-generate` → `make migrate`), and any new API contract. Cite `path:line`. |
| **Patterns & conventions** | Existing precedents to mirror: analogous features already implemented (routes, middleware chain, service methods, error envelope), naming, Zod validation at the route edge, configuration via env vars. |
| **Cross-cutting & frontend** | Shared types/utilities, security/auth implications (the `authenticate` → `resolveProject` → `requireProjectMember`/`requireProjectAdmin` chain, `requirePlatformAdmin` for platform-level ops, rich text sanitized both directions via `utils/sanitizeHtml.ts`, client-supplied board positions validated server-side, soft-deleted tickets excluded everywhere), kanban-domain invariants (per-project sequential display IDs via `projectSequences`, not UUIDs; positions unique & gapless within a column), and frontend impact (api modules in `frontend/src/api/*.ts`, hooks, components, pages, Zustand stores, routes). |

Backend lives at `backend/src/` (Node 24 + Express 5 + TypeScript + Drizzle ORM over PostgreSQL via a pg Pool singleton in `src/db/client.ts`; journal migrations under `src/db/migrations`). Frontend lives at `frontend/src/` (React 19 + Vite + Tailwind v4 CSS-first tokens + React Query/Zustand).

Each subagent returns a **curated digest** with `path:line` evidence — not raw file dumps. Work from those digests.

If the ticket is clearly single-layer or small, drop to 1–2 subagents. Add more `analyst` calls only if a digest surfaces a new area worth a focused probe.

### Step 3: Synthesize the approach

Combine the digests into a single coherent picture:

- **Bug** → state the root cause (what + why) and the minimal, convention-correct fix set
- **Feature / enhancement** → state the design: new/changed schema + migration, routes, middleware, services, API contract, frontend pieces — and a sensible build order (schema → migration → service → route/middleware → frontend)
- **Both** → list edge cases & risks (concurrency, position reordering mid-board, soft-delete interaction, related paths needing the same change, regressions, migration concerns) and any open questions

Respect project conventions: routes handle HTTP only (Zod schemas co-located, `AppError` thrown — never hand-written status codes), middleware does cross-cutting concerns, services own business logic and wrap multi-statement mutations in `db.transaction` over Drizzle (parameterized queries / `sql` template literal only); authorization decisions centralized in `services/accessControl.ts`; envelope is `{ data: T }` or `{ error: { code, message, details? } }`.

Kanban-domain invariants every plan must preserve:
- Per-project sequential display IDs (`projectSequences`) — never UUIDs in user-facing identifiers.
- Positions unique & gapless within a column, validated server-side (client-supplied positions never trusted verbatim).
- Destructive or role-changing actions (delete, deactivate, promote/demote) REQUIRE a confirmation modal in the UI.
- Platform-admin vs project-role separation preserved end-to-end — enforced at both route middleware (`requirePlatformAdmin`, `requireProjectAdmin`/`requireProjectMember`) and inside service checks.
- Soft-deleted tickets excluded from all reads; direct access yields 404 semantics.

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
| Route | `backend/src/routes/Xxx.ts` (+ co-located `Xxx.schema.ts`) | ... |
| Middleware | `backend/src/middleware/Xxx.ts` | ... |
| Service | `backend/src/services/Xxx.ts` | ... |
| Access control | `backend/src/services/accessControl.ts` | ... |
| Schema | `backend/src/db/schema.ts` | ... |
| Migration | `backend/src/db/migrations/` (`make migrate-generate`) | ... |
| Component | `frontend/src/components/Xxx.tsx` | ... |
| ... | ... | ... |

## Proposed Implementation

{Step-by-step. One sub-section per change, each with **File** / **What** / **Why** / **Code reference** (existing method/line the change builds on). Group backend and frontend separately. For features/enhancements, order changes by build dependency.}

### Backend Changes
...

### Frontend Changes
*(only if the ticket or fix touches the frontend)*
...

## Edge Cases & Risks

- {concurrency / position ordering / soft-delete interaction / membership matrix / related paths / regressions / migration concerns}

## Testing

*Follow project conventions — Vitest + supertest against the exported Express app over the real Postgres test DB injected by `backend/vitest.config.ts`; Vitest + Testing Library (jsdom via `src/test-setup.ts`) for the frontend, mocking at the api-module boundary with `vi.mock`; one behavior per test; co-locate tests next to source.*

- **Unit tests:** {service/route-level cases}
- **HTTP tests:** {route tests via supertest}
- **Frontend tests:** {component/hook tests, api modules mocked with `vi.mock`; DnD components wrapped in `src/test/dndWrapper.tsx`}
- **Manual verification:** {re-run the ticket's reproduce steps for bugs / exercise the new capability for features}
- **Gate:** `make gate` must pass green before completion is reported — typecheck + build + lint + prettier + test across both workspaces. Single-file reruns use e.g. `npm run test -w backend -- src/utils/jwt.test.ts`.

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
- **Convention-correct.** Respect the route → middleware → service → db layering and the project's style/error/testing conventions; never propose bypassing `utils/sanitizeHtml.ts`, skipping service-layer authorization checks, or hand-writing status codes instead of throwing `AppError`.
- **Adapt to the ticket type.** Bugs hunt a root cause; features/enhancements lay out a design. Same plan skeleton, type-appropriate emphasis.
- **Comprehensive but minimal.** Cover the full surface (including related paths needing the same change) without scope creep. Out-of-scope items are called out explicitly.
