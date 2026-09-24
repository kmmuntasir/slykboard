import { useFormContext } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { GitBranch } from 'lucide-react';

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/Select';
import { Field } from '@/components/ui/Field';
import type { TicketFormValues } from '@/hooks/useTicketForm';
import { eligibleParents } from '@/hooks/useTicketForm';
import { fetchBoard } from '@/api/boards';
import { boardKeys } from '@/api/queryKeys';
import { formatTicketId } from '@/utils/formatTicketId';
import { TICKET_TYPE_DISPLAY, type TicketType } from '@/types/ticket';

// CR-03 FR-03.1/FR-03.2: parent selector. Owns its data path (mirroring
// StatusField): the UNFILTERED board query ([...detail, ''] — deliberately
// ignoring the active board filters so a filtered board never hides an
// eligible parent). Options are filtered to tickets that STRICTLY outrank the
// selected type. "No parent" is hidden for SUBTASK (must have a parent).
const NONE = '__none__';

interface ParentFieldProps {
    projectSlug: string;
    readOnly?: boolean;
    /** Test/host override — skips the board fetch. */
    candidates?: ReadonlyArray<{
        id: string;
        title: string;
        ticketNumber: number;
        type: TicketType;
    }>;
}

export function ParentField({ projectSlug, readOnly, candidates }: ParentFieldProps) {
    const {
        watch,
        setValue,
        formState: { errors },
    } = useFormContext<TicketFormValues>();

    const type = watch('type');
    const parentId = watch('parentId');

    // Candidates come from the host when provided; otherwise from the
    // unfiltered board query (shared cache key with an unfiltered useBoard read).
    const { data: board } = useQuery({
        queryKey: [...boardKeys.detail(projectSlug), ''],
        queryFn: () => fetchBoard(projectSlug, ''),
        enabled: candidates === undefined && Boolean(projectSlug),
    });
    const effectiveCandidates =
        candidates ?? board?.columns.flatMap((column) => column.tickets) ?? [];

    const options = eligibleParents(effectiveCandidates, type);
    const selected = options.find((option) => option.id === parentId) ?? null;

    return (
        <Field label="Parent" error={errors.parentId?.message} icon={<GitBranch size={14} />}>
            <Select
                value={parentId ?? NONE}
                onValueChange={(next) =>
                    setValue('parentId', next === NONE ? null : next, { shouldDirty: true })
                }
            >
                <SelectTrigger className="w-full" aria-label="Parent ticket" disabled={readOnly}>
                    <SelectValue placeholder="No parent" />
                </SelectTrigger>
                <SelectContent>
                    {type !== 'SUBTASK' && (
                        <SelectItem value={NONE} textValue="No parent (root)">
                            No parent (root)
                        </SelectItem>
                    )}
                    {options.length === 0 && type === 'SUBTASK' && (
                        <SelectItem value={NONE} textValue="No eligible parent" disabled>
                            No eligible parent — create one first
                        </SelectItem>
                    )}
                    {options.map((option) => (
                        <SelectItem
                            key={option.id}
                            value={option.id}
                            textValue={`${formatTicketId(projectSlug, option.ticketNumber, { padded: true })} ${option.title}`}
                        >
                            {formatTicketId(projectSlug, option.ticketNumber, { padded: true })} ·{' '}
                            {TICKET_TYPE_DISPLAY[option.type]} · {option.title}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {selected && (
                <p className="text-xs text-muted-foreground">
                    Nested under a {TICKET_TYPE_DISPLAY[selected.type]}
                </p>
            )}
        </Field>
    );
}
