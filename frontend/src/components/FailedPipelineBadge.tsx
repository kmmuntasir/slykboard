import { useState } from 'react';

import { ApiClientError } from '@/api/client';
import {
    isFailedPipelineState,
    PIPELINE_STATE_LABEL,
    type PipelineState,
} from '@/constants/pipelineStates';

// SLYK-0310/0400 — inline failure badge (06-frontend-ui.md § <FailedPipelineBadge>).
// Rendered on the kanban <TicketCard> and in the ticket-detail header when the
// ticket's pipeline job state is FAILED_* or BLOCKED_HUMAN; absent otherwise
// (the caller gates on the same isFailedPipelineState check).
//
//   FAILED_*   → ❌ "Failed: <plain-English label>" + "Agent will retry up to N
//                more times" (remaining = retry cap − attempts; 0 remaining
//                means the next stop is BLOCKED_HUMAN).
//   BLOCKED_HUMAN → ❌ "Blocked: needs human help" + a "Need human help"
//                button (SLYK-0400): POSTs /api/v1/me/tickets/:id/escalate.
//                Success → "Escalated" disabled state (re-enabled if a fresh
//                BLOCKED_HUMAN transition arrives via SSE — the caller re-mounts
//                with a new state). 502 → error toast + button re-enables for
//                a retry; 409 debounce → treated as success-equivalent (the
//                escalation already went out <60s ago).

/** Backend retry cap (pipelineStateService.DEFAULT_RETRY_CAP). */
const RETRY_CAP = 3;

interface FailedPipelineBadgeProps {
    state: PipelineState;
    /** Job attempts — drives the remaining-retries line. */
    attempts: number;
    /**
     * SLYK-0400 — performs the escalation POST. Optional for test/mount
     * flexibility; when omitted in BLOCKED_HUMAN the button stays hidden
     * (06: "If neither dispatcher escalation nor Slack env is configured the
     * button stays hidden").
     */
    onEscalate?: () => Promise<unknown>;
}

export function FailedPipelineBadge({
    state,
    attempts,
    onEscalate,
}: FailedPipelineBadgeProps) {
    if (!isFailedPipelineState(state)) return null;

    const remaining = Math.max(RETRY_CAP - attempts, 0);

    if (state === 'BLOCKED_HUMAN') {
        // Controlled locally: the escalation lifecycle (pending → escalated /
        // retryable) is purely client-side; SSE re-mounts reset it.
        const [phase, setPhase] = useState<'idle' | 'pending' | 'escalated'>('idle');

        const handleClick = async () => {
            if (phase !== 'idle' || !onEscalate) return;
            setPhase('pending');
            try {
                await onEscalate();
                setPhase('escalated');
            } catch (err) {
                // 409 debounce — an escalation already went out moments ago;
                // surface as escalated rather than an error.
                if (err instanceof ApiClientError && err.status === 409) {
                    setPhase('escalated');
                    return;
                }
                setPhase('idle');
                throw err;
            }
        };

        return (
            <div
                className="flex items-center gap-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
                aria-label="Pipeline blocked: needs human help"
            >
                <span aria-hidden="true">❌</span>
                <span className="font-medium">Blocked: needs human help</span>
                {onEscalate && (
                    <button
                        type="button"
                        onClick={handleClick}
                        disabled={phase !== 'idle'}
                        className="rounded bg-destructive px-2 py-0.5 font-medium text-destructive-foreground disabled:opacity-70"
                    >
                        {phase === 'escalated'
                            ? 'Escalated'
                            : phase === 'pending'
                              ? 'Escalating…'
                              : 'Need human help'}
                    </button>
                )}
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
