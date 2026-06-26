import { useState, useRef, useEffect } from 'react';
import type { Label } from '@/types/label';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useLabels } from '@/hooks/useLabels';
import { LabelChip } from './LabelChip';

// F14 T7: native multi-select popover (no cmdk/Radix dep).
// Trigger shows selected chips; popover lists all project labels with
// checkbox + color dot + name. Controlled value/onChange (F13 contract).
// Outside-click closes. Loading disables the trigger.
interface LabelMultiSelectProps {
    projectSlug: string;
    value: string[];
    onChange: (ids: string[]) => void;
}

export function LabelMultiSelect({ projectSlug, value, onChange }: LabelMultiSelectProps) {
    const { data: labels = [], isLoading } = useLabels(projectSlug);
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
                disabled={isLoading}
                className="flex min-h-[40px] w-full flex-wrap items-center gap-1 rounded border border-border p-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
            >
                {selected.length === 0 && <span className="text-muted-foreground">No labels</span>}
                {selected.map((l: Label) => (
                    <LabelChip key={l.id} label={l} />
                ))}
            </button>
            {open && (
                <div
                    role="listbox"
                    aria-label="Available labels"
                    className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded border border-border bg-card shadow-lg"
                >
                    {labels.length === 0 && (
                        <div className="p-2 text-sm text-muted-foreground">No labels defined</div>
                    )}
                    {labels.map((l: Label) => (
                        <label
                            key={l.id}
                            className="flex cursor-pointer items-center gap-2 p-2 hover:bg-accent"
                        >
                            <input
                                type="checkbox"
                                checked={value.includes(l.id)}
                                onChange={() => toggle(l.id)}
                                onClick={(e: ReactMouseEvent<HTMLInputElement>) => e.stopPropagation()}
                                aria-label={l.name}
                                className="h-4 w-4"
                            />
                            <span
                                className="inline-block h-3 w-3 rounded-full"
                                style={{ backgroundColor: l.color }}
                            />
                            <span className="text-sm">{l.name}</span>
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
}
