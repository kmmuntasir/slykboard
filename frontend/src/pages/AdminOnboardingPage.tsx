// SLYK-0230 — /admin/onboarding page (agent mode only).
// Thin wrapper: heading + <OnboardingForm>. Non-admin redirect and agent-mode
// gating live in the route registration (routes/index.tsx agentRoutes array:
// RequirePlatformAdmin wrapper + __AGENT_MODE__ static spread), not here —
// the page is only reachable through those routes.
import { OnboardingForm } from '@/components/onboarding/OnboardingForm';

export function AdminOnboardingPage() {
    return (
        <div className="mx-auto max-w-2xl space-y-6 p-4">
            <div>
                <h1 className="text-2xl font-semibold">Add Project</h1>
                <p className="text-sm text-muted-foreground">
                    Create a project and start agent onboarding.
                </p>
            </div>
            <OnboardingForm />
        </div>
    );
}
