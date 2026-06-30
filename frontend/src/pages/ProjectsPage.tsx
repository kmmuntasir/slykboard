import { FolderOpen } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useProjects, useCreateProject } from '@/hooks/useProjects';
import { useProjectStore } from '@/stores/useProjectStore';
import { useRequirePlatformAdmin } from '@/hooks/useRequirePlatformAdmin';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Retry } from '@/components/Retry';
import { SkeletonLine } from '@/components/Skeleton';
import { ApiClientError } from '@/api/client';

export function ProjectsPage() {
    const navigate = useNavigate();
    const { data: projects, isLoading, error: queryError, refetch } = useProjects();
    const createProject = useCreateProject();
    const setLastSelectedSlug = useProjectStore((s) => s.setLastSelectedSlug);
    const lastSelectedSlug = useProjectStore((s) => s.lastSelectedSlug);
    const clearLastSelectedSlug = useProjectStore((s) => s.clear);
    const isAdmin = useRequirePlatformAdmin();

    const [name, setName] = useState('');
    const [slug, setSlug] = useState('');
    const [error, setError] = useState<string | null>(null);
    const createProjectFormRef = useRef<HTMLFormElement>(null);

    const handleSelect = (selectedSlug: string) => {
        setLastSelectedSlug(selectedSlug);
        void navigate(`/projects/${selectedSlug}`);
    };

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        try {
            const project = await createProject.mutateAsync({ name, slug });
            setLastSelectedSlug(project.slug);
            void navigate(`/projects/${project.slug}`);
        } catch (err) {
            setError(err instanceof ApiClientError ? err.message : 'Failed to create project');
        }
    };

    // SLYK-04: reconcile a stale stored lastSelectedSlug. If the loaded projects
    // list does NOT contain the stored slug, clear it exactly once (clearing flips
    // lastSelectedSlug → null, which re-runs this effect as a no-op → no loop).
    // Stops the 403-loop on '/' for a member whose project was deactivated.
    useEffect(() => {
        if (!projects || projects.length === 0) return;
        if (lastSelectedSlug && !projects.some((p) => p.slug === lastSelectedSlug)) {
            clearLastSelectedSlug();
        }
    }, [projects, lastSelectedSlug, clearLastSelectedSlug]);

    if (isLoading) {
        return (
            <div className="space-y-2 p-4">
                <SkeletonLine />
                <SkeletonLine />
                <SkeletonLine />
            </div>
        );
    }
    if (queryError) {
        return (
            <div className="p-4">
                <Retry message={queryError.message} onRetry={refetch} />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-2xl space-y-6 p-4">
            <h1 className="text-2xl font-semibold">Select a project</h1>

            {projects && projects.length === 0 ? (
                isAdmin ? (
                    <EmptyState
                        icon={
                            <FolderOpen
                                className="h-8 w-8 text-muted-foreground"
                                aria-hidden="true"
                            />
                        }
                        title="No projects yet"
                        description="Create your first project to get started."
                        action={
                            {
                                label: 'Create project',
                                onClick: () => {
                                    createProjectFormRef.current?.scrollIntoView({
                                        behavior: 'smooth',
                                    });
                                    createProjectFormRef.current
                                        ?.querySelector('input')
                                        ?.focus();
                                },
                            }
                        }
                    />
                ) : (
                    <EmptyState
                        icon={
                            <FolderOpen
                                className="h-8 w-8 text-muted-foreground"
                                aria-hidden="true"
                            />
                        }
                        title="You have no Projects"
                        description="Contact an Admin to get access to a project."
                    />
                )
            ) : (
                <ul className="space-y-2">
                    {projects?.map((p) => (
                        <li key={p.id}>
                            <button
                                type="button"
                                onClick={() => handleSelect(p.slug)}
                                className="text-left"
                            >
                                <span className="font-medium">{p.name}</span>{' '}
                                <span className="text-sm text-muted">({p.slug})</span>
                                {!p.isActive && isAdmin && (
                                    <Badge variant="warning" className="ml-2">
                                        Deactivated
                                    </Badge>
                                )}
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {isAdmin && (
                <form
                    ref={createProjectFormRef}
                    onSubmit={handleCreate}
                    className="space-y-2 rounded border border-border p-4"
                >
                    <h2 className="text-lg font-semibold">New Project</h2>
                    <input
                        aria-label="Project name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Name"
                        className="block w-full rounded border border-border px-2 py-1"
                    />
                    <input
                        aria-label="Project slug"
                        value={slug}
                        onChange={(e) => setSlug(e.target.value)}
                        placeholder="SLUG (e.g. SLYK)"
                        className="block w-full rounded border border-border px-2 py-1"
                    />
                    {error && <p className="text-sm text-foreground">{error}</p>}
                    <button
                        type="submit"
                        disabled={createProject.isPending}
                        className="rounded bg-primary px-3 py-1 text-background disabled:opacity-50"
                    >
                        {createProject.isPending ? 'Creating…' : 'Create'}
                    </button>
                </form>
            )}
        </div>
    );
}
