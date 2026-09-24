import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Clock } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { formatDuration } from '@/utils/formatDuration';
import { formatTicketId } from '@/utils/formatTicketId';
import { useTimerState } from '@/hooks/useTimerState';
import { useTimer } from '@/hooks/useTimer';
import { useServerTime } from '@/hooks/useServerTime';
import { cn } from '@/components/ui/cn';

// CR-15: the global timer widget in the top bar.
//
//  - While a timer runs: a PULSING clock icon; the dropdown shows the ticket
//    title + live elapsed (server-corrected) and a Stop action.
//  - While idle: the same (static) icon opens the LAST TRACKED ticket with its
//    final duration and a one-click Start to resume tracking it.
//  - Clicking the ticket title navigates to it (CR-15 FR-15.7).

/** Live elapsed readout — mounted only while a session runs. */
function RunningElapsed({ startTime }: { startTime: string }) {
    const { offset } = useServerTime();
    const [now, setNow] = useState(() => Date.now() + offset);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now() + offset), 1000);
        return () => clearInterval(timer);
    }, [offset]);
    return <>{formatDuration(Math.max(0, now - Date.parse(startTime)))}</>;
}

export function TimerWidget() {
    const { data } = useTimerState();
    const navigate = useNavigate();
    const active = data?.active ?? null;
    const lastTracked = data?.lastTracked ?? null;

    // Restarting the last-tracked ticket needs a timer scoped to ITS id.
    const lastTimer = useTimer(lastTracked?.id ?? '');
    const activeTimer = useTimer(active?.ticket.id ?? '');

    const [open, setOpen] = useState(false);
    const isRunning = active !== null;

    const goToTicket = (slug: string, ticketNumber: number) => {
        setOpen(false);
        navigate(`/projects/${slug}/tickets/${formatTicketId(slug, ticketNumber)}`);
    };

    const handleStop = async () => {
        if (!active) return;
        await activeTimer.stop();
        setOpen(false);
    };

    const handleStartLast = async () => {
        if (!lastTracked) return;
        await lastTimer.start();
        setOpen(false);
    };

    return (
        <div className="relative">
            <button
                type="button"
                aria-label={
                    isRunning
                        ? `Timer running on ${active.ticket.title}`
                        : 'Timer — last tracked ticket'
                }
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className={cn(
                    'relative inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    isRunning
                        ? 'text-emerald-600 hover:bg-emerald-500/10'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
            >
                <Clock
                    size={16}
                    aria-hidden="true"
                    className={isRunning ? 'animate-pulse' : undefined}
                />
            </button>

            {open && (
                <div
                    role="dialog"
                    aria-label="Timer"
                    className="absolute right-0 top-10 z-50 w-72 rounded-md border border-border bg-popover p-3 text-sm shadow-md"
                >
                    {isRunning && active ? (
                        <div className="space-y-2">
                            <button
                                type="button"
                                onClick={() =>
                                    goToTicket(
                                        active.ticket.projectSlug,
                                        active.ticket.ticketNumber,
                                    )
                                }
                                className="block w-full text-left hover:underline"
                            >
                                <span className="font-mono text-xs text-muted-foreground">
                                    {formatTicketId(
                                        active.ticket.projectSlug,
                                        active.ticket.ticketNumber,
                                        { padded: true },
                                    )}
                                </span>{' '}
                                {active.ticket.title}
                            </button>
                            <p className="flex items-center justify-between text-xs text-muted-foreground">
                                <span className="inline-flex items-center gap-1">
                                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                                    Running
                                </span>
                                <span className="font-mono tabular-nums text-foreground">
                                    <RunningElapsed startTime={active.startTime} />
                                </span>
                            </p>
                            <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => void handleStop()}
                                disabled={activeTimer.isStopping}
                                className="w-full"
                            >
                                {activeTimer.isStopping ? 'Stopping…' : 'Stop'}
                            </Button>
                        </div>
                    ) : lastTracked ? (
                        <div className="space-y-2">
                            <button
                                type="button"
                                onClick={() =>
                                    goToTicket(lastTracked.projectSlug, lastTracked.ticketNumber)
                                }
                                className="block w-full text-left hover:underline"
                            >
                                <span className="font-mono text-xs text-muted-foreground">
                                    {formatTicketId(
                                        lastTracked.projectSlug,
                                        lastTracked.ticketNumber,
                                        { padded: true },
                                    )}
                                </span>{' '}
                                {lastTracked.title}
                            </button>
                            <p className="text-xs text-muted-foreground">
                                Last tracked:{' '}
                                <span className="font-mono tabular-nums text-foreground">
                                    {formatDuration(lastTracked.durationMs)}
                                </span>
                            </p>
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={() => void handleStartLast()}
                                disabled={lastTimer.isStarting}
                                className="w-full"
                            >
                                {lastTimer.isStarting ? 'Starting…' : 'Start tracking again'}
                            </Button>
                        </div>
                    ) : (
                        <p className="text-xs text-muted-foreground">No time tracked yet.</p>
                    )}
                </div>
            )}
        </div>
    );
}
