import { Flag } from 'lucide-react';
import { PRIORITY_DISPLAY } from '@/types/ticket';
import type { Priority } from '@/types/ticket';

const PRIORITIES = Object.keys(PRIORITY_DISPLAY) as Priority[];

interface PrioritySelectProps {
    value: Priority;
    onChange: (p: Priority) => void;
    /** F44: when true, render only the <select> (label + icon supplied by the
     *  surrounding <Field>). Keeps the component usable standalone. */
    hideLabel?: boolean;
}

export function PrioritySelect({ value, onChange, hideLabel = false }: PrioritySelectProps) {
    const select = (
        <select
            aria-label="Priority"
            value={value}
            onChange={(e) => onChange(e.target.value as Priority)}
            className="w-full rounded border border-border p-2"
        >
            {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                    {PRIORITY_DISPLAY[p]}
                </option>
            ))}
        </select>
    );

    if (hideLabel) return select;

    return (
        <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                <Flag size={14} /> Priority
            </span>
            {select}
        </label>
    );
}
