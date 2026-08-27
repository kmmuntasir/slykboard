---
trigger: model_decision
description: Ruleset that MUST be followed when executing ANY git command
---

# Git Guidelines

## Sacred Rule

- **NEVER** run `git` without the user's explicit approval.
- `commit` after each task is pre-approved ONLY when the user invokes `/orchestrator`, `/handle-ticket`, `/ticket-pipeline`, or explicitly says "commit per task". Otherwise ask.
- **NEVER** push, merge, rebase, amend, or force-push without explicit per-action approval.

## Branching

- Default/primary branch: **`main`**.
- Feature/fix branches: `feature/SLYK-123-desc`, `fix/SLYK-123-desc`, `chore/SLYK-123-desc`, `docs/SLYK-123-desc`.
- Project slug: **`SLYK`** — used in branch names and commit message prefixes.
- Never assume a ticket number. If a ticket id is available, include it.

## Merge Policy

- PRs target `main`.
- Rebase and Merge via GitHub PRs; no merge commits in feature branches; no squash merging unless the repo convention says otherwise.
- Local merging only when user explicitly approves.

## Commit Messages

Format:

```
SLYK-123: <subject>
```

- **Prefix:** the ticket id (`SLYK-123`). If no ticket id exists, prefix with a conventional type instead: `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `build:`, `ci:`.
- **subject:** imperative, lowercase, ≤72 chars, no trailing period.

Examples:

```
SLYK-123: add per-question timer countdown
SLYK-101: fix leaderboard tie-breaker ordering
feat: add Google OAuth login
docs: clarify env vars for CORS
```

## Workflow

1. Stage explicit paths only — `git add <path1> <path2>`.
2. **Never** `git add -A`, `git add .`, or `git add -u` (sweeps unrelated changes).
3. Verify staged set with `git status` and `git diff --cached --stat` before committing.
4. Commit with a properly-formatted message (HEREDOC for multi-line).
5. **Never** skip hooks (`--no-verify`) or bypass signing.
6. Report commit hash + message + files (from `git show --stat --oneline HEAD`). Don't dump diffs.

## Pre-commit Hook Failures

- Do NOT bypass with `--no-verify`.
- Fix the underlying issue, re-stage, create a NEW commit (never `--amend`).
- If a hook fails for reasons outside the task scope, surface it and stop.

## .gitignore Discipline

Never commit:
- `node_modules/`, `frontend/dist/`, `frontend/.vite/`, `frontend/coverage/`
- `backend/dist/`, `backend/coverage/`
- `.env*` (real secrets)
- `*.log`, `logs/`
- `.DS_Store`
- IDE state: `.idea/`, `.vscode/`, `*.iml`
- `.docs/ai-generated/**` (except `.gitkeep`)

Note: `.context/` (PM cycle state) IS committed to the repo.

## Out of Scope

- Pushing, merging, rebasing, amending, force operations — user's call only.
- Reviewing or modifying the user's in-progress work without confirmation.
- Deleting branches, tags, or remotes without explicit instruction.