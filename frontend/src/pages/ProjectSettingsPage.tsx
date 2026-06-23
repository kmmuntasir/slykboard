// F14 T9: project-scoped settings page hosting LabelManager at
// /projects/:slug/settings. Project-scoped data gets a project-scoped URL.
import { useParams } from 'react-router';
import { LabelManager } from '@/components/LabelManager';

export function ProjectSettingsPage() {
    const { slug } = useParams<{ slug: string }>();

    if (!slug) {
        return <div className="p-4">No project selected.</div>;
    }

    return (
        <div className="mx-auto max-w-2xl p-4">
            <h1 className="mb-4 text-xl font-bold">Project Settings</h1>
            <LabelManager projectSlug={slug} />
        </div>
    );
}
