// SLYK-0230 — <OnboardingTimeline>, the /admin/projects/:slug page body
// (docs/agentic-automation/06-frontend-ui.md § "Onboarding Timeline").
//
// Polls GET /api/v1/me/projects/:slug/onboarding/events every 3s while the
// project state is in-flight; polling stops on terminal states (LIVE, FAILED,
// DECOMMISSIONED) via refetchInterval's function form. Layout per the doc:
// check/spinner/pending rows keyed off the event's toState position in the
// canonical lifecycle, error badge + detail under FAILED.
//
// Agent-mode gating is structural (see OnboardingForm.tsx header note).
import { useQuery } from '@tanstack/react-query';
import { Check, Loader2 } from 'lucide-react';

import { onboardingApi, onboardingKeys } from '@/api/onboarding';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { isTerminalOnboardingState, type OnboardingState } from '@/types/onboarding';

// 06-frontend-ui.md poll cadence: "every 3s while state is in-flight".
const POLL_INTERVAL_MS = 3_000;

// The canonical lifecycle the timeline renders as pending rows after the last
// event (04-schema.md OnboardingStateEnum, minus the terminal + decommission
// states which are statuses, not steps).
const TIMELINE_STEPS: readonly OnboardingState[] = [
    'PENDING',
    'PROVISIONING_LXC',
    'WIRING_GITHUB',
    'WIRING_AGENT',
    'WIRING_ZORAXY',
    'SMOKE_TEST',
    'LIVE',
];

export const ONBOARDING_STATE_LABELS: Record<OnboardingState, string> = {
    PENDING: 'Pending',
    PROVISIONING_LXC: 'Provisioning LXC',
    WIRING_GITHUB: 'Wiring GitHub',
    WIRING_AGENT: 'Wiring agent',
    WIRING_ZORAXY: 'Wiring Zoraxy',
    SMOKE_TEST: 'Smoke test',
    LIVE: 'Live',
    FAILED: 'Failed',
    DECOMMISSIONING: 'Decommissioning',
    DECOMMISSIONED: 'Decommissioned',
};

// Status-badge variant per state (list page reuses this).
export type StateBadgeVariant = 'success' | 'destructive' | 'warning' | 'secondary' | 'default';

export function stateBadgeVariant(state: OnboardingState): StateBadgeVariant {
    switch (state) {
        case 'LIVE':
            return 'success';
        case 'FAILED':
            return 'destructive';
        case 'DECOMMISSIONING':
            return 'warning';
        case 'DECOMMISSIONED':
            return 'secondary';
        default:
            return 'default';
    }
}

export interface OnboardingTimelineProps {
    slug: string;
}

// Relative timestamp ("2 min ago") for the row's right column. Coarse by
// design — the doc's layout shows minute-granularity deltas.
function timeAgo(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return '';
    const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

// One-line detail rendering for the states the doc shows extras for
// (ctid/lanIp under Provisioning, error under FAILED). Arbitrary jsonb keys
// render as key=value pairs; unknown shapes fall back to compact JSON.
function detailLine(detail: Record<string, unknown> | null): string | null {
    if (!detail) return null;
    const keys = Object.keys(detail);
    if (keys.length === 0) return null;
    return keys
        .map((key) => {
            const value = detail[key];
            return `${key}=${typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}`;
        })
        .join(', ');
}

export function OnboardingTimeline({ slug }: OnboardingTimelineProps) {
    const query = useQuery({
        queryKey: onboardingKeys.timeline(slug),
        queryFn: () => onboardingApi.getTimeline(slug),
        refetchInterval: (query) => {
            const state = query.state.data?.project.onboardingState;
            // Stop on terminal states — the ticket's poll-stop acceptance
            // criterion. Undefined data (still loading) keeps polling.
            if (state && isTerminalOnboardingState(state)) return false;
            return POLL_INTERVAL_MS;
        },
        refetchIntervalInBackground: false,
    });

    if (query.isLoading) {
        return (
            <Card className="p-6">
                <p role="status" className="text-sm text-muted-foreground">
                    Loading timeline…
                </p>
            </Card>
        );
    }

    if (query.isError || !query.data) {
        return (
            <Card className="p-6">
                <p role="alert" className="text-sm text-destructive">
                    Failed to load onboarding timeline.
                </p>
            </Card>
        );
    }

    const { project, events } = query.data;
    const terminal = isTerminalOnboardingState(project.onboardingState);
    const failed = project.onboardingState === 'FAILED';

    // Highest lifecycle index reached by any event — rows at or below it are
    // done (✓), the row at the current state spins (↻) unless terminal, the
    // rest render pending (⋯).
    const reachedIndex = (() => {
        let max = -1;
        for (const event of events) {
            const idx = TIMELINE_STEPS.indexOf(event.toState);
            if (idx > max) max = idx;
        }
        return max;
    })();

    return (
        <Card className="space-y-4 p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                    <h2 className="text-lg font-semibold">Project: {project.name}</h2>
                    <p data-testid="onboarding-status" className="text-sm text-muted-foreground">
                        Status: {project.onboardingState}
                    </p>
                </div>
                <Badge variant={stateBadgeVariant(project.onboardingState)}>
                    {ONBOARDING_STATE_LABELS[project.onboardingState]}
                </Badge>
            </div>

            {failed && project.onboardingError ? (
                <div
                    role="alert"
                    className="rounded-md border border-destructive/50 bg-destructive/10 p-3"
                >
                    <p className="text-sm font-medium text-destructive">
                        Onboarding failed: {project.onboardingError}
                    </p>
                </div>
            ) : null}

            <div>
                <h3 className="mb-2 text-sm font-medium text-muted-foreground">Timeline</h3>
                <ol className="space-y-2">
                    {TIMELINE_STEPS.map((step, index) => {
                        const done = index <= reachedIndex;
                        const current = !terminal && index === reachedIndex + 1;
                        // Terminal states mark the last done row as final (no
                        // spinner anywhere).
                        const icon = done ? (
                            <Check aria-hidden className="h-4 w-4 text-success" />
                        ) : current ? (
                            <Loader2 aria-hidden className="h-4 w-4 animate-spin text-primary" />
                        ) : (
                            <span aria-hidden className="text-muted-foreground">
                                ⋯
                            </span>
                        );

                        // Detail line: the most recent event that landed on this
                        // step (append-only log may hold several).
                        const eventForStep = [...events]
                            .reverse()
                            .find((event) => event.toState === step);
                        const detail = detailLine(eventForStep?.detail ?? null);

                        return (
                            <li
                                key={step}
                                data-state={step}
                                data-row-state={done ? 'done' : current ? 'current' : 'pending'}
                                className="flex items-start gap-3"
                            >
                                <span className="mt-0.5">{icon}</span>
                                <div className="min-w-0 flex-1">
                                    <span
                                        className={
                                            done || current
                                                ? 'text-sm'
                                                : 'text-sm text-muted-foreground'
                                        }
                                    >
                                        {ONBOARDING_STATE_LABELS[step]}
                                    </span>
                                    {detail ? (
                                        <p className="truncate font-mono text-xs text-muted-foreground">
                                            → {detail}
                                        </p>
                                    ) : null}
                                </div>
                                {eventForStep ? (
                                    <span className="shrink-0 text-xs text-muted-foreground">
                                        {timeAgo(eventForStep.createdAt)}
                                    </span>
                                ) : null}
                            </li>
                        );
                    })}
                </ol>
            </div>
        </Card>
    );
}
