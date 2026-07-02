import { describe, it, expect } from 'vitest';
import { ticketFormSchema, TICKET_DESCRIPTION_MAX_LENGTH } from './useTicketForm';

/**
 * DEL-03 T5: lock the unified description length ceiling at the schema level,
 * independent of the component test. The 10_000 limit is shared by create + edit
 * (see `useTicketForm`), so this guards the schema boundary directly.
 */

/** A complete, valid `TicketFormValues` object with a variable description. */
const validWith = (description: string) => ({
    title: 'Valid title',
    description,
    priority: 'MEDIUM' as const,
    assigneeId: null,
    labelIds: [],
    checklist: [],
    statusColumn: 'todo',
    dueDate: null,
});

describe.each([
    { chars: TICKET_DESCRIPTION_MAX_LENGTH + 1, accepted: false },
    { chars: TICKET_DESCRIPTION_MAX_LENGTH, accepted: true },
])('ticketFormSchema description length (chars=$chars)', ({ chars, accepted }) => {
    const description = 'x'.repeat(chars);

    it(accepted ? 'accepts at the limit' : 'rejects over the limit', () => {
        const result = ticketFormSchema.safeParse(validWith(description));

        if (accepted) {
            expect(result.success).toBe(true);
            return;
        }

        expect(result.success).toBe(false);
        if (!result.success) {
            const message = result.error.issues
                .find((issue) => issue.path.join('.') === 'description')
                ?.message;
            expect(message).toContain(
                `Description must be ${TICKET_DESCRIPTION_MAX_LENGTH} chars or fewer`,
            );
        }
    });
});
