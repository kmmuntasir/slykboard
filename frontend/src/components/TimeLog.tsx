import { useQuery } from '@tanstack/react-query';

import { fetchTimeEntries } from '@/api/timer';
import { timerKeys } from '@/api/queryKeys';
import { formatDate } from '@/utils/formatDate';
import { formatDuration } from '@/utils/formatDuration';

// F20: time-tracking log. Like ActivityFeed but for TimeEntries — renders the
// full reverse-chrono list (start, end, duration) plus a total of closed
// durations. The running entry is shown with "Running" in place of an end time
// and is excluded from the total (its elapsed time is still accruing).
interface TimeLogProps {
    ticketId: string;
}

export function TimeLog({ ticketId }: TimeLogProps) {
    const { data, isLoading, isError } = useQuery({
        queryKey: timerKeys.entries(ticketId),
        queryFn: () => fetchTimeEntries(ticketId),
    });

    const entries = data?.entries ?? [];
    const totalMs = data?.totalMs ?? 0;

    return (
        <div className="mt-4 border-t border-gray-200 pt-4">
            <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-gray-700">Time Tracking</h3>
                <span className="text-sm text-gray-500">
                    Total: <span className="font-mono tabular-nums">{formatDuration(totalMs)}</span>
                </span>
            </div>
            {isLoading && <p className="text-sm text-gray-500">Loading time entries…</p>}
            {isError && <p className="text-sm text-red-600">Failed to load time entries.</p>}
            {!isLoading && !isError && entries.length === 0 && (
                <p className="text-sm text-gray-500">No time tracked yet.</p>
            )}
            {entries.length > 0 && (
                <ul className="divide-y divide-gray-100">
                    {entries.map((entry) => (
                        <li key={entry.id} className="py-2">
                            <div className="flex items-baseline justify-between gap-2">
                                <span className="text-sm text-gray-700">
                                    {formatDate(entry.startTime)}
                                </span>
                                <span className="font-mono tabular-nums text-sm text-gray-700">
                                    {entry.durationMs !== null
                                        ? formatDuration(entry.durationMs)
                                        : 'Running'}
                                </span>
                            </div>
                            <div className="text-xs text-gray-500">
                                {entry.endTime ? formatDate(entry.endTime) : 'Running'}
                            </div>
                            {entry.description && (
                                <div className="mt-1 text-sm text-gray-600">
                                    {entry.description}
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
