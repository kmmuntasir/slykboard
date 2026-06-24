import { useQuery } from '@tanstack/react-query';

import { listLabels } from '@/api/labels';
import { labelKeys } from '@/api/queryKeys';
import { useUsers } from '@/hooks/useUsers';
import { useBoardUiStore } from '@/stores/useBoardUiStore';
import type { Label } from '@/types/label';

// F26: board filter bar. Reads/writes filter state in useBoardUiStore; the
// useBoard hook reacts to those values and refires the board query with a
// server-side query string (search/assignee/priority/label).

const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL'] as const;

interface BoardFiltersProps {
    slug: string;
}

export function BoardFilters({ slug }: BoardFiltersProps) {
    const {
        searchQuery,
        assigneeFilter,
        priorityFilter,
        labelFilter,
        setSearchQuery,
        setAssigneeFilter,
        setPriorityFilter,
        setLabelFilter,
        clearFilters,
    } = useBoardUiStore();

    const { data: users = [] } = useUsers();
    const { data: labels = [] } = useQuery<Label[]>({
        queryKey: labelKeys.forProject(slug),
        queryFn: () => listLabels(slug),
    });

    return (
        <div className="flex flex-wrap items-center gap-3">
            <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tickets…"
                aria-label="Search tickets"
                className="min-w-[14rem] flex-1 rounded border border-gray-300 p-2 text-sm"
            />

            <select
                value={assigneeFilter ?? ''}
                onChange={(e) => setAssigneeFilter(e.target.value || null)}
                aria-label="Filter by assignee"
                className="rounded border border-gray-300 p-2 text-sm"
            >
                <option value="">All assignees</option>
                {users.map((user) => (
                    <option key={user.id} value={user.id}>
                        {user.fullName}
                    </option>
                ))}
            </select>

            <select
                value={priorityFilter ?? ''}
                onChange={(e) => setPriorityFilter(e.target.value || null)}
                aria-label="Filter by priority"
                className="rounded border border-gray-300 p-2 text-sm"
            >
                <option value="">All priorities</option>
                {PRIORITY_OPTIONS.map((priority) => (
                    <option key={priority} value={priority}>
                        {priority}
                    </option>
                ))}
            </select>

            <select
                value={labelFilter ?? ''}
                onChange={(e) => setLabelFilter(e.target.value || null)}
                aria-label="Filter by label"
                className="rounded border border-gray-300 p-2 text-sm"
            >
                <option value="">All labels</option>
                {labels.map((label) => (
                    <option key={label.id} value={label.id}>
                        {label.name}
                    </option>
                ))}
            </select>

            <button
                type="button"
                onClick={clearFilters}
                className="rounded border bg-background px-4 py-2 text-sm hover:bg-secondary"
            >
                Clear
            </button>
        </div>
    );
}
