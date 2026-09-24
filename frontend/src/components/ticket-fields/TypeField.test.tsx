import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FormProvider } from 'react-hook-form';

import { TypeField } from './TypeField';
import { useTicketForm } from '@/hooks/useTicketForm';

// CR-03: type selector — options render + selection writes through the form.

function Harness() {
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
            type: 'TASK',
            parentId: null,
        },
        onSubmit: () => {},
    });
    return (
        <FormProvider {...methods}>
            <TypeField />
            <span data-testid="type-value">{methods.watch('type')}</span>
        </FormProvider>
    );
}

describe('TypeField (CR-03)', () => {
    it('renders the four hierarchy types with display labels', async () => {
        render(<Harness />);
        fireEvent.pointerDown(screen.getByLabelText('Ticket type'), { button: 0 });
        expect(await screen.findByRole('menuitem', { name: 'Epic' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Story' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Task' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Subtask' })).toBeInTheDocument();
    });

    it('writes the chosen type into the form', async () => {
        render(<Harness />);
        fireEvent.pointerDown(screen.getByLabelText('Ticket type'), { button: 0 });
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Epic' }));
        await waitFor(() => expect(screen.getByTestId('type-value')).toHaveTextContent('EPIC'));
    });
});
