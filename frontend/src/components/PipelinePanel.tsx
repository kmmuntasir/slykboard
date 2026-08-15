import { ApiClientError } from '@/api/client';
import { escalateTicket } from '@/api/pipeline';
import { usePipeline, useQueueForAgent } from '@/hooks/usePipeline';
import { useTicketSse } from '@/hooks/useTicketSse';
import {
    PIPELINE_STATE_LABEL,
    isFailedPipelineState,
    type PipelineState,
} from '@/constants/pipelineStates';
import type { PipelineEvent, PipelineJob } from '@/types/pipeline';
import { formatRelativeTime } from '@/utils/formatRelativeTime';
import { formatDuration } from '@/utils/formatDuration';
import { FailedPipelineBadge } from './FailedPipelineBadge';

// SLYK-0310 — the Pipeline tab body (06-frontend-ui.md § <PipelinePanel>).
// Timeline: one row per PipelineEvent — ✓ completed, ↻ the in-flight state
// (job.state when it is a live, non-terminal state with no event beyond it),
// ⋯ pending known-next states. Terminal failure → red <FailedPipelineBadge> +
// "Need human help" (SLYK-0400 — disabled stub). No job row (404) → the empty
// state with a "Queue for agent" button (SLYK-0290 POST /queue; on success the
// cache is seeded with the QUEUED job and the panel flips to the timeline).
// Live updates ride useTicketSse: `state` frames invalidate the pipeline query,
// so a state change lands without a manual refresh.

/** Rows after the last event: legal successors that are still pending (⋯). */
const PENDING_NEXT: Readonly<Partial<Record<PipelineState, readonly PipelineState[]>>> = {
    BACKLOG: ['QUEUED'],
    QUEUED: ['AGENT_RUNNING'],
    AGENT_RUNNING: ['AGENT_WAITING', 'PR_OPEN'],
    AGENT_WAITING: ['AGENT_RUNNING'],
    PR_OPEN: ['CI_RUNNING'],
    CI_RUNNING: ['MERGING'],
    MERGING: ['CONFLICT_RETRY'],
    CONFLICT_RETRY: ['MERGING'],
    DEPLOYING: ['DONE'],
};

/** Terminal states — no in-flight row, no pending rows. */
const TERMINAL_STATES: readonly PipelineState[] = [
    'DONE',
    'FAILED_AGENT',
    'FAILED_CI',
    'FAILED_CONFLICT',
    'FAILED_DEPLOY',
    'BLOCKED_HUMAN',
];

function isTerminal(state: PipelineState): boolean {
    return TERMINAL_STATES.includes(state);
}

interface PipelinePanelProps {
    ticketId: string;
    /** Project slug — board invalidation on queue + SSE DONE. */
    slug: string;
}

export function PipelinePanel({ ticketId, slug }: PipelinePanelProps) {
    // One SSE channel per panel mount; closed on unmount (useTicketSse).
    useTicketSse({ ticketId, boardSlug: slug });

    const { data, isLoading, isError, error } = usePipeline(ticketId);
    const queueMutation = useQueueForAgent({ slug, ticketId });

    if (isLoading) {
        return <p className="text-sm text-muted-foreground">Loading pipeline…</p>;
    }

    // 404 NOT_FOUND = the ticket has no pipeline row → the empty state.
    // Any other error surfaces as a plain failure line.
    const notQueued = isError && error instanceof ApiClientError && error.status === 404;
    if (isError) {
        if (notQueued) {
            return (
                <div className="flex flex-col items-start gap-3 rounded-md border border-border p-4">
                    <p className="text-sm text-muted-foreground">
                        This ticket isn&apos;t queued for agent work
                    </p>
                    <button
                        type="button"
                        onClick={() => queueMutation.mutate()}
                        disabled={queueMutation.isPending}
                        className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                    >
                        {queueMutation.isPending ? 'Queuing…' : 'Queue for agent'}
                    </button>
                    {queueMutation.isError && (
                        <p className="text-sm text-destructive" role="alert">
                            {queueMutation.error instanceof Error
                                ? queueMutation.error.message
                                : 'Failed to queue the ticket.'}
                        </p>
                    )}
                </div>
            );
        }
        return (
            <p className="text-sm text-destructive" role="alert">
                {error instanceof Error ? error.message : 'Failed to load pipeline.'}
            </p>
        );
    }

    if (!data) return null;
    const { job, events } = data;

    return (
        <div className="flex flex-col gap-3">
            <ol className="flex flex-col gap-2" aria-label="Pipeline timeline">
                {events.map((event) => (
                    <TimelineRow key={event.id} event={event} />
                ))}
                {!isTerminal(job.state) && <InFlightRow state={job.state} />}
                {pendingRows(job, events).map((state) => (
                    <li
                        key={state}
                        className="flex items-center gap-2 text-sm text-muted-foreground"
                    >
                        <span aria-hidden="true" className="w-4 text-center">
                            ⋯
                        </span>
                        <span>{PIPELINE_STATE_LABEL[state]}</span>
                    </li>
                ))}
            </ol>

            {isFailedPipelineState(job.state) && (
                <FailedPipelineBadge
                    state={job.state}
                    attempts={job.attempts}
                    onEscalate={() => escalateTicket(ticketId)}
                />
            )}
        </div>
    );
}

/** One completed timeline row: ✓ + label + relative time + duration/PR extras. */
function TimelineRow({ event }: { event: PipelineEvent }) {
    const detail = event.detail;
    const durationMs = typeof detail?.durationMs === 'number' ? detail.durationMs : null;
    const prNumber = typeof detail?.prNumber === 'number' ? detail.prNumber : null;

    return (
        <li className="flex items-center gap-2 text-sm">
            <span aria-hidden="true" className="w-4 text-center text-foreground">
                ✓
            </span>
            <span className="text-foreground">{PIPELINE_STATE_LABEL[event.toState]}</span>
            <time dateTime={event.createdAt} className="text-xs text-muted-foreground">
                {formatRelativeTime(event.createdAt)}
            </time>
            {prNumber !== null && (
                <a
                    href={`https://github.com/pulls/${prNumber}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-primary hover:underline"
                >
                    PR #{prNumber}
                </a>
            )}
            {durationMs !== null && (
                <span className="font-mono text-xs text-muted-foreground">
                    · {formatDuration(durationMs)}
                </span>
            )}
        </li>
    );
}

/** ↻ row — the job's current live state (terminal states never render it). */
function InFlightRow({ state }: { state: PipelineState }) {
    return (
        <li
            className="flex items-center gap-2 text-sm"
            aria-label={`In progress: ${PIPELINE_STATE_LABEL[state]}`}
        >
            <span aria-hidden="true" className="w-4 animate-spin text-center">
                ↻
            </span>
            <span className="font-medium text-foreground">{PIPELINE_STATE_LABEL[state]}</span>
        </li>
    );
}

/**
 * Pending ⋯ rows: the job's known legal successors minus the current state
 * (when the job row has advanced past the last event, that state renders as
 * the ↻ in-flight row instead). Terminal states have none.
 */
function pendingRows(job: PipelineJob, events: PipelineEvent[]): PipelineState[] {
    if (isTerminal(job.state)) return [];
    const successors = PENDING_NEXT[job.state] ?? [];
    const lastEventState = events.length > 0 ? events[events.length - 1]!.toState : null;
    return successors.filter((s) => s !== job.state && s !== lastEventState);
}
