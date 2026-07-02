---
name: product-requirement-writing
description: Format the final deliverables for the product-manager workflow. Ships two templates — a UserStory/Deliverable template (one file per deliverable) and a PRD/deliverable-index template (the milestone index). Structure is learned from good-prd-samples (shape only, synthetic examples, never copied content).
---

# Product Requirement Writing

Reference skill for the `pm-writer` agent (requirement task). It produces **two kinds** of documents:

1. **UserStory / Deliverable** — one file per deliverable, at `deliverables/DEL-NN-<slug>.md`.
2. **PRD / Deliverable Index** — the milestone index, at `deliverables.md`.

## Granular scope rule

- **One file per deliverable** (User Story) + a milestone **Deliverables Index** — never a monolithic PRD.
- The index links to each User-Story file, each clarification file, and (if present) each PRD file.

## Confidentiality

The sample PRDs in `good-prd-samples/` are **structure reference only** — real, confidential project data. Learn their *shape*; **never copy their content**. If a realistic example is needed, generate a synthetic one.

## Closed-loop rule

The index's *Context & Locked Decisions* is built directly from the cycle's locked decisions (from `state.md`) — nothing clarified is ever lost.

## No-tech-recs / no-code

Deliverables describe desired **behavior and UX**. No package names, no architecture patterns, no code/pseudocode, no install steps. A user-named tool is a *product constraint* ("the UI should…"), not an implementation guide.

---

## Template A — UserStory / Deliverable (`deliverables/DEL-NN-<slug>.md`)

Behavior-centric, end-to-end (data + API + UI + behavior together — **never split by layer**).

```markdown
# DEL-<NN> — <title>

**Source issue(s):** <link/quote the original issue(s) — required>
**Status:** Draft
**Dependencies:** DEL-<NN> | None

## Problem
<The user/product problem. Cite the original issue(s). Why does this matter?>

## Solution
<End-to-end desired behavior — what the user sees and does, across data, API, and UI
together. Do NOT split into "backend" and "frontend." Describe outcomes, not implementation.>

### <Domain subsection — e.g. Permission matrix / Data model / States>
<Only where the deliverable needs it. Use a table or list. Product-level, not schema-level.>

## Acceptance criteria
- [ ] <observable, testable outcome>
- [ ] <observable, testable outcome>
- [ ] <observable, testable outcome>

## Dependencies
- DEL-<NN>: <why> | None

## Out of scope
- <explicitly deferred items>
```

### Structure cues (learned from `good-prd-samples`, shape only)
A behavior/flow-oriented deliverable may add, where useful: an **entry point**, **step-by-step behavior** (with "Behavior:" notes and validation/constraint callouts), **success/failure & fallback scenarios**, and **future/deferred items**. Mirror the *shape*; never copy sample content.

---

## Template B — PRD / Deliverable Index (`deliverables.md`)

The milestone roll-up.

```markdown
# <Project> — <Milestone> Deliverables Index

**Project:** <name>
**Milestone:** <name>
**Generated:** <ISO date>
**Source issues:** <list / filepath>

## Table of Contents
1. Context & Locked Decisions
2. Glossary
3. Deliverables
4. Dependency Graph & Suggested Phasing
5. Cross-Cutting Concerns

## Context & Locked Decisions
<Built from state.md locked decisions — every clarification answer lives here.>
- <decision> — answered (questions/NN-<slug>.md, Q<NN>) | assumed
- <decision> — …

## Glossary
- **<term>:** <definition>

## Deliverables
| ID | Title | Status | Dependencies | File |
|----|-------|--------|--------------|------|
| DEL-01 | <title> | Draft | None | [deliverables/DEL-01-<slug>.md](deliverables/DEL-01-<slug>.md) |
| DEL-02 | <title> | Draft | DEL-01 | [deliverables/DEL-02-<slug>.md](deliverables/DEL-02-<slug>.md) |

### Clarifications
| Batch | File |
|-------|------|
| 01 | [questions/01-<slug>.md](questions/01-<slug>.md) |

## Dependency Graph & Suggested Phasing
<Batch/phase the deliverables in dependency order — a simple diagram or ordered list.
Suggest which deliverables can proceed in parallel.>

## Cross-Cutting Concerns
- <concern spanning multiple deliverables — e.g. auth, permissions, i18n, analytics>
```

### Structure cues (learned from `good-prd-samples`, shape only)
A milestone index may add, where useful: an **Overview**, a **Scope Summary** (which sources roll up), themed **module sections**, **Design Dependencies**, **QA & Testing**, and a **Delivery Schedule**. Mirror the *shape*; never copy sample content.

---

Render the structured data from the product-manager **exactly**. Do not invent requirements, decisions, or acceptance criteria.
