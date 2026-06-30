import type { Assignee } from '@/types/ticket';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/Tooltip';

interface AssigneeAvatarProps {
    assignee: Assignee | null;
}

export function AssigneeAvatar({ assignee }: AssigneeAvatarProps) {
    if (!assignee) {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <span
                        className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground"
                        aria-label="Unassigned"
                    >
                        –
                    </span>
                </TooltipTrigger>
                <TooltipContent>Unassigned</TooltipContent>
            </Tooltip>
        );
    }
    const initials = assignee.fullName
        .split(' ')
        .map((part) => part.charAt(0))
        .join('')
        .slice(0, 2)
        .toUpperCase();
    return assignee.avatarUrl ? (
        <img src={assignee.avatarUrl} alt={assignee.fullName} className="h-6 w-6 rounded-full" />
    ) : (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground"
                    aria-label={assignee.fullName}
                >
                    {initials}
                </span>
            </TooltipTrigger>
            <TooltipContent>{assignee.fullName}</TooltipContent>
        </Tooltip>
    );
}
