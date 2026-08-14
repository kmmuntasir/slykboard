import {
    isFailedPipelineState,
    PIPELINE_STATE_LABEL,
    type PipelineState,
} from '@/constants/pipelineStates';

// SLYK-0310 — inline failure badge (06-frontend-ui.md § <FailedPipelineBadge>).
// Rendered on the kanban <TicketCard> and in the ticket-detail header when the
// ticket's pipeline job state is FAILED_* or BLOCKED_HUMAN; absent otherwise
// (the caller gates on the same isFailedPipelineState check).
//
//   FAILED_*   → ❌ "Failed: <plain-English label>" + "Agent will retry up to N
//                more times" (remaining = retry cap − attempts; 0 remaining
//                means the next stop is BLOCKED_HUMAN).
//   BLOCKED_HUMAN → ❌ "Blocked: needs human help" + a "Need human help"
//                button. The escalation POST itself is SLYK-0400 — the button
//                renders disabled with a TODO until that lands.

/** Backend retry cap (pipelineStateService.DEFAULT_RETRY_CAP). */
const RETRY_CAP = 3;

interface FailedPipelineBadgeProps {
    state: PipelineState;
    /** Job attempts — drives the remaining-retries line. */
    attempts: number;
    /** Callback for the BLOCKED_HUMAN escalation button (SLYK-0400). */
    onRequestHumanHelp?: () => void;
}

export function FailedPipelineBadge({
    state,
    attempts,
    onRequestHumanHelp,
}: FailedPipelineBadgeProps) {
    if (!isFailedPipelineState(state)) return null;

    const remaining = Math.max(RETRY_CAP - attempts, 0);

    if (state === 'BLOCKED_HUMAN') {
        return (
            <div
                className="flex items-center gap-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
                aria-label="Pipeline blocked: needs human help"
            >
                <span aria-hidden="true">❌</span>
                <span className="font-medium">Blocked: needs human help</span>
                <button
                    type="button"
                    disabled
                    onClick={onRequestHumanHelp}
                    className="rounded bg-destructive px-2 py-0.5 font-medium text-destructive-foreground opacity-70"
                    title="Coming soon"
                >
                    Need human help
                </button>
            </div>
        );
    }

    return (
        <div
            className="flex flex-col gap-0.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
            aria-label={`Pipeline failed: ${PIPELINE_STATE_LABEL[state]}`}
        >
            <span className="flex items-center gap-2">
                <span aria-hidden="true">❌</span>
                <span className="font-medium">Failed: {PIPELINE_STATE_LABEL[state]}</span>
            </span>
            <span>
                {remaining > 0
                    ? `Agent will retry up to ${remaining} more ${remaining === 1 ? 'time' : 'times'}`
                    : 'No auto-retries left — awaiting escalation'}
            </span>
        </div>
    );
}
