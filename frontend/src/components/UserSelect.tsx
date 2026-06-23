import { useUsers } from '@/hooks/useUsers';

interface UserSelectProps {
    value: string | null;
    onChange: (userId: string | null) => void;
}

export function UserSelect({ value, onChange }: UserSelectProps) {
    const { data: users, isLoading } = useUsers();
    return (
        <label className="block">
            <span className="mb-1 block text-sm font-medium">Assignee</span>
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
        </label>
    );
}
