// SLYK-0310 — single source of truth for the pipeline state vocabulary and
// its plain-English labels (docs/agentic-automation/06-frontend-ui.md § state
// map). Mirrors the backend `pipelineStateEnum` (db/schema/agent.ts) — keep the
// 15 values in lockstep. Shared by <PipelinePanel> (timeline rows) and
// <FailedPipelineBadge> (failure copy).

/** All 15 pipeline states, in enum order (backend pipelineStateEnum). */
export const PIPELINE_STATES = [
  'BACKLOG',
  'QUEUED',
  'AGENT_RUNNING',
  'AGENT_WAITING',
  'PR_OPEN',
  'CI_RUNNING',
  'MERGING',
  'CONFLICT_RETRY',
  'DEPLOYING',
  'DONE',
  'FAILED_AGENT',
  'FAILED_CI',
  'FAILED_CONFLICT',
  'FAILED_DEPLOY',
  'BLOCKED_HUMAN',
] as const;

export type PipelineState = (typeof PIPELINE_STATES)[number];

/** State → plain-English label, verbatim from 06-frontend-ui.md. */
export const PIPELINE_STATE_LABEL: Readonly<Record<PipelineState, string>> = Object.freeze({
  BACKLOG: 'Task queued',
  QUEUED: 'Dispatcher acknowledged',
  AGENT_RUNNING: 'Agent started (Cyrus session)',
  AGENT_WAITING: 'Agent has a question for you',
  PR_OPEN: 'Pull request opened',
  CI_RUNNING: 'Automated tests running',
  MERGING: 'Merging to main',
  CONFLICT_RETRY: 'Resolving merge conflict',
  DEPLOYING: 'Deploying to production',
  DONE: 'Deployed',
  FAILED_AGENT: "Agent couldn't complete",
  FAILED_CI: 'Automated tests failed',
  FAILED_CONFLICT: "Couldn't resolve merge conflict",
  FAILED_DEPLOY: 'Deploy failed, rolled back',
  BLOCKED_HUMAN: 'Needs human help',
});

/** Failed terminal states — render the red <FailedPipelineBadge>. */
export const FAILED_PIPELINE_STATES: readonly PipelineState[] = [
  'FAILED_AGENT',
  'FAILED_CI',
  'FAILED_CONFLICT',
  'FAILED_DEPLOY',
  'BLOCKED_HUMAN',
];

/** True for FAILED_* and BLOCKED_HUMAN — the badge-gating check. */
export function isFailedPipelineState(state: PipelineState | null | undefined): boolean {
  return !!state && FAILED_PIPELINE_STATES.includes(state);
}
