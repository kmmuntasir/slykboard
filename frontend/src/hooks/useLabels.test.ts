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
    vi.mocked(listLabels).mockRejectedValue(new ApiClientError('boom', 500, 'INTERNAL_ERROR'));

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

// --- Per-slug query-key independence (SLYK-08 B1-2) -----------------------

// Table-driven assertion: the hook caches under ['labels', 'project', <slug>]
// (via labelKeys.forProject(slug)) and distinct slugs never collide.
const slugKeyCases: Array<{ name: string; slug: string; expectedKey: readonly unknown[] }> = [
  {
    name: 'slyk slug',
    slug: 'slyk',
    expectedKey: ['labels', 'project', 'slyk'],
  },
  {
    name: 'platform slug',
    slug: 'platform',
    expectedKey: ['labels', 'project', 'platform'],
  },
  {
    name: 'marketing slug',
    slug: 'marketing',
    expectedKey: ['labels', 'project', 'marketing'],
  },
];

describe('useLabels — per-slug query-key independence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // (1) The hook caches each slug under ['labels', 'project', <slug>]
  // (slug-keyed via labelKeys.forProject(slug)). One `it` per case.
  slugKeyCases.forEach(({ name, slug, expectedKey }) => {
    it(`caches under labelKeys.forProject(slug) — ${name}`, async () => {
      // Resolve with a slug-distinct payload so we can observe which cache slot
      // the hook wrote to. No live network — the module is mocked.
      vi.mocked(listLabels).mockResolvedValue([makeLabel(slug, { name: slug })]);

      const queryClient = newQueryClient();
      const { result } = renderHook(() => useLabels(slug), {
        wrapper: createWrapper(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(labelKeys.forProject(slug)).toEqual(expectedKey);
      expect(queryClient.getQueryData<Label[]>(expectedKey)).toEqual([
        makeLabel(slug, { name: slug }),
      ]);
    });
  });

  it('two distinct slugs produce independent cache entries (no cross-slug leak)', async () => {
    const slugA = 'slyk';
    const slugB = 'platform';
    const payloadA: Label[] = [makeLabel('a1', { name: 'Bug' })];
    const payloadB: Label[] = [makeLabel('b1', { name: 'Urgent' })];

    // Route by slug argument so each project resolves to its own payload.
    vi.mocked(listLabels).mockImplementation(async (s: string) =>
      s === slugA ? payloadA : payloadB,
    );

    const queryClient = newQueryClient();

    const { result: resultA } = renderHook(() => useLabels(slugA), {
      wrapper: createWrapper(queryClient),
    });
    const { result: resultB } = renderHook(() => useLabels(slugB), {
      wrapper: createWrapper(queryClient),
    });

    await waitFor(() => expect(resultA.current.isSuccess).toBe(true));
    await waitFor(() => expect(resultB.current.isSuccess).toBe(true));

    const keyA = labelKeys.forProject(slugA);
    const keyB = labelKeys.forProject(slugB);

    // (2) The two cache keys are distinct references and distinct by value.
    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toEqual(keyB);

    // Each slug's cache holds only its own payload — they do not overwrite.
    expect(queryClient.getQueryData<Label[]>(keyA)).toEqual(payloadA);
    expect(queryClient.getQueryData<Label[]>(keyB)).toEqual(payloadB);
  });
});
