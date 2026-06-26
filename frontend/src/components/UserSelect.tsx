import { UserCircle } from 'lucide-react';
import { useUsers } from '@/hooks/useUsers';

interface UserSelectProps {
    value: string | null;
    onChange: (userId: string | null) => void;
    /** F44: when true, render only the <select> (label + icon supplied by the
     *  surrounding <Field>). */
    hideLabel?: boolean;
}

export function UserSelect({ value, onChange, hideLabel = false }: UserSelectProps) {
    const { data: users, isLoading } = useUsers();

    const select = (
        <select
            aria-label="Assignee"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
            className="w-full rounded border border-gray-300 p-2"
            disabled={isLoading}
        >
            <option value="">Unassigned</option>
            {users?.map((u) => (
                <option key={u.id} value={u.id}>
                    {u.fullName}
                </option>
            ))}
        </select>
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
