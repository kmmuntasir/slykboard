import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ManualEntryForm } from './ManualEntryForm';
import { addManualEntry } from '@/api/timer';

// DEL-03 T3 — ManualEntryForm tests. The component was de-nested from a
// <form> into a <div role="group" aria-label="Manual time entry">; submit is a
// type="button" + onClick handler, and BOTH <TextInput>s Enter-to-submit via
// onKeyDown. These tests assert that new structure + behavior. The whole timer
// API is mocked wholesale so no network/React-Query cache noise leaks in.
vi.mock('@/api/timer', () => ({
    startTimer: vi.fn(),
    stopTimer: vi.fn(),
    fetchActiveTimer: vi.fn(),
    fetchTimeEntries: vi.fn(),
    addManualEntry: vi.fn().mockResolvedValue({ id: 'e1' }),
}));

const TICKET_ID = 't1';
const ERROR_TEXT = 'Enter a duration between 1m and 1440m (24h)';

function newQueryClient(): QueryClient {
    // Fresh client per test → no cross-test cache bleed.
    return new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
}

function renderForm() {
    const client = newQueryClient();
    const utils = render(
        <QueryClientProvider client={client}>
            <ManualEntryForm ticketId={TICKET_ID} />
        </QueryClientProvider>,
    );
    return { ...utils, client };
}

describe('ManualEntryForm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    afterEach(cleanup);

    // 1. De-nesting contract: group role + accessible name, NO <form>.
    it('renders as a group named "Manual time entry" and contains no nested <form>', () => {
        const { container } = renderForm();

        expect(screen.getByRole('group', { name: 'Manual time entry' })).toBeInTheDocument();
        expect(container.querySelector('form')).toBeNull();
    });

    // 2a. Valid duration bounds via the Log Time button-click path.
    // NOTE: the DEL-03 ticket table lists '2h 30m' -> 180, but 2h 30m is
    // 150 minutes (2*60+30); 180 would be 3h. parseDuration correctly yields
    // 150, so we assert the mathematically-correct value here (see report).
    it.each([
        { input: '1m', minutes: 1 },
        { input: '90', minutes: 90 },
        { input: '2h 30m', minutes: 150 },
        { input: '24h', minutes: 1440 },
        { input: '1440m', minutes: 1440 },
    ])(
        'accepts a valid duration "$input" and POSTs $minutes minutes via Log Time',
        async ({ input, minutes }) => {
            renderForm();

            fireEvent.change(screen.getByLabelText('Duration'), { target: { value: input } });
            fireEvent.click(screen.getByRole('button', { name: 'Log Time' }));

            await waitFor(() =>
                expect(vi.mocked(addManualEntry)).toHaveBeenCalledWith(TICKET_ID, {
                    minutes,
                    description: undefined,
                }),
            );
        },
    );

    // 2b. Invalid duration bounds: shows the error and never calls the mutation.
    it.each([
        { name: 'empty', value: '' },
        { name: 'non-numeric', value: 'abc' },
        { name: 'zero minutes', value: '0m' },
        { name: 'one over the max', value: '1441m' },
        { name: 'over 24h', value: '25h' },
    ])(
        'rejects invalid duration ($name): shows the bounds error, skips the mutation',
        ({ value }) => {
            renderForm();

            fireEvent.change(screen.getByLabelText('Duration'), { target: { value } });
            fireEvent.click(screen.getByRole('button', { name: 'Log Time' }));

            expect(screen.getByText(ERROR_TEXT)).toBeInTheDocument();
            expect(vi.mocked(addManualEntry)).not.toHaveBeenCalled();
        },
    );

    // 3. Description trimming.
    it.each([
        { name: 'whitespace-only collapses to undefined', desc: '   ', expected: undefined },
        { name: 'surrounding whitespace is trimmed', desc: '  Meeting  ', expected: 'Meeting' },
    ])('trims the description: $name', async ({ desc, expected }) => {
        renderForm();

        fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '90' } });
        fireEvent.change(screen.getByLabelText('Description'), { target: { value: desc } });
        fireEvent.click(screen.getByRole('button', { name: 'Log Time' }));

        await waitFor(() =>
            expect(vi.mocked(addManualEntry)).toHaveBeenCalledWith(TICKET_ID, {
                minutes: 90,
                description: expected,
            }),
        );
    });

    // 4. Explicit button-click submit payload (no description entered).
    it('fires the mutation with { minutes, description: undefined } via button click', async () => {
        renderForm();

        fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '90' } });
        fireEvent.click(screen.getByRole('button', { name: 'Log Time' }));

        await waitFor(() =>
            expect(vi.mocked(addManualEntry)).toHaveBeenCalledWith(TICKET_ID, {
                minutes: 90,
                description: undefined,
            }),
        );
    });

    // 5. Clears both fields on success.
    it('clears the Duration and Description fields after a successful submit', async () => {
        renderForm();

        fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '90' } });
        fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Standup' } });
        fireEvent.click(screen.getByRole('button', { name: 'Log Time' }));

        await waitFor(() => {
            expect(screen.getByLabelText('Duration')).toHaveValue('');
            expect(screen.getByLabelText('Description')).toHaveValue('');
        });
    });

    // 6. Enter-to-submit on the Duration input.
    it('submits when Enter is pressed inside the Duration input', async () => {
        renderForm();

        const durationInput = screen.getByLabelText('Duration');
        fireEvent.change(durationInput, { target: { value: '90' } });
        fireEvent.keyDown(durationInput, { key: 'Enter' });

        await waitFor(() =>
            expect(vi.mocked(addManualEntry)).toHaveBeenCalledWith(TICKET_ID, {
                minutes: 90,
                description: undefined,
            }),
        );
    });

    // 7. Enter-to-submit on the Description input.
    it('submits when Enter is pressed inside the Description input', async () => {
        renderForm();

        fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '90' } });
        const descriptionInput = screen.getByLabelText('Description');
        fireEvent.change(descriptionInput, { target: { value: 'Sprint planning' } });
        fireEvent.keyDown(descriptionInput, { key: 'Enter' });

        await waitFor(() =>
            expect(vi.mocked(addManualEntry)).toHaveBeenCalledWith(TICKET_ID, {
                minutes: 90,
                description: 'Sprint planning',
            }),
        );
    });

    // 8. Pending/disabled state: mutation pending -> button reads "Logging…" and is disabled.
    it('shows a disabled "Logging…" button while the mutation is pending', async () => {
        // Never-resolving promise keeps isPending true for this one call only.
        vi.mocked(addManualEntry).mockReturnValueOnce(new Promise(() => {}));

        renderForm();
        fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '90' } });
        fireEvent.click(screen.getByRole('button', { name: 'Log Time' }));

        await waitFor(() => {
            const button = screen.getByRole('button', { name: 'Logging…' });
            expect(button).toBeDisabled();
        });
    });

    // 9. Validation error renders visibly + accessible inside the group on bounds failure.
    it('renders the bounds validation message visibly when the duration is out of range', () => {
        renderForm();

        fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '0m' } });
        fireEvent.click(screen.getByRole('button', { name: 'Log Time' }));

        const error = screen.getByText(ERROR_TEXT);
        expect(error).toBeInTheDocument();
        expect(error).toHaveClass('text-destructive');
    });
});
