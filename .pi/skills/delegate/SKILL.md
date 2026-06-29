---
name: delegate
description: Isolated-context delegation primitive. Spawns headless `pi -p` subprocesses (each its own clean context window) to run another skill in a constrained role. Use this whenever you need to dispatch read-analysis or implementation work to a role skill WITHOUT polluting your own context — the orchestrator and ticket-handling skills are built on top of it.
---

# Delegate Skill

Pi has **no native subagents**. To get the same context isolation Claude Code gives you with the `Task`/`Agent` tool, you spawn **headless `pi -p` subprocesses** instead. Each subprocess is a fully independent agent: its own context window, its own tool set, its own session. It loads the target role skill via `/skill:<role>`, does the work, and returns only its final text answer to your stdout.

This skill is the primitive every other coordinating skill (`orchestrator`, `handle-ticket`, `create-implementation-plan`, `pr-review`, …) builds on. **When you are coordinating, dispatch via this script — do not do the analysis/coding in your own context.** Keep your context as a clean dispatcher that reads digests and decides sequencing.

## The script: `scripts/delegate.sh`

Run it from the project root. Your tool `bash` calls it directly.

### Usage

```bash
# Single delegation — role runs isolated, returns its final answer to stdout
./.pi/skills/delegate/scripts/delegate.sh <role> "<prompt>"

# Pipe a long prompt / file contents in
echo "<prompt>" | ./.pi/skills/delegate/scripts/delegate.sh <role> --stdin

# Parallel fan-out — N isolated roles at once, answers in order on stdout
./.pi/skills/delegate/scripts/delegate.sh --parallel \
  analyst "<probe A>" \
  analyst "<probe B>" \
  node-coder "<task C>"

# Restrict/expand tools for a run (overrides the role default)
DELEGATE_TOOLS="read,grep,find,ls" ./.pi/skills/delegate/scripts/delegate.sh <role> "<prompt>"
```

### Roles & their default toolsets

| Role | Default tools | Notes |
|------|---------------|-------|
| `analyst` | `read,grep,find,ls` | Read-only investigator (no bash mutation, no writes) |
| `committer` | `bash,read` | Git stage+commit only |
| `node-coder` | all built-ins | Backend implementation |
| `react-coder` | all built-ins | Frontend implementation |
| *(any other skill name)* | all built-ins | Generic isolated dispatch |

Override per-call with `DELEGATE_TOOLS=...`. The subprocess always runs with `--no-session` (ephemeral) and `--approve` (trust inherited cwd), and loads the role via `/skill:<role> <prompt>` so the role's full SKILL.md body applies.

### Environment variables

| Var | Default | Effect |
|-----|---------|--------|
| `DELEGATE_TOOLS` | *(role default)* | Comma-list of built-in tools for the subprocess |
| `DELEGATE_MODEL` | *(unset → project default)* | Model pattern, e.g. `sonnet:high`, `haiku` |
| `DELEGATE_THINKING` | *(unset)* | `off\|minimal\|low\|medium\|high\|xhigh` |
| `DELEGATE_TIMEOUT` | `600` | Per-subprocess wall-clock seconds |
| `DELEGATE_QUIET` | *(unset)* | If `1`, suppresses the `[delegate]` progress lines on stderr |

## How a coordinator uses this

1. **Dispatch analysis first** to keep your own context clean:
   ```bash
   ./.pi/skills/delegate/scripts/delegate.sh analyst \
     "Read the task file at $TASKS and return a structured task list: per task — ID, one-line description, layer, files touched, acceptance criteria, dependencies."
   ```
2. **Read the returned digest**, sequence the work, then **dispatch implementation** — one isolated subprocess per task. Parallelize when conflict-free (disjoint files / no shared schema), otherwise sequential:
   ```bash
   ./.pi/skills/delegate/scripts/delegate.sh --parallel \
     node-coder "Task T1: <desc>. Files: <paths>. Acceptance: <...>." \
     react-coder "Task T2: <desc>. Files: <paths>. Acceptance: <...>."
   ```
3. **Commit per task** via the `committer` role:
   ```bash
   ./.pi/skills/delegate/scripts/delegate.sh committer \
     "Commit task T1 only. Files: <paths>. Ticket SLYK-123."
   ```
4. **Verify** with the `analyst` role or `verify-implementation` skill.

## Operating rules

- **Delegate, don't do.** You are a dispatcher. Pull curated digests from delegations, not raw file contents, into your own context.
- **One task per delegation.** Hand a coder everything it needs (description, acceptance criteria, file paths, references) so it is self-contained — subprocesses can't ask you follow-ups mid-run.
- **Each subprocess is fire-and-forget** (print mode). It cannot steer or be interrupted; it runs to completion and returns final text. If it needs more context, send the `analyst` first, then pass the digest into the coder's prompt.
- **Parallel only when conflict-free.** Disjoint files / independent migrations / frontend-vs-backend with a stable contract. Same file, same migration, same shared type/DTO, or one task's output being another's input → run sequentially.
- **Never push/merge/rebase from a delegation** unless explicitly told. Committing per task is fine; shipping is the user's call.

## Failure handling

- A subprocess exits non-zero or returns an error → surface it verbatim to the user; do **not** commit a broken task. Re-dispatch with more context, split the task, or run the `analyst` to investigate.
- A role skill name is unknown → `/skill:<role>` passes through unexpanded and the subprocess runs generically; the script warns on stderr.
