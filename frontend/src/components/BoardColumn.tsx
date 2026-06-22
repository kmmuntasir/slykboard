import type { Ticket } from '@/types/ticket';
import { TicketCard } from './TicketCard';

interface BoardColumnProps {
    id: string;
    name: string;
    tickets: Ticket[];
    projectSlug: string;
    isUnsorted?: boolean;
}

// isUnsorted is part of the interface (reserved for future muted styling) but
// not yet used in render; intentionally omitted from destructuring to keep
// @typescript-eslint/no-unused-vars clean.
export function BoardColumn({ id, name, tickets, projectSlug }: BoardColumnProps) {
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
            {tickets.length === 0 ? (
                <div
                    role="status"
                    className="rounded border border-dashed p-4 text-center text-xs text-muted-foreground"
                >
                    No tickets
                </div>
            ) : (
                <ul className="flex flex-col gap-2">
                    {tickets.map((ticket, index) => (
                        <li key={ticket.id}>
                            <TicketCard ticket={ticket} projectSlug={projectSlug} index={index} />
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
