// SLYK-02 Task T7 — project member-management page at /projects/:slug/members.
//
// Thin assembly layer over the SLYK-02 shared primitives: heading, live search,
// <MemberTable>, the top-right "Add Member" button → <AddMemberModal>, and
// confirm-gated removal via <ConfirmDialog variant="destructive">. The legacy
// inline <AddMemberSection> (two-mode toggle forms) is gone — the modal now owns
// all add flows. Management controls are gated on (Platform Admin OR Project
// Admin); a plain Member sees a read-only roster (<MemberTable> renders a role
// Badge instead of a select and no Remove button). Non-member denial arrives as
// a project-scoped BE 403 and is centralized in apiFetch (bounce to /projects).
import { useMemo, useState } from 'react';
import { Navigate, useParams } from 'react-router';
import { ArrowLeft, Search, UserPlus } from 'lucide-react';

import { ApiClientError } from '@/api/client';
import { AddMemberModal } from '@/components/AddMemberModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { MemberTable } from '@/components/MemberTable';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Retry } from '@/components/Retry';
import { SkeletonLine } from '@/components/Skeleton';
import { TextInput } from '@/components/ui/TextInput';
import { useRequirePlatformAdmin } from '@/hooks/useRequirePlatformAdmin';
import {
    useProjectMembers,
    useUpdateMemberRole,
    useRemoveMember,
    useCurrentProjectMembership,
} from '@/hooks/useProjectMembers';
import { useToast } from '@/hooks/useToast';
import type { MemberRole } from '@/types/member';

const REMOVE_DIALOG_TITLE_ID = 'remove-member-title';

export function ProjectMembersPage() {
    const { slug } = useParams<{ slug: string }>();

    if (!slug) {
        return <Navigate to="/projects" replace />;
    }

    return <MembersBody slug={slug} />;
}

interface MembersBodyProps {
    slug: string;
}

function MembersBody({ slug }: MembersBodyProps) {
    const { data: members, isLoading, error, refetch } = useProjectMembers(slug);
    const isPlatformAdmin = useRequirePlatformAdmin();
    const { isProjectAdmin, membership } = useCurrentProjectMembership(slug);
    const updateRole = useUpdateMemberRole(slug);
    const remove = useRemoveMember(slug);
    const toast = useToast();

    // Management gate: Platform Admin OR Project Admin. A Platform Admin who is
    // not a real member (membership === undefined) still manages via the bypass.
    const canManage = isPlatformAdmin || isProjectAdmin;
    const currentUserId = membership?.userId;

    // Live search — case-insensitive partial match on fullName/displayName/email.
    const [query, setQuery] = useState('');
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return members ?? [];
        return (members ?? []).filter((m) => {
            const name = (m.fullName ?? '').toLowerCase();
            const display = (m.displayName ?? '').toLowerCase();
            const email = m.email.toLowerCase();
            return name.includes(q) || display.includes(q) || email.includes(q);
        });
    }, [members, query]);

    // Add-member modal trigger.
    const [addOpen, setAddOpen] = useState(false);

    // Confirm-gated removal. The row's Remove action (from <MemberTable>) only
    // opens this dialog; the delete fires on confirm. The previous immediate-
    // remove path is gone.
    const [removeTarget, setRemoveTarget] = useState<{ userId: string; email: string } | null>(
        null,
    );

    const handleRoleChange = async (userId: string, role: MemberRole) => {
        const current = members?.find((m) => m.userId === userId);
        if (current?.role === role) return;
        try {
            await updateRole.mutateAsync({ userId, role });
            toast.success('Role updated.');
        } catch (err) {
            toast.error(toMessage(err));
        }
    };

    const confirmRemove = async (userId: string) => {
        try {
            await remove.mutateAsync(userId);
            toast.success('Member removed.');
            setRemoveTarget(null);
        } catch (err) {
            toast.error(toMessage(err));
        }
    };

    if (isLoading) {
        return (
            <div className="mx-auto max-w-3xl space-y-3 p-4">
                <SkeletonLine className="h-6 w-48" />
                <SkeletonLine className="h-16 w-full" />
                <SkeletonLine className="h-16 w-full" />
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

    return (
        <div className="mx-auto max-w-3xl space-y-6 p-4">
            <header className="flex flex-wrap items-center gap-3">
                <a
                    href={`/projects/${slug}/settings`}
                    className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                    Settings
                </a>
                <h1 className="flex-1 text-2xl font-semibold">Member Management</h1>
                {canManage && (
                    <Button
                        type="button"
                        size="sm"
                        onClick={() => setAddOpen(true)}
                        aria-label="Add Member"
                    >
                        <UserPlus className="mr-1 h-4 w-4" aria-hidden="true" />
                        Add Member
                    </Button>
                )}
            </header>

            <section className="space-y-3">
                <div className="relative">
                    <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                    />
                    <TextInput
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        aria-label="Search members"
                        placeholder="Search by name or email"
                        className="w-full pl-9"
                    />
                </div>

                {members && members.length === 0 ? (
                    <Card className="p-4 text-sm text-muted-foreground">No members yet.</Card>
                ) : filtered.length === 0 ? (
                    <Card className="p-4 text-sm text-muted-foreground">
                        No members match &ldquo;{query}&rdquo;.
                    </Card>
                ) : (
                    <MemberTable
                        members={filtered}
                        canManage={canManage}
                        currentUserId={currentUserId}
                        onRoleChange={(userId, role) => void handleRoleChange(userId, role)}
                        onRemove={(userId) => {
                            const target = members?.find((m) => m.userId === userId);
                            if (target) {
                                setRemoveTarget({ userId, email: target.email });
                            }
                        }}
                    />
                )}
            </section>

            {canManage && (
                <AddMemberModal
                    slug={slug}
                    isOpen={addOpen}
                    onClose={() => setAddOpen(false)}
                />
            )}

            <ConfirmDialog
                isOpen={removeTarget !== null}
                title="Remove member?"
                titleId={REMOVE_DIALOG_TITLE_ID}
                variant="destructive"
                confirmLabel="Remove"
                cancelLabel="Cancel"
                pending={remove.isPending}
                message={
                    removeTarget
                        ? `Remove ${removeTarget.email} from this project? They will lose access immediately.`
                        : null
                }
                onConfirm={() => {
                    if (removeTarget) {
                        void confirmRemove(removeTarget.userId);
                    }
                }}
                onCancel={() => setRemoveTarget(null)}
            />
        </div>
    );
}

function toMessage(err: unknown): string {
    return err instanceof ApiClientError ? err.message : 'Something went wrong.';
}
