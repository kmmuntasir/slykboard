---
name: prd-to-features
description: Read a PRD and write a feature-breakdown file (the .docs/features.md style: small, shippable, sequential features grouped into dependency phases, each with Goal/Ships/Depends-on/PRD/Acceptance/Edge-cases, plus a category checklist index, schema deltas, cross-cutting decisions, and a deferred list). Fans out parallel subagents (analyst + general-purpose) to deep-read the PRD, scan the live repo + conventions, research decomposition best practices, and run a completeness critic — keeping the main thread's context lean. Use when the user asks to turn a PRD into a feature list / breakdown / backlog / roadmap.
---

# PRD → Features Skill

Produce a complete **feature breakdown** from a Product Requirements Document — decomposing the product into small, shippable, sequential features grouped into dependency phases. Output must match the existing `.docs/features.md` in structure and depth:

- Exemplar (product-specific, for depth only): `.docs/features.md`
- Section skeleton (fill every section): [`template/features-template.md`](./template/features-template.md)

## Why this design

The deliverable is large and groundable in many sources (PRD goals, requirements, schema, user journeys, project rules, existing repo state, decomposition best practices, domain conventions). Pulling all of it into the main context burns tokens and dilutes reasoning. Instead:

- **Main thread stays lean** — it only resolves input/output paths, dispatches subagents, and writes the final file.
- **Heavy reading + research is fanned out** to parallel subagents that return *dense summaries*, not raw file dumps.
- **A single synthesis subagent** drafts the complete markdown from those summaries (so one coherent author writes the whole doc, not several competing drafts).
- **One writer** (main thread) writes the file — avoids coordination races.

This saves wall-clock time (parallelism) and main-thread context (delegation). It also **thinks harder than a single pass**: the completeness critic independently surfaces features the PRD implies but never states (infra, API contract, auth guards, error/404 states, deployment), so the breakdown is exhaustive, not just a restatement of REQs.

## Inputs

- **PRD path** — defaults to `.docs/basic-PRD.md`. If absent, auto-detect a single `*PRD*.md` / `*prd*.md` in `.docs/`. If missing or ambiguous, ask the user.
- **Output path** — defaults to `.docs/features.md`. Override if the user names a file.
- **Slug** — derived from the PRD product name (or read from `.docs/project-metadata.md` if present). User may override.
- **Scope** — default to the PRD's stated MVP scope (honor its "Out of Scope" / "Future Considerations" sections). User may narrow ("MVP only") or widen ("include post-MVP as deferred features").

No path argument is strictly required; the skill derives sensible defaults.

## Execution steps

Follow in order. Do not skip phases.

### Step 1 — Resolve inputs (main thread)

1. **PRD path.** User-given → use it. Else `.docs/basic-PRD.md`. Else auto-detect one `*PRD*.md` in `.docs/`. If none or >1 match → ask the user; do not guess.
2. **Output path.** Default `.docs/features.md`. If it **already exists** → ask: overwrite (regenerate from scratch), append, or abort. Never silently clobber.
3. **Slug.** If `.docs/project-metadata.md` exists, read the slug from it (small file). Otherwise let the synthesis agent derive it from the PRD's Product Name (uppercased abbreviation).
4. **Collect source paths** to hand subagents:
   - The PRD path.
   - `.claude/rules/*.md` (style, testing, dev, git guidelines).
   - Existing `.docs/features.md` (if regenerating — for numbering continuity + already-shipped features).
   - The template: `.claude/skills/prd-to-features/template/features-template.md`.
   - The exemplar (depth reference): `.docs/features.md` itself if present.

State to the user: *"PRD: <path>. Output: <path>. Slug: <SLUG or 'deriving'>. Dispatching analysis."*

> **Main thread reads only small files** (project-metadata, if any). It does NOT read the full PRD into its own context — that is the analyst subagent's job.

### Step 2 — Fan-out analysis (parallel subagents)

Dispatch **3–4 subagents in a SINGLE message** so they run concurrently. Each gets the PRD path, the relevant rule/exemplar paths, and a precise scope. Each returns a **dense summary** (curated findings with PRD-section / `file:line` / URL citations), never raw file dumps.

| # | Agent type | Scope | Returns |
|---|-----------|-------|---------|
| A | `analyst` | **PRD deep read.** Read the full PRD. Return a structured extract: product name, audience, tech stack, goals + success metrics, every requirement (REQ-x.x / numbered item) grouped by functional area (verbatim where short), schema tables (verbatim column lists + types), user journeys / stories, architecture constraints (polling interval, OAuth, hosting), and the explicit "Out of Scope" / "Future" lists. Cite PRD sections. | PRD extract → feeds every downstream section. |
| B | `analyst` | **Repo + conventions.** Determine greenfield vs. existing. If `.docs/features.md` exists, extract its phase structure, numbering, categories, and any already-shipped (`[x]`) features for continuity. Read `.claude/rules/*.md` and any `CLAUDE.md`/`AGENTS.md` → conventions the breakdown must honor (REST envelope, Vitest co-located tests, rebase-only git, 2-space JS / 4-space JSX, etc.). Note any code already built (frontend/backend dirs) that constrains feature ordering. | Repo/convention summary → feeds §header, per-feature rules, and numbering. |
| C | `general-purpose` | **External research** (WebSearch + Context7 MCP). Two angles: (1) best practices for *decomposing a software PRD into shippable, sequentially-dependent feature increments* (sizing, dependency ordering, phase grouping); (2) domain-specific implied features the PRD may omit for this product type. Produce a **"commonly-forgotten feature categories" checklist** (scaffolding, DB/migration pipeline, API contract layer, auth/session lifecycle, error/empty/loading/404/403 states, search/filter, admin management, deployment/self-host). Cite sources. | Research + completeness checklist → feeds completeness critic and synthesis. |
| D | `general-purpose` | **Completeness critic (adversarial).** Read the PRD itself + agent C's checklist, then independently enumerate **every feature the product needs** — stated AND implied — grouped, each with a one-line purpose and a suggested dependency set. Surface PRD ambiguities/gaps that must become owner decisions (e.g. "who can create projects?", "what counts as 'resolved'?"). Flag requirements that map to no clear feature, and features that map to no requirement. | Candidate feature inventory + ambiguity list → feeds the index and synthesis. |

Adapt the fan-out to PRD complexity:

- **Small PRD** (few requirements, no schema, single domain): agents **A + C** only.
- **Standard PRD** (multiple areas, some schema, real codebase to honor): **A + B + C**.
- **Large / complex PRD** (many areas, schema, auth, third-party integrations, cross-cutting concerns): **A + B + C + D**.

If any subagent returns thin/empty findings, note the gap — do not invent.

### Step 3 — Synthesize the document (single subagent)

Dispatch **ONE `general-purpose` subagent** (high reasoning effort). Inputs: the PRD extract (A), repo/convention summary (B), research + checklist (C), candidate inventory + ambiguities (D), and the template path — **instruct it to follow the skeleton exactly**, using the exemplar only for depth.

Instruct the synthesis agent to:

1. **Group features into dependency phases.** Phase 0 = foundation/scaffolding/infrastructure (repo, DB, API contract, app shell); subsequent phases follow the dependency chain (identity → core domain → supporting domains → reporting → admin/polish → deployment). Phases show the chain; within a phase, order still matters where deps say so.
2. **Decompose into small, shippable, sequential features.** Each feature = an independently mergeable increment that leaves the system working and is a prerequisite for later features. Backend vs. frontend split is intentionally omitted (the implementing developer decides). Do **not** make one feature per REQ — collapse related REQs into one feature where they ship together; split where a REQ hides multiple independent increments.
3. **Assign a category** to every feature from this legend, and print the legend in the index:
   - 🏗 **Scaffolding** — empty skeleton, tooling, project bootstrap. No domain logic.
   - 🔧 **Infrastructure** — cross-cutting runtime plumbing (DB, API contract, auth guards) every feature leans on.
   - ✨ **Feature** — distinct user-facing capability; an end user does something concrete.
   - ⬆ **Enhancement** — refines an existing feature; not standalone.
   - 🚀 **Deployment** — packaging, hosting, release.
   (Extend the legend only if the product demands a category these five don't cover.)
4. **Write each feature block** with: **Goal** (one-sentence outcome), **Ships** (what an end user can concretely do once merged), **Depends on** (feature ids), **PRD** (linked REQ-x.x / §), **Acceptance** (observable checks = definition of done), **Edge cases** (traps and gaps the PRD leaves open — to resolve before/during implementation).
5. **Build the Feature Index** — a checklist grouped by phase, one line per feature: `- [ ] **F<NN>** <title> — <emoji> <Category> · _deps: <ids or —>_`. Checkboxes stay unchecked (implementation marks them done).
6. **Cover every requirement.** Map each REQ/numbered item to ≥1 feature. If a requirement maps to nothing, add a feature or flag it. If a feature maps to no requirement, justify it (it's implied infra/polish) or drop it. Report the coverage in the returned summary.
7. **Produce the Schema-deltas section** — additions the PRD schema needs for the features to work (sort-order columns, missing tables, indexes, enum additions, identity fields). Each delta row → the feature that owns it.
8. **Produce the Cross-cutting-decisions section** — irreversible / cross-cutting choices to make up front (e.g. ORM/client, token storage, who creates projects, "resolved" definition, stale-timer policy, reports access, soft vs. hard delete). Each → a one-line decision prompt; do **not** silently pick irreversible ones.
9. **Produce the Explicitly-deferred section** — the PRD's "Out of Scope" + "Future Considerations" items, verbatim where short, so the breakdown's boundary is explicit.
10. **Honor every project rule** agent B surfaced.
11. **Ground decisions** — cite PRD §/REQ, rule file, code `file:line`, or web URL for every material choice.
12. **Detect dependency problems** — circular deps, ambiguous deps, or features whose dependency isn't actually a feature → flag as owner questions; do not emit a broken dependency graph.

The agent **returns the complete markdown** as its final message. The main thread does **not** draft content — it only writes the returned text.

### Step 4 — Write the file (main thread)

1. Create the output directory if it does not exist.
2. Write the synthesis output to the resolved output path (default `.docs/features.md`).
3. Do **not** commit unless asked (per `git-guidelines.md`).

### Step 5 — Report (main thread)

Report to the user:

- Output path + slug.
- **Phase summary** — phase name → feature count.
- **Coverage** — REQs mapped to features; any orphans flagged.
- **Schema deltas** introduced and which feature owns each.
- **Owner sign-off questions** the breakdown deferred (surface these prominently).
- Any **unmet dependency, ambiguous PRD section, or thin subagent finding** encountered.

## Rules

- **Parallel dispatch in one message.** Step 2 subagents run concurrently; do not serialize them.
- **Subagents return summaries, not file dumps.** Reject raw full-file copies in favor of curated findings with citations.
- **Main thread never reads large source into its own context.** The PRD, rules, and existing features.md are all delegated. Main reads only small resolver files (project-metadata) and the synthesis output (to write it).
- **`analyst` for read/analyze, `general-purpose` for web research and synthesis.** The analyst agent is read-only and curated; use it wherever the job is "locate/read/summarize". Use general-purpose for WebSearch/Context7 work, the completeness critic, and the final synthesis.
- **One writer.** Only the main thread writes the file. Subagents do not write.
- **Honor project conventions.** The breakdown must not contradict `.claude/rules/*` or `git-guidelines.md`.
- **Ground every decision.** Each material choice cites a source (PRD §/REQ, rule file, code `file:line`, or web URL).
- **Don't invent.** If a source is missing or a subagent returns nothing, say so rather than fabricating requirements, schema, or feature ordering.
- **Small + sequential + shippable.** Every feature must be an independently mergeable increment that leaves the system working. Resist mega-features.

## Failure modes

- **PRD path missing or ambiguous** → ask the user; do not guess (Step 1.1).
- **Output file exists** → ask overwrite/append/abort (Step 1.2); never clobber silently.
- **Subagent returns thin findings** → note the gap; do not fill with guesses.
- **Requirement maps to no feature** → add one or flag the orphan in the report.
- **Circular or ambiguous dependency** → flag as an owner question; do not emit a broken graph.
- **Synthesis output missing a template section** → reject and re-dispatch synthesis with the specific gap called out.
