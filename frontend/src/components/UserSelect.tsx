import { UserCircle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { useUsers } from '@/hooks/useUsers';

interface UserSelectProps {
    value: string | null;
    onChange: (userId: string | null) => void;
    /** F44: when true, render only the select (label + icon supplied by the
     *  surrounding <Field>). */
    hideLabel?: boolean;
}

export function UserSelect({ value, onChange, hideLabel = false }: UserSelectProps) {
    const { data: users, isLoading } = useUsers();

    const select = (
        <Select
            value={value ?? ''}
            onValueChange={(v) => onChange(v === '' ? null : v)}
        >
            <SelectTrigger aria-label="Assignee" className="w-full" disabled={isLoading}>
                <SelectValue placeholder="Unassigned">
                    {value ? users?.find((u) => u.id === value)?.fullName ?? '' : ''}
                </SelectValue>
            </SelectTrigger>
            <SelectContent searchable>
                <SelectItem value="" textValue="Unassigned" />
                {users?.map((u) => (
                    <SelectItem key={u.id} value={u.id} textValue={u.fullName} />
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
