import { PRIORITY_DISPLAY } from '@/types/ticket';
import type { Priority } from '@/types/ticket';

const PRIORITIES = Object.keys(PRIORITY_DISPLAY) as Priority[];

interface PrioritySelectProps {
    value: Priority;
    onChange: (p: Priority) => void;
}

export function PrioritySelect({ value, onChange }: PrioritySelectProps) {
    return (
        <label className="block">
            <span className="mb-1 block text-sm font-medium">Priority</span>
            <select
                aria-label="Priority"
                value={value}
                onChange={(e) => onChange(e.target.value as Priority)}
                className="w-full rounded border border-gray-300 p-2"
            >
                {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                        {PRIORITY_DISPLAY[p]}
                    </option>
                ))}
            </select>
        </label>
    );
}
