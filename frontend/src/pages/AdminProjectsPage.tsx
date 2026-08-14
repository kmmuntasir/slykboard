// SLYK-0230 — /admin/projects page (agent mode only): all projects with their
// onboarding-state badges, filterable by state, searchable by name/slug
// (06-frontend-ui.md § "Project Admin List"). Data = the plain
// GET /api/projects list (admins already see every project there) joined
// client-side with per-slug timeline fetches — the dedicated admin-list
// endpoint 05-backend-routes.md defines doesn't exist yet, and the timeline
// response carries exactly the state + error fields this page renders.
// Non-admin redirect + agent-mode gating live in routes/index.tsx.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueries } from '@tanstack/react-query';

import { listProjects } from '@/api/projects';
import { onboardingApi, onboardingKeys } from '@/api/onboarding';
import {
    ONBOARDING_STATE_LABELS,
    stateBadgeVariant,
} from '@/components/onboarding/OnboardingTimeline';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Retry } from '@/components/Retry';
import { SkeletonLine } from '@/components/Skeleton';
import { TextInput } from '@/components/ui/TextInput';
import { useRuntimeConfigStore } from '@/stores/useRuntimeConfigStore';
import type { OnboardingState, OnboardingTimelineView } from '@/types/onboarding';

// The core projects table stores the mapped uppercase slug (SLYK-0190
// mapCoreSlug); agent URLs use the lowercase kebab form from ProjectAgentMeta.
// Lowercasing restores the agent form for hyphen-less core slugs
// ('INVENTORYTRACKER' → 'inventorytracker'); a hyphenated source slug can't be
// reconstructed, its timeline lookup 404s, and the row drops out of the list —
// the honest outcome until a dedicated admin-list endpoint lands.
function toAgentSlug(coreSlug: string): string {
    return coreSlug.toLowerCase();
}

interface AdminProjectRow {
    id: string;
    name: string;
    agentSlug: string;
    onboardingState: OnboardingState;
    onboardingError: string | null;
}

export function AdminProjectsPage() {
    // Gated on the runtime store per the ticket ("All gated on
    // useRuntimeConfigStore(s => s.agentMode)") — belt-and-suspenders with the
    // build-time route pruning: a stale store after a server flip hides the
    // data surfaces even though the route chunk is already loaded.
    const agentMode = useRuntimeConfigStore((s) => s.agentMode);

    const [stateFilter, setStateFilter] = useState<OnboardingState | null>(null);
    const [search, setSearch] = useState('');

    const projectsQuery = useQuery({
        queryKey: ['projects', 'admin-list'],
        queryFn: () => listProjects(),
        select: (rows) => rows.filter((p) => p.isActive),
    });

    const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
    const slugs = useMemo(() => projects.map((p) => toAgentSlug(p.slug)), [projects]);

    // Per-slug timeline fetches — the state badge's data source. retry:false so
    // a plain-mode project's 404 settles immediately (the row then drops out).
    const timelineQueries = useQueries({
        queries: slugs.map((slug) => ({
            queryKey: onboardingKeys.timeline(slug),
            queryFn: () => onboardingApi.getTimeline(slug),
            enabled: agentMode && projectsQuery.isSuccess,
            staleTime: 30_000,
            retry: false,
        })),
    });

    const rows = useMemo<AdminProjectRow[]>(() => {
        const q = search.trim().toLowerCase();
        return projects
            .map((project, index) => {
                const timeline = timelineQueries[index]?.data as OnboardingTimelineView | undefined;
                if (!timeline) return null; // not an agent project (404) or still loading
                return {
                    id: project.id,
                    name: project.name,
                    agentSlug: timeline.project.slug,
                    onboardingState: timeline.project.onboardingState,
                    onboardingError: timeline.project.onboardingError,
                };
            })
            .filter((row): row is AdminProjectRow => row !== null)
            .filter((row) => !stateFilter || row.onboardingState === stateFilter)
            .filter(
                (row) =>
                    !q ||
                    row.name.toLowerCase().includes(q) ||
                    row.agentSlug.toLowerCase().includes(q),
            );
    }, [projects, timelineQueries, stateFilter, search]);

    if (projectsQuery.isLoading) {
        return (
            <div className="space-y-2 p-4">
                <SkeletonLine />
                <SkeletonLine />
                <SkeletonLine />
            </div>
        );
    }

    if (projectsQuery.isError) {
        return (
            <div className="p-4">
                <Retry
                    message="Failed to load projects"
                    onRetry={() => void projectsQuery.refetch()}
                />
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-2xl space-y-6 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-2xl font-semibold">Projects</h1>
                <Link
                    to="/admin/onboarding"
                    className="text-sm font-medium text-primary hover:underline"
                >
                    + Add Project
                </Link>
            </div>

            <div className="flex flex-wrap gap-2">
                <TextInput
                    aria-label="Search projects"
                    placeholder="Search name or slug…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-56"
                />
                <select
                    aria-label="Filter by onboarding state"
                    value={stateFilter ?? ''}
                    onChange={(e) =>
                        setStateFilter(
                            e.target.value === '' ? null : (e.target.value as OnboardingState),
                        )
                    }
                    className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <option value="">All states</option>
                    {Object.entries(ONBOARDING_STATE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                            {label}
                        </option>
                    ))}
                </select>
            </div>

            {rows.length === 0 ? (
                <Card className="p-6">
                    <p className="text-sm text-muted-foreground">
                        No agent-mode projects yet.{' '}
                        <Link to="/admin/onboarding" className="text-primary hover:underline">
                            Add one
                        </Link>{' '}
                        to start onboarding.
                    </p>
                </Card>
            ) : (
                <ul className="space-y-2">
                    {rows.map((row) => (
                        <li key={row.id}>
                            <Card className="flex items-center justify-between gap-3 p-4">
                                <div className="min-w-0">
                                    <Link
                                        to={`/admin/projects/${row.agentSlug}`}
                                        className="font-medium hover:underline"
                                    >
                                        {row.name}
                                    </Link>
                                    <p className="truncate text-xs text-muted-foreground">
                                        {row.agentSlug}
                                        {row.onboardingError ? ` — ${row.onboardingError}` : ''}
                                    </p>
                                </div>
                                <Badge variant={stateBadgeVariant(row.onboardingState)}>
                                    {ONBOARDING_STATE_LABELS[row.onboardingState]}
                                </Badge>
                            </Card>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
