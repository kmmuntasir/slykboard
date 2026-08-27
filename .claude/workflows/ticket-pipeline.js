// ticket-pipeline Dynamic Workflow
//
// Implements the batch ticket-processing pipeline as a Claude Code Dynamic
// Workflow (CLI v2.1.154+). Each "parent agent" from the original diagram
// (orchestrator, ticket-handler, planner, task-breakdown-agent, implementer,
// verifier) becomes a STAGE in this script. The actual subagents (analyst,
// express-coder, react-coder, committer) are spawned FLAT via agent().
//
// Invocation:
//   /ticket-pipeline <path-to-ticket-list>
//   /ticket-pipeline "<inline ticket list as text>"
//
// Pipeline (per ticket):
//   curate -> plan -> breakdown -> implement (parallel when disjoint) -> verify -> commit
//
// Stack assumptions (Slykboard):
//   - Backend:  Node 24 + Express 5 + TypeScript (PostgreSQL, Drizzle ORM,
//               journal migrations; Google OAuth auth-code exchange + jose JWT
//               claims {sub,email,pa,ver}; structured JSON logging)
//   - Frontend: React 19 + TypeScript + Vite + Tailwind v4 (CSS-first) + React Query + Zustand
//   - Commits:  `SLYK-<id>: <subject>`; ticket id goes in the subject prefix.
//
// Script-layer constraints (Dynamic Workflows):
//   - Plain JavaScript only (no TypeScript syntax).
//   - No Date.now(), Math.random(), or argless new Date() — they throw.
//   - No filesystem or shell access from this layer. All I/O via agent() calls.
//   - Hard 1-level cap on nested workflow() calls (we don't nest here).
//   - parallel() failed thunk returns null; always guard.
//   - Subagents run in acceptEdits mode; file writes auto-apply.

const SCHEMAS = {
  taskList: {
    type: 'array',
    items: {
      type: 'object',
      required: ['id', 'title', 'layer'],
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        layer: { type: 'string', enum: ['backend', 'frontend', 'fullstack', 'other'] },
        files: { type: 'array', items: { type: 'string' } },
        criteria: { type: 'string' },
        deps: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  plan: {
    type: 'object',
    required: ['summary', 'approach', 'filesTouched'],
    properties: {
      summary: { type: 'string' },
      approach: { type: 'string' },
      risks: { type: 'array', items: { type: 'string' } },
      filesTouched: { type: 'array', items: { type: 'string' } },
      openQuestions: { type: 'array', items: { type: 'string' } },
    },
  },
  breakdown: {
    type: 'object',
    required: ['tasks'],
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'title', 'layer'],
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            layer: { type: 'string', enum: ['backend', 'frontend', 'other'] },
            files: { type: 'array', items: { type: 'string' } },
            criteria: { type: 'string' },
            deps: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
  report: {
    type: 'object',
    required: ['verified', 'gaps'],
    properties: {
      verified: { type: 'boolean' },
      gaps: { type: 'array', items: { type: 'string' } },
      notes: { type: 'string' },
      filesTouched: { type: 'array', items: { type: 'string' } },
    },
  },
  commit: {
    type: 'object',
    required: ['committed'],
    properties: {
      committed: { type: 'boolean' },
      sha: { type: 'string' },
      message: { type: 'string' },
      files: { type: 'array', items: { type: 'string' } },
    },
  },
};

// --- Prompt builders --------------------------------------------------------

function curatePrompt(ticketList) {
  return [
    'You are the analyst subagent in the ticket-pipeline workflow.',
    'Think like a senior engineer triaging a ticket list. Do NOT think like a product manager.',
    '',
    'Read the ticket list below. For each ticket, return structured JSON that the',
    'downstream planner stage will consume. Resolve obvious scope questions by',
    'inspecting the codebase. Strip out anything that needs a human decision.',
    '',
    'Ticket list (path or inline content):',
    '---',
    ticketList,
    '---',
    '',
    'Return JSON matching this shape:',
    '[{',
    '  "id":         "SLYK-123",              // ticket id; omit if none',
    '  "title":      "short imperative",',
    '  "layer":      "backend|frontend|fullstack|other",',
    '  "files":      ["paths/that/will/change"],   // best guess',
    '  "criteria":   "one-line acceptance criteria",',
    '  "deps":       ["SLYK-122"]             // other ticket ids that must land first',
    '}]',
    '',
    'Do not include preamble or markdown fences. Just the JSON array.',
  ].join('\n');
}

function plannerPrompt(task) {
  return [
    'You are the planner subagent in the ticket-pipeline workflow.',
    'Read the ticket below, investigate the codebase, and produce an implementation plan.',
    'Think like a senior engineer. Surface file paths, approach, risks, and open questions.',
    '',
    'Follow the approach documented in the `/create-implementation-plan` skill',
    '(see .claude/skills/create-implementation-plan/SKILL.md). If you can invoke',
    'skills, run that skill against the ticket; otherwise read the SKILL.md and',
    'apply its phases (read ticket -> analyze codebase -> write plan).',
    '',
    'Ticket:',
    JSON.stringify(task, null, 2),
    '',
    'Return JSON matching this shape:',
    '{',
    '  "summary":       "one-paragraph plan",',
    '  "approach":      "step-by-step, ordered",',
    '  "risks":         ["..."],',
    '  "filesTouched":  ["exact paths"],',
    '  "openQuestions": ["only blockers; resolve obvious ones via the codebase"]',
    '}',
    '',
    'Do not include preamble or markdown fences. Just the JSON object.',
  ].join('\n');
}

function breakdownPrompt(task, plan) {
  return [
    'You are the task-breakdown subagent in the ticket-pipeline workflow.',
    'Convert the plan into small, parallelizable tasks that an individual coder',
    '(backend Express/Node, or frontend React) can implement in one shot.',
    '',
    'Follow the two-phase process documented in the `/breakdown-plan-into-tasks`',
    'skill (see .claude/skills/breakdown-plan-into-tasks/SKILL.md): codebase',
    'analysis first, then task list. Invoke the skill if you can; otherwise read',
    'the SKILL.md and apply its phases.',
    '',
    'Ticket:',
    JSON.stringify(task, null, 2),
    '',
    'Plan:',
    JSON.stringify(plan, null, 2),
    '',
    'Return JSON matching this shape:',
    '{',
    '  "tasks": [{',
    '    "id":       "t1",',
    '    "title":    "imperative",',
    '    "layer":    "backend|frontend|other",',
    '    "files":    ["exact paths this task touches"],',
    '    "criteria": "acceptance",',
    '    "deps":     ["other task ids in this breakdown"]',
    '  }]',
    '}',
    '',
    'Split backend (Express/Node) vs frontend (React + Tailwind) cleanly.',
    'Tasks touching the same file must declare deps.',
    'Do not include preamble or markdown fences. Just the JSON object.',
  ].join('\n');
}

function implementPrompt(task, breakdown) {
  return [
    'You are the implementer subagent in the ticket-pipeline workflow.',
    'Implement every task in the breakdown. Follow project conventions:',
    '- Backend: Node 24 + Express 5 + TypeScript, route -> middleware -> service -> db layering,',
    '  PostgreSQL + Drizzle ORM (services own transactions), Google OAuth auth-code exchange + jose JWT',
    '  claims {sub,email,pa,ver}, structured JSON logger, Vitest + supertest tests.',
    '- Frontend: React 19 + TypeScript + Vite + Tailwind v4 (CSS-first) + Zustand + custom apiFetch client,',
    '  Vitest + Testing Library tests, api-module vi.mock for API mocks.',
    '- Commit convention: `SLYK-<id>: <subject>` for any commit you do NOT make here (a later stage commits).',
    '- PascalCase component files, camelCase hooks, SCREAMING_SNAKE_CASE constants.',
    '- No `any` in TS; explicit prop interfaces; functional components only.',
    '- No `console.log` in production paths; no string-concatenated SQL.',
    '',
    'Ticket:',
    JSON.stringify(task, null, 2),
    '',
    'Breakdown:',
    JSON.stringify(breakdown, null, 2),
    '',
    'Write the code. Run the relevant tests if possible:',
    '  backend:  cd backend && npm run typecheck && npm test',
    '  frontend: cd frontend && npm test',
    'Return a short summary of what you changed (file paths + one line each)',
    'and any blocker you hit. Do NOT commit — a later stage handles that.',
  ].join('\n');
}

function backendImplementPrompt(task, breakdown) {
  const backend = {
    tasks: breakdown.tasks.filter((t) => t.layer === 'backend'),
  };
  return [
    'You are the BACKEND implementer subagent. Node 24 / Express 5 / TypeScript only.',
    'Do not touch frontend files.',
    '',
    'Ticket:',
    JSON.stringify(task, null, 2),
    '',
    'Backend tasks:',
    JSON.stringify(backend, null, 2),
    '',
    'Conventions: RESTful endpoints in routes/, cross-cutting concerns in middleware/,',
    'pg Pool singleton owned by src/db/client.ts (max 5); Drizzle schema src/db/schema.ts;',
    'migrations journal-based (make migrate-generate / make migrate); parameterized queries only,',
    'server clock for business timestamps,',
    'services/googleOAuth.ts exchanges the auth-code server-side; JWT signed with jose in utils/jwt.ts',
    '(claims {sub,email,pa,ver}),',
    'structured JSON logging via pino/pino-http (config/logger.ts + requestLogger middleware, no console.log),',
    'consistent error envelope { data } | { error: { code, message, details? } },',
    'Rich text always passes utils/sanitizeHtml.ts (no javascript:/data: URIs, http(s) images only).',
    'Positions/order for board moves are validated server-side. Soft deletes on tickets.',
    '',
    'Write the code. Run `cd backend && npm run typecheck && npm test` if possible.',
    'Return file paths changed + one line each. Do NOT commit.',
  ].join('\n');
}

function frontendImplementPrompt(task, breakdown) {
  const frontend = {
    tasks: breakdown.tasks.filter((t) => t.layer === 'frontend'),
  };
  return [
    'You are the FRONTEND implementer subagent. React 19 + TypeScript + Vite +',
    'Tailwind v4 (CSS-first tokens in src/index.css) + Radix ui kit + apiFetch only.',
    'No additional styling or data-fetching libraries.',
    'Do not touch backend files.',
    '',
    'Ticket:',
    JSON.stringify(task, null, 2),
    '',
    'Frontend tasks:',
    JSON.stringify(frontend, null, 2),
    '',
    'Conventions: functional components + hooks, explicit prop interfaces (no `any`),',
    'Tailwind utility classes + theme tokens (no stray inline styles, no magic values),',
    'Zustand useAuthStore for global auth state (user/JWT/isPlatformAdmin) + localStorage persistence;',
    'useProjectStore / useBoardUiStore for last-project and board UI state,',
    'custom apiFetch (api/client.ts) attaching Bearer + coalesced 401 refresh + custom errors,',
    'React Router v7 (createBrowserRouter) with RequireAuth / RequirePlatformAdmin guards,',
    'kanban board flows: React Query polling per VITE_POLL_INTERVAL_SECONDS -> drag-and-drop via',
    '@hello-pangea/dnd with server-owned ordering -> destructive actions confirmed via ConfirmDialog;',
    'co-located *.test.ts(x), VITE_ prefix for env vars.',
    '',
    'Write the code. Run `cd frontend && npm test` if possible.',
    'Return file paths changed + one line each. Do NOT commit.',
  ].join('\n');
}

function verifyPrompt(task, breakdown, implSummary) {
  return [
    'You are the verifier subagent in the ticket-pipeline workflow.',
    'Check the implementation against the breakdown. Report gaps honestly.',
    '',
    'Follow the `/verify-deliverable` skill',
    '(see .claude/skills/verify-deliverable/SKILL.md): check acceptance criteria',
    'from the ticket against the implementation (intent conformance) and the',
    'plan/breakdown against the implementation (plan conformance). Invoke the',
    'skill if you can; otherwise read the SKILL.md and apply its method.',
    '',
    'Ticket:',
    JSON.stringify(task, null, 2),
    '',
    'Breakdown:',
    JSON.stringify(breakdown, null, 2),
    '',
    'Implementation summary from coder:',
    implSummary,
    '',
    'Return JSON:',
    '{',
    '  "verified":     true|false,',
    '  "gaps":         ["specific missing piece or path"],',
    '  "notes":        "free-form",',
    '  "filesTouched": ["paths you observed changed"]',
    '}',
    '',
    'Mark verified=false if ANY acceptance criterion from the breakdown is unmet.',
    'Do not include preamble or markdown fences.',
  ].join('\n');
}

function commitPrompt(task, report) {
  // curate-stage ids already carry the project prefix ("SLYK-123"); only
  // prepend SLYK- when a bare numeric id slips through.
  const rawId = typeof task.id === 'string' ? task.id.trim() : '';
  const ticketId = /^\d+$/.test(rawId) ? 'SLYK-' + rawId : rawId;
  const subjectPrefix = ticketId ? ticketId + ': ' : '';
  return [
    'You are the committer subagent in the ticket-pipeline workflow.',
    'Commit the implementation for this single ticket. Project conventions:',
    '- Commit format: `<ticket-id>: <subject>` (e.g. `SLYK-123: add time-entry filter`).',
    '- If no ticket id: prefix a conventional type instead (feat:, fix:, docs:, chore:, refactor:, test:, build:, ci:).',
    '- subject: imperative, lowercase, <=72 chars, no trailing period.',
    '- Stage ONLY the files in report.filesTouched. Never `git add .`.',
    '- NEVER push, merge, rebase, amend, or sign.',
    '- NEVER skip hooks (--no-verify).',
    '',
    'Ticket:',
    JSON.stringify(task, null, 2),
    '',
    'Verifier report:',
    JSON.stringify(report, null, 2),
    '',
    'Stage the files in report.filesTouched (skip if verified=false) and commit',
    'with a message prefixed:' + (subjectPrefix ? ' "' + subjectPrefix.slice(0, -2) + ': ..."' : ' a type prefix like "feat: ..."'),
    '',
    'Return JSON:',
    '{',
    '  "committed": true|false,',
    '  "sha":       "short sha if committed",',
    '  "message":   "the commit message",',
    '  "files":     ["staged paths"]',
    '}',
    '',
    'If verified=false, return committed=false and explain in `message`.',
  ].join('\n');
}

// --- Helpers ------------------------------------------------------------

function canParallelize(breakdown) {
  if (!breakdown || !Array.isArray(breakdown.tasks)) return false;
  const hasBackend = breakdown.tasks.some((t) => t.layer === 'backend');
  const hasFrontend = breakdown.tasks.some((t) => t.layer === 'frontend');
  if (!(hasBackend && hasFrontend)) return false;

  // Disjoint-file check across layers
  const seen = new Map();
  for (const t of breakdown.tasks) {
    for (const f of t.files || []) {
      const prev = seen.get(f);
      if (prev && prev !== t.layer) return false;
      seen.set(f, t.layer);
    }
  }
  return true;
}

function summarizeTask(task, plan, breakdown, impl, report, commit) {
  const id = task.id || '(no-id)';
  const status = report && report.verified ? 'DONE' : 'GAPS';
  const lines = [
    '## ' + id + ' — ' + (task.title || '') + ' [' + status + ']',
    '',
    plan ? '- Plan: ' + (plan.summary || '').slice(0, 140) : '',
    breakdown ? '- Tasks: ' + (breakdown.tasks || []).length + ' subtask(s)' : '',
    report ? '- Verified: ' + (report.verified ? 'yes' : 'NO — ' + ((report.gaps || []).join('; '))) : '',
    commit ? '- Commit: ' + (commit.committed ? commit.sha + ' — ' + commit.message : 'NOT COMMITTED: ' + commit.message) : '',
  ];
  return lines.filter(Boolean).join('\n');
}

// --- Workflow entry -----------------------------------------------------

export default async function* (input, api) {
  const { agent, parallel, pipeline, phase, log } = api;

  const ticketList =
    typeof input === 'string' ? input : input && (input.ticketList || input.tickets) || '';

  if (!ticketList) {
    return 'Usage: /ticket-pipeline <path-to-ticket-list | "inline ticket text">';
  }

  // Stage 1: curate
  phase('Curating ticket list');
  log('Reading ticket list and resolving obvious scope questions');
  const tasks = yield agent(curatePrompt(ticketList), { schema: SCHEMAS.taskList });

  if (!tasks || tasks.length === 0) {
    return 'No tickets to process.';
  }

  log('Processing ' + tasks.length + ' ticket' + (tasks.length === 1 ? '' : 's'));

  // Stages 2-6 run as a pipeline so ticket A can be in verify while ticket B
  // is still in plan. Each stage yields one agent() result per ticket.
  const perTicketResults = yield pipeline(
    tasks,
    // Stage 2: plan
    (task) => agent(plannerPrompt(task), { schema: SCHEMAS.plan }),
    // Stage 3: breakdown
    (plan, task) => agent(breakdownPrompt(task, plan), { schema: SCHEMAS.breakdown }),
    // Stage 4: implement (parallel backend+frontend when safe, else single dispatch)
    (breakdown, plan, task) => {
      if (!canParallelize(breakdown)) {
        return agent(implementPrompt(task, breakdown));
      }
      log('Ticket ' + (task.id || '(no-id)') + ': parallelizing backend + frontend');
      return parallel([
        () => agent(backendImplementPrompt(task, breakdown)),
        () => agent(frontendImplementPrompt(task, breakdown)),
      ]).then((parts) => parts.filter(Boolean).join('\n\n---\n\n'));
    },
    // Stage 5: verify
    (impl, breakdown, plan, task) =>
      agent(verifyPrompt(task, breakdown, impl), { schema: SCHEMAS.report }),
    // Stage 6: commit
    (report, impl, breakdown, plan, task) =>
      agent(commitPrompt(task, report), { schema: SCHEMAS.commit })
  );

  // perTicketResults is an array aligned with `tasks`; each entry is the final
  // stage's result for that ticket, with prior stage results available as
  // deeper array indices. For readability, we synthesize a per-task summary.
  const summary = tasks.map((task, i) => {
    const chain = Array.isArray(perTicketResults[i])
      ? perTicketResults[i]
      : [perTicketResults[i]];
    const [plan, breakdown, impl, report, commit] = Array.isArray(chain[0])
      ? chain[0]
      : chain;
    return summarizeTask(task, plan, breakdown, impl, report, commit);
  });

  phase('Done');
  return '# ticket-pipeline run summary\n\n' + summary.join('\n\n');
}
