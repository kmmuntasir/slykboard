import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useProjects, useProject, useCreateProject } from '@/hooks/useProjects';
import { listProjects, getProjectBySlug, createProject } from '@/api/projects';
import { projectKeys } from '@/api/queryKeys';
import type { CreateProjectDto, Project } from '@/types/project';

vi.mock('@/api/projects');

const projectMock: Project = {
    id: 'p1',
    name: 'Slyk',
    slug: 'slyk',
    columns: [],
    creatorId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
};

function createWrapper(queryClient: QueryClient) {
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
}

function newQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: { retry: false, gcTime: 0 },
        },
    });
}

describe('useProjects', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('useProjects returns data on success', async () => {
        vi.mocked(listProjects).mockResolvedValue([projectMock]);
        const queryClient = newQueryClient();

        const { result } = renderHook(() => useProjects(), {
            wrapper: createWrapper(queryClient),
        });

        await waitFor(() => expect(result.current.data).toBeDefined());

        expect(result.current.data).toEqual([projectMock]);
        expect(listProjects).toHaveBeenCalled();
    });

    it('useProject enabled only when slug present', async () => {
        vi.mocked(getProjectBySlug).mockResolvedValue(projectMock);
        vi.mocked(listProjects);
        vi.mocked(createProject);

        // No slug: hook disabled, getProjectBySlug not called.
        const queryClientUndefined = newQueryClient();
        renderHook(() => useProject(undefined), {
            wrapper: createWrapper(queryClientUndefined),
        });

        expect(getProjectBySlug).not.toHaveBeenCalled();

        // With slug: hook fetches.
        const queryClientSlug = newQueryClient();
        const { result } = renderHook(() => useProject('SLYK'), {
            wrapper: createWrapper(queryClientSlug),
        });

        await waitFor(() => expect(result.current.data).toBeDefined());

        expect(getProjectBySlug).toHaveBeenCalledWith('SLYK');
        expect(result.current.data).toEqual(projectMock);
    });

    it('useCreateProject invalidates list on success', async () => {
        const createdProject: Project = { ...projectMock, id: 'p2', slug: 'new' };
        vi.mocked(createProject).mockResolvedValue(createdProject);

        const queryClient = newQueryClient();
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

        const { result } = renderHook(() => useCreateProject(), {
            wrapper: createWrapper(queryClient),
        });

        const dto: CreateProjectDto = { name: 'New', slug: 'new' };

        await act(async () => {
            await result.current.mutateAsync(dto);
        });

        expect(invalidateSpy).toHaveBeenCalledWith({
            queryKey: projectKeys.lists(),
        });
    });
});
