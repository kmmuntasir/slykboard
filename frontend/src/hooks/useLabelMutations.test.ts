import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useCreateLabel,
  useUpdateLabel,
  useDeleteLabel,
} from '@/hooks/useLabelMutations';
import { createLabel, updateLabel, deleteLabel } from '@/api/labels';
import { ApiClientError } from '@/api/client';
import { labelKeys, boardKeys } from '@/api/queryKeys';
import type { Label, CreateLabelDto, UpdateLabelDto } from '@/types/label';

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

function seedLabels(): Label[] {
  return [
    makeLabel('l1', { name: 'Bug', color: '#FF0000' }),
    makeLabel('l2', { name: 'Urgent', color: '#FFA500' }),
  ];
}

// --- Harness ---------------------------------------------------------------

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

// --- Tests -----------------------------------------------------------------

describe('useCreateLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mutationFn calls createLabel(slug, dto)', async () => {
    const created = makeLabel('l3', { name: 'Defect', color: '#0000FF' });
    vi.mocked(createLabel).mockResolvedValue(created);

    const queryClient = newQueryClient();
    const { result } = renderHook(() => useCreateLabel(SLUG), {
      wrapper: createWrapper(queryClient),
    });

    const dto: CreateLabelDto = { name: 'Defect', color: '#0000FF' };
    await act(async () => {
      await result.current.mutateAsync(dto);
    });

    expect(createLabel).toHaveBeenCalledWith(SLUG, dto);
  });

  it('onSettled invalidates the label list for the project', async () => {
    const created = makeLabel('l3', { name: 'Defect', color: '#0000FF' });
    vi.mocked(createLabel).mockResolvedValue(created);

    const queryClient = newQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateLabel(SLUG), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ name: 'Defect', color: '#0000FF' });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: labelKeys.forProject(SLUG) });
  });
});

describe('useUpdateLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('optimistically patches the label in cache on mutate', async () => {
    const prev = seedLabels();
    const serverUpdated = makeLabel('l1', { name: 'Defect', color: '#0000FF' });
    vi.mocked(updateLabel).mockResolvedValue(serverUpdated);

    const queryClient = newQueryClient();
    queryClient.setQueryData(LABEL_KEY, prev);

    const setSpy = vi.spyOn(queryClient, 'setQueryData');

    const { result } = renderHook(() => useUpdateLabel(SLUG), {
      wrapper: createWrapper(queryClient),
    });

    const dto: UpdateLabelDto = { name: 'Defect', color: '#0000FF' };
    await act(async () => {
      await result.current.mutateAsync({ labelId: 'l1', dto });
    });

    // The optimistic onMutate wrote a patched array (function-form updater) against
    // labelKeys.forProject(slug). Invoke it against the seed to verify the patch.
    const optimisticCall = setSpy.mock.calls.find(
      ([key, value]) =>
        JSON.stringify(key) === JSON.stringify(LABEL_KEY) && typeof value === 'function',
    );
    expect(optimisticCall).toBeDefined();
    const updater = optimisticCall?.[1] as (curr: Label[] | undefined) => Label[];
    const patched = updater(prev);
    expect(patched[0]?.name).toBe('Defect');
    expect(patched[0]?.color).toBe('#0000FF');
    // Untouched label survives.
    expect(patched[1]).toEqual(prev[1]);
  });

  it('rolls back the cache on error', async () => {
    const prev = seedLabels();
    vi.mocked(updateLabel).mockRejectedValue(
      new ApiClientError('conflict', 409, 'CONFLICT'),
    );

    const queryClient = newQueryClient();
    queryClient.setQueryData(LABEL_KEY, prev);

    const setSpy = vi.spyOn(queryClient, 'setQueryData');

    const { result } = renderHook(() => useUpdateLabel(SLUG), {
      wrapper: createWrapper(queryClient),
    });

    const dto: UpdateLabelDto = { name: 'Defect' };
    await act(async () => {
      try {
        await result.current.mutateAsync({ labelId: 'l1', dto });
      } catch {
        // swallow; assert rollback below
      }
    });

    // onError restored the label list to the pre-mutation snapshot.
    const restoreCall = setSpy.mock.calls.find(
      ([key, value]) =>
        JSON.stringify(key) === JSON.stringify(LABEL_KEY) && value === prev,
    );
    expect(restoreCall).toBeDefined();
  });

  it('onSettled invalidates label list and board', async () => {
    const serverUpdated = makeLabel('l1', { name: 'Defect' });
    vi.mocked(updateLabel).mockResolvedValue(serverUpdated);

    const queryClient = newQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateLabel(SLUG), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ labelId: 'l1', dto: { name: 'Defect' } });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: labelKeys.forProject(SLUG) });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: boardKeys.all });
  });
});

describe('useDeleteLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('optimistically removes the label from cache on mutate', async () => {
    const prev = seedLabels();
    vi.mocked(deleteLabel).mockResolvedValue({ id: 'l1' });

    const queryClient = newQueryClient();
    queryClient.setQueryData(LABEL_KEY, prev);

    const setSpy = vi.spyOn(queryClient, 'setQueryData');

    const { result } = renderHook(() => useDeleteLabel(SLUG), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync('l1');
    });

    // onMutate wrote a filtered array (function-form updater) removing l1.
    const optimisticCall = setSpy.mock.calls.find(
      ([key, value]) =>
        JSON.stringify(key) === JSON.stringify(LABEL_KEY) && typeof value === 'function',
    );
    expect(optimisticCall).toBeDefined();
    const updater = optimisticCall?.[1] as (curr: Label[] | undefined) => Label[];
    const patched = updater(prev);
    expect(patched.find((l) => l.id === 'l1')).toBeUndefined();
    expect(patched.length).toBe(1);
    expect(patched[0]?.id).toBe('l2');
  });

  it('rolls back the cache on error', async () => {
    const prev = seedLabels();
    vi.mocked(deleteLabel).mockRejectedValue(
      new ApiClientError('boom', 500, 'INTERNAL_ERROR'),
    );

    const queryClient = newQueryClient();
    queryClient.setQueryData(LABEL_KEY, prev);

    const setSpy = vi.spyOn(queryClient, 'setQueryData');

    const { result } = renderHook(() => useDeleteLabel(SLUG), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      try {
        await result.current.mutateAsync('l1');
      } catch {
        // swallow; assert rollback below
      }
    });

    // onError restored the label list to the pre-mutation snapshot.
    const restoreCall = setSpy.mock.calls.find(
      ([key, value]) =>
        JSON.stringify(key) === JSON.stringify(LABEL_KEY) && value === prev,
    );
    expect(restoreCall).toBeDefined();
  });

  it('onSettled invalidates label list and board (cascade re-render)', async () => {
    vi.mocked(deleteLabel).mockResolvedValue({ id: 'l1' });

    const queryClient = newQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteLabel(SLUG), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync('l1');
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: labelKeys.forProject(SLUG) });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: boardKeys.all });
  });
});
