---
name: product-management
description: Turn a list of product issues into complete, end-to-end deliverables documents. Asks the product owner clarification questions in batches (written to .docs/ai-generated/, never interactively), then writes a deliverables index + per-deliverable files. Stateless per round — re-run /product-management (no args) to continue after answering. Use when the user gives a list of issues/bugfixes/features/enhancements to scope into shippable deliverables.
---

# Product Management Skill

Orchestrates the **`product-manager`** subagent across a multi-round clarification loop. You (the main agent) stay thin: spawn the PM, relay its short summary, tell the user how to continue. The PM keeps its own context clean by delegating codebase investigation to `Explore` subagents and persisting all state under `.docs/ai-generated/` (gitignored).

## Two modes

- **Start** — user provides a list of issues (inline text, or a path to a file containing them). Begin a fresh cycle.
- **Continue** — no new issues; the user has answered a question batch (they said so in the thread, or re-invoked this skill). Advance the existing cycle.

Decide mode: if the user supplied issues and `.docs/ai-generated/state.md` does not yet exist → **start**. If `state.md` exists and the user indicates answers are in → **continue**. If ambiguous, ask which.

## Authorization

Invoking this skill **is standing approval** to:

- Create and write files under `.docs/ai-generated/` (questions, state, deliverables).
- Spawn `product-manager` and `Explore` subagents (via the `Agent` tool).

It does **not** commit, push, merge, or touch any file outside `.docs/ai-generated/`. (That folder is gitignored.)

## Execution (every invocation)

1. **Ensure workspace.** `mkdir -p .docs/ai-generated/questions .docs/ai-generated/deliverables`.
2. **Spawn the PM subagent.** Use the `Agent` tool:
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
   - `workspace`: absolute path to `.docs/ai-generated/`.
3. **Relay its summary** to the user verbatim. Append a one-line "how to continue":
   - After questions: *"Answer inline in the file, then reply here (e.g. 'answered') or re-run `/product-management` to continue."*
   - After deliverables: *"Review the deliverables. Hand any one to `/skill:create-implementation-plan` to plan implementation."*
4. **Stop.** Do not do the PM's work yourself. Do not read source files into the main context. The PM is the only thing that investigates the codebase (via its own Explore subagents).

## Continuing after answers

The user typically replies in the thread (e.g. *"answered batch 1"*). To advance, **re-invoke this skill** (`/product-management`, no args) — it detects `state.md` and continues. If the user references answered questions but did not re-invoke, tell them to re-run `/product-management` to continue (the skill must load to drive the loop).

## Error handling

- **No issues on start** — ask the user to paste the issue list or give a file path. Do not invent issues.
- **PM reports it could not investigate an area** — relay that plainly; offer to continue on assumptions or let the user point it at the right files.
- **PM errors / dies** — retry once; if it fails again, report and stop.

## Key principles

- **Thin orchestrator.** You spawn and relay. The PM thinks; you don't.
- **Main context stays clean.** Never pull source files or agent digests into the main conversation — only the PM's short summary.
- **Stateless rounds.** Every `/product-management` invocation is one round. State lives in `.docs/ai-generated/state.md`.
- **No interactive questions.** Clarification is always file-based (the PM writes questions; the user answers inline).
