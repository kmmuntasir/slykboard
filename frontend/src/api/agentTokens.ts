import { apiFetch } from './client';

// SLYK-0380 — typed client for the agent-token endpoints (SLYK-0370 backend).
// Agent routes live under /api/v1; apiFetch's base is .../api, so paths are
// written as /v1/... (same convention as onboarding.ts / pipeline.ts).

// List row — the backend projection never includes tokenHash (hashes stay in
// the DB; 05-backend-routes.md § agent-tokens list).
export interface AgentTokenListItem {
  id: string;
  name: string;
  projectId: string | null;
  createdBy: string | null;
  revokedAt: string | null;
  createdAt: string;
}

// Generate response — the RAW token appears exactly once, in this payload.
// Never persisted client-side beyond the dialog's show-once reveal.
export interface GeneratedAgentToken {
  token: string;
  id: string;
  name: string;
}

export const agentTokenApi = {
  list: (): Promise<AgentTokenListItem[]> => apiFetch<AgentTokenListItem[]>('/v1/admin/agent-tokens'),

  generate: (body: { name: string; projectId: string | null }): Promise<GeneratedAgentToken> =>
    apiFetch<GeneratedAgentToken>('/v1/admin/agent-tokens', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  revoke: (id: string): Promise<void> =>
    apiFetch<void>(`/v1/admin/agent-tokens/${id}`, { method: 'DELETE' }),
};

// Query keys colocated per the onboarding.ts convention — the plain-mode
// bundle never references agent keys.
export const agentTokenKeys = {
  all: ['agent-tokens'] as const,
};
