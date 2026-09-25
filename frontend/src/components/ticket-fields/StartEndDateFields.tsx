import { useFormContext } from 'react-hook-form';
import { CalendarClock, Flag } from 'lucide-react';

import { Field } from '@/components/ui/Field';
import { TextInput } from '@/components/ui/TextInput';
import type { TicketFormValues } from '@/hooks/useTicketForm';

// CR-10: the required Start/End window (endDate is the due date). Start is
// pre-filled with "right now" on the create form (editable, submitted
// explicitly); End must be picked by hand. Native datetime-local inputs keep
// the time-of-day the "right now" default implies — a date-only picker cannot.

function toLocalInputValue(iso: string | null | undefined): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
        date.getHours(),
    )}:${pad(date.getMinutes())}`;
}

interface StartEndDateFieldsProps {
    readOnly?: boolean;
}

export function StartEndDateFields({ readOnly }: StartEndDateFieldsProps) {
    const {
        watch,
        setValue,
        formState: { errors },
    } = useFormContext<TicketFormValues>();

    const startDate = watch('startDate');

    const endDate = watch('endDate');

    return (
        <div className="space-y-4">
            <Field label="Start" icon={<CalendarClock size={14} />}>
                <TextInput
                    type="datetime-local"
                    aria-label="Start date"
                    value={toLocalInputValue(startDate)}
                    disabled={readOnly}
                    onChange={(e) => {
                        // datetime-local has no zone; the browser's local time
                        // is the user's intent, so normalize to an ISO instant.
                        const picked = e.target.value ? new Date(e.target.value).toISOString() : '';
                        setValue('startDate', picked, { shouldDirty: true });
                    }}
                />
            </Field>
            <Field label="End (due)" icon={<Flag size={14} />} error={errors.endDate?.message}>
                <TextInput
                    type="datetime-local"
                    aria-label="End date"
                    value={toLocalInputValue(endDate)}
                    disabled={readOnly}
                    onChange={(e) => {
                        const picked = e.target.value ? new Date(e.target.value).toISOString() : '';
                        setValue('endDate', picked, { shouldDirty: true });
                    }}
                />
            </Field>
        </div>
    );
}
