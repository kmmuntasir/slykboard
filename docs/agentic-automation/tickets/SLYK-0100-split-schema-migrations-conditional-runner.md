# SLYK-0100 — Split schema + migrations, conditional migration runner

**Phase:** Pre-Phase-0 refactor
**Type:** Refactor
**Depends on:** —

## Description

Split the single Drizzle schema file and single migrations folder into
core/agent halves, and replace the migration runner with one that applies
agent migrations only when `SLYKBOARD_AGENT_MODE=true`. Pure structural move
— zero behavior change in plain mode.

Work items (from `00-refactor-plan.md` Tasks 1–2):

1. **Split schema** — move ALL existing table/enum/interface definitions
   verbatim from `backend/src/db/schema.ts` into `backend/src/db/schema/core.ts`
   (START_TICKET_NUMBER, users, Column/ChecklistItem, projects,
   projectMemberRoleEnum, projectMembers, projectSequences, priorityEnum,
   tickets, labels, ticketLabels, activityActionEnum, activityLogs,
   timeEntries, comments, CommentRow). No code changes within definitions.
2. Create `backend/src/db/schema/agent.ts` as an empty placeholder
   (`export {};` + header comment noting Phase 0 fills it).
3. Create `backend/src/db/schema/index.ts` re-exporting both
   (`export * from './core'; export * from './agent';` — unconditionally;
   Drizzle table objects are inert declarations, tables only exist after
   their migration runs).
4. **Split migrations** — `git mv` existing migration `.sql` files + `meta/`
   into `backend/src/db/migrations/core/`; create empty
   `backend/src/db/migrations/agent/` with `.gitkeep`. Moving `meta/`
   preserves the applied-migrations journal.
5. **Drizzle configs** — point `backend/drizzle.config.ts` at
   `schema: './src/db/schema/core.ts'`, `out: './src/db/migrations/core'`.
   New `backend/drizzle.config.agent.ts` pointing at the agent halves.
6. **Package scripts** — add `db:generate:core`, `db:generate:agent`,
   `db:generate`, `db:migrate` (custom runner), `db:push:core`,
   `db:push:agent`, `db:studio:core`, `db:studio:agent`, keep `db:seed`.
7. **Custom runner** — replace `backend/src/db/migrate.ts` with the
   conditional runner from `00-refactor-plan.md` Task 2 Step 2 (core always,
   agent folder only when agent mode).
8. **Boot-time runner** — update `runMigrations()` in `backend/src/index.ts`
   per Task 2 Step 3: `CORE_MIGRATIONS_FOLDER` + `AGENT_MIGRATIONS_FOLDER`
   env overrides, agent folder applied only in agent mode.
9. Update `Makefile` migrate targets if they reference the old single-folder
   path.
10. Verify nothing imports `db/migrate` for the runner (`grep -R 'db/migrate' backend/src`).

Note: keep `backend/src/db/schema.ts` deletion clean — update every import
of `../db/schema` / `./schema` to `../db/schema` (the new `index.ts` keeps
the same public path, so most imports should keep working; verify with
typecheck).

## Acceptance criteria

- [ ] `make typecheck` + `make lint` green.
- [ ] Plain mode (`SLYKBOARD_AGENT_MODE` unset): `npm run db:migrate` logs
      "core migrations applied" + "agent mode off — skipping agent
      migrations"; `\dt` shows existing tables only, no errors.
- [ ] Agent mode: `npm run db:migrate` logs both lines; agent folder empty so
      second step is a no-op; same table list as plain mode.
- [ ] `npm run db:generate:core` and `db:generate:agent` both run against
      their respective configs.
- [ ] Full existing backend + frontend test suites pass — zero regressions.
- [ ] Manual smoke: login, view board, create ticket, move ticket, comment —
      all identical to pre-refactor.
- [ ] No migration files duplicated across core/ and the old location.

## References

- `docs/agentic-automation/00-refactor-plan.md` Tasks 1–2 (+ verification §1–2, 5–6)
- `docs/agentic-automation/02-dual-mode.md` Layer 1
- `docs/agentic-automation/04-schema.md` (target layout the split serves)

## Dependencies

None. First ticket in the program.
