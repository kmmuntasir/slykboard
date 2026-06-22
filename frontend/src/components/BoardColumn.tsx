import { Droppable } from '@hello-pangea/dnd';
import type { Ticket } from '@/types/ticket';
import { TicketCard } from './TicketCard';

interface BoardColumnProps {
    id: string;
    name: string;
    tickets: Ticket[];
    projectSlug: string;
    isUnsorted?: boolean;
}

export function BoardColumn({ id, name, tickets, projectSlug, isUnsorted }: BoardColumnProps) {
    return (
        <section
            className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-muted/40 p-2"
            aria-label={`Column ${name}`}
            data-column-id={id}
        >
            <header className="flex items-center justify-between px-1">
                <h3 className="text-sm font-semibold">{name}</h3>
                <span className="text-xs text-muted-foreground">{tickets.length}</span>
            </header>
            <Droppable droppableId={id} type="CARD" direction="vertical" isDropDisabled={isUnsorted}>
                {(provided) => (
                    <ul
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className="flex flex-col gap-2"
                    >
                        {tickets.length === 0 ? (
                            <li className="list-none">
                                <div
                                    role="status"
                                    className="rounded border border-dashed p-4 text-center text-xs text-muted-foreground"
                                >
                                    No tickets
                                </div>
                            </li>
                        ) : (
                            tickets.map((ticket, index) => (
                                <li key={ticket.id}>
                                    <TicketCard
                                        ticket={ticket}
                                        projectSlug={projectSlug}
                                        index={index}
                                    />
                                </li>
                            ))
                        )}
                        {provided.placeholder}
                    </ul>
                )}
            </Droppable>
        </section>
    );
}
