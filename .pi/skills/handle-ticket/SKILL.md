---
name: handle-ticket
description: End-to-end ticket handler. From a ticket file, sync from origin/develop, create the ticket branch, create an implementation plan, break it into tasks, orchestrate implementation (isolated delegations + per-task commits), then verify and report. Use when the user wants one ticket handled start-to-finish.
---

# Handle Ticket Skill

Run a single ticket end-to-end by chaining four existing skills in order:

```
ticket → /create-implementation-plan → /breakdown-plan-into-tasks → /orchestrator → /verify-implementation
```

You drive the chain in the **main context**. Each sub-skill is invoked **sequentially** via the **`/skill:<name>`** command (pi expands `/skill:` to the full skill body — one invocation at a time, never nested/parallel). Let a sub-skill finish and write its artifact, capture the artifact path, then pass it to the next step. The orchestrator step in turn dispatches its coding/analysis work via the `delegate` script so each task runs in an isolated context window.

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
4. Track the phases below with the todo/task tracking the user can see — in-progress → completed.

Artifact paths chain by naming convention (example for `docs/bugfix/SLYK-300.md`):

| Artifact | Path |
|----------|------|
| Plan | `docs/bugfix/SLYK-300-plan.md` |
| Tasks | `docs/bugfix/SLYK-300-plan-tasks.md` |
| Verification | `docs/bugfix/SLYK-300-plan-tasks-verification.md` |

## Phases

### Phase 1 — Plan

Invoke the **`create-implementation-plan`** skill: type `/create-implementation-plan` in the editor (or `pi -p /skill:create-implementation-plan ...` if non-interactive), passing the ticket path.

It reads the ticket, analyzes the codebase (via `analyst` delegations), and writes the plan to the **same folder** as the ticket.

After it finishes: verify the plan file exists (expected `{ticket-dir}/{ticket-basename}-plan.md`), then capture its absolute path as **`planFile`**. If the sub-skill reported a different path, use that.

### Phase 2 — Break into tasks

Invoke the **`breakdown-plan-into-tasks`** skill: `/breakdown-plan-into-tasks <planFile>`.

It analyzes the plan against the codebase (via `analyst` delegations) and writes a parallelizable task breakdown alongside it.

After it finishes: verify the tasks file exists (expected `{plan-dir}/{plan-basename}-tasks.md`), capture its absolute path as **`tasksFile`**.

### Phase 3 — Implement (orchestrate + per-task commits)

Invoke the **`orchestrator`** skill: `/orchestrator <tasksFile>`.

- Let the orchestrator implement and verify **all** tasks. It dispatches each task to an isolated `node-coder` / `react-coder` subprocess via the `delegate` script, and commits **per task** via the `committer` role — its default. Pass the **ticket ID** as context so each commit is ticket-numbered (`SLYK-<n>: <task summary>`).
- Do **not** override the per-task cadence. Never push.

Capture the list of files that changed and the commit hashes.

If the orchestrator reports a blocker or a coder delegation returns a failure, surface it and stop (do not silently skip or commit a broken task).

### Phase 4 — Verify (build + completeness)

Two complementary checks:

1. **Completeness** — invoke the **`verify-implementation`** skill: `/verify-implementation <tasksFile>`. It compares the codebase against the task spec (via `analyst` delegations) and writes a report. Capture its path as **`verificationFile`**.
2. **Build/tests** — **run the backend test suite by default**:
   ```
   npm --prefix backend test
   ```
   (Project uses Vitest; equivalent to `cd backend && npm test`.) Fold the result (pass/fail, failing tests if any) into the final report. If the frontend is touched too, also run `npm --prefix frontend test` (Vitest + Testing Library) when present.

   **Static-review fallback** — only if the user has stated they have no local Node/npm, **skip** the test run and rely on the `verify-implementation` report alone. In that case, state plainly that tests were **not** executed and verification is **static review only**.

### Phase 5 — Docs commit

Commit the planning artifacts produced by Phases 1, 2, and 4 (the plan, tasks, and verification files) as a single ticket-numbered docs commit via the `committer` role (through the `delegate` script), e.g. `SLYK-300: Add implementation plan, tasks, and verification report`. (Skip if there are none or the user declines.)

## Output (final report)

Return a concise end-to-end summary:

- **Ticket** — ID, type, title, one-line summary; branch created/used
- **Artifacts** — links to `planFile`, `tasksFile`, `verificationFile`
- **Implementation** — what got built (per task area, files touched)
- **Commits** — hash + message for each per-task code commit, plus the docs commit
- **Verification outcome** — `npm test` result (or explicit "not run — static review only"); completeness counts (✅ implemented / ⚠️ partial / ❌ missing / 🔄 modified); any gaps surfaced
- **Open items** — anything blocked, failing tests, or left to the user (push/merge, manual runtime testing, etc.)

## Error Handling

- **Ticket unreadable / missing ID** — ask the user; do not proceed.
- **Sub-skill's artifact not found after it returns** — note the expected path, re-check, and ask the user before continuing (the next phase depends on it).
- **Orchestrator blocker / coder delegation failure** — do not commit further; report and stop.
- **`npm test` fails or is unavailable (and not pre-declared)** — report the failure verbatim; fall back to static review for the report; do not claim green tests.
- **Verification finds gaps** — do not auto-fix; surface them in the final report for the user to decide.

## Key Principles

- **Sequential sub-skills.** One `/skill:` invocation at a time; capture each artifact before invoking the next.
- **Per-task commits, ticket-numbered.** Let the orchestrator commit after each task (each task runs in an isolated subprocess); never push.
- **Branch fresh from origin/develop.** Fetch, reset hard, branch — unless already on the ticket branch.
- **Verify for real by default.** Run `npm test`; only fall back to static review when the user has no local toolchain, and say so explicitly.
- **Honest reporting.** Never claim a build/test passed that wasn't actually run.
