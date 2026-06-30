export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  detail: (slug: string) => [...projectKeys.all, 'detail', slug] as const,
};

export const boardKeys = {
  all: ['boards'] as const,
  detail: (slug: string) => [...boardKeys.all, 'detail', slug] as const,
};

export const ticketKeys = {
  all: ['tickets'] as const,
  detail: (id: string) => [...ticketKeys.all, 'detail', id] as const,
  // F30 T3: SLYK-NNN-ref-keyed detail cache — kept separate from UUID-keyed
  // detail above to avoid cache-key collisions between the two addressing schemes.
  detailByRef: (slug: string, displayId: string) =>
    [...ticketKeys.all, 'detail-by-ref', slug, displayId] as const,
  // F19: per-ticket activity feed cache key.
  activity: (id: string) => [...ticketKeys.all, 'activity', id] as const,
  // SLYK-13 T9: per-ticket comment thread cache key. Scoped under the ticket's
  // detail domain so invalidation travels with the ticket, not globally.
  comments: (id: string) => [...ticketKeys.all, 'comments', id] as const,
};

// F14 T5: label catalog query keys (project-scoped list + label detail).
export const labelKeys = {
  all: ['labels'] as const,
  forProject: (slug: string) => [...labelKeys.all, 'project', slug] as const,
  detail: (id: string) => [...labelKeys.all, 'detail', id] as const,
};

// F20 T4: server-authoritative timer query keys (user's single open timer).
export const timerKeys = {
  all: ['timer'] as const,
  active: () => [...timerKeys.all, 'active'] as const,
  // F20: per-ticket time-tracking log cache key.
  entries: (id: string) => [...timerKeys.all, 'entries', id] as const,
};

// SLYK-01 Task N: project-scoped member roster cache key. `slug` is a key
// segment so the roster cache does not leak across projects on switch.
export const memberKeys = {
  all: ['project-members'] as const,
  forProject: (slug: string) => [...memberKeys.all, slug] as const,
  // SLYK-02 T4: per-(slug, email) member lookup cache key for the Add-Member
  // modal auto-search. `email` is a key segment so React Query naturally discards
  // stale lookups as the user types.
  lookup: (slug: string, email: string) =>
    [...memberKeys.forProject(slug), 'lookup', email] as const,
};

// F49: project-scoped report cache keys. `slug` is a key segment so cache does
// not leak across projects on switch (stale-cross-project-data edge case).
export const reportKeys = {
  all: ['reports'] as const,
  time: (period: 'weekly' | 'monthly', offset: number, slug: string) =>
    [...reportKeys.all, 'time', period, offset, slug] as const,
  tickets: (period: 'weekly' | 'monthly', offset: number, slug: string) =>
    [...reportKeys.all, 'tickets', period, offset, slug] as const,
};
