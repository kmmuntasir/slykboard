---
name: prd-to-features
description: Turn a PRD into a phased feature-breakdown file (Goal/Ships/Depends-on/Acceptance per feature, checklist index, schema deltas, decisions). Use when converting a PRD into a feature list / backlog / roadmap.
---

# PRD → Features Skill

Produce a complete **feature breakdown** from a Product Requirements Document — small, shippable, sequential features grouped into dependency phases. Output matches the skeleton at [`template/features-template.md`](./template/features-template.md) (fill every section).

**Project-agnostic.** Source PRD, output file, project slug, and the rules to honor are all resolved from the user's prompt or auto-detected — no paths are hardcoded. Copy the skill folder into any project and invoke it.

## Why this design

The deliverable is large and groundable in many sources (PRD goals, requirements, schema, journeys, project rules, repo state, decomposition best practices). Pulling all of it into the main context burns tokens and dilutes reasoning. Instead:

- **Main thread stays lean** — resolves input/output paths, dispatches subagents, writes the final file.
- **Heavy reading + research is fanned out** to parallel subagents that return *dense summaries*, not file dumps.
- **A single synthesis subagent** drafts the whole doc from those summaries (one coherent author).
- **One writer** (main thread) — avoids coordination races.

The completeness critic also surfaces features the PRD implies but never states (infra, API contract, auth guards, error/404 states, deployment), so the breakdown is exhaustive.

## Inputs

Resolve each from the user's prompt → else auto-detect → else ask. Do not guess.

- **PRD path.** User-given wins. Else auto-detect a single `*PRD*.md` / `*prd*.md` across candidate docs dirs (see *Discovery* below) and repo root. None or >1 match → ask.
- **Output path.** User-given wins. Else default to `features.md` inside the same docs dir as the PRD. If it **already exists** → ask: overwrite / append / abort. Never silently clobber.
- **Project slug.** User-given wins. Else read from a project-metadata file if one exists (see *Discovery*). Else let the synthesis agent derive a short uppercase abbreviation from the PRD's Product Name.
- **Scope.** Default to the PRD's stated MVP scope (honor its "Out of Scope" / "Future" sections). User may narrow ("MVP only") or widen ("include post-MVP as deferred").

> **Main thread reads only small resolver files** (a metadata file, if any). It does NOT read the full PRD into its own context — that is the analyst subagent's job.

## Discovery (project-agnostic)

Do not hardcode locations. Resolve these by globbing candidate paths and using whatever exists.

- **Docs dir** — first existing of: `.docs/`, `docs/`, `doc/`, repo root.
- **Rules** — gather *all* that exist across these locations (pass the resulting set to subagents; do not name specific rule files):
  - Rule folders: `.claude/rules/`, `.cursor/rules/`, `.agent/rules/`, `.agents/rules/`, `docs/rules/`, `docs/conventions/`.
  - Root convention files: `CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`, `.windsurfrules`, `CONTRIBUTING.md`.
  - If none exist → note that and proceed (do not fabricate conventions).
- **Metadata file** (optional slug source) — first existing of: `.docs/project-metadata.md`, `docs/project-metadata.md`, repo-root `project-metadata.md`.
- **Existing feature file** — if an output file already exists (regenerate case), extract its phase structure, numbering, categories, and `[x]` shipped features for continuity.

## Execution steps

Follow in order. Do not skip phases.

### Step 1 — Resolve inputs (main thread)

Apply *Inputs* + *Discovery*. State to the user: *"PRD: <path>. Output: <path>. Slug: <PROJECT_SLUG or 'deriving'>. Rules found: <count> files. Dispatching analysis."*

### Step 2 — Fan-out analysis (parallel subagents)

Dispatch **3–4 subagents in a SINGLE message** so they run concurrently. Each gets the PRD path, the discovered rule/convention set, and a precise scope. Each returns a **dense summary** (curated findings with PRD-section / `file:line` / URL citations), never file dumps.

| # | Agent type | Scope | Returns |
|---|-----------|-------|---------|
| A | `analyst` | **PRD deep read.** Full PRD. Structured extract: product name, audience, tech stack, goals + success metrics, every requirement (REQ-x.x / numbered item) grouped by functional area (verbatim where short), schema tables (verbatim columns + types), user journeys, architecture constraints, and explicit "Out of Scope" / "Future" lists. Cite PRD sections. | PRD extract → feeds every downstream section. |
| B | `analyst` | **Repo + conventions.** Greenfield vs. existing. If a feature file exists, extract its phase structure, numbering, categories, `[x]` shipped features. Read the discovered rules/convention files → conventions the breakdown must honor. Note any code already built that constrains ordering. | Repo/convention summary → feeds header, per-feature rules, numbering. |
| C | `general-purpose` | **External research** (WebSearch + Context7 MCP). (1) best practices for *decomposing a PRD into shippable, sequentially-dependent increments* (sizing, ordering, phase grouping); (2) domain-specific implied features the PRD may omit. Produce a **"commonly-forgotten feature categories" checklist** (scaffolding, DB/migration, API contract, auth/session lifecycle, error/empty/loading/404/403 states, search/filter, admin, deployment). Cite sources. | Research + completeness checklist → feeds critic and synthesis. |
| D | `general-purpose` | **Completeness critic (adversarial).** Read the PRD + agent C's checklist, then independently enumerate **every feature the product needs** — stated AND implied — grouped, each with a one-line purpose and suggested deps. Surface PRD ambiguities that must become owner decisions. Flag requirements mapping to no feature, and features mapping to no requirement. | Candidate inventory + ambiguity list → feeds index and synthesis. |

Adapt to PRD complexity:
- **Small PRD** (few requirements, no schema): **A + C**.
- **Standard PRD** (multiple areas, some schema, real codebase): **A + B + C**.
- **Large / complex PRD** (many areas, schema, auth, third-party, cross-cutting): **A + B + C + D**.

Thin/empty findings → note the gap; do not invent.

### Step 3 — Synthesize the document (single subagent)

Dispatch **ONE `general-purpose` subagent** (high reasoning effort). Inputs: A (PRD extract), B (repo/conventions), C (research + checklist), D (candidate inventory + ambiguities), the discovered rules set, and the template path — **instruct it to follow the skeleton exactly**.

Instruct the synthesis agent to:

1. **Group features into dependency phases.** Phase 0 = foundation/scaffolding/infrastructure; later phases follow the dependency chain (identity → core domain → supporting domains → reporting → admin/polish → deployment).
2. **Decompose into small, shippable, sequential features.** Each = an independently mergeable increment that leaves the system working and is a prerequisite for later features. Backend/frontend split is omitted (developer decides). Do **not** do one feature per REQ — collapse related REQs, split REQs hiding multiple increments.
3. **Assign a category** to every feature from the legend printed in the template index (default set: 🏗 Scaffolding · 🔧 Infrastructure · ✨ Feature · ⬆ Enhancement · 🚀 Deployment). Extend the legend only if the product demands a category these five don't cover.
4. **Write each feature block** with: **Goal**, **Ships**, **Depends on**, **PRD** (linked REQ/§), **Acceptance** (observable = definition of done), **Edge cases** (traps the PRD leaves open).
5. **Build the Feature Index** — checklist grouped by phase, one line per feature following the index format contract in the template (`- [ ] **F<NN>** <title> — <emoji> <Category> · _deps: <ids or —>_`). Print the legend. Checkboxes unchecked.
6. **Cover every requirement.** Map each REQ/numbered item to ≥1 feature. Orphan requirement → add a feature or flag it. Feature mapping to no requirement → justify (implied infra/polish) or drop. Report coverage.
7. **Schema-deltas section** — additions the PRD schema needs (sort columns, missing tables, indexes, enums, identity fields). Each delta → owning feature.
8. **Cross-cutting-decisions section** — irreversible/cross-cutting choices up front (ORM/client, token storage, who creates projects, soft vs hard delete, etc.). Each → a one-line decision prompt; do **not** silently pick irreversible ones.
9. **Explicitly-deferred section** — PRD "Out of Scope" + "Future", verbatim where short.
10. **Honor every discovered project rule** agent B surfaced.
11. **Ground decisions** — cite PRD §/REQ, rule file, code `file:line`, or web URL for every material choice.
12. **Detect dependency problems** — circular/ambiguous deps, or deps that aren't features → flag as owner questions; do not emit a broken graph.

The agent **returns the complete markdown**. Main thread does not draft content — it only writes the returned text.

### Step 4 — Write the file (main thread)

1. Create the output directory if it does not exist.
2. Write the synthesis output to the resolved output path.
3. Do **not** commit unless asked (follow repo's git conventions — do not assume a specific rule file exists).

### Step 5 — Report (main thread)

- Output path + slug.
- **Phase summary** — phase name → feature count.
- **Coverage** — REQs mapped to features; orphans flagged.
- **Schema deltas** introduced and owning feature.
- **Owner sign-off questions** the breakdown deferred (surface prominently).
- Any **unmet dependency, ambiguous PRD section, or thin subagent finding**.

## Rules

- **Parallel dispatch in one message.** Step 2 subagents run concurrently.
- **Subagents return summaries, not file dumps.** Curated findings with citations only.
- **Main thread never reads large source into its own context.** PRD, rules, existing feature file — all delegated. Main reads only small resolver files and the synthesis output.
- **`analyst` for read/analyze, `general-purpose` for web research and synthesis.**
- **One writer.** Only the main thread writes.
- **Honor project conventions.** Breakdown must not contradict the discovered rules.
- **Ground every decision.** Each material choice cites a source.
- **Don't invent.** Missing source or empty subagent → say so, never fabricate.
- **Small + sequential + shippable.** Every feature an independently mergeable increment. Resist mega-features.

## Failure modes

- **PRD path missing or ambiguous** → ask; do not guess.
- **Output file exists** → ask overwrite/append/abort; never clobber silently.
- **Subagent returns thin findings** → note gap; no guesses.
- **Requirement maps to no feature** → add one or flag the orphan.
- **Circular or ambiguous dependency** → flag as owner question; no broken graph.
- **Synthesis output missing a template section** → reject and re-dispatch with the gap called out.
