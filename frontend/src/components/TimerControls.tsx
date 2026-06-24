import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchActiveTimer } from '@/api/timer';
import { timerKeys } from '@/api/queryKeys';
import { useTimer } from '@/hooks/useTimer';
import { useServerTime } from '@/hooks/useServerTime';
import { formatDuration } from '@/utils/formatDuration';

// F20: per-ticket timer controls. Renders Start when no timer is running on
// this ticket, or Stop + a live elapsed readout when this ticket's timer is the
// active one. After stopping, shows the last-tracked duration. Elapsed tracks
// server-authoritative startTime via the server-time offset (useServerTime).
interface TimerControlsProps {
    ticketId: string;
}

export function TimerControls({ ticketId }: TimerControlsProps) {
    const { start, stop, isStarting, isStopping } = useTimer(ticketId);
    const { offset } = useServerTime();
    const { data: activeTimerData } = useQuery({
        queryKey: timerKeys.active(),
        queryFn: () => fetchActiveTimer(),
    });

    const activeTimer = activeTimerData?.activeTimer ?? null;
    const isRunning = activeTimer !== null && activeTimer.ticketId === ticketId;

    // F20: live elapsed via a ticking `now` state. The interval sets `now` inside
    // its callback (NOT synchronously in the effect body — avoids set-state-in-effect).
    // Date.now() lives in the lazy initializer + the interval callback, never in render.
    const [now, setNow] = useState(() => Date.now());
    // F20: capture the just-stopped entry's duration for display after stop.
    const [lastDurationMs, setLastDurationMs] = useState<number | null>(null);

    useEffect(() => {
        if (!isRunning) return;
        const interval = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(interval);
    }, [isRunning]);

    const elapsedMs =
        isRunning && activeTimer
            ? now + offset - Date.parse(activeTimer.startTime)
            : 0;

    const handleStop = async () => {
        const { entry } = await stop();
        if (entry.endTime) {
            setLastDurationMs(
                Date.parse(entry.endTime) - Date.parse(entry.startTime),
            );
        }
    };

    return (
        <div className="mb-4 flex items-center gap-3">
            {isRunning ? (
                <>
                    <button
                        type="button"
                        onClick={() => {
                            void handleStop();
                        }}
                        disabled={isStopping}
                        className="rounded bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                    >
                        Stop
                    </button>
                    <span className="font-mono text-sm tabular-nums text-gray-700">
                        {formatDuration(elapsedMs)}
                    </span>
                </>
            ) : (
                <>
                    <button
                        type="button"
                        onClick={() => {
                            void start();
                        }}
                        disabled={isStarting}
                        className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                        Start
                    </button>
                    {lastDurationMs !== null && (
                        <span className="text-sm text-gray-500">
                            Last tracked: {formatDuration(lastDurationMs)}
                        </span>
                    )}
                </>
            )}
        </div>
    );
}
