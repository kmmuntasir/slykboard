import type { Ticket } from '@/types/ticket';
import { AssigneeAvatar } from './AssigneeAvatar';
import { PriorityBadge } from './PriorityBadge';

interface TicketCardProps {
    ticket: Ticket;
    projectSlug: string;
}

export function TicketCard({ ticket, projectSlug }: TicketCardProps) {
    const ticketId = `${projectSlug}-${ticket.ticketNumber}`; // REQ-3.1
    return (
        <article
            className="space-y-2 rounded border bg-card p-2 text-sm shadow-sm"
            aria-label={`Ticket ${ticketId}: ${ticket.title}`}
        >
            <header className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs text-muted-foreground">{ticketId}</span>
                <PriorityBadge priority={ticket.priority} />
            </header>
            <h4 className="font-medium leading-snug">{ticket.title}</h4>
            <footer className="flex items-center justify-between gap-2">
                <AssigneeAvatar assignee={ticket.assignee} />
                {ticket.labels.length > 0 && (
                    <ul className="flex flex-wrap gap-1" aria-label="Labels">
                        {ticket.labels.map((label) => (
                            <li
                                key={label}
                                className="rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground"
                            >
                                {label}
                            </li>
                        ))}
                    </ul>
                )}
            </footer>
        </article>
    );
}
