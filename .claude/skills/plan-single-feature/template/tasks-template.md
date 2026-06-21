# F{{NN}} — {{Title}}: Plan + Task Breakdown

> **Feature:** F{{NN}} — {{title}} ({{Phase name}} — {{phase subtitle}})
> **Slug:** `{{SLYK}}` · **Depends on:** {{deps or "—"}} · **PRD ref:** {{PRD §/REQ refs}}
> **Sources:** [`basic-PRD.md`](../../basic-PRD.md), [`features.md`](../../features.md) (F{{NN}} spec block + relevant schema-delta rows), [`.claude/rules/js-development-rules.md`](../../../.claude/rules/js-development-rules.md), [`js-style-guide.md`](../../../.claude/rules/js-style-guide.md), [`js-testing-rules.md`](../../../.claude/rules/js-testing-rules.md), [`git-guidelines.md`](../../../.claude/rules/git-guidelines.md){{, plus dependency feature task docs: [F{{dep}}](../F{{dep-slug}}/F{{dep-slug}}-tasks.md)}}

<!--
AUTHOR GUIDANCE (delete all HTML comments before finalizing):
- This template mirrors .docs/features/F01-monorepo-scaffolding/F01-monorepo-scaffolding-tasks.md in structure and depth.
- Fill EVERY section. Replace {{placeholders}}. Delete sections only if genuinely N/A (and say why).
- Ground every claim in a source: PRD §, rule file, dep task doc, code path:line, or web URL.
- Resolve every "Edge case" from the features.md spec into an explicit decision or a flagged owner question.
-->

---

## 1. F{{NN}} Recap

**Goal:** {{one-sentence outcome — copy/refine from features.md Goal}}.

**Ships:** {{what an end user can concretely do once merged — copy/refine from features.md Ships}}.

**Acceptance (definition of done):**
{{Copy the feature's Acceptance bullets from features.md verbatim, then tighten. Each must be observable.}}

**Edge cases to resolve up front:**
{{For each Edge case in the features.md spec: state the resolution as a decision, OR flag it as an owner question. Never carry an unresolved trap forward silently.}}
- {{Edge case}} → **Decision:** {{choice + one-line rationale}}.
- {{Edge case}} → **Owner question:** {{what needs sign-off}}.

---

## 2. Codebase Analysis Summary

{{Dense summary of live codebase state relevant to this feature. Sourced from the Phase-2 codebase subagent.}}

- **State:** {{greenfield / partial / what exists. Confirm deps are actually implemented in code, not just checked off.}}
- **Existing structure this feature builds on:** {{dirs, config modules, exported seams — with path citations}}.
- **Prior art / partial work:** {{anything already half-built that this feature completes or must reconcile with}}.
- **File paths the plan references that do NOT exist yet** (will be created): {{list}}.
- **Authority files** this plan must satisfy: {{which .claude/rules/*.md dictate structure/naming/testing/git for this feature}}.
- **Hidden coupling to plan for:** {{shared types, config, env vars, schema columns the spec doesn't spell out but tasks will touch}}.

---

## 3. Key Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | {{e.g. ORM / client / lib / storage / pattern}} | **{{choice}}** | {{rationale citing PRD §, rule, dep doc, or web source}} |
| D2 | ... | ... | ... |

> **Out of F{{NN}} scope (explicitly deferred):** {{what this feature does NOT do and which later feature owns it. Prevents scope creep.}}

> **Owner sign-off needed:** {{any irreversible / cross-cutting choice deferred to the owner (e.g. who can create projects; soft vs hard delete; reports access). Surface these in chat too.}}

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
{{ASCII diagram: Batch A → Batch B → ... showing which tasks gate which.
Reuse the F01 diagram style (T1 ──┐ ├──▶ T3).}}
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

- [ ] {{restates the feature's definition-of-done from features.md, expanded with the wiring proven in the terminal task}}.
- [ ] `npm run lint` + `npm run format:check` pass on an empty change (per F01 baseline).
- [ ] `npm run typecheck` + `npm run test` pass.
- [ ] {{feature-specific observable checks}}.

**Integration record (fill during the terminal task):**
- Feature commit SHA: `________`
- {{key observable: e.g. `/api/...` response, UI screenshot path, migration applied}}: `________`
- Lint/format/typecheck/test exit codes: `0 / 0 / 0 / 0`

---

## 8. Schema deltas owned by this feature

{{If features.md §"Schema deltas vs. PRD" assigns a delta to F{{NN}}, document the exact migration here. Otherwise delete this section.}}

| Delta | Detail | Migration |
| --- | --- | --- |
| {{e.g. `Tickets.position`}} | {{type, nullable, default, index}} | {{`ALTER TABLE ...` / Prisma schema block}} |
