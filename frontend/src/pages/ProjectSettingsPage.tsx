// F14 T9 / F27: project-scoped settings page at /projects/:slug/settings.
// Hosts the project rename + column management surfaces (admin-only) and the
// LabelManager. Project-scoped data gets a project-scoped URL.
import { useState } from 'react';
import { useParams } from 'react-router';
import { useProject } from '@/hooks/useProjects';
import { useUpdateProject } from '@/hooks/useUpdateProject';
import { useRequireRole } from '@/hooks/useRequireRole';
import { ApiClientError } from '@/api/client';
import { LabelManager } from '@/components/LabelManager';
import { ProjectColumnsManager } from '@/components/ProjectColumnsManager';
import { Retry } from '@/components/Retry';
import { SkeletonBlock, SkeletonLine } from '@/components/Skeleton';

export function ProjectSettingsPage() {
    const { slug } = useParams<{ slug: string }>();

    if (!slug) {
        return <div className="p-4">No project selected.</div>;
    }

    return <SettingsBody slug={slug} />;
}

interface SettingsBodyProps {
    slug: string;
}

function SettingsBody({ slug }: SettingsBodyProps) {
    const { data: project, isLoading, error, refetch } = useProject(slug);
    const isAdmin = useRequireRole('ADMIN');

    if (isLoading) {
        return (
            <div className="space-y-3 p-4">
                <SkeletonLine className="h-6 w-40" />
                <SkeletonLine className="h-4 w-full" />
                <SkeletonBlock />
            </div>
        );
    }
    if (error) {
        return (
            <div className="p-4">
                <Retry message={error.message} onRetry={refetch} />
            </div>
        );
    }
    if (!project) {
        return <div className="p-4">Project not found.</div>;
    }

    return (
        <div className="mx-auto max-w-2xl space-y-6 p-4">
            <h1 className="text-xl font-bold">Project Settings</h1>

            {isAdmin && (
                <>
                    <ProjectNameSection slug={slug} name={project.name} />
                    <ProjectColumnsManager projectSlug={slug} columns={project.columns} />
                </>
            )}

            <LabelManager projectSlug={slug} />
        </div>
    );
}

interface ProjectNameSectionProps {
    slug: string;
    name: string;
}

function ProjectNameSection({ slug, name }: ProjectNameSectionProps) {
    const updateMut = useUpdateProject(slug);
    const [draftName, setDraftName] = useState(name);

    const handleSaveName = async () => {
        const trimmed = draftName.trim();
        if (!trimmed) return;
        try {
            await updateMut.mutateAsync({ name: trimmed });
        } catch {
            // error surfaced via updateMut.error below
        }
    };

    const errMsg =
        updateMut.error instanceof ApiClientError
            ? updateMut.error.message
            : updateMut.error?.message;

    return (
        <section className="space-y-2 rounded border border-border p-4">
            <h2 className="text-lg font-semibold">Project Name</h2>
            <input
                aria-label="Project name"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Name"
                className="block w-full rounded border border-border px-2 py-1"
            />
            <button
                type="button"
                onClick={handleSaveName}
                disabled={updateMut.isPending || !draftName.trim()}
                className="rounded bg-primary px-3 py-1 text-background disabled:opacity-50"
            >
                {updateMut.isPending ? 'Saving…' : 'Save Name'}
            </button>
            {errMsg && <p className="text-sm text-red-600">{errMsg}</p>}
        </section>
    );
}
