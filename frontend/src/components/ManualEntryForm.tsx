import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { Button } from './ui/Button';
import { TextInput } from './ui/TextInput';
import { addManualEntry } from '@/api/timer';
import { timerKeys } from '@/api/queryKeys';
import { parseDuration } from '@/utils/parseDuration';

// F21: compact manual time-entry form. Parses a human duration ('2h 30m',
// '90m', or a bare minute count), validates the 1-1440 cap, then POSTs to
// /tickets/:id/timer/manual. On success it invalidates the TimeLog cache and
// clears the form.
interface ManualEntryFormProps {
    ticketId: string;
}

const MIN_MINUTES = 1;
const MAX_MINUTES = 1440; // 24h
const MAX_DESCRIPTION = 500;

export function ManualEntryForm({ ticketId }: ManualEntryFormProps) {
    const queryClient = useQueryClient();
    const [duration, setDuration] = useState('');
    const [description, setDescription] = useState('');
    const [validationError, setValidationError] = useState<string | null>(null);

    const mutation = useMutation({
        mutationFn: (vars: { minutes: number; description?: string }) =>
            addManualEntry(ticketId, vars),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: timerKeys.entries(ticketId) });
            setDuration('');
            setDescription('');
            setValidationError(null);
        },
    });

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        const minutes = parseDuration(duration);
        if (minutes === null || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
            setValidationError('Enter a duration between 1m and 1440m (24h)');
            return;
        }
        setValidationError(null);
        void mutation.mutate({
            minutes,
            description: description.trim() || undefined,
        });
    };

    // Mutation errors surface as a message; validation errors take precedence so
    // the user sees the actionable constraint message first.
    const errorMessage =
        validationError ?? (mutation.error instanceof Error ? mutation.error.message : null);

    return (
        <form onSubmit={handleSubmit} className="mt-3 border-t border-border pt-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <TextInput
                    type="text"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    placeholder="2h 30m, 90m, or 90"
                    aria-label="Duration"
                    className="flex-1 text-sm"
                />
                <TextInput
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Description (optional)"
                    maxLength={MAX_DESCRIPTION}
                    aria-label="Description"
                    className="flex-1 text-sm"
                />
                <Button type="submit" variant="primary" size="sm" disabled={mutation.isPending}>
                    {mutation.isPending ? 'Logging…' : 'Log Time'}
                </Button>
            </div>
            {errorMessage && <p className="mt-1 text-sm text-destructive">{errorMessage}</p>}
        </form>
    );
}
