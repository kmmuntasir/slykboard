import { UserCircle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { useProjectMembers } from '@/hooks/useProjectMembers';

interface UserSelectProps {
    value: string | null;
    onChange: (userId: string | null) => void;
    /** Project slug — sources the assignee options from the project roster
     *  (GET /projects/:slug/members) instead of the workspace-wide admin
     *  /users endpoint, which 403s for non-admins. */
    projectSlug: string;
    /** F44: when true, render only the select (label + icon supplied by the
     *  surrounding <Field>). */
    hideLabel?: boolean;
}

export function UserSelect({ value, onChange, projectSlug, hideLabel = false }: UserSelectProps) {
    const { data: members, isLoading } = useProjectMembers(projectSlug);

    const select = (
        <Select
            value={value ?? ''}
            onValueChange={(v) => onChange(v === '' ? null : v)}
        >
            <SelectTrigger aria-label="Assignee" className="w-full" disabled={isLoading}>
                <SelectValue placeholder="Unassigned">
                    {value ? members?.find((m) => m.userId === value)?.fullName ?? '' : ''}
                </SelectValue>
            </SelectTrigger>
            <SelectContent searchable>
                <SelectItem value="" textValue="Unassigned" />
                {members?.map((m) => (
                    <SelectItem key={m.userId} value={m.userId} textValue={m.fullName} />
                ))}
            </SelectContent>
        </Select>
    );

    if (hideLabel) return select;

    return (
        <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                <UserCircle size={14} /> Assignee
            </span>
            {select}
        </label>
    );
}
