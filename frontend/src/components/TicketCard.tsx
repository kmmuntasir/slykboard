import { Draggable } from '@hello-pangea/dnd';
import type { Ticket } from '@/types/ticket';
import { AssigneeAvatar } from './AssigneeAvatar';
import { LabelChip } from './LabelChip';
import { PriorityBadge } from './PriorityBadge';
import { formatTicketId } from '@/utils/formatTicketId';

interface TicketCardProps {
    ticket: Ticket;
    projectSlug: string;
    index: number;
    onEdit?: (ticketId: string) => void;
}

export function TicketCard({ ticket, projectSlug, index, onEdit }: TicketCardProps) {
    const ticketId = formatTicketId(projectSlug, ticket.ticketNumber, { padded: true }); // REQ-3.1, F12 D2, F30 D1
    // F15: defend against a stale board cache / a raw create response inserted
    // optimistically (missing labels/assignee/checklist joins) — never crash the
    // whole column on an undefined field.
    const checklist = ticket.checklist ?? [];
    const labels = ticket.labels ?? [];
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
                        <div className="flex items-center gap-2">
                            <AssigneeAvatar assignee={ticket.assignee} />
                            {checklist.length > 0 && (
                                <span
                                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                                    aria-label={`Checklist progress ${checklist.filter((i) => i.done).length} of ${checklist.length} done`}
                                >
                                    <span aria-hidden="true">✓</span>
                                    {checklist.filter((i) => i.done).length}/
                                    {checklist.length}
                                </span>
                            )}
                        </div>
                        {labels.length > 0 && (
                            <ul className="flex flex-wrap gap-1" aria-label="Labels">
                                {labels.map((label) => (
                                    <li key={label.id}>
                                        <LabelChip label={label} />
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
