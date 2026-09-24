import { type CSSProperties } from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { Lock } from 'lucide-react';
import type { Ticket } from '@/types/ticket';
import { AssigneeAvatar } from './AssigneeAvatar';
import { LabelChip } from './LabelChip';
import { PriorityBadge } from './PriorityBadge';
import { formatTicketId } from '@/utils/formatTicketId';
import { epicColorClass } from '@/utils/hierarchy';
import { TICKET_TYPE_DISPLAY } from '@/types/ticket';

interface TicketCardProps {
    ticket: Ticket;
    projectSlug: string;
    index: number;
    onEdit?: (displayId: string) => void;
    /** CR-03: indent subtasks whose parent card sits in the same column. */
    isNested?: boolean;
}

export function TicketCard({ ticket, projectSlug, index, onEdit, isNested }: TicketCardProps) {
    const ticketId = formatTicketId(projectSlug, ticket.ticketNumber, { padded: true }); // REQ-3.1, F12 D2, F30 D1
    // F15: defend against a stale board cache / a raw create response inserted
    // optimistically (missing labels/assignee/checklist joins) — never crash the
    // whole column on an undefined field.
    const checklist = ticket.checklist ?? [];
    const labels = ticket.labels ?? [];
    // CR-03: hierarchy decorations. TASK is the badge-free default; every other
    // type carries a small type badge. Parents (childCount > 0) show child
    // progress + a lock hint (their column is derived — FR-03.9/03.10).
    const showTypeBadge = ticket.type !== 'TASK';
    const isParent = (ticket.childCount ?? 0) > 0;
    return (
        <Draggable draggableId={ticket.id} index={index}>
            {(provided) => (
                <article
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    {...provided.dragHandleProps}
                    style={provided.draggableProps.style as CSSProperties | undefined}
                    onClick={() => onEdit?.(formatTicketId(projectSlug, ticket.ticketNumber))}
                    className={`cursor-pointer space-y-2 rounded border border-border bg-card p-2 text-sm shadow-sm ring-1 ring-black/5 dark:ring-white/5 ${isNested ? 'ml-4 border-l-4' : ''}`}
                    aria-label={`Ticket ${ticketId}: ${ticket.title}`}
                >
                    <header className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{ticketId}</span>
                        <div className="flex items-center gap-1.5">
                            {showTypeBadge && (
                                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    {TICKET_TYPE_DISPLAY[ticket.type]}
                                </span>
                            )}
                            <PriorityBadge priority={ticket.priority} />
                        </div>
                    </header>
                    <h4 className="font-medium leading-snug">{ticket.title}</h4>

                    {/* CR-03: epic chip (descendants of an epic) + parent chip on
                        subtasks whose parent lives in another column. */}
                    {(ticket.epic || ticket.parent) && (
                        <div className="flex flex-wrap items-center gap-1">
                            {ticket.epic && ticket.type !== 'EPIC' && (
                                <span
                                    className={`inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[10px] font-medium ${epicColorClass(ticket.epic.id)}`}
                                    title={`Epic: ${ticket.epic.title}`}
                                >
                                    {ticket.epic.title}
                                </span>
                            )}
                            {ticket.parent && !isNested && (
                                <span
                                    className="inline-flex items-center gap-0.5 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                                    title={`Nested under: ${ticket.parent.title}`}
                                >
                                    ↳{' '}
                                    {formatTicketId(projectSlug, ticket.parent.ticketNumber, {
                                        padded: true,
                                    })}
                                </span>
                            )}
                        </div>
                    )}

                    <footer className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                            <AssigneeAvatar assignee={ticket.assignee} />
                            {isParent && (
                                <span
                                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                                    aria-label={`Children progress ${ticket.childDoneCount} of ${ticket.childCount} done`}
                                    title="This ticket's column follows its least-progressed child"
                                >
                                    <span aria-hidden="true">✓</span>
                                    {ticket.childDoneCount}/{ticket.childCount}
                                    <Lock size={10} aria-label="Column derived from children" />
                                </span>
                            )}
                            {checklist.length > 0 && (
                                <span
                                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                                    aria-label={`Checklist progress ${checklist.filter((i) => i.done).length} of ${checklist.length} done`}
                                >
                                    <span aria-hidden="true">☑</span>
                                    {checklist.filter((i) => i.done).length}/{checklist.length}
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
