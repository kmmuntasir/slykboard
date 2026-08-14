// SLYK-0230 — /admin/projects/:slug page (agent mode only): onboarding
// timeline for one project. Also serves the /admin/projects/:slug/onboarding
// alias the form redirects to (route registration maps both paths here).
// Non-admin redirect + agent-mode gating live in routes/index.tsx.
import { Link, Navigate, useParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';

import { OnboardingTimeline } from '@/components/onboarding/OnboardingTimeline';

export function AdminProjectPage() {
    const { slug } = useParams<{ slug: string }>();

    if (!slug) {
        return <Navigate to="/admin/projects" replace />;
    }

    return (
        <div className="mx-auto max-w-2xl space-y-6 p-4">
            <div className="flex items-center gap-2">
                <Link
                    to="/admin/projects"
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="h-4 w-4" aria-hidden />
                    All projects
                </Link>
            </div>
            <OnboardingTimeline slug={slug} />
        </div>
    );
}
