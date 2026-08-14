import { apiFetch } from './client';
import { projectKeys } from './queryKeys';
import type {
  CreatedAgentProject,
  CreateAgentProjectBody,
  OnboardingTimelineView,
  ProjectAgentMeta,
} from '@/types/onboarding';

// SLYK-0230 — typed client for the agent onboarding endpoints
// (docs/agentic-automation/05-backend-routes.md § /api/v1/admin/* + the
// doc-gap /api/v1/me/projects/:slug/onboarding/events read this ticket adds).
// Agent routes live under the versioned /api/v1 mount, NOT the legacy /api
// prefix every other module uses — apiFetch's base URL is .../api, so agent
// paths are written as `/v1/...` here.

export const onboardingApi = {
  // POST /api/v1/admin/projects — create project + start onboarding (SLYK-0190).
  // 201 with the created project row; 4xx validation/conflict; 5xx/502 when the
  // dispatcher rejects the /onboard kick.
  createProject: (body: CreateAgentProjectBody): Promise<CreatedAgentProject> =>
    apiFetch<CreatedAgentProject>('/v1/admin/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // GET /api/v1/me/projects/:slug/onboarding/events — timeline payload this
  // ticket's backend half serves. Polled every 3s while in-flight (see
  // useOnboardingTimeline); returns 404 for an unknown slug.
  getTimeline: (slug: string): Promise<OnboardingTimelineView> =>
    apiFetch<OnboardingTimelineView>(`/v1/me/projects/${slug}/onboarding/events`),
};

// Query key factory additions per 11-existing-patterns.md — colocated here
// (not in queryKeys.ts) so the plain-mode bundle never references agent keys;
// the module is only ever imported through the agent-mode React.lazy pages.
export const onboardingKeys = {
  all: ['onboarding'] as const,
  timeline: (slug: string) => [...onboardingKeys.all, 'timeline', slug] as const,
  adminProjects: () => [...onboardingKeys.all, 'admin-projects'] as const,
};

// Existing plain-mode key re-export — a created agent project also lands in the
// core projects list, so the form invalidates that cache too.
export const projectKeysRef = projectKeys;

// Admin project list row — ProjectAgentMeta joined with the core project name.
export interface AdminProjectListItem {
  project: { id: string; name: string; slug: string };
  meta: ProjectAgentMeta;
}
