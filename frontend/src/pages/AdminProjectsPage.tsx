// SLYK-0230/0430 — /admin/projects dashboard (agent mode only): all projects
// with their onboarding-state badges, multi-select state-chip filters,
// 300ms-debounced name/slug search, FAILED-row error detail, rows linking to
// the timeline (06-frontend-ui.md § "Project Admin List"). Data = the plain
// GET /api/projects list joined client-side with per-slug timeline fetches —
// the dedicated admin-list endpoint 05-backend-routes.md defines doesn't
// exist yet, and the timeline response carries exactly the state + error
// fields this page renders. Filters stay client-side for the same reason
// (ticket allows either when the project count is naturally tiny).
// Non-admin redirect + agent-mode gating live in routes/index.tsx.
import { useEffect, useMemo, useState } from 'react';
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

    // SLYK-0430 — multi-select state chips + debounced search (300ms).
    const [stateFilters, setStateFilters] = useState<Set<OnboardingState>>(new Set());
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');

    useEffect(() => {
        const t = setTimeout(() => setSearch(searchInput), 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    const toggleStateFilter = (state: OnboardingState) => {
        setStateFilters((prev) => {
            const next = new Set(prev);
            if (next.has(state)) {
                next.delete(state);
            } else {
                next.add(state);
            }
            return next;
        });
    };

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
            .filter((row) => stateFilters.size === 0 || stateFilters.has(row.onboardingState))
            .filter(
                (row) =>
                    !q ||
                    row.name.toLowerCase().includes(q) ||
                    row.agentSlug.toLowerCase().includes(q),
            );
    }, [projects, timelineQueries, stateFilters, search]);

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

            <div className="flex flex-wrap items-center gap-2">
                <TextInput
                    aria-label="Search projects"
                    placeholder="Search name or slug…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="w-56"
                />
            </div>

            {/* SLYK-0430 — multi-select state chips. A chip toggles its state
                in/out of the filter set; zero selected = all states. */}
            <div
                className="flex flex-wrap gap-1.5"
                role="group"
                aria-label="Filter by onboarding state"
            >
                {Object.entries(ONBOARDING_STATE_LABELS).map(([value, label]) => {
                    const state = value as OnboardingState;
                    const active = stateFilters.has(state);
                    return (
                        <button
                            key={value}
                            type="button"
                            aria-pressed={active}
                            onClick={() => toggleStateFilter(state)}
                            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                                active
                                    ? 'border-primary bg-primary text-primary-foreground'
                                    : 'border-input bg-background text-muted-foreground hover:bg-muted'
                            }`}
                        >
                            {label}
                        </button>
                    );
                })}
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
