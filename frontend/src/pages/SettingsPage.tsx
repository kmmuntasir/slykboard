import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AssigneeAvatar } from '@/components/AssigneeAvatar';
import { Modal } from '@/components/Modal';
import { fetchUsers, type WorkspaceUser } from '@/api/users';
import { useUpdatePlatformAdmin, useSetUserBlocked } from '@/hooks/useUserManagement';
import { useAuthStore } from '@/stores/useAuthStore';
import { ApiClientError } from '@/api/client';

type ConfirmAction = 'promote' | 'demote' | 'deactivate' | 'reactivate';

interface ConfirmTarget {
    userId: string;
    fullName: string;
    action: ConfirmAction;
}

// F25: admin user management. Lists every workspace user with role + status
// badges and per-row Promote/Demote + Activate/Deactivate actions. The route is
// gated by RequirePlatformAdmin, so only platform admins reach this page. The "only admin"
// demote hint is client-side courtesy; the server enforces the real guard.
export function SettingsPage() {
    const currentUser = useAuthStore((s) => s.user);
    const {
        data: users,
        isLoading,
        isError,
    } = useQuery({
        queryKey: ['users'],
        queryFn: fetchUsers,
    });

    const roleMutation = useUpdatePlatformAdmin();
    const blockMutation = useSetUserBlocked();

    // F25: confirmation gate for the deactivation/reactivation mutation. The row
    // button only stages a target; the modal's Confirm button fires the mutation.
    const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);

    const handleConfirm = (target: ConfirmTarget) => {
        if (target.action === 'promote' || target.action === 'demote') {
            roleMutation.mutate(
                {
                    userId: target.userId,
                    isPlatformAdmin: target.action === 'promote',
                },
                { onSuccess: () => setConfirmTarget(null) },
            );
        } else {
            blockMutation.mutate(
                { userId: target.userId, blocked: target.action === 'deactivate' },
                { onSuccess: () => setConfirmTarget(null) },
            );
        }
    };

    const roster = users ?? [];
    // Client hint: disable self-demote when you are the only admin. Server still
    // enforces the real last-admin guard.
    const adminCount = roster.filter((u) => u.isPlatformAdmin).length;

    return (
        <div className="p-8">
            <h1 className="text-2xl font-semibold">Member Management</h1>

            {isLoading && <p className="mt-4 text-sm text-muted-foreground">Loading…</p>}
            {isError && <p className="mt-4 text-sm text-destructive">Failed to load users.</p>}
            {!isLoading && !isError && roster.length === 0 && (
                <p className="mt-4 text-sm text-muted-foreground">No users found.</p>
            )}
            {!isLoading && !isError && roster.length > 0 && (
                <div className="mt-4 overflow-hidden rounded-lg border border-border">
                    <table className="w-full text-sm">
                        <thead className="bg-muted text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            <tr>
                                <th scope="col" className="px-4 py-2.5">
                                    User
                                </th>
                                <th scope="col" className="px-4 py-2.5">
                                    Role
                                </th>
                                <th scope="col" className="px-4 py-2.5">
                                    Status
                                </th>
                                <th scope="col" className="px-4 py-2.5 text-right">
                                    Actions
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                            {roster.map((user) => (
                                <UserRow
                                    key={user.id}
                                    user={user}
                                    isSelf={user.id === currentUser?.id}
                                    isOnlyAdmin={user.isPlatformAdmin && adminCount <= 1}
                                    rolePending={roleMutation.isPending}
                                    blockPending={blockMutation.isPending}
                                    onRoleChange={(nextIsPlatformAdmin) =>
                                        setConfirmTarget({
                                            userId: user.id,
                                            fullName: user.fullName,
                                            action: nextIsPlatformAdmin ? 'promote' : 'demote',
                                        })
                                    }
                                    onBlockChange={(blocked) =>
                                        setConfirmTarget({
                                            userId: user.id,
                                            fullName: user.fullName,
                                            action: blocked ? 'deactivate' : 'reactivate',
                                        })
                                    }
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {confirmTarget && (
                <Modal
                    isOpen={true}
                    onClose={() => setConfirmTarget(null)}
                    titleId="confirm-action-title"
                    title={confirmTitle(confirmTarget)}
                >
                    <p className="text-sm text-muted-foreground">{confirmBody(confirmTarget)}</p>
                    {(roleMutation.error || blockMutation.error) && (
                        <p role="alert" className="text-sm text-destructive">
                            {roleMutation.error instanceof ApiClientError
                                ? roleMutation.error.message
                                : blockMutation.error instanceof ApiClientError
                                  ? blockMutation.error.message
                                  : 'Action failed — please try again.'}
                        </p>
                    )}
                    <div className="mt-6 flex justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => setConfirmTarget(null)}
                            disabled={roleMutation.isPending || blockMutation.isPending}
                            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => handleConfirm(confirmTarget)}
                            disabled={roleMutation.isPending || blockMutation.isPending}
                            className={confirmButtonClass(confirmTarget.action)}
                        >
                            {confirmButtonLabel(confirmTarget.action)}
                        </button>
                    </div>
                </Modal>
            )}
        </div>
    );
}

interface UserRowProps {
    user: WorkspaceUser;
    isSelf: boolean;
    isOnlyAdmin: boolean;
    rolePending: boolean;
    blockPending: boolean;
    onRoleChange: (nextIsPlatformAdmin: boolean) => void;
    onBlockChange: (blocked: boolean) => void;
}

function UserRow({
    user,
    isSelf,
    isOnlyAdmin,
    rolePending,
    blockPending,
    onRoleChange,
    onBlockChange,
}: UserRowProps) {
    const isAdmin = user.isPlatformAdmin;
    const isBlocked = user.blocked;
    const rowBusy = rolePending || blockPending;

    // Disable role-change button when it would demote the sole admin. Self-promote
    // of a MEMBER is always allowed; self-demote as the only admin is blocked.
    const roleDisabled = rowBusy || (isSelf && isOnlyAdmin) || isBlocked;

    return (
        <tr className="hover:bg-muted">
            <td className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                    <AssigneeAvatar
                        assignee={{
                            id: user.id,
                            fullName: user.fullName,
                            avatarUrl: user.avatarUrl,
                        }}
                    />
                    <div className="flex flex-col">
                        <span className="text-foreground">
                            {user.fullName}
                            {isSelf && (
                                <span className="ml-1 text-xs text-muted-foreground">(you)</span>
                            )}
                        </span>
                        <span className="text-xs text-muted-foreground">{user.email}</span>
                    </div>
                </div>
            </td>
            <td className="px-4 py-2.5">
                <RoleBadge isPlatformAdmin={user.isPlatformAdmin} />
            </td>
            <td className="px-4 py-2.5">
                <StatusBadge blocked={user.blocked} />
            </td>
            <td className="px-4 py-2.5">
                <div className="flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={() => onRoleChange(!isAdmin)}
                        disabled={roleDisabled}
                        title={
                            isSelf && isOnlyAdmin
                                ? 'You are the only admin — promote another member first.'
                                : undefined
                        }
                        className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                        {isAdmin ? 'Demote to Member' : 'Promote to Admin'}
                    </button>
                    <button
                        type="button"
                        onClick={() => onBlockChange(!isBlocked)}
                        disabled={rowBusy}
                        className={
                            isBlocked
                                ? 'rounded-md border border-success/50 px-2.5 py-1 text-xs text-success hover:bg-success/10 disabled:opacity-40'
                                : 'rounded-md border border-destructive/50 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40'
                        }
                    >
                        {isBlocked ? 'Reactivate' : 'Deactivate'}
                    </button>
                </div>
            </td>
        </tr>
    );
}

function confirmTitle(t: ConfirmTarget): string {
    switch (t.action) {
        case 'promote':
            return `Promote ${t.fullName} to Admin?`;
        case 'demote':
            return `Demote ${t.fullName} to Member?`;
        case 'deactivate':
            return `Deactivate ${t.fullName}?`;
        case 'reactivate':
            return `Reactivate ${t.fullName}?`;
    }
}

function confirmBody(t: ConfirmTarget): string {
    switch (t.action) {
        case 'promote':
            return 'This user will gain full admin privileges, including user management and project settings.';
        case 'demote':
            return 'This user will lose admin privileges and become a regular member.';
        case 'deactivate':
            return 'This user will no longer be able to log in.';
        case 'reactivate':
            return 'This user will be able to log in again.';
    }
}

function confirmButtonLabel(action: ConfirmAction): string {
    switch (action) {
        case 'promote':
            return 'Promote';
        case 'demote':
            return 'Demote';
        case 'deactivate':
            return 'Deactivate';
        case 'reactivate':
            return 'Reactivate';
    }
}

function confirmButtonClass(action: ConfirmAction): string {
    const base =
        'rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40';
    switch (action) {
        case 'promote':
            return `${base} bg-primary text-primary-foreground hover:bg-primary/90`;
        case 'demote':
            return `${base} bg-secondary text-secondary-foreground hover:bg-secondary/80`;
        case 'deactivate':
            return `${base} bg-destructive text-destructive-foreground hover:bg-destructive/90`;
        case 'reactivate':
            return `${base} bg-success text-success-foreground hover:bg-success/90`;
    }
}

function RoleBadge({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
    return isPlatformAdmin ? (
        <span className="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
            Admin
        </span>
    ) : (
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
            Member
        </span>
    );
}

function StatusBadge({ blocked }: { blocked: boolean }) {
    return blocked ? (
        <span className="inline-flex items-center rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
            Deactivated
        </span>
    ) : (
        <span className="inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success">
            Active
        </span>
    );
}
