// SLYK-0230 — /admin/projects/:slug page (agent mode only): onboarding
// timeline for one project. Also serves the /admin/projects/:slug/onboarding
// alias the form redirects to (route registration maps both paths here).
// Non-admin redirect + agent-mode gating live in routes/index.tsx.
//
// SLYK-0240 — the page header hosts the "Remove" button (06-frontend-ui.md
// § Onboarding Timeline layout) opening <DecommissionDialog>. The dialog's
// consequence bullets quote meta fields (ctid/subdomain/githubRepoCreated),
// so the page subscribes to the SAME timeline query the timeline body drives
// (shared key via onboardingKeys.timeline) — one fetch, no duplicate polling:
// the timeline component's refetchInterval stays the single cadence owner.
import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { onboardingApi, onboardingKeys } from '@/api/onboarding';
import { DecommissionDialog } from '@/components/onboarding/DecommissionDialog';
import { OnboardingTimeline } from '@/components/onboarding/OnboardingTimeline';
import { Button } from '@/components/ui/Button';
import type { DecommissionProjectInfo } from '@/components/onboarding/DecommissionDialog';

export function AdminProjectPage() {
    const { slug } = useParams<{ slug: string }>();
    const [removeOpen, setRemoveOpen] = useState(false);
    // Remounts <DecommissionDialog> per open (key) so the typed-slug gate
    // always starts fresh — a previously-typed slug must not survive a
    // cancel → reopen.
    const [removeSeq, setRemoveSeq] = useState(0);

    // Read-only subscription to the timeline query <OnboardingTimeline> owns.
    // enabled:false → this mount never triggers its own fetch or refetch loop;
    // it only reads whatever the timeline's poll has cached.
    const timeline = useQuery({
        queryKey: onboardingKeys.timeline(slug ?? ''),
        queryFn: () => onboardingApi.getTimeline(slug ?? ''),
        enabled: false,
    });

    if (!slug) {
        return <Navigate to="/admin/projects" replace />;
    }

    const project: DecommissionProjectInfo | null = timeline.data
        ? {
              slug: timeline.data.project.slug,
              name: timeline.data.project.name,
              subdomain: timeline.data.project.subdomain,
              lxcCtid: timeline.data.project.lxcCtid,
              githubRepoCreated: timeline.data.project.githubRepoCreated,
          }
        : null;

    return (
        <div className="mx-auto max-w-2xl space-y-6 p-4">
            <div className="flex items-center justify-between gap-2">
                <Link
                    to="/admin/projects"
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="h-4 w-4" aria-hidden />
                    All projects
                </Link>
                <Button
                    variant="destructive-outline"
                    size="sm"
                    onClick={() => {
                        setRemoveSeq((n) => n + 1);
                        setRemoveOpen(true);
                    }}
                    disabled={!project}
                >
                    Remove
                </Button>
            </div>
            <OnboardingTimeline slug={slug} />

            {project ? (
                <DecommissionDialog
                    key={removeSeq}
                    isOpen={removeOpen}
                    project={project}
                    onClose={() => setRemoveOpen(false)}
                />
            ) : null}
        </div>
    );
}
