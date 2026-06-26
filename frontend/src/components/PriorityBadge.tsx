import type { Priority } from '@/types/ticket';
import { PRIORITY_DISPLAY } from '@/types/ticket';

const PRIORITY_TONE: Readonly<Record<Priority, string>> = Object.freeze({
    LOW: 'bg-secondary text-secondary-foreground',
    MEDIUM: 'bg-primary/10 text-primary',
    HIGH: 'bg-warning/15 text-warning',
    URGENT: 'bg-warning text-warning-foreground',
    CRITICAL: 'bg-destructive text-destructive-foreground',
});

interface PriorityBadgeProps {
    priority: Priority;
}

export function PriorityBadge({ priority }: PriorityBadgeProps) {
    return (
        <span
            className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${PRIORITY_TONE[priority]}`}
            aria-label={`Priority: ${PRIORITY_DISPLAY[priority]}`}
        >
            {PRIORITY_DISPLAY[priority]}
        </span>
    );
}
