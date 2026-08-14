// SLYK-0230 — onboarding-domain types mirrored from the backend agent
// endpoints (docs/agentic-automation/05-backend-routes.md § POST
// /api/v1/admin/projects + 06-frontend-ui.md § Onboarding Timeline). Shapes
// match the backend rows exactly; timestamps arrive as ISO strings over JSON.

// OnboardingStateEnum values (backend/src/db/schema/agent.ts).
export type OnboardingState =
  | 'PENDING'
  | 'PROVISIONING_LXC'
  | 'WIRING_GITHUB'
  | 'WIRING_AGENT'
  | 'WIRING_ZORAXY'
  | 'SMOKE_TEST'
  | 'LIVE'
  | 'FAILED'
  | 'DECOMMISSIONING'
  | 'DECOMMISSIONED';

// Terminal states per 06-frontend-ui.md § Onboarding Timeline — polling stops
// once the project lands here.
export const TERMINAL_ONBOARDING_STATES: readonly OnboardingState[] = [
  'LIVE',
  'FAILED',
  'DECOMMISSIONED',
];

export function isTerminalOnboardingState(state: OnboardingState): boolean {
  return TERMINAL_ONBOARDING_STATES.includes(state);
}

export type SourceMode = 'new' | 'existing';
export type AgentStack = 'node-express' | 'next' | 'python-fastapi' | 'go' | 'static';
export type AgentVisibility = 'internal' | 'public';

// POST /api/v1/admin/projects request body (SLYK-0190). githubRepo is
// required iff sourceMode === 'existing'; agentBackend null = global default.
export interface CreateAgentProjectBody {
  name: string;
  slug: string;
  subdomain: string;
  sourceMode: SourceMode;
  githubRepo: string | null;
  stack: AgentStack;
  agentBackend: string | null;
  visibility: AgentVisibility;
  initialAgentContext: string | null;
}

// Core Projects row as returned by the create endpoint (camelCase via Drizzle
// $inferSelect serialization).
export interface CreatedAgentProject {
  id: string;
  name: string;
  slug: string;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
}

// One OnboardingEvents row (append-only log, asc render order).
export interface OnboardingEvent {
  id: string;
  projectId: string;
  fromState: OnboardingState | null;
  toState: OnboardingState;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

// GET /api/v1/me/projects/:slug/onboarding/events response (SLYK-0230).
// SLYK-0240 widened project with the three fields <DecommissionDialog>'s
// consequence bullets quote (ctid, subdomain, githubRepoCreated).
export interface OnboardingTimelineView {
  project: {
    name: string;
    slug: string;
    onboardingState: OnboardingState;
    onboardingError: string | null;
    lxcCtid: number | null;
    subdomain: string;
    githubRepoCreated: boolean;
  };
  events: OnboardingEvent[];
}

// ProjectAgentMeta row (admin project list + timeline header context).
export interface ProjectAgentMeta {
  projectId: string;
  slug: string;
  subdomain: string;
  sourceMode: SourceMode;
  githubRepo: string | null;
  githubRepoCreated: boolean;
  stack: AgentStack;
  teamKey: string;
  agentBackend: string | null;
  initialAgentContext: string | null;
  lxcCtid: number | null;
  lanIp: string | null;
  systemdService: string | null;
  zoraxyProxyId: string | null;
  onboardingState: OnboardingState;
  onboardingError: string | null;
  onboardedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
