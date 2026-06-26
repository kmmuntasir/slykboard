import type { ActivityEntry } from '@/types/activity';
import { actorLabel, describeActivity } from '@/utils/describeActivity';
import { formatRelativeTime } from '@/utils/formatRelativeTime';
import { formatDate } from '@/utils/formatDate';

// F19: one enriched activity row. Actor avatar+name, sentence clause,
// relative time primary + absolute locale time in a title tooltip.
interface ActivityItemProps {
    entry: ActivityEntry;
}

export function ActivityItem({ entry }: ActivityItemProps) {
    const { clause } = describeActivity(entry);
    const name = actorLabel(entry);
    const absolute = formatDate(entry.createdAt);

    return (
        <li className="flex gap-3 py-2">
            {entry.actor?.avatarUrl ? (
                <img src={entry.actor.avatarUrl} alt={name} className="h-7 w-7 rounded-full" />
            ) : (
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
                    {name.charAt(0)}
                </div>
            )}
            <div className="min-w-0 flex-1">
                <p className="text-sm text-foreground">
                    <span className="font-medium">{name}</span> {clause}
                </p>
                <p className="text-xs text-muted-foreground" title={absolute}>
                    {formatRelativeTime(entry.createdAt)}
                </p>
            </div>
        </li>
    );
}
