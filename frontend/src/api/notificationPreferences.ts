// SLYK-0390 — typed client for the per-user per-project email opt-ins
// (06-frontend-ui.md § Notifications; the endpoints are this ticket's doc-gap
// additions). Agent routes live under the versioned /api/v1 mount — apiFetch's
// base URL is .../api, so agent paths are written as `/v1/...` here (same
// note as api/onboarding.ts).

import { apiFetch } from './client';
import type { NotificationPreferences } from '@/types/notificationPreferences';

export const notificationPreferenceApi = {
  // GET /api/v1/me/projects/:slug/notification-preferences — row or the
  // lazy all-true default; never creates the row.
  get: (slug: string): Promise<NotificationPreferences> =>
    apiFetch<NotificationPreferences>(`/v1/me/projects/${slug}/notification-preferences`),

  // PUT same path — upsert on the composite PK (user×project); returns the
  // saved values.
  save: (slug: string, body: NotificationPreferences): Promise<NotificationPreferences> =>
    apiFetch<NotificationPreferences>(`/v1/me/projects/${slug}/notification-preferences`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};

// Colocated (not in queryKeys.ts) so the plain-mode bundle never references
// agent keys — same precedent as onboardingKeys.
export const notificationPreferenceKeys = {
  all: ['notification-preferences'] as const,
  forProject: (slug: string) => [...notificationPreferenceKeys.all, slug] as const,
};
