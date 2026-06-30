import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchActiveTimer } from '@/api/timer';
import { timerKeys } from '@/api/queryKeys';
import { useTimer } from '@/hooks/useTimer';
import { useServerTime } from '@/hooks/useServerTime';
import { formatDuration } from '@/utils/formatDuration';
import { Button } from './ui/Button';

// DEL-01 T7: prominent per-ticket timer card. Lifts the server-authoritative
// timer logic from TimerControls.tsx (useTimer + useServerTime + the
// timerKeys.active() query + the ticking `now` state + lastDurationMs capture)
// into a single hero surface: a large monospace elapsed readout over a
// full-width Start/Stop toggle.
//
// Composition split (documented in the plan): TimerHeroCard renders ONLY the
// hero card (timer surface). The hosting Time Tracking panel renders the
// "Total tracked" summary line, <TimeLog>, and the collapsible <ManualEntryForm>
// alongside it — that keeps this component single-responsibility (the timer)
// and lets the panel own the log/disclosure layout.
interface TimerHeroCardProps {
    ticketId: string;
}

export function TimerHeroCard({ ticketId }: TimerHeroCardProps) {
    const { start, stop, isStarting, isStopping } = useTimer(ticketId);
    const { offset } = useServerTime();
    const { data: activeTimerData } = useQuery({
        queryKey: timerKeys.active(),
        queryFn: () => fetchActiveTimer(),
    });

    const activeTimer = activeTimerData?.activeTimer ?? null;
    const isRunning = activeTimer !== null && activeTimer.ticketId === ticketId;

    // Live elapsed via a ticking `now` state. The interval sets `now` inside its
    // callback (NOT synchronously in the effect body — avoids set-state-in-effect).
    const [now, setNow] = useState(() => Date.now());
    // Capture the just-stopped entry's duration for display after stop.
    const [lastDurationMs, setLastDurationMs] = useState<number | null>(null);

    useEffect(() => {
        if (!isRunning) return;
        const interval = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(interval);
    }, [isRunning]);

    const elapsedMs =
        isRunning && activeTimer ? now + offset - Date.parse(activeTimer.startTime) : 0;

    const handleStop = async () => {
        const { entry } = await stop();
        if (entry.endTime) {
            setLastDurationMs(Date.parse(entry.endTime) - Date.parse(entry.startTime));
        }
    };

    // Show the live elapsed while running; otherwise the last-tracked duration
    // (if any) or a resting 00:00:00 placeholder. formatDuration collapses to
    // "0s" at 0 — render the explicit zero form when nothing has run yet.
    const displayMs = isRunning
        ? elapsedMs
        : lastDurationMs !== null
            ? lastDurationMs
            : 0;
    const readout = displayMs > 0 ? formatDuration(displayMs) : '00:00:00';

    return (
        <div className="bg-card border border-border rounded-lg p-4 flex flex-col items-center gap-3">
            <span
                className="font-mono text-3xl tabular-nums text-foreground"
                aria-live="polite"
                aria-atomic="true"
            >
                {readout}
            </span>

            {isRunning ? (
                <Button
                    type="button"
                    variant="destructive"
                    className="w-full"
                    disabled={isStopping}
                    onClick={() => {
                        void handleStop();
                    }}
                >
                    {isStopping ? 'Stopping…' : 'Stop'}
                </Button>
            ) : (
                <Button
                    type="button"
                    variant="primary"
                    className="w-full"
                    disabled={isStarting}
                    onClick={() => {
                        void start();
                    }}
                >
                    {isStarting ? 'Starting…' : 'Start'}
                </Button>
            )}

            {lastDurationMs !== null && !isRunning && (
                <span className="text-sm text-muted-foreground">
                    Last tracked: {formatDuration(lastDurationMs)}
                </span>
            )}
        </div>
    );
}
