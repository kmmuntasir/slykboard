import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { listLabels } from '@/api/labels';
import { labelKeys } from '@/api/queryKeys';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { useUsers } from '@/hooks/useUsers';
import { useBoardUiStore } from '@/stores/useBoardUiStore';
import type { Label } from '@/types/label';
import { PRIORITY_DISPLAY, type Priority } from '@/types/ticket';

// F26: board filter bar. Reads/writes filter state in useBoardUiStore; the
// useBoard hook reacts to those values and refires the board query with a
// server-side query string (search/assignee/priority/label).
//
// The search input uses LOCAL state + a 300ms debounce before pushing to the
// Zustand store. This prevents the store update → board refetch → re-render cycle
// from defocusing the input on every keystroke.

const SEARCH_DEBOUNCE_MS = 300;
const PRIORITIES = Object.keys(PRIORITY_DISPLAY) as Priority[];

/** Resolve a loose priority string (from the store) to its display label,
 *  or undefined when the value is unset/invalid (SelectValue falls back). */
function priorityLabel(value: string | null): string {
    if (value && (PRIORITIES as string[]).includes(value)) {
        return PRIORITY_DISPLAY[value as Priority];
    }
    return '';
}

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

            <Select
                value={assigneeFilter ?? ''}
                onValueChange={(v) => setAssigneeFilter(v === '' ? null : v)}
            >
                <SelectTrigger aria-label="Filter by assignee" className="text-sm">
                    <SelectValue placeholder="All assignees">
                        {assigneeFilter
                            ? users.find((u) => u.id === assigneeFilter)?.fullName ?? ''
                            : ''}
                    </SelectValue>
                </SelectTrigger>
                <SelectContent searchable>
                    <SelectItem value="" textValue="All assignees" />
                    {users.map((user) => (
                        <SelectItem key={user.id} value={user.id} textValue={user.fullName} />
                    ))}
                </SelectContent>
            </Select>

            <Select
                value={priorityFilter ?? ''}
                onValueChange={(v) => setPriorityFilter(v === '' ? null : v)}
            >
                <SelectTrigger aria-label="Filter by priority" className="text-sm">
                    <SelectValue placeholder="All priorities">
                        {priorityLabel(priorityFilter)}
                    </SelectValue>
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="" textValue="All priorities" />
                    {PRIORITIES.map((priority) => (
                        <SelectItem key={priority} value={priority} textValue={priority}>
                            {PRIORITY_DISPLAY[priority]}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

            <Select
                value={labelFilter ?? ''}
                onValueChange={(v) => setLabelFilter(v === '' ? null : v)}
            >
                <SelectTrigger aria-label="Filter by label" className="text-sm">
                    <SelectValue placeholder="All labels">
                        {labelFilter ? labels.find((l) => l.id === labelFilter)?.name ?? '' : ''}
                    </SelectValue>
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="" textValue="All labels" />
                    {labels.map((label) => (
                        <SelectItem key={label.id} value={label.id} textValue={label.name} />
                    ))}
                </SelectContent>
            </Select>

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
