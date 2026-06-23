import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('./RichTextEditor', () => ({
    RichTextEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
        <textarea
            aria-label="Description"
            value={value}
            onChange={(e) => onChange(e.target.value)}
        />
    ),
}));
vi.mock('./PrioritySelect', () => ({
    PrioritySelect: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
        <select aria-label="Priority" value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
            <option value="CRITICAL">Critical</option>
        </select>
    ),
}));
vi.mock('./UserSelect', () => ({
    UserSelect: ({
        value,
        onChange,
    }: {
        value: string | null;
        onChange: (v: string | null) => void;
    }) => (
        <select
            aria-label="Assignee"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
        >
            <option value="">Unassigned</option>
            <option value="11111111-1111-1111-1111-111111111111">Alice</option>
        </select>
    ),
}));

import { TicketAttributeForm } from './TicketAttributeForm';
import type { UpdateTicketDto } from '@/types/ticket';

const baseDefaults = {
    title: '',
    description: '',
    priority: 'MEDIUM' as const,
    assigneeId: null,
};

describe('TicketAttributeForm', () => {
    it('create mode renders all controls + Create ticket button', () => {
        render(
            <TicketAttributeForm
                mode="create"
                defaultValues={baseDefaults}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        expect(screen.getByLabelText('Title')).toBeInTheDocument();
        expect(screen.getByLabelText('Description')).toBeInTheDocument();
        expect(screen.getByLabelText('Priority')).toBeInTheDocument();
        expect(screen.getByLabelText('Assignee')).toBeInTheDocument();
        expect(
            screen.getByRole('button', { name: 'Create ticket' }),
        ).toBeInTheDocument();
    });

    it('edit mode renders Save changes button + prefilled defaults', () => {
        const defaults = {
            title: 'Existing ticket',
            description: '<p>prefilled</p>',
            priority: 'HIGH' as const,
            assigneeId: '11111111-1111-1111-1111-111111111111',
        };
        render(
            <TicketAttributeForm
                mode="edit"
                defaultValues={defaults}
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
            />,
        );
        expect(
            screen.getByRole('button', { name: 'Save changes' }),
        ).toBeInTheDocument();
        expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
            'Existing ticket',
        );
        expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe(
            '<p>prefilled</p>',
        );
        expect((screen.getByLabelText('Priority') as HTMLSelectElement).value).toBe('HIGH');
        expect((screen.getByLabelText('Assignee') as HTMLSelectElement).value).toBe(
            '11111111-1111-1111-1111-111111111111',
        );
    });

    it('empty title blocks submit + shows validation error', async () => {
        const onSubmit = vi.fn();
        render(
            <TicketAttributeForm
                mode="create"
                defaultValues={baseDefaults}
                onSubmit={onSubmit}
                onCancel={vi.fn()}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
        await waitFor(() => {
            expect(screen.getByText('Title is required')).toBeInTheDocument();
        });
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('title > 200 chars blocks submit + shows error', async () => {
        const onSubmit = vi.fn();
        render(
            <TicketAttributeForm
                mode="create"
                defaultValues={baseDefaults}
                onSubmit={onSubmit}
                onCancel={vi.fn()}
            />,
        );
        const long = 'a'.repeat(201);
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: long } });
        fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
        await waitFor(() => {
            expect(screen.getByText('Title must be 200 chars or fewer')).toBeInTheDocument();
        });
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('description > 5000 chars blocks submit + shows error', async () => {
        const onSubmit = vi.fn();
        render(
            <TicketAttributeForm
                mode="create"
                defaultValues={baseDefaults}
                onSubmit={onSubmit}
                onCancel={vi.fn()}
            />,
        );
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Valid title' } });
        const long = 'a'.repeat(5001);
        fireEvent.change(screen.getByLabelText('Description'), {
            target: { value: long },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
        await waitFor(() => {
            expect(
                screen.getByText('Description must be 5000 chars or fewer'),
            ).toBeInTheDocument();
        });
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('valid submit calls onSubmit with assembled UpdateTicketDto', async () => {
        const onSubmit = vi.fn<(dto: UpdateTicketDto) => void>();
        render(
            <TicketAttributeForm
                mode="create"
                defaultValues={baseDefaults}
                onSubmit={onSubmit}
                onCancel={vi.fn()}
            />,
        );
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New bug' } });
        fireEvent.change(screen.getByLabelText('Description'), {
            target: { value: '<p>steps</p>' },
        });
        fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'HIGH' } });
        fireEvent.change(screen.getByLabelText('Assignee'), {
            target: { value: '11111111-1111-1111-1111-111111111111' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
        await waitFor(() => {
            expect(onSubmit).toHaveBeenCalledTimes(1);
        });
        expect(onSubmit).toHaveBeenCalledWith({
            title: 'New bug',
            description: '<p>steps</p>',
            priority: 'HIGH',
            assigneeId: '11111111-1111-1111-1111-111111111111',
        });
    });

    it('cancel button calls onCancel', () => {
        const onCancel = vi.fn();
        const onSubmit = vi.fn();
        render(
            <TicketAttributeForm
                mode="create"
                defaultValues={baseDefaults}
                onSubmit={onSubmit}
                onCancel={onCancel}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onSubmit).not.toHaveBeenCalled();
    });
});
