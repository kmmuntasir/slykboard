import type { Priority } from '@/types/ticket';
import { PRIORITY_DISPLAY } from '@/types/ticket';

const PRIORITY_TONE: Readonly<Record<Priority, string>> = Object.freeze({
    LOW: 'bg-slate-100 text-slate-700',
    MEDIUM: 'bg-blue-100 text-blue-700',
    HIGH: 'bg-amber-100 text-amber-700',
    URGENT: 'bg-orange-100 text-orange-700',
    CRITICAL: 'bg-red-100 text-red-700',
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
