// F14 T9 / F27 / SLYK-03 T2: project-scoped settings page at
// /projects/:slug/settings. Two-column layout — a left in-page section sidebar
// (General / Members / Labels) drives the right content pane. Management
// controls (rename, columns, labels) are gated on the broadened
// (Platform Admin OR Project Admin) gate via useCurrentProjectMembership; the
// members pane is a navigation <Link>, not an embed of the members page.
//
// Loading correctness: useCurrentProjectMembership exposes no loading flag, so
// membership loading is read separately from useProjectMembers(slug). Until it
// resolves, management UI is suppressed (read-only / skeleton) so it never
// flashes then hides for a non-admin.
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useProject } from '@/hooks/useProjects';
import { useUpdateProject } from '@/hooks/useUpdateProject';
import { useRequirePlatformAdmin } from '@/hooks/useRequirePlatformAdmin';
import { useProjectMembers, useCurrentProjectMembership } from '@/hooks/useProjectMembers';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { LabelManager } from '@/components/LabelManager';
import { ProjectColumnsManager } from '@/components/ProjectColumnsManager';
import { Retry } from '@/components/Retry';
import { SkeletonLine } from '@/components/Skeleton';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { useDeactivateProject } from '@/hooks/useDeactivateProject';
import { useReactivateProject } from '@/hooks/useReactivateProject';

// SLYK-04 T6: unique aria title id for the platform-admin status dialog
// (mirrors the REMOVE_DIALOG_TITLE_ID pattern from ProjectMembersPage).
const PROJECT_STATUS_DIALOG_TITLE_ID = 'project-status-title';

type SectionId = 'general' | 'members' | 'labels';

// The section registry — the single extension point for the in-page sidebar.
const SECTIONS: { id: SectionId; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'members', label: 'Members' },
    { id: 'labels', label: 'Labels' },
];

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
    const isPlatformAdmin = useRequirePlatformAdmin();
    const { isProjectAdmin } = useCurrentProjectMembership(slug);
    // Membership has no dedicated loading flag on useCurrentProjectMembership;
    // read it from the underlying roster query so management UI never flashes.
    const { isLoading: membershipLoading } = useProjectMembers(slug);

    const [active, setActive] = useState<SectionId>('general');

    if (isLoading) {
        return (
            <div className="space-y-3 p-4">
                <SkeletonLine className="h-6 w-40" />
                <SkeletonLine className="h-4 w-full" />
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

    // Broadened gate: Platform Admin OR Project Admin. A Platform Admin who is
    // not a real member still manages via the bypass, so the platform-admin
    // source short-circuits the membership-loading wait.
    const canManage = isPlatformAdmin || isProjectAdmin;
    const membershipReady = isPlatformAdmin || !membershipLoading;

    return (
        <div className="p-4">
            <h1 className="mb-4 text-xl font-bold">Project Settings</h1>

            <div className="flex gap-6">
                <nav aria-label="Project settings sections" className="w-48 shrink-0">
                    <ul className="space-y-1">
                        {SECTIONS.map((section) => {
                            const isActive = active === section.id;
                            return (
                                <li key={section.id}>
                                    <button
                                        type="button"
                                        aria-current={isActive ? 'page' : undefined}
                                        onClick={() => setActive(section.id)}
                                        className={cn(
                                            'block w-full rounded px-3 py-2 text-left text-sm',
                                            isActive
                                                ? 'bg-muted font-medium text-foreground'
                                                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                                        )}
                                    >
                                        {section.label}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                </nav>

                <div className="flex-1 space-y-6">
                    {active === 'general' &&
                        renderGeneral(
                            slug,
                            project.name,
                            project.columns,
                            project.isActive,
                            canManage,
                            membershipReady,
                            isPlatformAdmin,
                        )}
                    {active === 'members' && (
                        <section className="space-y-2 rounded border border-border p-4">
                            <h2 className="text-lg font-semibold">Members</h2>
                            <p className="text-sm text-muted-foreground">
                                Manage who can access this project and their roles.
                            </p>
                            <Link
                                to={`/projects/${slug}/members`}
                                className="inline-block rounded bg-primary px-3 py-1 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                            >
                                Manage members
                            </Link>
                        </section>
                    )}
                    {active === 'labels' && renderLabels(slug, canManage, membershipReady)}
                </div>
            </div>
        </div>
    );
}

function renderGeneral(
    slug: string,
    name: string,
    columns: SettingsColumns,
    isActive: boolean,
    canManage: boolean,
    membershipReady: boolean,
    isPlatformAdmin: boolean,
) {
    if (!membershipReady) {
        return <SkeletonLine className="h-24 w-full" />;
    }
    if (!canManage) {
        return (
            <ReadOnlyNote>
                You need admin access to rename this project or edit its columns.
            </ReadOnlyNote>
        );
    }
    return (
        <>
            <ProjectNameSection slug={slug} name={name} />
            <ProjectColumnsManager projectSlug={slug} columns={columns} />
            {/* SLYK-04 T6: Platform-Admin-only status control. Gated on
                isPlatformAdmin, NOT canManage. A PA always satisfies canManage
                via the bypass, so this lives inside the management branch but
                is independently gated so a future gate change can't leak it. */}
            {isPlatformAdmin && <ProjectStatusSection slug={slug} isActive={isActive} />}
        </>
    );
}

function renderLabels(slug: string, canManage: boolean, membershipReady: boolean) {
    if (!membershipReady) {
        return <SkeletonLine className="h-24 w-full" />;
    }
    if (!canManage) {
        return <ReadOnlyNote>You need admin access to manage labels.</ReadOnlyNote>;
    }
    return <LabelManager projectSlug={slug} />;
}

interface ReadOnlyNoteProps {
    children: ReactNode;
}

function ReadOnlyNote({ children }: ReadOnlyNoteProps) {
    return (
        <section className="space-y-1 rounded border border-border p-4">
            <h2 className="text-lg font-semibold">Read-only</h2>
            <p className="text-sm text-muted-foreground">{children}</p>
        </section>
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
        // F28 T12: a failed rename is toasted by the global mutation funnel
        // (single surface) — no inline error to avoid double-surfacing.
        try {
            await updateMut.mutateAsync({ name: trimmed });
        } catch {
            // toasted via MutationCache.onError
        }
    };

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
        </section>
    );
}

// Local type alias so renderGeneral's signature can name the columns prop
// without importing Column here.
type SettingsColumns = ComponentProps<typeof ProjectColumnsManager>['columns'];

interface ProjectStatusSectionProps {
    slug: string;
    isActive: boolean;
}

// SLYK-04 T6: Platform-Admin-only deactivate/reactivate. Deactivation stops
// running timers and revokes member access; project data is preserved and the
// project can be reactivated later. T5's hooks invalidate the detail query on
// success, so project.isActive flips and this section re-reads automatically.
function ProjectStatusSection({ slug, isActive }: ProjectStatusSectionProps) {
    const deactivate = useDeactivateProject(slug);
    const reactivate = useReactivateProject(slug);
    const mutation = isActive ? deactivate : reactivate;
    const [confirmOpen, setConfirmOpen] = useState(false);

    const handleConfirm = () => {
        mutation.mutate(undefined, {
            onSuccess: () => setConfirmOpen(false),
        });
    };

    return (
        <section className="space-y-2 rounded border border-border p-4">
            <h2 className="text-lg font-semibold">Project Status</h2>
            {isActive ? (
                <>
                    <p className="text-sm text-muted-foreground">
                        Deactivating stops all running timers and removes member access. Project
                        data is preserved and the project can be reactivated later.
                    </p>
                    <Button
                        variant="destructive"
                        disabled={mutation.isPending}
                        onClick={() => setConfirmOpen(true)}
                    >
                        Deactivate project
                    </Button>
                    <ConfirmDialog
                        isOpen={confirmOpen}
                        title="Deactivate project?"
                        titleId={PROJECT_STATUS_DIALOG_TITLE_ID}
                        variant="destructive"
                        confirmLabel="Deactivate"
                        cancelLabel="Cancel"
                        pending={mutation.isPending}
                        message="Running timers are stopped and members lose access immediately. Project data is preserved and the project can be reactivated later."
                        onConfirm={handleConfirm}
                        onCancel={() => setConfirmOpen(false)}
                    />
                </>
            ) : (
                <>
                    <p className="text-sm text-muted-foreground">
                        This project is deactivated. Reactivate it to restore member access and
                        timers.
                    </p>
                    <Button disabled={mutation.isPending} onClick={() => setConfirmOpen(true)}>
                        Reactivate project
                    </Button>
                    <ConfirmDialog
                        isOpen={confirmOpen}
                        title="Reactivate project?"
                        titleId={PROJECT_STATUS_DIALOG_TITLE_ID}
                        variant="default"
                        confirmLabel="Reactivate"
                        cancelLabel="Cancel"
                        pending={mutation.isPending}
                        message="Members regain access and timers may resume. No project data has been lost."
                        onConfirm={handleConfirm}
                        onCancel={() => setConfirmOpen(false)}
                    />
                </>
            )}
        </section>
    );
}
