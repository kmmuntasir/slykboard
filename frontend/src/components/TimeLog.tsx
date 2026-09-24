import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchTimeEntries } from '@/api/timer';
import { timerKeys } from '@/api/queryKeys';
import { useAdjustTimeEntry } from '@/hooks/useAdjustTimeEntry';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/Modal';
import { formatDate } from '@/utils/formatDate';
import { formatDuration } from '@/utils/formatDuration';

// F20: time-tracking log. Like ActivityFeed but for TimeEntries — renders the
// full reverse-chrono list (start, end, duration) plus a total of closed
// durations. The running entry is shown with "Running" in place of an end time
// and is excluded from the total (its elapsed time is still accruing).
interface TimeLogProps {
    ticketId: string;
}

export function TimeLog({ ticketId }: TimeLogProps) {
    const { data, isLoading, isError } = useQuery({
        queryKey: timerKeys.entries(ticketId),
        queryFn: () => fetchTimeEntries(ticketId),
    });

    const entries = data?.entries ?? [];
    const totalMs = data?.totalMs ?? 0;

    // CR-14: the adjustment form opens per entry (one at a time — FR-14.7).
    const adjustMut = useAdjustTimeEntry(ticketId);
    const [adjustingId, setAdjustingId] = useState<string | null>(null);
    const [minutes, setMinutes] = useState('0');
    const [reason, setReason] = useState('');
    const [formError, setFormError] = useState<string | null>(null);
    const adjustingEntry = entries.find((entry) => entry.id === adjustingId) ?? null;

    const openAdjust = (entryId: string) => {
        setAdjustingId(entryId);
        setMinutes('0');
        setReason('');
        setFormError(null);
    };
    const closeAdjust = () => {
        if (adjustMut.isPending) return;
        setAdjustingId(null);
        setFormError(null);
    };
    const submitAdjust = async () => {
        if (!adjustingEntry) return;
        const parsed = Number(minutes);
        if (!Number.isInteger(parsed) || parsed === 0) {
            setFormError('Enter a non-zero whole number of minutes (negative reduces).');
            return;
        }
        if (reason.trim().length < 10) {
            setFormError('A reason of at least 10 characters is required.');
            return;
        }
        try {
            await adjustMut.mutateAsync({
                entryId: adjustingEntry.id,
                adjustmentMinutes: parsed,
                reason: reason.trim(),
            });
            setAdjustingId(null);
        } catch {
            // surfaced by the global mutation funnel; keep the form open
            setFormError('The adjustment could not be saved.');
        }
    };

    return (
        <div className="mt-4 border-t border-border pt-4">
            <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-foreground">Time Tracking</h3>
                <span className="text-sm text-muted-foreground">
                    Total: <span className="font-mono tabular-nums">{formatDuration(totalMs)}</span>
                </span>
            </div>
            {isLoading && <p className="text-sm text-muted-foreground">Loading time entries…</p>}
            {isError && <p className="text-sm text-destructive">Failed to load time entries.</p>}
            {!isLoading && !isError && entries.length === 0 && (
                <p className="text-sm text-muted-foreground">No time tracked yet.</p>
            )}
            {entries.length > 0 && (
                <ul className="divide-y divide-border">
                    {entries.map((entry) => (
                        <li key={entry.id} className="py-2">
                            <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                                {entry.user?.avatarUrl && (
                                    <img
                                        src={entry.user.avatarUrl}
                                        alt=""
                                        className="h-4 w-4 rounded-full"
                                    />
                                )}
                                {entry.user?.fullName ?? 'Unknown user'}
                            </div>
                            {entry.type === 'manual' ? (
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2 text-sm">
                                        <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                                            Manual
                                        </span>
                                        <span className="text-foreground">
                                            <span className="text-muted-foreground">Logged: </span>
                                            {formatDate(entry.startTime)}
                                        </span>
                                    </div>
                                    <span className="font-mono tabular-nums text-sm text-foreground">
                                        {formatDuration(entry.durationMs ?? 0)}
                                    </span>
                                </div>
                            ) : (
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex flex-col gap-0.5 text-sm">
                                        <span className="text-foreground">
                                            <span className="text-muted-foreground">Start: </span>
                                            {formatDate(entry.startTime)}
                                        </span>
                                        <span className="text-foreground">
                                            <span className="text-muted-foreground">End: </span>
                                            {entry.endTime ? formatDate(entry.endTime) : 'Running'}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono tabular-nums text-sm text-foreground">
                                            {entry.durationMs !== null
                                                ? formatDuration(entry.durationMs)
                                                : 'Running'}
                                        </span>
                                        {entry.adjustmentMinutes != null &&
                                            entry.adjustmentMinutes !== 0 && (
                                                <span
                                                    className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive"
                                                    title={entry.adjustmentReason ?? undefined}
                                                >
                                                    Adjusted{' '}
                                                    {entry.adjustmentMinutes > 0 ? '+' : ''}
                                                    {entry.adjustmentMinutes}m
                                                </span>
                                            )}
                                        {/* CR-14: only CLOSED timer entries are adjustable. */}
                                        {entry.endTime !== null && (
                                            <button
                                                type="button"
                                                onClick={() => openAdjust(entry.id)}
                                                className="text-xs text-primary hover:underline"
                                            >
                                                Adjust
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                            {entry.adjustmentMinutes != null && entry.adjustmentMinutes !== 0 && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                    Original: {formatDuration(entry.originalDurationMs ?? 0)} ·{' '}
                                    {entry.adjustmentReason}
                                </p>
                            )}
                            {entry.description && (
                                <div className="mt-1 text-sm text-muted-foreground">
                                    {entry.description}
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {/* CR-14: adjustment form (signed minutes + mandatory reason). */}
            <Modal
                isOpen={adjustingEntry !== null}
                onClose={closeAdjust}
                titleId="adjust-time-dialog-title"
                title="Adjust tracked time"
                size="md"
            >
                <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                        Original:{' '}
                        <span className="font-mono tabular-nums text-foreground">
                            {formatDuration(adjustingEntry?.originalDurationMs ?? 0)}
                        </span>
                    </p>
                    <label className="block text-sm">
                        <span className="mb-1 block font-medium">
                            Adjustment (minutes, negative reduces)
                        </span>
                        <input
                            type="number"
                            aria-label="Adjustment minutes"
                            value={minutes}
                            onChange={(e) => setMinutes(e.target.value)}
                            className="w-full rounded border border-border px-2 py-1"
                        />
                    </label>
                    <label className="block text-sm">
                        <span className="mb-1 block font-medium">Reason (required)</span>
                        <textarea
                            aria-label="Adjustment reason"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            rows={3}
                            placeholder="Why is this being adjusted?"
                            className="w-full rounded border border-border px-2 py-1"
                        />
                    </label>
                    {formError && <p className="text-sm text-destructive">{formError}</p>}
                    <div className="flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={closeAdjust}
                            disabled={adjustMut.isPending}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            onClick={() => void submitAdjust()}
                            disabled={adjustMut.isPending}
                        >
                            {adjustMut.isPending ? 'Saving…' : 'Save adjustment'}
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
