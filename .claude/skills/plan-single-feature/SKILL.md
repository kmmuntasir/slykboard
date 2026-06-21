---
name: plan-single-feature
description: Plan the next not-yet-done feature from .docs/features.md into a comprehensive task-breakdown document. Reads the feature index, fans out parallel subagents (analyst + general-purpose) to analyze the live codebase, dependency features, the PRD, and current best practices via web search, then synthesizes a plan + tasks doc under .docs/features/F<NN>-<slug>/ mirroring the F01 exemplar. Use when the user asks to plan, prepare, or generate tasks for the next feature.
---

# Plan Single Feature Skill

Produce a comprehensive **plan + task-breakdown** for the next not-yet-implemented feature in `.docs/features.md`, then write it to the feature's directory. Output must match the F01 exemplar in structure, depth, and rigor:

- Exemplar: `.docs/features/F01-monorepo-scaffolding/F01-monorepo-scaffolding-tasks.md`
- Section skeleton: [`template/tasks-template.md`](./template/tasks-template.md) (fill every section)

## Why this design

The deliverable is large and groundable in many sources (feature spec, PRD schema, project rules, dependency features, live code, current library versions). Reading all of it into the main context burns tokens and dilutes reasoning. Instead:

- **Main thread stays lean** — it only parses the index, dispatches subagents, and writes the final file.
- **Heavy reading + research is fanned out** to parallel subagents that return *dense summaries*, not raw file dumps.
- **A single synthesis subagent** drafts the complete markdown from those summaries (so one coherent author writes the whole doc, not three competing drafts).
- **One writer** (main thread) writes the file — avoids coordination races.

## Inputs

No path argument required. The skill derives the target. If the user names a specific feature (e.g. "plan F03"), honor it; otherwise use the next not-done feature.

## Execution steps

Follow in order. Do not skip phases.

### Step 1 — Identify the target feature (main thread)

1. Read `.docs/features.md`.
2. Scan the **Feature Index** for the **first unchecked** line matching `- [ ] **F<NN>**`. That is the target. (First-checked pattern: `- [x]`.)
   - If the user named a feature (`F<NN>`), target that one instead — verify it is unchecked; if already done, stop and report.
3. Extract from the index line:
   - Feature number (`F<NN>`), title, category emoji (🏗/🔧/✨/⬆/🚀), and the `_deps: ..._` list.
4. Extract the **full spec block** — the `### F<NN> — <title>` section in the phase area below the index. It contains the authoritative **Goal / Ships / Depends on / PRD / Acceptance / Edge cases**. This is the real input; the index line is only a summary.
5. **Dependency gate.** For each feature in `_deps_`, confirm it is `- [x]` done in the index.
   - All deps done → proceed.
   - Any dep not done → **warn the user**, list the unmet deps, and ask whether to proceed (the plan will then state assumptions about un-built seams). Default: ask, don't silently proceed.
6. **Derive the output location.**
   - Slug = short kebab from the title: lowercase, drop articles/conjunctions (`&`, `and`, `with`, `for`), ≤ 3 significant words. Examples (mirroring F01's brevity): "Monorepo scaffolding & dev tooling" → `monorepo-scaffolding`; "Database connection & migration pipeline" → `database-connection`; "Google SSO login + JWT issuance" → `google-sso-login`.
   - Output dir: `.docs/features/F<NN>-<slug>/`
   - Output file: `F<NN>-<slug>-tasks.md`
   - If the file already exists → ask: overwrite, append, or abort. Do not silently clobber.
7. Collect the **source paths** to hand to subagents:
   - `.docs/basic-PRD.md`
   - `.docs/features.md` (the F<NN> spec block + any schema-delta rows / cross-cutting decisions at the bottom)
   - `.claude/rules/*.md`
   - The exemplar: `.docs/features/F01-monorepo-scaffolding/F01-monorepo-scaffolding-tasks.md`
   - The template: `.claude/skills/plan-single-feature/template/tasks-template.md`

State to the user: *"Target: F<NN> — <title>. Output: <path>. Dispatching analysis."*

### Step 2 — Fan-out analysis (parallel subagents)

Dispatch **3–4 subagents in a SINGLE message** so they run concurrently. Each gets: the target feature spec block, the deps list, and the relevant paths. Each returns a **dense summary** (curated findings with `file:line` or PRD-section citations), never raw file dumps or full copies.

| # | Agent type | Scope | Returns |
|---|-----------|-------|---------|
| A | `analyst` | **Live codebase state.** What exists today that this feature touches: directories, config, existing modules, established patterns. Confirm the feature's deps are actually implemented in code (not just checked off). Note prior art / partial work. Flag any file path the plan might reference that does not exist yet. | Codebase summary → feeds §2 of the doc. |
| B | `analyst` | **Dependency features.** For each dep feature: read its `-tasks.md` doc (if present) and extract the **contracts/seams the target inherits** (env vars, exported functions, route shapes, schema tables, types, config modules). Confirm the dep's acceptance criteria are met in code. | Dependency-contract summary → feeds §1, §3, and per-task Dependencies. |
| C | `general-purpose` | **PRD + project rules deep-read.** Extract the exact PRD sections the feature references (`§8.x` schema tables, `REQ-x.x`, user journeys) and the applicable rules (`js-development-rules.md`, `js-style-guide.md`, `js-testing-rules.md`, `git-guidelines.md`). Pull verbatim schema columns, env-var tables, route conventions. | PRD/rules extract → feeds §1 and §3 decisions. |
| D | `general-purpose` | **External research** (WebSearch + Context7 MCP). Ground the plan in current (2026) library versions and patterns the feature implies — e.g. ORM choice, OAuth/PKCE flow, DnD lib, WYSIWYG sanitizer, server-timer patterns. Cite sources. **Adaptive:** skip this agent for pure scaffolding features with no new library decisions. | Research summary → feeds §3 decisions. |

Adapt the fan-out to feature complexity:
- **Simple scaffolding** (no new libs, no deps): agents A + C only.
- **Standard feature** (deps present, established patterns): A + B + C.
- **Complex / library-heavy feature** (auth, timer, DnD, reports): A + B + C + D.

If any subagent returns thin/empty findings, note the gap — do not invent.

### Step 3 — Synthesize the document (single subagent)

Dispatch **ONE `general-purpose` subagent** (high reasoning effort). Inputs:
- The target feature spec block (Step 1).
- All Phase-2 summaries (A/B/C/D), verbatim.
- The template path: `.claude/skills/plan-single-feature/template/tasks-template.md` — **instruct it to follow this skeleton exactly.**
- The F01 exemplar path — as a depth/rigor reference, not to copy content.

Instruct the synthesis agent to:
1. Resolve every **edge case** the spec lists into an explicit decision (or a clearly-flagged owner question). Do not carry forward unresolved traps.
2. Produce the **Key Technical Decisions** table — one row per material choice, each with a rationale grounded in the Phase-2 evidence (cite PRD §, rule file, or web source).
3. Produce the **Architecture Overview** target tree — only the files/dirs this feature adds or changes; reuse existing structure where the codebase summary confirms it.
4. Produce the **Parallelization Strategy** — batch tasks by dependency order so each batch touches **disjoint file sets** (zero merge conflicts). Include the batch diagram, merge-order rules, summary table, and developer-assignment tracks.
5. Produce the **Tasks** (T1..Tn). Each task: Batch / Depends on / Parallel with / Description (with concrete file paths, code snippets, source refs) / Acceptance Criteria (checkboxes) / Dependencies. One task = a few tightly-coupled files.
6. Produce the **Final Acceptance Checklist** mapping back to the feature's definition-of-done.
7. Respect every project rule the PRD/rules agent surfaced (2-space JS / 4-space JSX, Vitest co-located tests, REST envelope, rebase-only git, etc.).
8. Carry forward any **schema delta** (per `.docs/features.md` §"Schema deltas vs. PRD") this feature owns.
9. List **cross-cutting decisions needing owner sign-off** explicitly (don't silently pick on irreversible choices).

The agent **returns the complete markdown** as its final message. Main thread does **not** draft content — it only writes the returned text.

### Step 4 — Write the file (main thread)

1. Create the output directory if it does not exist.
2. Write the synthesis output to `.docs/features/F<NN>-<slug>/F<NN>-<slug>-tasks.md`.
3. **Do not** check the feature box in `.docs/features.md` — the owner marks it done only after implementation. Do not commit unless asked (per `git-guidelines.md`).

### Step 5 — Report (main thread)

Report to the user:
- Output path.
- One-line summary of each Key Technical Decision (especially any that deviate from the obvious).
- The **batch/parallelization** summary.
- Any **owner sign-off questions** the plan deferred (surface these prominently).
- Any **unmet dependency** or **missing source** encountered.

## Rules

- **Parallel dispatch in one message.** Subagents in Step 2 run concurrently; do not serialize them.
- **Subagents return summaries, not file dumps.** Reject raw full-file copies in favor of curated findings with citations.
- **Main thread never reads large source into its own context.** PRD, rules, dep docs, code — all delegated. Main reads only `.docs/features.md` (to find the target) and the synthesis output (to write it).
- **`analyst` for read/analyze, `general-purpose` for web research and synthesis.** The analyst agent is read-only and curated; use it wherever the job is "locate/read/summarize". Use general-purpose only for WebSearch/Context7 work and the final synthesis (which needs no tools beyond reasoning + writing its return text).
- **One writer.** Only the main thread writes the file. Subagents do not write.
- **Honor project conventions.** The plan must not contradict `.claude/rules/*` or `git-guidelines.md`.
- **Ground every decision.** Each Key Technical Decision cites a source (PRD §, rule file, dep task doc, code `file:line`, or web URL).
- **Don't invent.** If a source is missing or a subagent returns nothing, say so rather than fabricating file paths or patterns.

## Failure modes

- **No unchecked feature found** → all features done; report and stop.
- **User-named feature already done** → report; ask if they want to re-plan anyway.
- **Dependency not done** → warn (Step 1.5) and ask before proceeding.
- **Output file exists** → ask overwrite/append/abort (Step 1.6); never clobber silently.
- **Subagent returns thin findings** → note the gap; do not fill with guesses.
- **Synthesis output missing a template section** → reject and re-dispatch synthesis with the specific gap called out.
