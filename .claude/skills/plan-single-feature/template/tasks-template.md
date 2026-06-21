# F{{NN}} — {{Title}}: Plan + Task Breakdown

> **Feature:** F{{NN}} — {{title}} ({{Phase name}} — {{phase subtitle}})
> **Slug:** `{{PROJECT_SLUG}}` · **Depends on:** {{deps or "—"}} · **PRD ref:** {{PRD §/REQ refs}}
> **Sources:** [`{{prd-file}}`](./{{prd-file}}), [`{{features-file}}`](./{{features-file}}) (F{{NN}} spec block + relevant schema-delta rows){{, the project rules discovered for this repo}}{{, plus dependency feature task docs: [F{{dep}}](../F{{dep-slug}}/F{{dep-slug}}-tasks.md)}}

<!--
AUTHOR GUIDANCE (delete all HTML comments before finalizing):
- Fill EVERY section. Replace {{placeholders}}. Delete sections only if genuinely N/A (and say why).
- Ground every claim in a source: PRD §, project rule file, dep task doc, code path:line, or web URL.
- Resolve every "Edge case" from the feature spec into an explicit decision or a flagged owner question.
- If a depth exemplar (an existing completed *-tasks.md in the same dir family) was found, mirror its
  level of detail. Otherwise match the rigor implied by the placeholders below.
-->

---

## 1. F{{NN}} Recap

**Goal:** {{one-sentence outcome — copy/refine from the feature spec's Goal}}.

**Ships:** {{what an end user can concretely do once merged — copy/refine from the feature spec's Ships}}.

**Acceptance (definition of done):**
{{Copy the feature's Acceptance bullets from the feature spec verbatim, then tighten. Each must be observable.}}

**Edge cases to resolve up front:**
{{For each Edge case in the feature spec: state the resolution as a decision, OR flag it as an owner question. Never carry an unresolved trap forward silently.}}
- {{Edge case}} → **Decision:** {{choice + one-line rationale}}.
- {{Edge case}} → **Owner question:** {{what needs sign-off}}.

---

## 2. Codebase Analysis Summary

{{Dense summary of live codebase state relevant to this feature. Sourced from the Phase-2 codebase subagent.}}

- **State:** {{greenfield / partial / what exists. Confirm deps are actually implemented in code, not just checked off.}}
- **Existing structure this feature builds on:** {{dirs, config modules, exported seams — with path citations}}.
- **Prior art / partial work:** {{anything already half-built that this feature completes or must reconcile with}}.
- **File paths the plan references that do NOT exist yet** (will be created): {{list}}.
- **Project rules** this plan must satisfy: {{the rule files discovered for this repo (style, testing, dev, git, etc.) — list them; do not invent ones that do not exist}}.
- **Hidden coupling to plan for:** {{shared types, config, env vars, schema columns the spec doesn't spell out but tasks will touch}}.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | {{e.g. ORM / client / lib / storage / pattern}} | **{{choice}}** | {{rationale citing PRD §, rule, dep doc, or web source}} |
| D2 | ... | ... | ... |

> **Out of F{{NN}} scope (explicitly deferred):** {{what this feature does NOT do and which later feature owns it. Prevents scope creep.}}

> **Owner sign-off needed:** {{any irreversible / cross-cutting choice deferred to the owner. Surface these in chat too.}}

---

## 4. Architecture Overview (Target Tree)

```
{{Root or package tree showing ONLY the files/dirs this feature adds or changes.
Reuse existing structure (confirmed in §2) rather than re-listing it.
Mark new files vs modified with a comment.}}
```

{{Optional: one short paragraph on data flow or request lifecycle if the feature has non-obvious flow.}}

---

## 5. Parallelization Strategy

Tasks are grouped into **N batches** by dependency order. Within a batch, tasks touch **disjoint file sets** → zero merge conflicts → safe to run in parallel and merge independently.

### Batch dependency diagram

```
{{ASCII diagram: Batch A → Batch B → ... showing which tasks gate which.}}
```

- {{Batch A}} → {{Batch B}} is a hard barrier: {{why}}.
- {{Batch B}} → {{Batch C}} is a hard barrier: {{why}}.

### Merge order rules

1. {{Batch A merges first. Which tasks, in what order or "either order". What must be on main before next batch branches.}}
2. {{Batch B merges second.}}
3. {{Batch C (integration / verification) merges last.}}

### Summary table

| # | Batch | Target files / dirs | Depends on | Can parallel with |
|---|-------|---------------------|------------|-------------------|
| **T1** | A | {{files}} | {{— / task ids}} | {{T2}} |
| **T2** | A | {{files}} | {{—}} | {{T1}} |
| ... | | | | |

### Developer assignment tracks

- **Solo:** {{T1 → T2 → (T3 ‖ T4) → T5}}.
- **2 devs:** {{Dev-A path; Dev-B path}}.
- **3 devs:** {{split}}.

---

## 6. Tasks

### T1 — {{Action-oriented title}}

**Batch:** {{A}} · **Depends on:** {{None / task ids}} · **Parallel with:** {{task ids / —}}

**Description:** {{Detailed enough for a developer unfamiliar with the plan to execute. Reference exact file paths, function/symbol names, line refs, and short code snippets. State what to create vs modify.}}

Create / Modify:
- {{`path/to/file.ext`}} — {{what it contains, key exports, code snippet if non-trivial}}.
- ...

**Acceptance Criteria:**
- [ ] {{specific, verifiable checkbox}}.
- [ ] {{...}}.

**Dependencies:** {{None / exact task ids}}.

---

### T2 — {{Title}}

**Batch:** {{A}} · **Depends on:** {{None}} · **Parallel with:** {{T1}}

**Description:** {{...}}

Create / Modify:
- {{...}}

**Acceptance Criteria:**
- [ ] {{...}}

**Dependencies:** {{...}}

---

{{...repeat one ### block per task...}}

### T{{last}} — Integration verification & sign-off

**Batch:** {{C (terminal)}} · **Depends on:** {{all prior}} · **Parallel with:** —

**Description:** The final definition-of-done gate. Run every tool against the as-merged feature, fix gaps, record proof.

Steps:
1. {{concrete verification steps — scripts, curl, manual checks}}.
2. ...

**Acceptance Criteria:**
- [ ] {{every feature Acceptance bullet from §1 satisfied; record commit SHAs / responses}}.

**Dependencies:** {{...}}.

---

## 7. Final F{{NN}} Acceptance Checklist

- [ ] {{restates the feature's definition-of-done from the feature spec, expanded with the wiring proven in the terminal task}}.
- [ ] Lint + format checks pass on an empty change.
- [ ] Typecheck + test pass.
- [ ] {{feature-specific observable checks}}.

**Integration record (fill during the terminal task):**
- Feature commit SHA: `________`
- {{key observable: e.g. API response, UI screenshot path, migration applied}}: `________`
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0`

---

## 8. Schema deltas owned by this feature

{{If the feature file's "Schema deltas" section assigns a delta to F{{NN}}, document the exact migration here. Otherwise delete this section.}}

| Delta | Detail | Migration |
| --- | --- | --- |
| {{e.g. `Tickets.position`}} | {{type, nullable, default, index}} | {{`ALTER TABLE ...` / ORM schema block}} |
