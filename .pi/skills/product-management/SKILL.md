---
name: product-management
description: Turn a list of product issues into complete, end-to-end deliverables documents. Asks the product owner clarification questions in batches (written to a cycle folder, never interactively), then writes a deliverables index + per-deliverable files. Stateless per round — re-run /product-management (no args) to continue after answering. Use when the user gives a list of issues/bugfixes/features/enhancements to scope into shippable deliverables.
---

# Product Management Skill

Orchestrates the **`product-manager`** subagent across a multi-round clarification loop. You (the main agent) stay thin: spawn the PM, relay its short summary, tell the user how to continue. The PM keeps its own context clean by delegating codebase investigation to `Explore` subagents and persisting all state under `.docs/ai-generated/` (gitignored).

## Cycle Folders

Each PM cycle lives in its own **dated subfolder** under `.docs/ai-generated/`:

```
.docs/ai-generated/
  pm-cycle-2026-07-01-14-30-00/   # cycle folder (YYYY-MM-DD-HH-mm-ss)
    state.md
    questions/
    deliverables/
    deliverables.md
  pm-cycle-2026-07-03-09-15-22/   # another cycle
    ...
```

This keeps cycles self-contained — no file shuffling between cycles. The timestamp makes each folder unique and immediately tells you when the cycle started.

## Two modes

- **Start** — user provides a list of issues (inline text, or a path to a file containing them). Begin a fresh cycle in a new dated folder.
- **Continue** — no new issues; the user has answered a question batch (they said so in the thread, or re-invoked this skill). Advance the existing cycle.

### Mode detection

- **Start**: user supplied issues → find the latest `pm-cycle-*/state.md` under `.docs/ai-generated/`. If none exists OR the latest one has `phase: done` → create a new cycle folder. If the latest one has `phase: clarifying` → ask whether to start fresh or continue.
- **Continue**: no new issues → find the latest `pm-cycle-*/state.md` with `phase: clarifying`. If found, continue it. If not found, tell the user there's no active cycle.

## Authorization

Invoking this skill **is standing approval** to:

- Create cycle folders and write files under `.docs/ai-generated/` (questions, state, deliverables).
- Spawn `product-manager` and `Explore` subagents (via the `Agent` tool).

It does **not** commit, push, merge, or touch any file outside `.docs/ai-generated/`. (That folder is gitignored.)

## ⛔ Code Modification Ban

**This skill and its subagent must NEVER modify source code.**

- Do **not** install packages, run builds, edit components, write tests, or change any file outside `.docs/ai-generated/`.
- Do **not** implement features, fix bugs, or write production code.
- This skill's scope is **requirements clarification and deliverable documentation only**.
- If the user's input sounds like a request to implement (e.g. "I want Radix datepickers"), treat it as a **product issue to scope** — write a deliverable describing the desired outcome, not the implementation itself.
- Implementation belongs to `/skill:create-implementation-plan` → `/skill:orchestrator` or manual coding.

Violation of this rule defeats the purpose of the product-management workflow.

## Execution (every invocation)

1. **Determine mode** (see Mode detection above).
2. **Create or locate the cycle folder.**
   - `start`: generate a dated folder name using the current timestamp:
     ```bash
     CYCLE_DIR=".docs/ai-generated/pm-cycle-$(date +%Y-%m-%d-%H-%M-%S)"
     mkdir -p "$CYCLE_DIR/questions" "$CYCLE_DIR/deliverables"
     ```
   - `continue`: find the active cycle folder:
     ```bash
     CYCLE_DIR=$(ls -dt .docs/ai-generated/pm-cycle-*/state.md 2>/dev/null | head -1 | xargs dirname)
     ```
   Store `CYCLE_DIR` as an absolute path for the PM prompt.
3. **Spawn the PM subagent.** Use the `Agent` tool:
   ```
   Agent({
     subagent_type: "product-manager",
     prompt: "<constructed prompt with mode, issues, workspace>",
     description: "Product Manager — deliverables cycle"
   })
   ```
   Construct the prompt containing:
   - `mode`: `start` or `continue` (decided above).
   - `issues`: the user's issue list verbatim (`start` only).
   - `workspace`: absolute path to the cycle folder (`CYCLE_DIR`).
4. **Relay its summary** to the user verbatim. Append a one-line "how to continue":
   - After questions: *"Answer inline in the file, then reply here (e.g. 'answered') or re-run `/product-management` to continue."*
   - After deliverables: *"Review the deliverables. Hand any one to `/skill:create-implementation-plan` to plan implementation."*
5. **Stop.** Do not do the PM's work yourself. Do not read source files into the main context. The PM is the only thing that investigates the codebase (via its own Explore subagents).

## Continuing after answers

The user typically replies in the thread (e.g. *"answered batch 1"*). To advance, **re-invoke this skill** (`/product-management`, no args) — it finds the active cycle folder and continues. If the user references answered questions but did not re-invoke, tell them to re-run `/product-management` to continue (the skill must load to drive the loop).

## Error handling

- **No issues on start** — ask the user to paste the issue list or give a file path. Do not invent issues.
- **PM reports it could not investigate an area** — relay that plainly; offer to continue on assumptions or let the user point it at the right files.
- **PM errors / dies** — retry once; if it fails again, report and stop.

## Key principles

- **Thin orchestrator.** You spawn and relay. The PM thinks; you don't.
- **Main context stays clean.** Never pull source files or agent digests into the main conversation — only the PM's short summary.
- **Stateless rounds.** Every `/product-management` invocation is one round. State lives in the active cycle folder's `state.md`.
- **No interactive questions.** Clarification is always file-based (the PM writes questions; the user answers inline).
- **Self-contained cycles.** Each cycle owns its own folder. No cross-cycle file pollution.
