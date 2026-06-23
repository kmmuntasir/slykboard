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
};
