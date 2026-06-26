import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { listLabels } from '@/api/labels';
import { labelKeys } from '@/api/queryKeys';
import { useUsers } from '@/hooks/useUsers';
import { useBoardUiStore } from '@/stores/useBoardUiStore';
import type { Label } from '@/types/label';

// F26: board filter bar. Reads/writes filter state in useBoardUiStore; the
// useBoard hook reacts to those values and refires the board query with a
// server-side query string (search/assignee/priority/label).
//
// The search input uses LOCAL state + a 300ms debounce before pushing to the
// Zustand store. This prevents the store update → board refetch → re-render cycle
// from defocusing the input on every keystroke.

const SEARCH_DEBOUNCE_MS = 300;
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

    // Local state for the search input — prevents re-render/defocus on each keystroke.
    const [localSearch, setLocalSearch] = useState(searchQuery);

    // Debounce-push to the store so useBoard refetches only after typing pauses.
    useEffect(() => {
        const timer = setTimeout(() => {
            if (localSearch !== searchQuery) {
                setSearchQuery(localSearch);
            }
        }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [localSearch, searchQuery, setSearchQuery]);

    // Sync local state when the store is cleared externally (Clear button).
    const handleClear = () => {
        setLocalSearch('');
        clearFilters();
    };

    const { data: users = [] } = useUsers();
    const { data: labels = [] } = useQuery<Label[]>({
        queryKey: labelKeys.forProject(slug),
        queryFn: () => listLabels(slug),
    });

    return (
        <div className="flex flex-wrap items-center gap-3">
            <input
                type="text"
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                placeholder="Search tickets…"
                aria-label="Search tickets"
                className="min-w-[14rem] flex-1 rounded border border-border p-2 text-sm"
            />

            <select
                value={assigneeFilter ?? ''}
                onChange={(e) => setAssigneeFilter(e.target.value || null)}
                aria-label="Filter by assignee"
                className="rounded border border-border p-2 text-sm"
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
                className="rounded border border-border p-2 text-sm"
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
                className="rounded border border-border p-2 text-sm"
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
                onClick={handleClear}
                className="rounded border bg-background px-4 py-2 text-sm hover:bg-secondary"
            >
                Clear
            </button>
        </div>
    );
}
