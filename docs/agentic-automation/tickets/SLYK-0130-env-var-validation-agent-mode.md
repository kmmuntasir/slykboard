# SLYK-0130 — Env var validation for agent mode

**Phase:** Pre-Phase-0 refactor
**Type:** Refactor
**Depends on:** —

## Description

Extend the Zod env schema in `backend/src/config/env.ts` with the agent-mode
variables and cross-field rules. From `00-refactor-plan.md` Task 7.

1. Add to the schema:

   ```ts
   SLYKBOARD_AGENT_MODE: z.enum(['true', 'false']).default('false'),
   SLYKBOARD_DISPATCHER_URL: z.string().url().optional(),
   SLYKBOARD_DISPATCHER_TOKEN: z.string().min(64).optional(),
   SLYKBOARD_SLACK_ESCALATION_WEBHOOK: z.string().url().optional(),
   ```

2. Cross-field validation after parse — agent mode requires both dispatcher
   vars:

   ```ts
   if (parsed.SLYKBOARD_AGENT_MODE === 'true') {
     if (!parsed.SLYKBOARD_DISPATCHER_URL) throw new Error('SLYKBOARD_DISPATCHER_URL required when SLYKBOARD_AGENT_MODE=true');
     if (!parsed.SLYKBOARD_DISPATCHER_TOKEN) throw new Error('SLYKBOARD_DISPATCHER_TOKEN required when SLYKBOARD_AGENT_MODE=true');
   }
   ```

3. Update `.env.example` files with the four vars (commented, marked
   agent-mode-only).

4. Test `backend/src/config/env.test.ts` cases:
   - plain mode boots with none of the four set;
   - agent mode + missing URL → error names the var;
   - agent mode + missing/short token → error;
   - agent mode + valid URL + 64-hex token → parses;
   - bad enum value (`SLYKBOARD_AGENT_MODE=yes`) → Zod error.

## Acceptance criteria

- [ ] All env test cases above pass.
- [ ] Plain mode with zero agent vars boots clean (no warnings about
      dispatcher).
- [ ] Agent mode without dispatcher vars fails fast at boot with an
      actionable message.
- [ ] `.env.example` updated; no secrets committed.

## References

- `docs/agentic-automation/00-refactor-plan.md` Task 7
- `docs/agentic-automation/02-dual-mode.md` agent-mode contract
- `docs/agentic-automation/03-security.md` secret inventory

## Dependencies

None.
