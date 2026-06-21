# Orchestrator Skill → Headless Dispatch (Architecture & Implementation Plan)

## 1. Problem

Current `orchestrator` skill uses the `Task` tool to spawn `analyst` / `node-coder` / `react-coder` **subagents**. Claude Code subagents **cannot nest** — a subagent cannot spawn further subagents. Consequences:

- A coder subagent cannot divide a large task and delegate the pieces.
- An analyst subagent cannot fan out multiple parallel investigation subagents.
- All decomposition must live in the orchestrator's own context (itself a subagent-spawner, so only **1 level** of delegation total: orchestrator → subagent).

## 2. Goal

Replace Task-tool subagent dispatch with **headless `claude -p` sessions**. Each headless session is an **independent top-level agent** with full tool access — including the `Task`/Agent tool. Result: **2 levels of delegation** become possible (headless main → its own subagents).

- Orchestrator runs a **headless main-analyst** that itself spawns many parallel `analyst` subagents.
- Orchestrator runs a **headless coder** per task; that coder may spawn `analyst` (locate) and `node-coder`/`react-coder` (delegate) subagents.
- Git stays centralized: headless coders **never** commit; orchestrator still delegates commits to the existing `committer` Task-subagent.

## 3. Architecture

```
Interactive /orchestrator session   (depth 0, runs SKILL.md)
  |
  |-- Bash: claude -p  [HEADLESS MAIN ANALYST]   --json-schema task-list
  |      |-- Task: analyst subagent (area A) ─┐
  |      |-- Task: analyst subagent (area B)  │ parallel
  |      |-- Task: analyst subagent (area C) ─┘
  |      --> returns structured task list (JSON), each task tagged kind: feature|task
  |
  |-- parse JSON -> TaskCreate todos
  |
  |-- per task:
  |     kind = task (leaf)
  |       |-- Bash: claude -p  [HEADLESS CODER]   --json-schema coder-result  (depth 1)
  |       |      |-- Task: analyst (locate)
  |       |      |-- Task: node-coder | react-coder  (multiple, parallel slices)
  |       |      --> coder-result JSON
  |
  |     kind = feature (composite)
  |       |-- Bash: claude -p  [HEADLESS SUB-ORCHESTRATOR]  --json-schema feature-result  (depth 1)
  |       |      |-- Task: analyst subagents (decompose feature -> leaf tasks)
  |       |      |-- (depth < MAX) Bash: claude -p [HEADLESS CODER] per leaf task  (depth 2)
  |       |      |      |-- Task: analyst + node-coder + react-coder  (multiple subagents)
  |       |      |      --> coder-result JSON
  |       |      |__(depth >= MAX) Task: node-coder | react-coder subagents directly
  |       |      --> aggregates leaf results -> feature-result JSON
  |
  |-- Task: committer subagent  (stage + commit per dispatched unit, filesTouched aggregated up)
  |
  --> report
```

Two shifts:
1. Orchestrator stops using `Task` for analyst/coder work — uses **Bash → `claude -p`**. `Task` reserved for the `committer`.
2. **Recursive**: feature-level tasks route to a headless **sub-orchestrator** (depth 1), which decomposes them into leaf tasks and dispatches each to a headless **coder** (depth 2) that uses multiple subagents. Leaf tasks skip the sub-orchestrator and go straight to a headless coder. Depth-bounded (§5).

## 4. Decision Matrix (resolving each open flag)

| Concern | Decision | Reason |
|---|---|---|
| Analyst dispatch | Headless `claude -p` (main analyst) | Needs parallel subagent fan-out — impossible as a subagent. |
| Coder dispatch | Headless `claude -p` per task | Needs sub-delegation for large tasks. |
| Committer dispatch | Keep as `Task` subagent | No nesting benefit; keeps git centralized + cached context. |
| Worktrees per task | **No** — shared working tree | User mandate. Merge-back avoided. |
| Parallel coders | Allowed **only** when conflict-free (disjoint files) | Shared tree ⇒ concurrent writes race otherwise. |
| Permissions | `--dangerously-skip-permissions` | User mandate. Blanket bypass. |
| `--allowedTools` | **Not used** | User mandate (skip-permissions instead). |
| `--max-budget` | **Not used** | User mandate. |
| `--output-format` | `json` (one-shot), `stream-json` (optional streaming) | Reliable machine-parseable result. |
| `--json-schema` | **Yes**, every dispatch | Forces validated structured return; orchestrator parses `.result`. |
| `--bare` | **No** | Need CLAUDE.md, hooks, MCP, agent registry, persona — all auto-loaded. |
| `--agents` | **Not used** | Default registry already exposes `analyst`/`node-coder`/`react-coder`/`committer`. |
| `--append-system-prompt` | **Yes — via `--append-system-prompt-file`** | Role instructions (main-analyst / coder) are stable ⇒ file. Project rules already in CLAUDE.md, NOT re-injected. |
| `--session-id` | **Yes** — orchestrator generates UUID per dispatch | Enables deterministic resume. |
| `--resume` | **Recovery only** — not normal flow | One-shot `-p` is simpler; resume used when a coder blocks/crashes to continue same context cheaply. |
| `--continue` | **No** | Ambiguous under parallel dispatch (resumes "most recent"). |
| `--model` / `--effort` | Omit (inherit account default) | Tunable later; not now. |
| Prompt delivery | **stdin** (heredoc / `< file`) | Avoids arg-length + quoting limits for large task briefs. |

## 5. Recursion Model (bounded)

Recursion is **allowed but bounded** — this is what enables feature → sub-orchestrator → task → multiple subagents.

### Who may spawn headless `claude -p`
- **Orchestrator-role sessions only** (depth 0 interactive + depth ≥1 headless sub-orchestrator).
- **Coder role NEVER spawns headless** — `roles/coder.md` forbids `claude -p`; uses Task-tool subagents only. This is the hard floor.

### Depth accounting
- Env `ORCHESTRATOR_DEPTH`: 0 at the interactive orchestrator. Parent passes `ORCHESTRATOR_DEPTH=$((d+1))` to each child headless session.
- Env `ORCHESTRATOR_MAX_DEPTH` (default **2**): a sub-orchestrator at depth `d` may spawn a headless coder only if `d < MAX`. At the cap, it dispatches leaf tasks to coder **subagents** directly (no further headless).
- Because the coder role never recurses, the chain caps naturally at **2 headless layers** even without the env check: `orchestrator(0) → sub-orchestrator(1) → coder(2) → subagents`. `ORCHESTRATOR_MAX_DEPTH` is belt-and-suspenders + enables the flat toggle (§12).

### Cheaper variant (toggle `ORCHESTRATOR_FLAT=1`)
Sub-orchestrator dispatches leaf tasks to multiple coder **subagents** directly (parallel siblings) instead of headless coders. A task is still done by multiple subagents, but skips the depth-2 cold start. Tradeoff: sub-orchestrator context holds the whole feature (less isolation, lower cost). Off by default.

### Guarantees
- Only orchestrator-role prompts call `run-headless.sh`.
- Coder role forbids `claude -p` → no runaway.
- Subagents (Task tool) cannot nest regardless → leaves are always terminal.

## 6. Component Inventory

Create / modify under `.claude/skills/orchestrator/`:

```
.claude/skills/orchestrator/
  SKILL.md                          # REWRITE — new headless workflow (depth 0)
  roles/
    main-analyst.md                 # NEW — role prompt for headless analyst
    coder.md                        # NEW — role prompt for headless coder (leaf, never recurses)
    sub-orchestrator.md             # NEW — role prompt for headless sub-orchestrator (feature, depth >=1)
  schemas/
    task-list.schema.json           # NEW — analyst output schema (tasks tagged kind: feature|task)
    coder-result.schema.json        # NEW — coder output schema (leaf task result)
    feature-result.schema.json      # NEW — sub-orchestrator output schema (aggregated leaf results)
  scripts/
    run-headless.sh                 # NEW — unified dispatch wrapper (bakes fixed flags, propagates depth env)
```

No backend / frontend source touched. Pure tooling change.

## 7. Role Prompts

### 7.1 `roles/main-analyst.md`

```markdown
# Role: Main Analyst (headless session)

You are the MAIN ANALYST inside a headless Claude Code session spawned by the orchestrator.
One job: turn a raw plan / task-breakdown into a structured, dependency-ordered task list.

## How you work
- You are a DISPATCHER, not a file reader. Keep your own context lean.
- Spawn MULTIPLE `analyst` subagents IN PARALLEL — several Task calls in a single message.
  Assign each a distinct area: routes/controllers, data model + schema/migrations,
  frontend components/hooks, existing tests, shared types/constants, API contracts.
- Collect their digests, dedupe, sequence by dependency, merge into one task list.
- Every task must list the concrete files it will touch (for conflict detection).

## Hard limits
- NEVER run `claude -p` or any headless command. Task-tool subagents only.
- NEVER modify files. Read-only investigation.
- NEVER run git.

## Output
Return ONLY the JSON object validated against the supplied schema. No prose, no fences.
```

### 7.2 `roles/coder.md`

```markdown
# Role: Coder (headless session)

You are a CODER COORDINATOR inside a headless Claude Code session spawned by the orchestrator.
Implement ONE task (or one conflict-free batch) to completion.

## Your default mode: DISPATCH, do not hand-roll
You are a full top-level agent — the whole reason you exist is that you can delegate.
USE THE CODER SUBAGENTS. Do the work THROUGH them, not beside them.

Available subagents (spawn via the Task tool by `subagent_type`):
- `analyst`      — read-only locator/excerpter. Your eyes. ALWAYS run first.
- `node-coder`   — backend implementation (Node.js / Express + PostgreSQL). One scoped task each.
- `react-coder`  — frontend implementation (React / TypeScript). One scoped task each.

## How you work
1. LOCATE first: spawn one or more `analyst` subagents (parallel OK) to return exact file
   paths + relevant excerpts. Do NOT blind-edit.
2. DELEGATE the implementation: hand each backend slice to a `node-coder` subagent and each
   frontend slice to a `react-coder` subagent. One well-scoped slice per invocation.
   Pass each: the slice description, acceptance criteria, and the file paths/references
   the analyst returned.
3. COORDINATE: sequence slices by dependency; merge results; resolve integration gaps.
   Write glue/integration code yourself only when no subagent owns it.
4. VERIFY: typecheck / run tests before returning success.

Rules of thumb:
- Task has a clear backend part AND frontend part ⇒ two subagents, sequenced (backend first if
  the frontend consumes a new contract).
- Task is one small mechanical edit ⇒ still fine to do it directly, but prefer a subagent if it
  touches >1 file.
- Never do directly what a `node-coder`/`react-coder` subagent could do — that defeats the design.

## Hard limits
- NEVER run `claude -p` or any headless command. Task-tool subagents only.
  (You are already one level deep — that is the contract.)
- NEVER run git (add/commit/push/branch). Committing is the orchestrator's job.
- Follow project conventions — CLAUDE.md, js-style-guide, js-testing-rules,
  js-development-rules are already loaded. Respect them.
- If blocked or a conflict with existing code arises, return status "blocked" with
  full detail in `blockers`. Do not fake success.

## Output
Return ONLY the JSON object validated against the supplied schema. No prose, no fences.
```

### 7.3 `roles/sub-orchestrator.md`

```markdown
# Role: Sub-Orchestrator (headless session)

You are a SUB-ORCHESTRATOR inside a headless Claude Code session. You own ONE feature
(a composite backend or frontend unit) and drive it to done by DELEGATING — never hand-coding.

## Context
- Spawned by a parent orchestrator. Env `ORCHESTRATOR_DEPTH` = your depth (>=1).
- Hard cap `ORCHESTRATOR_MAX_DEPTH` (default 2).
- Env `ORCHESTRATOR_FLAT` (0 default). If 1, use the flat path below.

## How you work
1. CURATE: spawn `analyst` subagents IN PARALLEL to decompose the feature into leaf tasks.
   Each leaf task: id, layer, concrete files[], acceptance criteria. Identify dependencies.
2. SEQUENCE: order leaf tasks by dependency. Group conflict-free ones (disjoint files[]) for parallel dispatch.
3. DISPATCH each leaf task — choose path:
   - DEFAULT (depth < MAX and FLAT=0): spawn a headless CODER for the task
     (scripts/run-headless.sh coder schemas/coder-result.schema.json "$SID" < brief).
     The coder uses multiple subagents itself. Collect its coder-result.
   - FLAT (FLAT=1, or depth >= MAX): dispatch DIRECTLY to `node-coder` / `react-coder`
     subagents — several in parallel for one task if it has independent slices.
     One scoped slice per subagent invocation. No further headless.
4. AGGREGATE: roll up each leaf's {taskId, status, filesTouched, summary, verification, blockers}
   into the feature result. Resolve integration gaps between leaves yourself.
5. Do NOT commit. Do NOT run git. The parent (depth 0) orchestrator owns commits.

## Hard limits
- Respect `ORCHESTRATOR_MAX_DEPTH`. Do not spawn headless beyond the cap.
- NEVER run `claude -p` except via scripts/run-headless.sh, and only for the `coder` role.
- NEVER commit / git / push / branch.
- Shared working tree: enforce conflict-free parallelism on files[].
- A blocked leaf -> surface in that leaf's blockers; do not fake success.

## Output
Return ONLY the JSON object validated against the feature-result schema. No prose, no fences.
```

## 8. JSON Schemas

### 8.1 `schemas/task-list.schema.json`

```json
{
  "type": "object",
  "required": ["tasks"],
  "properties": {
    "tasks": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "kind", "description", "layer", "files", "acceptanceCriteria", "dependencies"],
        "properties": {
          "id": { "type": "string" },
          "kind": { "type": "string", "enum": ["task", "feature"], "description": "task=leaf (single unit), feature=composite (needs sub-orchestrator decomposition)" },
          "description": { "type": "string" },
          "layer": { "type": "string", "enum": ["backend", "frontend", "other"] },
          "files": { "type": "array", "items": { "type": "string" } },
          "acceptanceCriteria": { "type": "array", "items": { "type": "string" } },
          "dependencies": { "type": "array", "items": { "type": "string" } },
          "references": { "type": "array", "items": { "type": "string" } }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

### 8.2 `schemas/coder-result.schema.json`

```json
{
  "type": "object",
  "required": ["taskId", "status", "filesTouched", "summary"],
  "properties": {
    "taskId": { "type": "string" },
    "status": { "type": "string", "enum": ["success", "blocked", "partial"] },
    "filesTouched": { "type": "array", "items": { "type": "string" } },
    "summary": { "type": "string" },
    "verification": { "type": "string" },
    "blockers": { "type": "array", "items": { "type": "string" } },
    "notes": { "type": "string" }
  },
  "additionalProperties": false
}
```

### 8.3 `schemas/feature-result.schema.json`

Returned by a headless sub-orchestrator. Aggregates its leaf tasks' results so the depth-0 orchestrator can commit + report per feature without re-parsing internals.

```json
{
  "type": "object",
  "required": ["featureId", "status", "tasks"],
  "properties": {
    "featureId": { "type": "string" },
    "status": { "type": "string", "enum": ["success", "blocked", "partial"] },
    "tasks": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["taskId", "status", "filesTouched", "summary"],
        "properties": {
          "taskId": { "type": "string" },
          "status": { "type": "string", "enum": ["success", "blocked", "partial"] },
          "filesTouched": { "type": "array", "items": { "type": "string" } },
          "summary": { "type": "string" },
          "verification": { "type": "string" },
          "blockers": { "type": "array", "items": { "type": "string" } }
        },
        "additionalProperties": false
      }
    },
    "blockers": { "type": "array", "items": { "type": "string" } },
    "notes": { "type": "string" }
  },
  "additionalProperties": false
}
```

## 9. Dispatch Wrapper — `scripts/run-headless.sh`

Centralizes fixed flags so `SKILL.md` stays clean and flag edits localize to one file.

```bash
#!/usr/bin/env bash
# run-headless.sh — unified headless dispatch for the orchestrator skill.
# Usage:
#   run-headless.sh <role> <schema-file> [session-id]  < prompt.txt > out.json
#   RESUME=1 run-headless.sh <role> <schema-file> <session-id> < followup.txt > out.json
set -euo pipefail

ROLE="${1:?usage: run-headless.sh <role> <schema-file> [session-id]}"
SCHEMA_FILE="${2:?schema file required}"
SESSION_ID="${3:-}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROLE_FILE="${HERE}/../roles/${ROLE}.md"
SCHEMA="$(cat "${SCHEMA_FILE}")"

ARGS=(
  -p
  --output-format json
  --json-schema "${SCHEMA}"
  --append-system-prompt-file "${ROLE_FILE}"
  --dangerously-skip-permissions
)

if [[ "${RESUME:-0}" == "1" ]]; then
  [[ -n "${SESSION_ID}" ]] || { echo "RESUME=1 requires a session-id" >&2; exit 2; }
  ARGS+=(--resume "${SESSION_ID}")
elif [[ -n "${SESSION_ID}" ]]; then
  ARGS+=(--session-id "${SESSION_ID}")
fi

# Prompt comes from stdin; result JSON to stdout, diagnostics to stderr.
# Auto-increment depth so each headless layer sees parent_depth + 1.
export ORCHESTRATOR_DEPTH=$(( ${ORCHESTRATOR_DEPTH:-0} + 1 ))
export ORCHESTRATOR_MAX_DEPTH="${ORCHESTRATOR_MAX_DEPTH:-2}"
exec claude "${ARGS[@]}"
```

Typical orchestrator invocation (run via the Bash tool):

```bash
SID=$(uuidgen)
.run-headless() { .claude/skills/orchestrator/scripts/run-headless.sh "$@"; }

# 1. Analyst
SID_A=$(uuidgen)
.run-headless main-analyst \
  .claude/skills/orchestrator/schemas/task-list.schema.json "$SID_A" \
  < .docs/some-plan.md > /tmp/analyst-out.json 2> /tmp/analyst-err.log
# parse: jq '.result.tasks' /tmp/analyst-out.json

# 2. Coder (per task)
SID_C=$(uuidgen)
.read_task_brief | .run-headless coder \
  .claude/skills/orchestrator/schemas/coder-result.schema.json "$SID_C" \
  > /tmp/coder-out.json 2> /tmp/coder-err.log
# parse: jq '.result' /tmp/coder-out.json  -> status, filesTouched, blockers

# 3. Recovery (if status == blocked)
printf '%s' "$FOLLOWUP" | RESUME=1 .run-headless coder \
  .claude/skills/orchestrator/schemas/coder-result.schema.json "$SID_C" \
  > /tmp/coder-out2.json 2> /tmp/coder-err2.log
```

## 10. SKILL.md — Rewritten Workflow (outline)

Frontmatter: keep `name: orchestrator`. Update `description` to mention headless dispatch.

Body sections:

1. **Role of orchestrator** — coordinator only. Dispatches via Bash → `claude -p`. Reserves `Task` for the `committer`.
2. **Subagents still available (Task tool)** — `committer` only (lightweight, cached). `analyst`/`node-coder`/`react-coder` are now used *inside* headless sessions, not by the orchestrator directly.
3. **Workflow**
   1. **Curate via headless main-analyst.** Write the raw plan/task-set to a temp file. Run `run-headless.sh main-analyst schemas/task-list.schema.json "$SID" < plan.txt > out.json`. Parse `.result.tasks`.
   2. **Build todos.** `TaskCreate` from parsed tasks; order by `dependencies`.
   3. **Dispatch by `kind`** — sequential in dependency order; **parallel** (multiple Bash tool calls in one message) only when conflict-free per heuristics.
      - `kind: task` (leaf) → run `run-headless.sh coder schemas/coder-result.schema.json "$SID"` with the task brief on stdin. The coder uses multiple subagents internally.
      - `kind: feature` (composite) → run `run-headless.sh sub-orchestrator schemas/feature-result.schema.json "$SID"` with the feature brief on stdin. The sub-orchestrator decomposes into leaf tasks and dispatches each (headless coder at depth 2, or coder subagents directly if at `ORCHESTRATOR_MAX_DEPTH` / `ORCHESTRATOR_FLAT=1`).
      - Each dispatch gets a fresh `SID`; record `{task/feature → SID}` in todo metadata for resume.
   4. **Handle result.**
      - Coder `success` → hand `filesTouched` to `committer` → mark done.
      - Sub-orchestrator `success` → aggregate `filesTouched` across its `tasks[]`; hand the union to `committer` (commit once per feature, or once per leaf task — pick per-feature for composite units) → mark done.
      - `blocked`/`partial` → do NOT commit; `RESUME=1` follow-up to the stored `SID`, or split/reorder/re-dispatch. Never silently skip.
   5. **Report.** Per-task: files touched, verified?, blocked items.
4. **Conflict-free heuristics** — carry over verbatim from current SKILL.md (parallel OK = disjoint files / independent schema / stable API contract; sequential required = shared file/model/migration/config or producer-consumer coupling). Emphasize: shared working tree ⇒ heuristic is **mandatory**, not optional.
5. **Operating constraints**
   - Delegate, don't do.
   - One commit per task via `committer`; never push.
   - Invoking `/orchestrator` = standing approval to commit per task (carry over).
   - Headless sessions are expendable: parse output, don't trust prose.
   - Never let two tasks' files land in one commit.
   - Single task ⇒ one headless coder directly, skip analyst step.
6. **Flag reference table** — the Decision Matrix (§4) inline, so future edits are self-documenting.
7. **Failure modes** — schema-validation failure (re-run), crash (resume by `SID`), git race (only sequential commits, orchestrator-owned).

## 11. Parallelism & Conflict Rules (shared tree)

- Parallel headless coders write the **same** working tree. Safe **iff** file sets are disjoint.
- Orchestrator computes file-set overlap from the analyst's `files[]` arrays before dispatching.
  - Zero overlap across a group ⇒ dispatch group in parallel (multiple Bash calls, one message).
  - Any overlap ⇒ sequential.
- **Commits are always sequential** and orchestrator-owned: even if coders ran in parallel, orchestrator invokes `committer` one task at a time after results return. This is the only git concurrency control.
- No `git add -A`. Committer stages exactly the task's `filesTouched`.

## 12. Session-ID / Resume Strategy

- **Per dispatch:** orchestrator mints `SID=$(uuidgen)`, passes `--session-id "$SID"`, stores `{task → SID}` in todo metadata.
- **Normal flow:** one-shot `-p`. No resume.
- **Recovery flow:** if a coder returns `blocked` or the process crashes, orchestrator runs the same wrapper with `RESUME=1` and the stored `SID` plus a follow-up prompt. Keeps the coder's prior investigation in context (cheaper + more coherent than cold re-dispatch).
- **Analyst resume:** rarely needed (analyst is one-shot read-only). Available via same mechanism if a large plan needs a second investigation pass.
- `--continue` deliberately unused (ambiguous under parallel runs).

## 13. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Token cost — each `-p` = fresh context, no cross-process prompt cache | Keep prompts lean; let headless session's own subagents pull files. Accept cost (trade for nesting). |
| Recursion cost — feature path spawns sub-orchestrator + N coder headless sessions (depth 2) | Bound via `ORCHESTRATOR_MAX_DEPTH` (default 2). Use `ORCHESTRATOR_FLAT=1` to drop depth-2 coders (sub-orchestrator dispatches coder subagents directly). Reserve `kind: feature` for genuinely composite units. |
| Cold-start latency per dispatch (process spawn + MCP init) | Accept; parallelize where safe. Single-task path skips analyst. |
| Shared-tree write races during parallel coders | Mandatory conflict-free gate on `files[]`; sequential commits. |
| `--dangerously-skip-permissions` = full bypass | Local trusted dev only; role prompts forbid destructive ops (git, headless recursion). Document trust assumption. |
| Output not matching schema / parse failure | `--json-schema` enforces; on validation error re-run with same `SID` + "emit valid JSON only" nudge. |
| Recursion (headless spawns headless) | Role-prompt forbid + `ORCHESTRATOR_DEPTH` soft guard + natural subagent-nesting cap. |
| Interactively-authed MCP absent headless | Document; non-blocking for this skill (no such MCP required). |
| Quoting/arg-length on large prompts | Prompt via stdin, not arg. |
| Result handoff fragility (parsing stdout) | `--output-format json` + `--json-schema` ⇒ structured `.result`; orchestrator parses with `jq`. |

## 14. Verify Before Build (runtime checks)

Confirm empirically before relying on:

1. `--append-system-prompt-file <path>` accepts a file path (help implies it; verify on first run).
2. `--json-schema` + `--output-format json` together yield a wrapper whose `.result` is the validated object.
3. A `claude -p` session exposes the `Task`/Agent tool (so headless main can spawn subagents). Expected: yes.
4. `--dangerously-skip-permissions` alone is sufficient (no additional `--permission-mode` needed).
5. `--session-id <uuid>` then `--resume <uuid>` correctly continues the same session.
6. `--json-schema` is inline-only (confirmed: no file variant) ⇒ wrapper reads file and inlines.

## 15. Implementation Steps (ordered)

1. Create dirs: `roles/`, `schemas/`, `scripts/` under `.claude/skills/orchestrator/`.
2. Write `roles/main-analyst.md`, `roles/coder.md` (§7).
3. Write `schemas/task-list.schema.json`, `schemas/coder-result.schema.json` (§8).
4. Write `scripts/run-headless.sh`, `chmod +x`.
5. Run §14 verification checks (smoke-test each flag).
6. Rewrite `SKILL.md` per §10.
7. Dry-run end-to-end on a tiny 2-task plan: analyst → parse → 2 coders (1 parallel pair, 1 sequential pair) → committer → report. Confirm JSON round-trips and commits land per-task.
8. Tune only if needed: `--model` / `--effort` per role.

## 16. Out of Scope / Future

- Per-task git worktrees (explicitly rejected by user now; revisit if shared-tree races bite).
- `--allowedTools` tightening (rejected now; full bypass chosen).
- Budget caps (rejected now).
- Cross-session prompt-cache sharing (not supported by harness; would reduce cost).
- Depth > 2 (raise `ORCHESTRATOR_MAX_DEPTH` only if a tier beyond feature→task proves necessary; cost scales poorly).
- A native "nested subagent" feature if Anthropic ships one — would obsolete this design.
