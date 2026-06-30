import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useLabels } from '@/hooks/useLabels';
import { useRequirePlatformAdmin } from '@/hooks/useRequirePlatformAdmin';
import { useCurrentProjectMembership } from '@/hooks/useProjectMembers';
import { LabelChip } from './LabelChip';
import { Retry } from './Retry';
import { EmptyState } from './EmptyState';
import { SkeletonLine } from './Skeleton';
import type { Label } from '@/types/label';
import type { MouseEvent as ReactMouseEvent } from 'react';

// F14 T7: native multi-select popover (no cmdk/Radix dep).
// Trigger shows selected chips; popover lists all project labels with
// checkbox + color dot + name. Controlled value/onChange (F13 contract).
// Outside-click closes. Loading/error disables the trigger.
interface LabelMultiSelectProps {
    projectSlug: string;
    value: string[];
    onChange: (ids: string[]) => void;
}

export function LabelMultiSelect({ projectSlug, value, onChange }: LabelMultiSelectProps) {
    // SLYK-08 B2-1: consume the full useLabels return (incl. isError + refetch)
    // so we can surface distinct error and empty states instead of a bare label.
    const { data: labels = [], isLoading, isError, refetch } = useLabels(projectSlug);
    const isPlatformAdmin = useRequirePlatformAdmin();
    const { isProjectAdmin } = useCurrentProjectMembership(projectSlug);
    const canManageLabels = isPlatformAdmin || isProjectAdmin;
    const navigate = useNavigate();

    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Close on outside click. Only attached while open so closed state is inert.
    useEffect(() => {
        if (!open) return;
        function handler(e: globalThis.MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    // The selected chips are derived from whatever labels we currently have. While
    // loading or errored we render distinct states below, so `selected` only
    // matters once labels are available.
    const selected = labels.filter((l: Label) => value.includes(l.id));

    function toggle(id: string) {
        if (value.includes(id)) {
            onChange(value.filter((v: string) => v !== id));
        } else {
            onChange([...value, id]);
        }
    }

    return (
        <div ref={containerRef} className="relative">
            <span className="mb-1 block text-sm font-medium">Labels</span>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-label="Labels"
                aria-expanded={open}
                // Disabled while loading OR errored so the dropdown never opens
                // empty/broken (SLYK-08 B2-1 AC3).
                disabled={isLoading || isError}
                className="flex min-h-[40px] w-full flex-wrap items-center gap-1 rounded border border-border p-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
            >
                {selected.length === 0 && <span className="text-muted-foreground">No labels</span>}
                {selected.map((l: Label) => (
                    <LabelChip key={l.id} label={l} />
                ))}
            </button>

            {/* Error: distinct from empty — Retry control, always visible under the
                disabled trigger. (SLYK-08 B2-1 AC2) */}
            {isError && (
                <div className="mt-1">
                    <Retry message="Couldn't load labels" onRetry={() => void refetch()} />
                </div>
            )}

            {/* Loading skeleton shown beneath the disabled trigger so the user sees
                something is happening without opening the popover. */}
            {isLoading && (
                <div className="mt-1 space-y-2 rounded border border-border p-2">
                    <SkeletonLine className="h-4 w-1/2" />
                    <SkeletonLine className="h-4 w-2/3" />
                </div>
            )}

            {/* Popover: only meaningful once labels have loaded successfully. The
                branches inside are mutually exclusive: empty → role-aware
                EmptyState, otherwise the label list. */}
            {open && !isLoading && !isError && (
                <div
                    role="listbox"
                    aria-label="Available labels"
                    className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded border border-border bg-card shadow-lg"
                >
                    {labels.length === 0 ? (
                        <EmptyState
                            title="No labels yet"
                            description={
                                canManageLabels
                                    ? 'Create labels to organize tickets.'
                                    : 'Ask a project admin to create labels.'
                            }
                            action={
                                canManageLabels
                                    ? {
                                          label: 'Create labels',
                                          onClick: () =>
                                              navigate(`/projects/${projectSlug}/settings`),
                                      }
                                    : undefined
                            }
                        />
                    ) : (
                        labels.map((l: Label) => (
                            <label
                                key={l.id}
                                className="flex cursor-pointer items-center gap-2 p-2 hover:bg-accent"
                            >
                                <input
                                    type="checkbox"
                                    checked={value.includes(l.id)}
                                    onChange={() => toggle(l.id)}
                                    onClick={(e: ReactMouseEvent<HTMLInputElement>) =>
                                        e.stopPropagation()
                                    }
                                    aria-label={l.name}
                                    className="h-4 w-4"
                                />
                                <span
                                    className="inline-block h-3 w-3 rounded-full"
                                    style={{ backgroundColor: l.color }}
                                />
                                <span className="text-sm">{l.name}</span>
                            </label>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
