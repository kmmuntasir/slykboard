---
name: handle-ticket
description: End-to-end ticket handler. From a ticket file, sync from origin/develop, create the ticket branch, create an implementation plan, break it into tasks, orchestrate implementation with per-task commits, then verify and report. Use when the user wants one ticket handled start-to-finish.
---

# Handle Ticket Skill

Run a single ticket end-to-end by chaining four sub-agents in order:

```
ticket → create-implementation-plan → breakdown-plan-into-tasks → orchestrator → verify-implementation
```

Each sub-agent is spawned via the **Agent** tool (one at a time — never parallel across phases). You drive the chain in the main context: spawn a sub-agent, let it finish and write its artifact, capture the artifact path, pass it to the next step.

## Authorization (read before running)

Invoking this skill **is standing approval** to:

- **Sync the working tree from `origin/develop` and branch for the ticket** — `git fetch --all`, then `git checkout develop`, `git reset --hard origin/develop` (**discards any uncommitted local changes — intentional**), then create + checkout the ticket branch. Skip the sync/branch only if you are already on the ticket branch.
- **Commit** via the `committer` agent — **one commit per task**, ticket-numbered (`SLYK-<n>: ...`); no per-commit confirmation pause.
- **Run the backend tests** (`npm test`) for verification **by default**. (Fall back to static review only if the user has stated they have no local Node/npm — see Phase 4.)
- **Never** push, merge, rebase, amend, or force-push — those remain the user's call.

State this to the user before starting: "Handling {ticket}. This will sync from origin/develop, branch, implement, commit per task, and verify. Local uncommitted changes will be discarded. Push/merge stays your call."

## Inputs

User provides a **ticket file path**, e.g.:

- `docs/bugfix/SLYK-300.md`
- `docs/feature/some-feature/some-ticket.md`
- Absolute or relative path to a single `*.md` ticket

If no input is provided, **ask** for it. Do not guess.

## Setup

1. Resolve the ticket path to absolute. Read it to capture:
   - **Ticket ID** (e.g. `SLYK-300`) — from the heading
   - **Type** — bug / feature / enhancement (infer from content)
   - **Slug** — short, hyphenated, lowercased, derived from the title
2. Compute the branch name (project convention `type/PROJECTSLUG-TICKET_NUMBER-desc`):
   - bug → `bugfix/<ID>-<slug>`
   - feature / enhancement → `feature/<ID>-<slug>`
3. **Branch setup** (authorized above). Determine the current branch:
   - **Already on the ticket branch** → no action.
   - **Otherwise** → run, in order:
     ```
     git fetch --all
     git checkout develop
     git reset --hard origin/develop
     git checkout -b <ticket-branch>
     ```
4. Compute and hold these **absolute** artifact paths (chain by naming convention):
   - `TICKET` = absolute ticket path
   - `PLAN` = `{ticket-dir}/{ticket-basename}-plan.md`
   - `TASKS` = `{plan-dir}/{plan-basename}-tasks.md`
   - `VERIFICATION` = `{tasks-dir}/{tasks-basename}-verification.md`

Artifact paths chain by naming convention (example for `docs/bugfix/SLYK-300.md`):

| Artifact | Path |
|----------|------|
| Plan | `docs/bugfix/SLYK-300-plan.md` |
| Tasks | `docs/bugfix/SLYK-300-plan-tasks.md` |
| Verification | `docs/bugfix/SLYK-300-plan-tasks-verification.md` |

## Phases

### Phase 1 — Plan

Spawn a `create-implementation-plan` sub-agent via the Agent tool:

```
Agent({
  subagent_type: "create-implementation-plan",
  prompt: "Ticket file: <TICKET> (absolute path — read it completely). Follow your instructions exactly: Step 1 read the ticket; Step 2 spawn 3 parallel Explore subagents to investigate the codebase (backend at backend/src uses Express 5 + Drizzle ORM + PostgreSQL with migrations under backend/src/db/migrations; frontend at frontend/src uses React 19 + Vite + TanStack Query + Zustand + Tailwind); Step 3 synthesize; Step 4 write the plan to <PLAN> (absolute path, same folder as the ticket, named {ticket-basename}-plan.md) using your full plan template. After writing, print the absolute path of the plan file you wrote and a one-paragraph summary.",
  description: "Plan: <ticket title>"
})
```

After the sub-agent returns: verify `<PLAN>` exists (expected `{ticket-dir}/{ticket-basename}-plan.md`), then capture its absolute path. If the sub-agent reported a different path, use that.

### Phase 2 — Break into tasks

Spawn a `breakdown-plan-into-tasks` sub-agent:

```
Agent({
  subagent_type: "breakdown-plan-into-tasks",
  prompt: "Plan file: <PLAN> (absolute path — read it completely). Follow your instructions exactly: Phase 1 spawn 3 parallel Explore subagents to verify the plan against the codebase; Phase 2 spawn Explore subagents to draft batched tasks; merge and write the task breakdown to <TASKS> (absolute path, same folder as the plan, named {plan-basename}-tasks.md) using your task format and parallelization strategy. After writing, print the absolute path of the tasks file you wrote and a one-paragraph summary.",
  description: "Breakdown: <ticket title>"
})
```

After the sub-agent returns: verify `<TASKS>` exists, capture its absolute path.

### Phase 3 — Implement (orchestrate + per-task commits)

Spawn an `orchestrator` sub-agent:

```
Agent({
  subagent_type: "orchestrator",
  prompt: "Tasks file: <TASKS> (absolute path). Ticket ID: <ID>. Follow your instructions exactly: spawn the Explore agent to curate the task set, dispatch each task to node-coder / react-coder (parallel only when conflict-free), and commit each completed task via the committer agent using the ticket-numbered convention <ID>: <summary>. Never push. After finishing, print: per task — ID, what was implemented, files touched; and the list of commit hashes + messages.",
  description: "Implement: <ticket title>",
  max_turns: 200
})
```

After the sub-agent returns: capture the list of changed files and commit hashes. If the sub-agent reported a blocker or a coder failure, **stop** — surface it and do not proceed to Phase 4.

### Phase 4 — Verify (completeness + tests)

Run BOTH:

1. **Completeness** — spawn a `verify-implementation` sub-agent:
   ```
   Agent({
     subagent_type: "verify-implementation",
     prompt: "Tasks file: <TASKS> (absolute path — read it completely). Follow your instructions exactly: spawn 3 parallel Explore subagents to verify the codebase against the tasks; write the verification report to <VERIFICATION> (absolute path, same folder as the tasks file, named {tasks-basename}-verification.md) using your report template. After writing, print the absolute path of the report and the status counts (implemented / partial / missing / modified).",
     description: "Verify: <ticket title>"
   })
   ```
2. **Build/tests** — you run this directly (it is not a sub-agent):
   ```bash
   npm --prefix backend test
   ```
   (Project uses Vitest.) Fold the result (pass/fail, failing tests if any) into the final report. If the frontend is touched too, also run `npm --prefix frontend test` when present.

   **Static-review fallback** — only if the user has stated they have no local Node/npm, **skip** the test run and rely on the `verify-implementation` report alone. State plainly that tests were **not** executed and verification is **static review only**.

### Phase 5 — Docs commit

Commit the planning artifacts produced by Phases 1, 2, and 4 (the plan, tasks, and verification files) as a single ticket-numbered docs commit via the `committer` agent. (Skip if there are none or the user declines.)

```
Agent({
  subagent_type: "committer",
  prompt: "Commit the docs/planning artifacts for ticket <ID> as a single commit. Files (exact paths): <PLAN> <TASKS> <VERIFICATION>. Single-line message: '<ID>: Add implementation plan, tasks, and verification report'. Stage exactly those paths; never push.",
  description: "Commit docs: <ticket id>"
})
```

## Output (final report)

Return a concise end-to-end summary:

- **Ticket** — ID, type, title, one-line summary; branch created/used
- **Artifacts** — links to `PLAN`, `TASKS`, `VERIFICATION`
- **Implementation** — what got built (per task area, files touched)
- **Commits** — hash + message for each per-task code commit, plus the docs commit
- **Verification outcome** — `npm test` result (or explicit "not run — static review only"); completeness counts (implemented / partial / missing / modified); any gaps surfaced
- **Open items** — anything blocked, failing tests, or left to the user (push/merge, manual runtime testing, etc.)

## Error Handling

- **Ticket unreadable / missing ID** — ask the user; do not proceed.
- **Sub-agent's artifact not found after it returns** — note the expected path, re-check, and ask the user before continuing (the next phase depends on it).
- **Orchestrator blocker / coder failure** — do not commit further; report and stop.
- **`npm test` fails or is unavailable (and not pre-declared)** — report the failure verbatim; fall back to static review for the report; do not claim green tests.
- **Verification finds gaps** — do not auto-fix; surface them in the final report for the user to decide.

## Key Principles

- **Sequential sub-agents.** One Agent tool invocation at a time; capture each artifact before invoking the next.
- **Per-task commits, ticket-numbered.** Let the orchestrator commit after each task; never push.
- **Branch fresh from origin/develop.** Fetch, reset hard, branch — unless already on the ticket branch.
- **Verify for real by default.** Run `npm test`; only fall back to static review when the user has no local toolchain, and say so explicitly.
- **Honest reporting.** Never claim a build/test passed that wasn't actually run.
