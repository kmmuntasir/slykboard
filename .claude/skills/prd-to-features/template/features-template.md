# {{Product Name}} — Feature Breakdown

> Source of truth for scope: [`{{prd-file}}`](./{{prd-file}}). Slug: `{{SLUG}}`.
>
> This document decomposes the {{MVP | product}} into **small, shippable, sequential features**. Each
> feature is an independently mergeable increment that leaves the system in a working state
> and is a prerequisite for later features. Backend vs. frontend split is intentionally omitted —
> the implementing developer decides that. Features are grouped into phases only to show the
> dependency chain; within a phase, order still matters where a `Depends on` says so.

## How to read a feature

| Field | Meaning |
| --- | --- |
| **Goal** | One-sentence outcome. |
| **Ships** | What an end user can concretely do once merged. |
| **Depends on** | Features that must land first. |
| **PRD** | Linked requirement(s) from the PRD. |
| **Acceptance** | Observable checks — treat as the feature's definition of done. |
| **Edge cases** | Traps and gaps the PRD leaves open. Resolve before/during implementation. |

---

## Feature Index

> **Categories:** 🏗 Scaffolding · 🔧 Infrastructure · ✨ Feature · ⬆ Enhancement · 🚀 Deployment
>
> - 🏗 **Scaffolding** — empty skeleton, tooling, project bootstrap. No domain logic.
> - 🔧 **Infrastructure** — cross-cutting runtime plumbing (DB, API contract, auth guards) every feature leans on.
> - ✨ **Feature** — distinct user-facing capability; an end user does something concrete.
> - ⬆ **Enhancement** — refines an existing feature; not standalone.
> - 🚀 **Deployment** — packaging, hosting, release.
>
> Track progress by checking items off. Spec per feature lives in the sections below.

**Phase 0 — {{Foundation}}**
- [ ] **F01** {{title}} — {{emoji}} {{Category}} · _deps: —_
- [ ] **F02** {{title}} — {{emoji}} {{Category}} · _deps: F01_
- ...

**Phase 1 — {{Identity & Access / domain phase name}}**
- [ ] **F0N** {{title}} — {{emoji}} {{Category}} · _deps: {{ids}}_
- ...

{{...one phase block per dependency phase, in order...}}

---

## Phase 0 — {{Foundation}}

### F01 — {{title}}
**Goal:** {{one-sentence outcome}}.
**Ships:** {{what an end user can concretely do once merged}}.
**Depends on:** {{— or feature ids}}.
**PRD:** {{REQ-x.x / §refs}}.
**Acceptance:**
- {{observable check}}.
- {{...}}.
**Edge cases:**
- {{trap the PRD leaves open}}.
- {{...}}.

{{...one ### block per feature, in dependency order within the phase...}}

---

## Phase 1 — {{phase name}}

### F0N — {{title}}
{{...same block shape...}}

---

{{...one phase section per dependency phase...}}

---

## Schema deltas vs. PRD

The PRD schema is a draft. These additions are required for the features above — track them explicitly. Each delta is owned by the feature that introduces it.

| Delta | Reason | Feature |
| --- | --- | --- |
| {{e.g. `Tickets.position` (sort order)}} | {{required for vertical reordering}} | {{FNN}} |
| {{e.g. `Labels` table (project-scoped, color)}} | {{color-coded labels need a managed source}} | {{FNN}} |
| {{e.g. partial unique index}} | {{enforce a constraint the PRD implies}} | {{FNN}} |

> If the PRD schema needs no deltas, state that explicitly rather than omitting the section.

---

## Cross-cutting decisions to make up front

These are irreversible or cross-cutting choices that should be settled before the dependent features start. Do not silently pick them in a feature's edge cases — surface each as a decision prompt.

1. **{{e.g. ORM/client}}:** {{Prisma vs. Drizzle vs. raw `pg`}} — decide in F02, never again.
2. **{{e.g. Auth token storage}}:** {{HttpOnly cookie vs. in-memory + refresh}}.
3. **{{e.g. Who creates projects / tickets}}:** {{admin-only? any-member?}}.
4. **{{...one per cross-cutting choice...}}**.

---

## Explicitly deferred (post-MVP)

Per the PRD's "Out of Scope" / "Future Considerations" sections. These are **not** features above.

- {{deferred item, verbatim from PRD where short}}.
- {{...}}.
