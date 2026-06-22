export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  detail: (slug: string) => [...projectKeys.all, 'detail', slug] as const,
};
