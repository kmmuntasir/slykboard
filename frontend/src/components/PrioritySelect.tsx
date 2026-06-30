import { Flag } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { PRIORITY_DISPLAY } from '@/types/ticket';
import type { Priority } from '@/types/ticket';

const PRIORITIES = Object.keys(PRIORITY_DISPLAY) as Priority[];

interface PrioritySelectProps {
    value: Priority;
    onChange: (p: Priority) => void;
    /** F44: when true, render only the select (label + icon supplied by the
     *  surrounding <Field>). Keeps the component usable standalone. */
    hideLabel?: boolean;
}

export function PrioritySelect({ value, onChange, hideLabel = false }: PrioritySelectProps) {
    const select = (
        <Select value={value} onValueChange={(v) => onChange(v as Priority)}>
            <SelectTrigger aria-label="Priority" className="w-full">
                <SelectValue placeholder="Priority">{PRIORITY_DISPLAY[value]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
                {PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p} textValue={PRIORITY_DISPLAY[p]}>
                        {PRIORITY_DISPLAY[p]}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
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
