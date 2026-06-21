---
name: plan-single-feature
description: Plan one feature into a task-breakdown doc (decisions, architecture, parallelization, T1..Tn tasks). Reads the next un-checked feature from the feature index. Use when asked to plan / prepare / generate tasks for a feature.
---

# Plan Single Feature Skill

Produce a comprehensive **plan + task-breakdown** for one feature in the feature index, then write it to the feature's directory. Output matches the skeleton at [`template/tasks-template.md`](./template/tasks-template.md) (fill every section).

**Project-agnostic.** Feature index, output path, PRD, and the rules to honor are all resolved from the user's prompt or auto-detected — no paths are hardcoded. Copy the skill folder into any project and invoke it. Designed to consume the file produced by the sibling `prd-to-features` skill, but works with any feature index that follows that file's index format contract.

## Why this design

The deliverable is large and groundable in many sources (feature spec, PRD, project rules, dependency features, live code, current library versions). Reading all of it into the main context burns tokens and dilutes reasoning. Instead:

- **Main thread stays lean** — parses the index, dispatches subagents, writes the final file.
- **Heavy reading + research is fanned out** to parallel subagents returning *dense summaries*.
- **A single synthesis subagent** drafts the complete markdown (one coherent author).
- **One writer** (main thread) — avoids coordination races.

## Inputs

Resolve each from the user's prompt → else auto-detect → else ask. Do not guess.

- **Feature index path.** User-given wins. Else auto-detect `features.md` across candidate docs dirs (see *Discovery*). None or >1 → ask.
- **Target feature.** User-named (`F<NN>`) wins. Else the **first un-checked** feature in the index.
- **Output path.** User-given file **or** directory wins.
  - If a directory is given: write `<dir>/F<NN>-<slug>/F<NN>-<slug>-tasks.md`.
  - If a file is given: write exactly that file.
  - Else default: derive from the index's location — `<index-dir>/F<NN>-<slug>/F<NN>-<slug>-tasks.md`.
  - If it **already exists** → ask: overwrite / append / abort. Never silently clobber.
- **PRD path** (optional, for grounding). User-given wins. Else auto-detect a single `*PRD*.md` / `*prd*.md` in the same docs dir as the index, then repo root. None → proceed without (note the gap); the feature spec block is the primary input.
- **Slug.** User-given wins. Else read from a project-metadata file if one exists (see *Discovery*). Else derive from the index file's header.

> **Main thread reads only the feature index** (to find the target) and the synthesis output (to write it). PRD, rules, dep docs, code — all delegated to subagents.

## Discovery (project-agnostic)

Do not hardcode locations. Resolve these by globbing candidate paths and using whatever exists.

- **Docs dir** — first existing of: `.docs/`, `docs/`, `doc/`, repo root.
- **Rules** — gather *all* that exist across these locations (pass the set to subagents; do not name specific rule files):
  - Rule folders: `.claude/rules/`, `.cursor/rules/`, `.agent/rules/`, `.agents/rules/`, `docs/rules/`, `docs/conventions/`.
  - Root convention files: `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `.windsurfrules`, `CONTRIBUTING.md`.
  - If none exist → note that and proceed (do not fabricate conventions).
- **Metadata file** (optional slug source) — first existing of: `.docs/project-metadata.md`, `docs/project-metadata.md`, repo-root `project-metadata.md`.
- **Depth exemplar** (optional) — if one or more completed task docs already exist in the index dir family (any `*-tasks.md` / `*-plan.md` under a sibling `F<NN>-*` directory), point the synthesis agent at the most complete one as a depth/rigor reference only. If none exist, rely on the template alone.

## Execution steps

Follow in order. Do not skip phases.

### Step 1 — Identify the target feature (main thread)

1. Read the feature index file.
2. **Parse the index tolerantly.** The sibling `prd-to-features` skill writes one checkbox per feature (`- [ ] **F<NN>** <title> — <emoji> <Category> · _deps: <ids or —>_`), but other index files may vary. Detect the file's actual convention: find checkbox lines (`- [ ]` unchecked / `- [x]` checked) carrying a feature id (`F<NN>` or similar). Extract id, title, category, and the dependency list (commonly `_deps: F01,F02_`; fall back to a `Depends on:` field if the file uses prose blocks).
3. Pick the target: the user-named feature, else the **first un-checked** one. If the user-named feature is already checked → stop and report.
4. **Extract the full spec block** — the `### F<NN>` / `## F<NN>` section elsewhere in the file containing the authoritative **Goal / Ships / Depends on / PRD / Acceptance / Edge cases**. The index line is only a summary; this block is the real input.
5. **Dependency gate.** For each dep, confirm it is checked done in the index.
   - All done → proceed.
   - Any not done → **warn**, list unmet deps, ask whether to proceed (the plan will state assumptions about un-built seams). Default: ask, don't silently proceed.
6. **Derive the output location** (per *Inputs* — honor a user-given path/dir; otherwise derive).
   - Slug = short kebab from the title: lowercase, drop articles/conjunctions, ≤ 3 significant words.
   - If the file already exists → ask overwrite/append/abort.
7. **Collect source paths** to hand subagents:
   - The PRD path (if found).
   - The feature index file (the F<NN> spec block + any schema-delta rows / cross-cutting decisions).
   - The discovered rules set.
   - The depth exemplar path (if found).
   - The template: [`template/tasks-template.md`](./template/tasks-template.md) (this skill's own dir).

State to the user: *"Target: F<NN> — <title>. Output: <path>. Dispatching analysis."*

### Step 2 — Fan-out analysis (parallel subagents)

Dispatch **3–4 subagents in a SINGLE message** so they run concurrently. Each gets: the target feature spec block, the deps list, and the relevant paths. Each returns a **dense summary** (curated findings with `file:line` or PRD-section citations), never file dumps.

| # | Agent type | Scope | Returns |
|---|-----------|-------|---------|
| A | `analyst` | **Live codebase state.** What exists today that this feature touches: dirs, config, modules, established patterns. Confirm deps are actually implemented in code (not just checked off). Note prior art / partial work. Flag any file path the plan references that does not exist yet. | Codebase summary → feeds §2. |
| B | `analyst` | **Dependency features.** For each dep: read its task doc (if present) and extract the **contracts/seams the target inherits** (env vars, exported functions, route shapes, schema tables, types, config modules). Confirm the dep's acceptance criteria are met in code. | Dependency-contract summary → feeds §1, §3, per-task Dependencies. |
| C | `general-purpose` | **PRD + project rules deep-read.** Extract the exact PRD sections the feature references (schema tables, REQs, journeys) and the applicable discovered rules. Pull verbatim schema columns, env-var tables, route conventions. | PRD/rules extract → feeds §1 and §3 decisions. |
| D | `general-purpose` | **External research** (WebSearch + Context7 MCP). Ground the plan in current (2026) library versions and patterns the feature implies (ORM choice, OAuth/PKCE, DnD lib, sanitizer, etc.). Cite sources. **Adaptive:** skip for pure scaffolding features with no new library decisions. | Research summary → feeds §3 decisions. |

Adapt to feature complexity:
- **Simple scaffolding** (no new libs, no deps): **A + C**.
- **Standard feature** (deps present, established patterns): **A + B + C**.
- **Complex / library-heavy feature** (auth, timer, DnD, reports): **A + B + C + D**.

Thin/empty findings → note the gap; do not invent.

### Step 3 — Synthesize the document (single subagent)

Dispatch **ONE `general-purpose` subagent** (high reasoning effort). Inputs:
- The target feature spec block (Step 1).
- All Phase-2 summaries (A/B/C/D), verbatim.
- The template path — **instruct it to follow the skeleton exactly.**
- The depth exemplar path (if found) — depth/rigor reference, not content to copy.

Instruct the synthesis agent to:
1. Resolve every **edge case** the spec lists into an explicit decision (or a clearly-flagged owner question). No unresolved traps carried forward.
2. Produce the **Key Technical Decisions** table — one row per material choice, each rationale grounded in the Phase-2 evidence (cite PRD §, rule file, or web source).
3. Produce the **Architecture Overview** target tree — only the files/dirs this feature adds or changes; reuse existing structure where the codebase summary confirms it.
4. Produce the **Parallelization Strategy** — batch tasks by dependency order so each batch touches **disjoint file sets** (zero merge conflicts). Include the batch diagram, merge-order rules, summary table, and developer-assignment tracks.
5. Produce the **Tasks** (T1..Tn). Each task: Batch / Depends on / Parallel with / Description (concrete file paths, code snippets, source refs) / Acceptance Criteria (checkboxes) / Dependencies. One task = a few tightly-coupled files.
6. Produce the **Final Acceptance Checklist** mapping back to the feature's definition-of-done.
7. Respect every project rule the rules agent surfaced.
8. Carry forward any **schema delta** this feature owns (per the feature file's schema-deltas section).
9. List **cross-cutting decisions needing owner sign-off** explicitly (don't silently pick irreversible choices).

The agent **returns the complete markdown**. Main thread does not draft content — it only writes the returned text.

### Step 4 — Write the file (main thread)

1. Create the output directory if it does not exist.
2. Write the synthesis output to the resolved output path.
3. **Do not** check the feature box in the index — the owner marks it done only after implementation. Do not commit unless asked (follow repo's git conventions — do not assume a specific rule file exists).

### Step 5 — Report (main thread)

- Output path.
- One-line summary of each Key Technical Decision (especially deviations from the obvious).
- The **batch/parallelization** summary.
- Any **owner sign-off questions** the plan deferred (surface prominently).
- Any **unmet dependency** or **missing source** encountered.

## Rules

- **Parallel dispatch in one message.** Step 2 subagents run concurrently.
- **Subagents return summaries, not file dumps.** Curated findings with citations only.
- **Main thread never reads large source into its own context.** PRD, rules, dep docs, code — all delegated. Main reads only the feature index (to find the target) and the synthesis output.
- **`analyst` for read/analyze, `general-purpose` for web research and synthesis.**
- **One writer.** Only the main thread writes. Subagents do not write.
- **Honor project conventions.** The plan must not contradict the discovered rules.
- **Ground every decision.** Each Key Technical Decision cites a source (PRD §, rule file, dep task doc, code `file:line`, or web URL).
- **Don't invent.** Missing source or empty subagent → say so; never fabricate paths or patterns.

## Failure modes

- **No un-checked feature found** → all done; report and stop.
- **User-named feature already done** → report; ask if they want to re-plan anyway.
- **Dependency not done** → warn (Step 1.5) and ask before proceeding.
- **Output file exists** → ask overwrite/append/abort; never clobber silently.
- **Subagent returns thin findings** → note the gap; no guesses.
- **Synthesis output missing a template section** → reject and re-dispatch synthesis with the specific gap called out.
