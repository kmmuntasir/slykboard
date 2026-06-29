---
name: handle-ticket
description: End-to-end ticket handler. From a ticket file, sync from origin/develop, create the ticket branch, create an implementation plan, break it into tasks, orchestrate implementation (isolated delegations + per-task commits), then verify and report. Use when the user wants one ticket handled start-to-finish.
---

# Handle Ticket Skill

> ## MANDATORY EXECUTION — READ FIRST
>
> This is a **dispatcher** skill. Your only job is to run the Setup steps, then run the **exact `delegate.sh` command given in each Phase**, capture each artifact path, and pass it to the next phase. Everything else is forbidden.
>
> **Every skill-to-skill invocation is a `delegate.sh` subprocess. Period.** You do NOT type `/skill:` in any editor. You do NOT run `pi -p` yourself. You do NOT invoke sub-skills inline by "following their SKILL.md yourself." The command in each Phase is literal and complete — fill in the placeholders from Setup and run it via `bash`.
>
> You are **FORBIDDEN** from:
> - Reading any sub-skill's `SKILL.md` to "understand the mechanics," "check how delegation works," or "see if nesting is OK." The mechanics are already encoded in the commands below. **Do not open those files.**
> - Reasoning about whether to dispatch a phase inline vs. as a subprocess. Each phase **is** a subprocess command, verbatim.
> - Reading the ticket's source code / codebase to "help" a sub-skill. The sub-skill (inside its subprocess) does its own investigation via `analyst` delegations.
>
> If you spend your turn "thinking about how to invoke" a sub-skill, you have already failed. **The commands are written for you. Run them.**

Run a single ticket end-to-end by chaining four skills, **each dispatched as an isolated `delegate.sh` subprocess**, in order:

```
ticket → create-implementation-plan → breakdown-plan-into-tasks → orchestrator → verify-implementation
```

`delegate.sh` runs `pi -p "/skill:<skill-name> <prompt>"` in a fresh, isolated context. The dispatched subprocess loads that skill's full body, follows it (including its own mandatory `analyst`/coder delegations — nested delegation is supported), writes its artifact, and returns its final text to your stdout. You capture the artifact path and feed it to the next phase.

> **Nested delegation is expected and supported.** A dispatched coordinator skill (e.g. `create-implementation-plan`) will itself call `delegate.sh` to spawn `analyst` subprocesses. Set a generous `DELEGATE_TIMEOUT` on the outer dispatch so the inner ones can finish. The commands below already set safe timeouts.

## Authorization (read before running)

Invoking this skill **is standing approval** to:

- **Sync the working tree from `origin/develop` and branch for the ticket** — `git fetch --all`, then `git checkout develop`, `git reset --hard origin/develop` (**discards any uncommitted local changes — intentional**), then create + checkout the ticket branch. Skip the sync/branch only if you are already on the ticket branch.
- **Commit** via the `committer` role — **one commit per task**, ticket-numbered (`SLYK-<n>: ...`); no per-commit confirmation pause.
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

1. Resolve the ticket path to absolute. Read **only the ticket file** (not the codebase) to capture:
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
5. Track the phases below with the todo/task tracker the user can see — in-progress -> completed.

## Phases

> Run each phase's command verbatim via `bash`, substituting the placeholders (`<TICKET>`, `<PLAN>`, `<TASKS>`, `<VERIFICATION>`, `<ID>`) from Setup. Do not modify the commands. Do not read the sub-skill files. Do not run anything inline.

### Phase 1 — Plan (dispatch `create-implementation-plan` as a subprocess)

```bash
DELEGATE_TIMEOUT=1800 ./.pi/skills/delegate/scripts/delegate.sh create-implementation-plan \
  "Ticket file: <TICKET> (absolute path — read it completely). Follow your SKILL.md exactly: Step 1 read the ticket; Step 2 dispatch your 3 parallel analyst subprocesses via delegate.sh to investigate the codebase (backend at backend/src uses Express 5 + Drizzle ORM + PostgreSQL with migrations under backend/src/db/migrations; frontend at frontend/src uses React 19 + Vite + TanStack Query + Zustand + Tailwind); Step 3 synthesize; Step 4 write the plan to <PLAN> (absolute path, same folder as the ticket, named {ticket-basename}-plan.md) using your full plan template. After writing, print the absolute path of the plan file you wrote and a one-paragraph summary."
```

After the subprocess returns: confirm `<PLAN>` exists, capture its path. If the subprocess reported a different path, use that.

### Phase 2 — Break into tasks (dispatch `breakdown-plan-into-tasks` as a subprocess)

```bash
DELEGATE_TIMEOUT=1800 ./.pi/skills/delegate/scripts/delegate.sh breakdown-plan-into-tasks \
  "Plan file: <PLAN> (absolute path — read it completely). Follow your SKILL.md exactly: Phase 1 dispatch your analyst subprocesses via delegate.sh to verify the plan against the codebase; Phase 2 dispatch your analyst subprocesses to draft batched tasks; merge and write the task breakdown to <TASKS> (absolute path, same folder as the plan, named {plan-basename}-tasks.md) using your task format and parallelization strategy. After writing, print the absolute path of the tasks file you wrote and a one-paragraph summary."
```

After the subprocess returns: confirm `<TASKS>` exists, capture its path.

### Phase 3 — Implement (dispatch `orchestrator` as a subprocess; per-task commits)

```bash
DELEGATE_TIMEOUT=3600 ./.pi/skills/delegate/scripts/delegate.sh orchestrator \
  "Tasks file: <TASKS> (absolute path). Ticket ID: <ID>. Follow your SKILL.md exactly: dispatch the analyst to curate the task set, dispatch each task to node-coder / react-coder via delegate.sh (parallel only when conflict-free), and commit each completed task via the committer role using the ticket-numbered convention <ID>: <summary>. Never push. After finishing, print: per task — ID, what was implemented, files touched; and the list of commit hashes + messages."
```

After the subprocess returns: capture the list of changed files and commit hashes. If the subprocess reported a blocker or a coder failure, **stop** — surface it and do not proceed to Phase 4.

### Phase 4 — Verify (dispatch `verify-implementation` as a subprocess + run tests)

Run BOTH:

1. **Completeness** — dispatch the skill as a subprocess:
   ```bash
   DELEGATE_TIMEOUT=1800 ./.pi/skills/delegate/scripts/delegate.sh verify-implementation \
     "Tasks file: <TASKS> (absolute path — read it completely). Follow your SKILL.md exactly: dispatch your 3 analyst subprocesses via delegate.sh to verify the codebase against the tasks; write the verification report to <VERIFICATION> (absolute path, same folder as the tasks file, named {tasks-basename}-verification.md) using your report template. After writing, print the absolute path of the report and the status counts (implemented / partial / missing / modified)."
   ```
2. **Build/tests** — you run this directly (it is not a skill):
   ```bash
   npm --prefix backend test
   ```
   (Project uses Vitest.) Fold the result (pass/fail, failing tests if any) into the final report. If the frontend is touched too, also run `npm --prefix frontend test` when present.

   **Static-review fallback** — only if the user has stated they have no local Node/npm, **skip** the test run and rely on the `verify-implementation` report alone. State plainly that tests were **not** executed and verification is **static review only**.

### Phase 5 — Docs commit (dispatch `committer` role as a subprocess)

Commit the planning artifacts produced by Phases 1, 2, and 4 (the plan, tasks, and verification files) as a single ticket-numbered docs commit. (Skip if there are none or the user declines.)

```bash
./.pi/skills/delegate/scripts/delegate.sh committer \
  "Commit the docs/planning artifacts for ticket <ID> as a single commit. Files (exact paths): <PLAN> <TASKS> <VERIFICATION>. Single-line message: '<ID>: Add implementation plan, tasks, and verification report'. Stage exactly those paths; never push."
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
- **A phase's subprocess returns no artifact / artifact not found** — note the expected path, re-check, and ask the user before continuing (the next phase depends on it).
- **Orchestrator subprocess reports a blocker / coder failure** — do not commit further; report and stop.
- **`npm test` fails or is unavailable (and not pre-declared)** — report the failure verbatim; fall back to static review for the report; do not claim green tests.
- **Verification finds gaps** — do not auto-fix; surface them in the final report for the user to decide.

## Key Principles

- **Every skill-to-skill invocation is a `delegate.sh` subprocess.** Never type `/skill:`, never run a sub-skill inline, never read a sub-skill's `SKILL.md` to "understand" it. The Phase commands are complete — run them verbatim.
- **Sequential phases.** One `delegate.sh` dispatch at a time; confirm each artifact before dispatching the next.
- **Per-task commits, ticket-numbered.** The orchestrator subprocess commits after each task (each task is itself an isolated subprocess); never push.
- **Branch fresh from origin/develop.** Fetch, reset hard, branch — unless already on the ticket branch.
- **Verify for real by default.** Run `npm test`; only fall back to static review when the user has no local toolchain, and say so explicitly.
- **Honest reporting.** Never claim a build/test passed that wasn't actually run.
