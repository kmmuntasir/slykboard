import { useParams, useNavigate } from 'react-router';
import { FolderKanban, ChevronDown, Check, AlertCircle } from 'lucide-react';
import { useProjects } from '@/hooks/useProjects';
import { useProjectStore } from '@/stores/useProjectStore';
import { useRequireRole } from '@/hooks/useRequireRole';
import { cn } from '@/components/ui/cn';
import {
    Dropdown,
    DropdownTrigger,
    DropdownContent,
    DropdownItem,
    DropdownSeparator,
    DropdownGroup,
} from '@/components/ui/Dropdown';
import type { Project } from '@/types/project';

// F38 — Project picker rebuild. Kills the 3 bugs at the old :19/:24/:27:
//   - :19 conflated states → 4 explicit branches (D3).
//   - :24 un-themeable <select> → F36 Radix Dropdown (D4/D5).
//   - :27 uncontrolled defaultValue → controlled value from useParams + store (D2).
// Controlled VALUE (F38) + Radix-controlled OPEN (auto-close on select, no open state).

// D1 — deterministic color dot from slug (no Project.color field exists).
// Hash → HSL hue → one inline-style exception (data-derived, like Badge's style passthrough).
function slugHue(slug: string): number {
    let hash = 0;
    for (let i = 0; i < slug.length; i++) {
        hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
    }
    return hash % 360;
}

function ColorDot({ slug, className }: { slug: string; className?: string }) {
    return (
        <span
            aria-hidden="true"
            className={cn('inline-block h-2 w-2 shrink-0 rounded-full', className)}
            style={{ backgroundColor: `hsl(${slugHue(slug)} 65% 45%)` }}
        />
    );
}

const TRIGGER_MAX_W = 'max-w-[10rem]';
const PLACEHOLDER = 'Select a project';
const LISTING_PLACEHOLDER = 'Select a project';

export function ProjectPicker() {
    const params = useParams<{ slug: string }>();
    const navigate = useNavigate();
    const { data: projects, isLoading, isError, refetch } = useProjects();
    const lastSelectedSlug = useProjectStore((s) => s.lastSelectedSlug);
    const setLastSelectedSlug = useProjectStore((s) => s.setLastSelectedSlug);
    const isAdmin = useRequireRole('ADMIN');

    // D2 — controlled value: route primary, store fallback, "" placeholder.
    const selectedSlug = params.slug ?? lastSelectedSlug ?? '';
    const selected = projects?.find((p) => p.slug === selectedSlug) ?? null;

    const handleSelect = (slug: string) => {
        setLastSelectedSlug(slug);
        void navigate(`/projects/${slug}`);
    };

    // D4 — trigger label per state. Loaded-with-selection shows the project name;
    // listing (no slug) or no-selection shows the D3 placeholder.
    const triggerLabel = selected ? selected.name : LISTING_PLACEHOLDER;

    // D3 — state-shaped trigger content. Each non-loaded state still renders an
    // accessible trigger (aria-label preserved) so the control is always present.
    let triggerBody: React.ReactNode;
    if (isLoading) {
        triggerBody = (
            <>
                <span className="h-4 w-4 animate-pulse rounded-sm bg-muted" />
                <span className="truncate text-muted">Loading…</span>
            </>
        );
    } else if (isError) {
        triggerBody = (
            <>
                <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                <span className="truncate text-destructive">Couldn't load projects</span>
            </>
        );
    } else if (!projects || projects.length === 0) {
        triggerBody = (
            <>
                <FolderKanban className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                <span className="truncate text-muted">No projects yet</span>
            </>
        );
    } else {
        triggerBody = (
            <>
                {selected && <ColorDot slug={selected.slug} />}
                <FolderKanban className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                <span className={cn('truncate', TRIGGER_MAX_W)} title={triggerLabel}>
                    {triggerLabel}
                </span>
            </>
        );
    }

    return (
        <Dropdown>
            <DropdownTrigger asChild>
                <button
                    type="button"
                    aria-label="Select project"
                    title={selected ? selected.name : PLACEHOLDER}
                    className={cn(
                        'flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1',
                        'text-sm text-foreground hover:bg-accent',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                >
                    {triggerBody}
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                </button>
            </DropdownTrigger>

            <DropdownContent align="start" className="min-w-[12rem]">
                {isLoading && <div className="px-2 py-1.5" aria-hidden="true" />}

                {isError && (
                    <div className="flex flex-col gap-2 px-2 py-1.5">
                        <button
                            type="button"
                            onClick={() => void refetch()}
                            className="self-start rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-accent"
                        >
                            Retry
                        </button>
                    </div>
                )}

                {!isLoading && !isError && (!projects || projects.length === 0) && (
                    <DropdownItem
                        onSelect={() => void navigate('/projects')}
                        className="text-muted-foreground"
                    >
                        No projects yet — create one
                    </DropdownItem>
                )}

                {!isLoading && !isError && projects && projects.length > 0 && (
                    <DropdownGroup>
                        {projects.map((p: Project) => {
                            const isSelected = p.slug === selectedSlug;
                            return (
                                <DropdownItem
                                    key={p.id}
                                    onSelect={() => handleSelect(p.slug)}
                                    className="gap-2"
                                >
                                    <ColorDot slug={p.slug} />
                                    <FolderKanban
                                        className="h-4 w-4 shrink-0 text-muted"
                                        aria-hidden="true"
                                    />
                                    <span className={cn('truncate', TRIGGER_MAX_W)} title={p.name}>
                                        {p.name}
                                    </span>
                                    {isSelected && (
                                        <Check
                                            className="ml-auto h-4 w-4 shrink-0 text-primary"
                                            aria-hidden="true"
                                        />
                                    )}
                                </DropdownItem>
                            );
                        })}
                    </DropdownGroup>
                )}

                {isAdmin && (
                    <>
                        <DropdownSeparator />
                        <DropdownItem onSelect={() => void navigate('/projects')}>
                            + Create project
                        </DropdownItem>
                    </>
                )}
            </DropdownContent>
        </Dropdown>
    );
}
