import { useMemo } from 'react';
import { useFormContext } from 'react-hook-form';
import { CalendarClock } from 'lucide-react';

import { DatePicker, DatePickerTrigger } from '@/components/ui/DatePicker';
import { Field } from '@/components/ui/Field';
import type { TicketFormValues } from '@/hooks/useTicketForm';

export function DueDateField() {
    const { watch, setValue } = useFormContext<TicketFormValues>();

    // eslint-disable-next-line react-hooks/incompatible-library
    const dueDate = watch('dueDate') ?? null;

    const dueDateQuickPicks = useMemo(() => {
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        const nextWeek = new Date(today);
        nextWeek.setDate(today.getDate() + 7);
        const nextMonth = new Date(today);
        nextMonth.setMonth(today.getMonth() + 1);
        return [
            { label: 'Today', date: today },
            { label: 'Tomorrow', date: tomorrow },
            { label: 'Next week', date: nextWeek },
            { label: 'Next month', date: nextMonth },
            { label: 'No date', date: null },
        ];
    }, []);

    return (
        <Field label="Due date" icon={<CalendarClock size={14} />}>
            <DatePicker
                value={dueDate ? new Date(dueDate) : null}
                onChange={(date) => {
                    if (date) {
                        const utc = new Date(
                            Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
                        );
                        setValue('dueDate', utc.toISOString());
                    } else {
                        setValue('dueDate', null);
                    }
                }}
                clearable
                quickPicks={dueDateQuickPicks}
                aria-label="Due date"
            >
                <DatePickerTrigger />
            </DatePicker>
        </Field>
    );
}
