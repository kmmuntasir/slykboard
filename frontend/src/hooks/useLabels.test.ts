import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLabels } from '@/hooks/useLabels';
import { listLabels } from '@/api/labels';
import { ApiClientError } from '@/api/client';
import { labelKeys } from '@/api/queryKeys';
import type { Label } from '@/types/label';

vi.mock('@/api/labels');

const SLUG = 'slyk';
const LABEL_KEY = labelKeys.forProject(SLUG);

// --- Fixtures --------------------------------------------------------------

function makeLabel(id: string, overrides: Partial<Label> = {}): Label {
  return {
    id,
    name: `label-${id}`,
    color: '#6B7280',
    ...overrides,
  };
}

const labelMock: Label[] = [
  makeLabel('l1', { name: 'Bug', color: '#FF0000' }),
  makeLabel('l2', { name: 'Urgent', color: '#FFA500' }),
];

// --- Harness ---------------------------------------------------------------

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

// --- Tests -----------------------------------------------------------------

describe('useLabels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches and returns the label list under labelKeys.forProject(slug)', async () => {
    vi.mocked(listLabels).mockResolvedValue(labelMock);

    const queryClient = newQueryClient();
    const { result } = renderHook(() => useLabels(SLUG), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(listLabels).toHaveBeenCalledWith(SLUG);
    expect(result.current.data).toEqual(labelMock);
    // The query is cached under the expected project-scoped key.
    expect(queryClient.getQueryData<Label[]>(LABEL_KEY)).toEqual(labelMock);
  });

  it('surfaces error state when listLabels rejects', async () => {
    vi.mocked(listLabels).mockRejectedValue(
      new ApiClientError('boom', 500, 'INTERNAL_ERROR'),
    );

    const queryClient = newQueryClient();
    const { result } = renderHook(() => useLabels(SLUG), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(ApiClientError);
    expect(result.current.data).toBeUndefined();
  });

  it('returns empty list when project has no labels', async () => {
    vi.mocked(listLabels).mockResolvedValue([]);

    const queryClient = newQueryClient();
    const { result } = renderHook(() => useLabels(SLUG), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });
});
