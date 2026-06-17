---
trigger: model_decision
description: Ruleset that MUST be followed when executing ANY git command
---

# Git Guidelines

## Sacred Rule:
- NEVER run `git` command without user's explicit approval.

## Merge Policy:
- **Rebase and Merge ONLY** — Repo uses "Rebase and Merge" policy
- **No merge commits** — Never `git merge`
- **No squash merging** — Never `--squash` flag
- **No local branch merging** — All merging via PR rebase on GitHub

## Project Slug:
- PROJECTSLUG: short project abbreviation (e.g., JIRA tickets)
- This project: **SLYK**
- Source: `./project-metadata.md`

## Branch Naming:
- Format: `type/PROJECTSLUG-TICKET_NUMBER-hyphenated-short-description`
- Example: `feature/SLYK-123-add-review-timeout`, `bugfix/SLYK-234-fix-clone-failure`
- Exception: Release branches: `release/1.2.3` — version only, no ticket or description
- Imperative, hyphenated description
- Never assume ticket number. If missing, omit
- Trello projects: use Card Number instead of Ticket number

## Commit Messages:
- ALWAYS single-line commit message
- Format: `PROJECTSLUG-TICKET_NUMBER: message`
- Example: `SLYK-123: Add review timeout handling`
- Extract ticket number from branch name
- If ticket unidentifiable, omit prefix — message only

## .gitignore
Ensure these entries exist. Never commit sensitive build artifacts:
- `node_modules/`
- `.env` (actual secrets, not `.env.example`)
- `dist/`
- `build/`
- `*.log`
- `.DS_Store`