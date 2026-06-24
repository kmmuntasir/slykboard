import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchTicketActivity } from '@/api/tickets';
import { ticketKeys } from '@/api/queryKeys';
import { ActivityItem } from './ActivityItem';

// F19: client-side show-more. Backend caps at 50; FE renders the first
// INITIAL_FEED_VISIBLE then a "Show N more" toggle.
const INITIAL_FEED_VISIBLE = 5;

interface ActivityFeedProps {
    ticketId: string;
}

export function ActivityFeed({ ticketId }: ActivityFeedProps) {
    const [expanded, setExpanded] = useState(false);
    const { data, isLoading, isError } = useQuery({
        queryKey: ticketKeys.activity(ticketId),
        queryFn: () => fetchTicketActivity(ticketId),
    });

    const entries = data?.entries ?? [];
    const visible = expanded ? entries : entries.slice(0, INITIAL_FEED_VISIBLE);
    const hiddenCount = entries.length - INITIAL_FEED_VISIBLE;

    return (
        <div className="mt-4 border-t border-gray-200 pt-4">
            <h3 className="mb-2 text-sm font-semibold text-gray-700">Activity</h3>
            {isLoading && <p className="text-sm text-gray-500">Loading activity…</p>}
            {isError && <p className="text-sm text-red-600">Failed to load activity.</p>}
            {!isLoading && !isError && entries.length === 0 && (
                <p className="text-sm text-gray-500">No activity yet.</p>
            )}
            {entries.length > 0 && (
                <ul className="divide-y divide-gray-100">
                    {visible.map((entry) => (
                        <ActivityItem key={entry.id} entry={entry} />
                    ))}
                </ul>
            )}
            {!expanded && hiddenCount > 0 && (
                <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="mt-2 text-sm text-blue-600 hover:underline"
                >
                    Show {hiddenCount} more
                </button>
            )}
        </div>
    );
}
