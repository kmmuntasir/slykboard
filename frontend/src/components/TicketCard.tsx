import { type CSSProperties, useEffect, useState } from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { Clock, Lock } from 'lucide-react';
import { useServerTime } from '@/hooks/useServerTime';
import { formatDuration } from '@/utils/formatDuration';
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
    /** Id of the project's last column — a ticket there counts as resolved, so
     *  it is never "overdue" (CR-10 FR-10.6). */
    lastColumnId?: string;
    /** CR-03: indent subtasks whose parent card sits in the same column. */
    isNested?: boolean;
}

/**
 * CR-12 FR-12.2: the ticking live-elapsed readout. Mounted ONLY while a timer
 * runs and keyed by its start time, so a new session re-initializes the clock.
 * State is seeded lazily (server-corrected) and refreshed by a 1s interval —
 * never read from the device clock at paint time.
 */
/** CR-10 FR-10.6: due-date chip. Lazily seeds the clock, then ticks so a
 *  ticket that passes its deadline flips to Overdue without a refetch. */
function OverdueBadge({ endDate }: { endDate: string }) {
    // Seed lazily (allowed in a state initializer) and refresh once a minute so
    // a ticket that passes its deadline flips without a board refetch.
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60_000);
        return () => clearInterval(timer);
    }, []);
    if (Date.parse(endDate) >= now) return null;
    return (
        <span
            className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-destructive"
            aria-label="Overdue"
        >
            Overdue
        </span>
    );
}

function RunningElapsed({ startTime, offset }: { startTime: number; offset: number }) {
    const [now, setNow] = useState(() => Date.now() + offset);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now() + offset), 1000);
        return () => clearInterval(timer);
    }, [offset]);
    return <>{formatDuration(Math.max(0, now - startTime))}</>;
}

export function TicketCard({
    ticket,
    projectSlug,
    index,
    onEdit,
    isNested,
    lastColumnId,
}: TicketCardProps) {
    // CR-10 FR-10.6: overdue = endDate (the due date) has passed AND the ticket
    // is not in the last column. The clock read happens inside the keyed child
    // so this component stays render-pure.
    const isOverdue =
        lastColumnId !== undefined && ticket.statusColumn !== lastColumnId
            ? { endDate: ticket.endDate }
            : null;
    const ticketId = formatTicketId(projectSlug, ticket.ticketNumber, { padded: true }); // REQ-3.1, F12 D2, F30 D1
    // CR-12: closed-entry total + the live running timer (any member). The
    // live value ticks against the SERVER clock (useServerTime offset), never
    // the device clock — persisted totals stay authoritative.
    const { trackedTotalMs, runningTimer } = ticket;
    const { offset } = useServerTime();
    const runningStart = runningTimer ? Date.parse(runningTimer.startTime) : null;
    const isRunning = runningStart !== null;
    const showBadge = (trackedTotalMs ?? 0) > 0 || isRunning;
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
                    <h4 className="flex flex-wrap items-center gap-2 font-medium leading-snug">
                        <span>{ticket.title}</span>
                        {isOverdue && <OverdueBadge endDate={isOverdue.endDate} />}
                    </h4>

                    {/* CR-12 FR-12.1/FR-12.2: tracked total badge; pulses + ticks
                        live while anyone has a timer running on the ticket. */}
                    {showBadge && (
                        <div>
                            <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
                                    isRunning
                                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                        : 'bg-muted text-muted-foreground'
                                }`}
                            >
                                <Clock
                                    size={12}
                                    aria-hidden="true"
                                    className={isRunning ? 'animate-pulse' : undefined}
                                />
                                {/* Content-based labeling: read linearly as
                                    "Tracked time 3h 20m running + 1m 30s". */}
                                <span className="sr-only">Tracked time</span>
                                {formatDuration(trackedTotalMs ?? 0)}
                                {isRunning && runningTimer && (
                                    <span className="font-normal">
                                        <span className="sr-only">running</span>+
                                        <span>
                                            <RunningElapsed
                                                key={runningTimer.startTime}
                                                startTime={runningStart ?? 0}
                                                offset={offset}
                                            />
                                        </span>
                                    </span>
                                )}
                            </span>
                        </div>
                    )}

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
