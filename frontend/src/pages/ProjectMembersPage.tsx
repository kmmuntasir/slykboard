// SLYK-01 Task N — project member-management page at /projects/:slug/members.
// Lists the roster with role badges. Management controls (add an existing user
// by email/id, create a brand-new user, promote/demote, remove) are gated on
// (Platform Admin OR Project Admin); a plain Member sees a read-only roster.
// Non-member denial arrives as a project-scoped BE 403 and is centralized in
// apiFetch (bounce to /projects). Other FORBIDDENs (wrong-domain email on
// create) carry a different message and surface inline here.
import { useState } from 'react';
import { Navigate, useParams } from 'react-router';
import { ArrowLeft, Mail, Trash2, UserPlus } from 'lucide-react';

import { ApiClientError } from '@/api/client';
import { AssigneeAvatar } from '@/components/AssigneeAvatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Retry } from '@/components/Retry';
import { SkeletonLine } from '@/components/Skeleton';
import { useRequirePlatformAdmin } from '@/hooks/useRequirePlatformAdmin';
import {
    useProjectMembers,
    useAddMember,
    useCreateAndAddMember,
    useUpdateMemberRole,
    useRemoveMember,
    useCurrentProjectMembership,
} from '@/hooks/useProjectMembers';
import { useToast } from '@/hooks/useToast';
import type { Member, MemberRole } from '@/types/member';

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

    // Management gate: Platform Admin OR Project Admin. A Platform Admin who is
    // not a real member (membership === undefined) still manages via the bypass.
    const canManage = isPlatformAdmin || isProjectAdmin;
    const currentUserId = membership?.userId;

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
            <header className="flex items-center gap-3">
                <a
                    href={`/projects/${slug}/settings`}
                    className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                    Settings
                </a>
                <h1 className="text-2xl font-semibold">Members</h1>
            </header>

            {canManage && (
                <AddMemberSection slug={slug} />
            )}

            <section className="space-y-3">
                <h2 className="text-lg font-semibold">Roster</h2>
                {members && members.length === 0 ? (
                    <Card className="p-4 text-sm text-muted-foreground">
                        No members yet.
                    </Card>
                ) : (
                    <ul className="space-y-2">
                        {members?.map((member) => (
                            <li key={member.userId}>
                                <MemberRow
                                    member={member}
                                    slug={slug}
                                    canManage={canManage}
                                    isSelf={member.userId === currentUserId}
                                />
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

// --- Add-member section ------------------------------------------------------

interface AddMemberSectionProps {
    slug: string;
}

type AddMode = 'existing' | 'new';

function AddMemberSection({ slug }: AddMemberSectionProps) {
    const [mode, setMode] = useState<AddMode>('existing');
    const addMember = useAddMember(slug);
    const createMember = useCreateAndAddMember(slug);
    const toast = useToast();

    return (
        <Card className="space-y-4 p-4">
            <div className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-lg font-semibold">Add member</h2>
            </div>

            <div className="inline-flex rounded-md" role="group" aria-label="Add member mode">
                <Button
                    variant={mode === 'existing' ? 'primary' : 'outline'}
                    size="sm"
                    aria-pressed={mode === 'existing'}
                    onClick={() => setMode('existing')}
                    className="rounded-r-none"
                >
                    Existing user
                </Button>
                <Button
                    variant={mode === 'new' ? 'primary' : 'outline'}
                    size="sm"
                    aria-pressed={mode === 'new'}
                    onClick={() => setMode('new')}
                    className="rounded-l-none"
                >
                    New user
                </Button>
            </div>

            {mode === 'existing' ? (
                <AddExistingForm
                    pending={addMember.isPending}
                    onSubmit={async (email, role) => {
                        try {
                            await addMember.mutateAsync({ email, role });
                            toast.success('Member added.');
                        } catch (err) {
                            toast.error(toMessage(err));
                        }
                    }}
                />
            ) : (
                <CreateNewForm
                    pending={createMember.isPending}
                    onSubmit={async (body) => {
                        try {
                            await createMember.mutateAsync(body);
                            toast.success('Member created and added.');
                        } catch (err) {
                            // Wrong-domain email surfaces a non-redirect FORBIDDEN
                            // here (different message → not caught by the central
                            // handler) — show it inline.
                            toast.error(toMessage(err));
                        }
                    }}
                />
            )}
        </Card>
    );
}

interface AddExistingFormProps {
    pending: boolean;
    onSubmit: (email: string, role: MemberRole) => Promise<void>;
}

function AddExistingForm({ pending, onSubmit }: AddExistingFormProps) {
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<MemberRole>('MEMBER');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = email.trim();
        if (!trimmed) return;
        await onSubmit(trimmed, role);
        setEmail('');
        setRole('MEMBER');
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <input
                    aria-label="Existing user email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="existing.user@example.com"
                    className="block w-full rounded border border-border px-2 py-1"
                />
            </div>
            <RoleSelect
                aria-label="New member role"
                value={role}
                onChange={setRole}
                disabled={false}
                disabledSelfAdmin={false}
            />
            <Button type="submit" size="sm" disabled={pending || !email.trim()}>
                {pending ? 'Adding…' : 'Add existing'}
            </Button>
        </form>
    );
}

interface CreateNewFormProps {
    pending: boolean;
    onSubmit: (body: {
        email: string;
        fullName?: string;
        displayName?: string | null;
        role?: MemberRole;
    }) => Promise<void>;
}

function CreateNewForm({ pending, onSubmit }: CreateNewFormProps) {
    const [email, setEmail] = useState('');
    const [fullName, setFullName] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [role, setRole] = useState<MemberRole>('MEMBER');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmedEmail = email.trim();
        if (!trimmedEmail) return;
        await onSubmit({
            email: trimmedEmail,
            fullName: fullName.trim() || undefined,
            displayName: displayName.trim() || undefined,
            role,
        });
        setEmail('');
        setFullName('');
        setDisplayName('');
        setRole('MEMBER');
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-3">
            <input
                aria-label="New user email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="new.user@example.com"
                className="block w-full rounded border border-border px-2 py-1"
            />
            <input
                aria-label="Full name (optional)"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Full name (optional)"
                className="block w-full rounded border border-border px-2 py-1"
            />
            <input
                aria-label="Display name (optional)"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Display name (optional)"
                className="block w-full rounded border border-border px-2 py-1"
            />
            <RoleSelect
                aria-label="New user role"
                value={role}
                onChange={setRole}
                disabled={false}
                disabledSelfAdmin={false}
            />
            <Button type="submit" size="sm" disabled={pending || !email.trim()}>
                {pending ? 'Creating…' : 'Create & add'}
            </Button>
        </form>
    );
}

// --- Roster row --------------------------------------------------------------

interface MemberRowProps {
    member: Member;
    slug: string;
    canManage: boolean;
    isSelf: boolean;
}

function MemberRow({ member, slug, canManage, isSelf }: MemberRowProps) {
    const updateRole = useUpdateMemberRole(slug);
    const remove = useRemoveMember(slug);
    const toast = useToast();

    const handleRoleChange = async (role: MemberRole) => {
        if (role === member.role) return;
        try {
            await updateRole.mutateAsync({ userId: member.userId, role });
            toast.success('Role updated.');
        } catch (err) {
            toast.error(toMessage(err));
        }
    };

    const handleRemove = async () => {
        try {
            await remove.mutateAsync(member.userId);
            toast.success('Member removed.');
        } catch (err) {
            toast.error(toMessage(err));
        }
    };

    return (
        <Card className="flex flex-wrap items-center gap-3 p-4">
            <AssigneeAvatar
                assignee={{
                    id: member.userId,
                    fullName: member.displayName ?? member.fullName,
                    avatarUrl: member.avatarUrl,
                }}
            />
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-foreground">
                        {(member.displayName ?? member.fullName) || member.email}
                    </span>
                    {isSelf && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                            You
                        </span>
                    )}
                </div>
                <p className="truncate text-sm text-muted-foreground">{member.email}</p>
            </div>

            {canManage ? (
                <div className="flex items-center gap-2">
                    <RoleSelect
                        aria-label={`Role for ${member.email}`}
                        value={member.role}
                        onChange={handleRoleChange}
                        disabled={updateRole.isPending || isSelf}
                        disabledSelfAdmin={isSelf}
                    />
                    <Button
                        variant="destructive"
                        size="sm"
                        onClick={handleRemove}
                        disabled={remove.isPending || isSelf}
                        aria-label={`Remove ${member.email}`}
                    >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                </div>
            ) : (
                <RoleBadge role={member.role} />
            )}
        </Card>
    );
}

// --- Shared bits -------------------------------------------------------------

interface RoleSelectProps {
    'aria-label': string;
    value: MemberRole;
    onChange: (role: MemberRole) => void;
    disabled: boolean;
    // When true and the current value is PROJECT_ADMIN, the control is locked —
    // prevents a user demoting themselves out of admin (client-side footgun guard).
    disabledSelfAdmin: boolean;
}

function RoleSelect({
    'aria-label': ariaLabel,
    value,
    onChange,
    disabled,
    disabledSelfAdmin,
}: RoleSelectProps) {
    // disabledSelfAdmin gates only the self row when it currently holds
    // PROJECT_ADMIN so the user cannot demote themselves out of admin.
    const selfLocked = disabledSelfAdmin && value === 'PROJECT_ADMIN';
    return (
        <select
            aria-label={ariaLabel}
            value={value}
            disabled={disabled || selfLocked}
            onChange={(e) => onChange(e.target.value as MemberRole)}
            className="rounded border border-border bg-background px-2 py-1 text-sm disabled:opacity-50"
        >
            <option value="MEMBER">Member</option>
            <option value="PROJECT_ADMIN">Project Admin</option>
        </select>
    );
}

function RoleBadge({ role }: { role: MemberRole }) {
    const classes =
        role === 'PROJECT_ADMIN'
            ? 'bg-primary/10 text-primary'
            : 'bg-muted text-muted-foreground';
    const label = role === 'PROJECT_ADMIN' ? 'Project Admin' : 'Member';
    return (
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${classes}`}>{label}</span>
    );
}

function toMessage(err: unknown): string {
    return err instanceof ApiClientError ? err.message : 'Something went wrong.';
}
