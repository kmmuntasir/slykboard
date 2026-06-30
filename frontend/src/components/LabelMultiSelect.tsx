import { useState, useRef, useEffect } from 'react';
import { useLabels } from '@/hooks/useLabels';
import { useRequirePlatformAdmin } from '@/hooks/useRequirePlatformAdmin';
import { useCurrentProjectMembership } from '@/hooks/useProjectMembers';
import { useCreateLabel } from '@/hooks/useLabelMutations';
import { useToast } from '@/hooks/useToast';
import { LabelChip } from './LabelChip';
import { Retry } from './Retry';
import { EmptyState } from './EmptyState';
import { SkeletonLine } from './Skeleton';
import { Checkbox } from '@/components/ui/Checkbox';
import type { Label } from '@/types/label';

// D16 / F14 T9: neutral gray default mirroring LabelManager.DEFAULT_COLOR so
// inline-created labels match the catalog's create surface.
const DEFAULT_LABEL_COLOR = '#6B7280';

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
    const createLabelMut = useCreateLabel(projectSlug);
    const toast = useToast();

    const [open, setOpen] = useState(false);
    // Search filters the visible label list AND drives the inline "Create Label"
    // row for admins (T4). Empty string = no filter.
    const [search, setSearch] = useState('');
    const containerRef = useRef<HTMLDivElement>(null);

    // Create-row visibility: an admin typing a non-empty query that no existing
    // label matches (case-insensitive) gets an inline Create option. Members
    // never see it.
    const trimmedSearch = search.trim();
    const lowerSearch = trimmedSearch.toLowerCase();
    const hasExactMatch =
        trimmedSearch !== '' &&
        labels.some((l: Label) => l.name.toLowerCase() === lowerSearch);
    const showCreateRow = canManageLabels && trimmedSearch !== '' && !hasExactMatch;

    async function handleCreate() {
        if (!showCreateRow || createLabelMut.isPending) return;
        const name = trimmedSearch;
        try {
            const created = await createLabelMut.mutateAsync({
                name,
                color: DEFAULT_LABEL_COLOR,
            });
            onChange([...value, created.id]);
            setSearch('');
        } catch {
            toast.error('Failed to create label');
        }
    }

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
                    <div className="sticky top-0 border-b border-border bg-card p-2">
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search labels"
                            aria-label="Search labels"
                            className="w-full rounded border border-border p-1 text-sm"
                        />
                    </div>

                    {(() => {
                        const filtered = labels.filter((l: Label) =>
                            l.name.toLowerCase().includes(lowerSearch),
                        );
                        const showEmpty =
                            filtered.length === 0 && !showCreateRow;

                        if (showEmpty) {
                            return (
                                <EmptyState
                                    title="No labels yet"
                                    description={
                                        canManageLabels
                                            ? 'Create labels to organize tickets.'
                                            : 'Ask a project admin to create labels.'
                                    }
                                />
                            );
                        }

                        return (
                            <>
                                {filtered.map((l: Label) => (
                                    <label
                                        key={l.id}
                                        className="flex cursor-pointer items-center gap-2 p-2 hover:bg-accent"
                                    >
                                        <Checkbox
                                            checked={value.includes(l.id)}
                                            onCheckedChange={() => toggle(l.id)}
                                            onClick={(e) => e.stopPropagation()}
                                            aria-label={l.name}
                                        />
                                        <span
                                            className="inline-block h-3 w-3 rounded-full"
                                            style={{ backgroundColor: l.color }}
                                        />
                                        <span className="text-sm">{l.name}</span>
                                    </label>
                                ))}
                                {showCreateRow && (
                                    <button
                                        type="button"
                                        onClick={handleCreate}
                                        disabled={createLabelMut.isPending}
                                        className="flex w-full items-center gap-2 border-t border-border p-2 text-left text-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        <span
                                            aria-hidden="true"
                                            className="inline-block h-3 w-3 rounded-full"
                                            style={{ backgroundColor: DEFAULT_LABEL_COLOR }}
                                        />
                                        <span>
                                            Create Label &lsquo;{trimmedSearch}&rsquo;
                                        </span>
                                    </button>
                                )}
                            </>
                        );
                    })()}
                </div>
            )}
        </div>
    );
}
