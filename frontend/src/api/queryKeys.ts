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

// F23 T3: per-user aggregated time report cache keys (period + offset scoped).
export const reportKeys = {
  all: ['reports'] as const,
  time: (period: 'weekly' | 'monthly', offset: number) =>
    [...reportKeys.all, 'time', period, offset] as const,
  // F24: per-user resolved-ticket summary cache keys (period + offset scoped).
  tickets: (period: 'weekly' | 'monthly', offset: number) =>
    [...reportKeys.all, 'tickets', period, offset] as const,
};
