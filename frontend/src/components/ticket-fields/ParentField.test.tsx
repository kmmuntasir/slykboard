import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FormProvider } from 'react-hook-form';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ParentField } from './ParentField';
import { useTicketForm, eligibleParents } from '@/hooks/useTicketForm';
import type { TicketFormValues } from '@/hooks/useTicketForm';
import type { TicketType } from '@/types/ticket';

// CR-03: parent selector — only tickets that STRICTLY outrank the selected type
// are offered; a subtask must pick one (schema enforces non-null).

// Ids are real UUIDs — the form schema validates parentId with z.string().uuid().
const CANDIDATES = [
    {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Payments epic',
        ticketNumber: 1,
        type: 'EPIC' as TicketType,
    },
    {
        id: '22222222-2222-4222-8222-222222222222',
        title: 'Checkout story',
        ticketNumber: 2,
        type: 'STORY' as TicketType,
    },
    {
        id: '33333333-3333-4333-8333-333333333333',
        title: 'API task',
        ticketNumber: 3,
        type: 'TASK' as TicketType,
    },
    {
        id: '44444444-4444-4444-8444-444444444444',
        title: 'Hook subtask',
        ticketNumber: 4,
        type: 'SUBTASK' as TicketType,
    },
];
const EPIC_ID = '11111111-1111-4111-8111-111111111111';

function wrapper({ children }: { children: React.ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function Harness({
    type,
    onSubmit,
}: {
    type: TicketType;
    onSubmit: (v: TicketFormValues) => void;
}) {
    const methods = useTicketForm({
        defaultValues: {
            title: 'T',
            description: '',
            priority: 'MEDIUM',
            assigneeId: null,
            labelIds: [],
            checklist: [],
            statusColumn: 'todo',
            startDate: '2026-01-01T00:00:00.000Z',
            endDate: '2026-01-08T00:00:00.000Z',
            type,
            parentId: null,
        },
        onSubmit,
    });
    return (
        <FormProvider {...methods}>
            <ParentField projectSlug="SLYK" candidates={CANDIDATES} />
            <span data-testid="parent-value">{methods.watch('parentId') ?? 'none'}</span>
            <button type="button" onClick={methods.handleSubmit(onSubmit)}>
                submit
            </button>
        </FormProvider>
    );
}

describe('eligibleParents (CR-03)', () => {
    it('offers only strictly-higher-ranked tickets', () => {
        expect(eligibleParents(CANDIDATES, 'TASK').map((c) => c.id)).toEqual([
            CANDIDATES[0]!.id,
            CANDIDATES[1]!.id,
        ]);
        expect(eligibleParents(CANDIDATES, 'STORY').map((c) => c.id)).toEqual([CANDIDATES[0]!.id]);
        expect(eligibleParents(CANDIDATES, 'EPIC')).toEqual([]);
        expect(eligibleParents(CANDIDATES, 'SUBTASK').map((c) => c.id)).toEqual([
            CANDIDATES[0]!.id,
            CANDIDATES[1]!.id,
            CANDIDATES[2]!.id,
        ]);
    });
});

describe('ParentField (CR-03)', () => {
    it('offers root + eligible parents for a TASK (siblings excluded)', async () => {
        render(<Harness type="TASK" onSubmit={vi.fn()} />, { wrapper });
        fireEvent.pointerDown(screen.getByLabelText('Parent ticket'), { button: 0 });
        expect(
            await screen.findByRole('menuitem', { name: 'No parent (root)' }),
        ).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: /Payments epic/ })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: /Checkout story/ })).toBeInTheDocument();
        // A TASK sibling does not outrank TASK.
        expect(screen.queryByRole('menuitem', { name: /API task/ })).not.toBeInTheDocument();
    });

    it('hides the root option for a SUBTASK and blocks submit without a parent', async () => {
        const onSubmit = vi.fn();
        render(<Harness type="SUBTASK" onSubmit={onSubmit} />, { wrapper });
        fireEvent.pointerDown(screen.getByLabelText('Parent ticket'), { button: 0 });
        expect(
            screen.queryByRole('menuitem', { name: 'No parent (root)' }),
        ).not.toBeInTheDocument();
        fireEvent.keyDown(document.body, { key: 'Escape' });

        fireEvent.click(screen.getByRole('button', { name: 'submit' }));
        await waitFor(() => {
            expect(screen.getByText('A subtask must have a parent ticket')).toBeInTheDocument();
        });
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('writes the selected parent into the form and submits', async () => {
        const onSubmit = vi.fn();
        render(<Harness type="STORY" onSubmit={onSubmit} />, { wrapper });
        fireEvent.pointerDown(screen.getByLabelText('Parent ticket'), { button: 0 });
        fireEvent.click(await screen.findByRole('menuitem', { name: /Payments epic/ }));
        await waitFor(() => expect(screen.getByTestId('parent-value')).toHaveTextContent(EPIC_ID));
        fireEvent.keyDown(document.body, { key: 'Escape' });
        fireEvent.click(screen.getByRole('button', { name: 'submit' }));
        await waitFor(() => expect(onSubmit).toHaveBeenCalled());
        // handleSubmit passes (values, event) — assert the values payload only.
        expect(onSubmit.mock.calls[0]![0]).toEqual(expect.objectContaining({ parentId: EPIC_ID }));
    });
});
