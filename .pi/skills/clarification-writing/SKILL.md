---
name: clarification-writing
description: Write a clarification-question batch to a file for the product owner to answer. Batching rules, per-question spec, and the canonical markdown template.
---

# Clarification Writing

Reference skill for the `pm-writer` agent (clarification task). You write **one batch** of clarification questions to a file the user answers in the thread.

## Batching rules

- Group questions **by theme**.
- **3–8 questions per batch** — never dump twenty. High-value, related questions only.
- Each question is about **product behavior** — never about packages, architecture, or code.

## Per-question spec

- **Type:** `multiple-choice` / `boolean` / `text`.
- **Why this matters:** one line.
- The question.
- For **multiple-choice:** 2–4 options, exactly **one** marked `*(recommended)*` with a one-line reason.
- A clear `**Answer:**` slot the user writes under.

## Filename rule

`questions/NN-<short-slug>.md` where `NN` = previous batch number + 1 (zero-padded). `NN` is supplied in the writer's task prompt.

## No-tech-recs

Questions are about product behavior, never about packages/architecture/code.

## Full template (canonical format)

```markdown
# Clarification Batch <NN>

**How to answer:** write your reply under each `**Answer:**` below. You may answer
in this file, or reply inline in the thread. When done, re-run the product-manager
workflow to continue.

> 3–8 questions, grouped by theme. Recommended options are marked *(recommended)*.

---

## Theme: <name>

### Q<NN>. <question>
- **Type:** multiple-choice | boolean | text
- **Why this matters:** <one line>

Options:
- a) <option>
- b) <option> *(recommended — <one-line reason>)*
- c) <option>

**Answer:**

---

### Q<NN>. <question>
- **Type:** boolean
- **Why this matters:** <one line>

**Answer:**

---

## Theme: <name>

### Q<NN>. <question>
- **Type:** text
- **Why this matters:** <one line>

**Answer:**
```

Mirror the structured questions exactly. Do not invent questions. Do not add technical recommendations.
