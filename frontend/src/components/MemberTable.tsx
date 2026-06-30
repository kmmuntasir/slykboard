// SLYK-02 Task T5 — MemberTable primitive.
// Purpose-built presentational <table> for a project roster. PURE presentational:
// no mutations, no toasts, no confirms — it calls back; the owning page wires the
// hooks (useUpdateMemberRole / useRemoveMember) + ConfirmDialog. Replaces the
// legacy <ul>-of-cards layout in ProjectMembersPage.
import { Trash2 } from 'lucide-react';

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import type { Member, MemberRole } from '@/types/member';

export interface MemberTableProps {
    members: Member[];
    /** Platform Admin OR Project Admin — gates the role select + Remove button. */
    canManage: boolean;
    /** The current user's membership userId, for self-lock; undefined when not a real member. */
    currentUserId?: string;
    onRoleChange: (userId: string, role: MemberRole) => void;
    onRemove: (userId: string) => void;
}

const ROLE_OPTIONS: ReadonlyArray<{ value: MemberRole; label: string }> = [
    { value: 'MEMBER', label: 'Member' },
    { value: 'PROJECT_ADMIN', label: 'Project Admin' },
];

function roleBadgeVariant(role: MemberRole): 'default' | 'secondary' {
    return role === 'PROJECT_ADMIN' ? 'default' : 'secondary';
}

function roleLabel(role: MemberRole): string {
    return role === 'PROJECT_ADMIN' ? 'Project Admin' : 'Member';
}

export function MemberTable({
    members,
    canManage,
    currentUserId,
    onRoleChange,
    onRemove,
}: MemberTableProps) {
    // Empty roster → render nothing. The page owns the empty state.
    if (members.length === 0) {
        return null;
    }

    return (
        <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                    <tr>
                        <th scope="col" className="px-4 py-2 font-medium">
                            User
                        </th>
                        <th scope="col" className="px-4 py-2 font-medium">
                            Project Role
                        </th>
                        <th scope="col" className="px-4 py-2 font-medium">
                            Status
                        </th>
                        {canManage && (
                            <th scope="col" className="px-4 py-2 font-medium">
                                <span className="sr-only">Actions</span>
                            </th>
                        )}
                    </tr>
                </thead>
                <tbody>
                    {members.map((member) => {
                        const isSelf = member.userId === currentUserId;
                        // Self-lock: cannot demote self out of PROJECT_ADMIN
                        // (client-side footgun guard, preserves existing behavior).
                        const selfLockedAdmin = isSelf && member.role === 'PROJECT_ADMIN';
                        const primaryName =
                            (member.displayName ?? member.fullName) || member.email;
                        const avatarName =
                            member.displayName ?? member.fullName ?? member.email;

                        return (
                            <tr key={member.userId} className="border-t border-border">
                                <th scope="row" className="px-4 py-3 text-left align-middle">
                                    <div className="flex min-w-0 items-center gap-3">
                                        <Avatar
                                            size="sm"
                                            src={member.avatarUrl ?? undefined}
                                            name={avatarName}
                                        />
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="truncate font-medium text-foreground">
                                                    {primaryName}
                                                </span>
                                                {isSelf && (
                                                    <Badge variant="secondary">You</Badge>
                                                )}
                                            </div>
                                            <p className="truncate text-muted-foreground">
                                                {member.email}
                                            </p>
                                        </div>
                                    </div>
                                </th>
                                <td className="px-4 py-3 align-middle">
                                    {canManage ? (
                                        <Select
                                            value={member.role}
                                            onValueChange={(v) =>
                                                onRoleChange(member.userId, v as MemberRole)
                                            }
                                        >
                                            <SelectTrigger
                                                aria-label={`Role for ${member.email}`}
                                                className="py-1 text-sm"
                                                disabled={selfLockedAdmin}
                                            >
                                                <SelectValue placeholder="Role">
                                                    {roleLabel(member.role)}
                                                </SelectValue>
                                            </SelectTrigger>
                                            <SelectContent>
                                                {ROLE_OPTIONS.map((opt) => (
                                                    <SelectItem
                                                        key={opt.value}
                                                        value={opt.value}
                                                        textValue={opt.label}
                                                    />
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <Badge variant={roleBadgeVariant(member.role)}>
                                            {roleLabel(member.role)}
                                        </Badge>
                                    )}
                                </td>
                                <td className="px-4 py-3 align-middle">
                                    {/* TODO(SLYK-02): surface users.blocked when Member gains the field.
                                        v1 derives Active for every roster row (a row exists ⇒ active). */}
                                    <Badge variant="secondary">Active</Badge>
                                </td>
                                {canManage && (
                                    <td className="whitespace-nowrap px-4 py-3 text-right align-middle">
                                        <Button
                                            variant="destructive"
                                            size="sm"
                                            aria-label={`Remove ${member.email}`}
                                            disabled={isSelf}
                                            onClick={() => onRemove(member.userId)}
                                        >
                                            <Trash2
                                                className="h-4 w-4"
                                                aria-hidden="true"
                                            />
                                        </Button>
                                    </td>
                                )}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}
