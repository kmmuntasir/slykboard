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
        <div className="mt-4 border-t border-border pt-4">
            <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-foreground">Time Tracking</h3>
                <span className="text-sm text-muted-foreground">
                    Total: <span className="font-mono tabular-nums">{formatDuration(totalMs)}</span>
                </span>
            </div>
            {isLoading && <p className="text-sm text-muted-foreground">Loading time entries…</p>}
            {isError && <p className="text-sm text-destructive">Failed to load time entries.</p>}
            {!isLoading && !isError && entries.length === 0 && (
                <p className="text-sm text-muted-foreground">No time tracked yet.</p>
            )}
            {entries.length > 0 && (
                <ul className="divide-y divide-border">
                    {entries.map((entry) => (
                        <li key={entry.id} className="py-2">
                            <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                                {entry.user?.avatarUrl && (
                                    <img src={entry.user.avatarUrl} alt="" className="h-4 w-4 rounded-full" />
                                )}
                                {entry.user?.fullName ?? 'Unknown user'}
                            </div>
                            {entry.type === 'manual' ? (
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 text-sm">
                                        <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                                            Manual
                                        </span>
                                        <span className="text-foreground">
                                            <span className="text-muted-foreground">Logged: </span>
                                            {formatDate(entry.startTime)}
                                        </span>
                                    </div>
                                    <span className="font-mono tabular-nums text-sm text-foreground">
                                        {formatDuration(entry.durationMs ?? 0)}
                                    </span>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex flex-col gap-0.5 text-sm">
                                        <span className="text-foreground">
                                            <span className="text-muted-foreground">Start: </span>
                                            {formatDate(entry.startTime)}
                                        </span>
                                        <span className="text-foreground">
                                            <span className="text-muted-foreground">End: </span>
                                            {entry.endTime
                                                ? formatDate(entry.endTime)
                                                : 'Running'}
                                        </span>
                                    </div>
                                    <span className="font-mono tabular-nums text-sm text-foreground">
                                        {entry.durationMs !== null
                                            ? formatDuration(entry.durationMs)
                                            : 'Running'}
                                    </span>
                                </div>
                            )}
                            {entry.description && (
                                <div className="mt-1 text-sm text-muted-foreground">
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
