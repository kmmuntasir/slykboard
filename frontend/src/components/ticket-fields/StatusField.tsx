import { useFormContext } from 'react-hook-form';
import { Columns3 } from 'lucide-react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select';
import { Field } from '@/components/ui/Field';
import { useProject } from '@/hooks/useProjects';
import type { TicketFormValues } from '@/hooks/useTicketForm';

// DEL-01 T6: status field — a <Select> bound to the project's columns[], new
// capability. Status is EXPOSE-ONLY on the existing tickets.statusColumn (no
// schema work). The edit modal routes changes through the existing moveTicket
// (via onMove); the create flow persists the chosen column directly via
// setValue('statusColumn'). Owns the columns fetch via useProject(projectSlug)
// so the host only needs to pass the slug.
export interface StatusFieldProps {
    projectSlug: string;
    /** Edit-modal only: when provided, a status change routes through moveTicket
     *  (paired with position) instead of updateTicket. Create flow omits it. */
    onMove?: (statusColumn: string) => void;
}

export function StatusField({ projectSlug, onMove }: StatusFieldProps) {
    const { watch, setValue } = useFormContext<TicketFormValues>();
    const { data: project } = useProject(projectSlug);

    // eslint-disable-next-line react-hooks/incompatible-library
    const statusColumn = watch('statusColumn') ?? '';

    const columns = project?.columns ?? [];
    // Resolve the current column's name for the trigger label.
    const currentName = columns.find((c) => c.id === statusColumn)?.name ?? '';

    function handleChange(nextId: string) {
        if (onMove) {
            onMove(nextId);
        } else {
            setValue('statusColumn', nextId);
        }
    }

    return (
        <Field label="Status" icon={<Columns3 size={14} />}>
            <Select value={statusColumn} onValueChange={handleChange}>
                <SelectTrigger aria-label="Status" className="w-full">
                    <SelectValue placeholder="Select column">{currentName}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                    {columns.map((c) => (
                        <SelectItem key={c.id} value={c.id} textValue={c.name}>
                            {c.name}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </Field>
    );
}
