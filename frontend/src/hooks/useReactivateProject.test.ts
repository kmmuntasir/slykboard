import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useReactivateProject } from '@/hooks/useReactivateProject';
import { updateProject } from '@/api/projects';
import { projectKeys, boardKeys } from '@/api/queryKeys';
import type { Project } from '@/types/project';

vi.mock('@/api/projects');

const SLUG = 'slyk';

// --- Fixtures ---------------------------------------------------------------

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Slyk',
    slug: SLUG,
    columns: [{ id: 'c1', name: 'Todo' }],
    creatorId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isActive: false,
    ...overrides,
  };
}

// --- Harness ----------------------------------------------------------------

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
    },
  });
}

// --- Tests ------------------------------------------------------------------

describe('useReactivateProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls updateProject with { isActive: true } and the right slug', async () => {
    const serverUpdated = makeProject({ isActive: true });
    vi.mocked(updateProject).mockResolvedValue(serverUpdated);

    const queryClient = newQueryClient();
    const { result } = renderHook(() => useReactivateProject(SLUG), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(updateProject).toHaveBeenCalledTimes(1);
    expect(updateProject).toHaveBeenCalledWith(SLUG, { isActive: true });
  });

  it('invalidates project detail, project lists, and board families on success', async () => {
    const serverUpdated = makeProject({ isActive: true });
    vi.mocked(updateProject).mockResolvedValue(serverUpdated);

    const queryClient = newQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useReactivateProject(SLUG), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: projectKeys.detail(SLUG) });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: projectKeys.lists() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: boardKeys.all });
  });

  it('does NOT perform an optimistic update (server-authoritative)', async () => {
    const serverUpdated = makeProject({ isActive: true });
    vi.mocked(updateProject).mockResolvedValue(serverUpdated);

    const queryClient = newQueryClient();
    const setSpy = vi.spyOn(queryClient, 'setQueryData');

    const { result } = renderHook(() => useReactivateProject(SLUG), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(setSpy).not.toHaveBeenCalled();
  });
});
