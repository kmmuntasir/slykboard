import { useFormContext } from 'react-hook-form';
import { CalendarClock } from 'lucide-react';

import { Field } from '@/components/ui/Field';
import type { TicketFormValues } from '@/hooks/useTicketForm';

// DEL-01 T6: due-date field — a themed native <input type="date"> bound to
// watch('dueDate')/setValue('dueDate', iso | null). The backend schema
// (projects.schema.ts / tickets.schema.ts) uses z.string().datetime(), so we
// emit a FULL ISO datetime string, not a bare yyyy-mm-dd.
//
// Conversion:
//   - display: an ISO value "2026-07-15T00:00:00.000Z" → "2026-07-15" (date part).
//   - input  : the picker's yyyy-mm-dd → `${date}T00:00:00.000Z` (full ISO, UTC midnight).
//   - empty  : setValue('dueDate', null).
//
// Themed with the input-family tokens (border-input bg-background text-foreground)
// + the house focus ring, matching TextInput. A native date input reintroduces a
// browser element; a full Radix date-picker is a flagged future enhancement.
const UTC_MIDNIGHT = 'T00:00:00.000Z';
const ISO_DATE_LENGTH = 10; // yyyy-mm-dd

/** Take the date part of an ISO datetime for the native date input. */
function toDateInput(iso: string | null | undefined): string {
    if (!iso) return '';
    // ISO datetime → leading yyyy-mm-dd (10 chars). Robust to the UTC form we emit.
    return iso.slice(0, ISO_DATE_LENGTH);
}

export function DueDateField() {
    const { watch, setValue } = useFormContext<TicketFormValues>();

    // eslint-disable-next-line react-hooks/incompatible-library
    const dueDate = watch('dueDate') ?? null;

    return (
        <Field label="Due date" icon={<CalendarClock size={14} />}>
            <input
                type="date"
                aria-label="Due date"
                value={toDateInput(dueDate)}
                onChange={(e) => {
                    const date = e.target.value;
                    // Match the existing field components: no shouldDirty flag
                    // (the plan preserves the "only title flips isDirty" behavior).
                    setValue('dueDate', date ? `${date}${UTC_MIDNIGHT}` : null);
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary"
            />
        </Field>
    );
}
