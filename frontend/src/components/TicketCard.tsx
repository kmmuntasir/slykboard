import { Draggable } from '@hello-pangea/dnd';
import type { Ticket } from '@/types/ticket';
import { AssigneeAvatar } from './AssigneeAvatar';
import { PriorityBadge } from './PriorityBadge';

// F12 D2: display ticket IDs zero-padded to 3 digits (SLYK-001). Display-only;
// storage holds the raw int (Ticket.ticketNumber). padStart is a minimum width,
// so SLYK-1000+ render unpadded beyond 3 digits.
const TICKET_NUMBER_DISPLAY_WIDTH = 3;

interface TicketCardProps {
    ticket: Ticket;
    projectSlug: string;
    index: number;
    onEdit?: (ticketId: string) => void;
}

export function TicketCard({ ticket, projectSlug, index, onEdit }: TicketCardProps) {
    const ticketId = `${projectSlug}-${String(ticket.ticketNumber).padStart(TICKET_NUMBER_DISPLAY_WIDTH, '0')}`; // REQ-3.1, F12 D2
    return (
        <Draggable draggableId={ticket.id} index={index}>
            {(provided) => (
                <article
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    style={provided.draggableProps.style}
                    onClick={() => onEdit?.(ticket.id)}
                    className="cursor-pointer space-y-2 rounded border bg-card p-2 text-sm shadow-sm"
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
            )}
        </Draggable>
    );
}
