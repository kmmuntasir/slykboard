import { useNavigate } from 'react-router';
import { useProjects } from '@/hooks/useProjects';
import { useProjectStore } from '@/stores/useProjectStore';

export function ProjectPicker() {
    const navigate = useNavigate();
    const { data: projects, isLoading } = useProjects();
    const setLastSelectedSlug = useProjectStore((s) => s.setLastSelectedSlug);

    const handleSelect = (slug: string) => {
        setLastSelectedSlug(slug);
        void navigate(`/projects/${slug}`);
    };

    if (isLoading) {
        return <span className="text-sm text-muted">Loading…</span>;
    }

    if (!projects || projects.length === 0) {
        return <span className="text-sm text-muted">No projects</span>;
    }

    return (
        <select
            aria-label="Select project"
            className="rounded border border-border bg-background px-2 py-1 text-sm"
            defaultValue=""
            onChange={(e) => e.target.value && handleSelect(e.target.value)}
        >
            <option value="" disabled>
                Select project…
            </option>
            {projects.map((p) => (
                <option key={p.id} value={p.slug}>
                    {p.name} ({p.slug})
                </option>
            ))}
        </select>
    );
}
