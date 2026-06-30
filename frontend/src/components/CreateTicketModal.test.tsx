import { describe, it, expect, vi, beforeEach } from 'vitest';
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
        </select>
    ),
}));
vi.mock('./LabelMultiSelect', () => ({
    LabelMultiSelect: ({
        value,
        onChange,
    }: {
        projectSlug: string;
        value: string[];
        onChange: (ids: string[]) => void;
    }) => (
        <div aria-label="Labels">
            <button type="button" onClick={() => onChange(value)}>
                labels
            </button>
        </div>
    ),
}));
// DEL-01 T6: StatusField owns its columns fetch (useProject); stub it here so
// the create-modal test stays focused on the create contract. The field's data
// path is covered by its own tests.
vi.mock('./ticket-fields/StatusField', () => ({
    StatusField: () => (
        <select aria-label="Status">
            <option value="">Select column</option>
        </select>
    ),
}));

const mutateAsync = vi.fn();
vi.mock('@/hooks/useCreateTicket', () => ({
    useCreateTicket: () => ({ mutateAsync, mutate: mutateAsync }),
}));

import { CreateTicketModal } from './CreateTicketModal';

describe('CreateTicketModal', () => {
    beforeEach(() => mutateAsync.mockReset());

    it('renders nothing when open=false', () => {
        const { container } = render(
            <CreateTicketModal open={false} onClose={vi.fn()} slug="SLYK" />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('renders form with Create ticket button when open=true', () => {
        render(<CreateTicketModal open={true} onClose={vi.fn()} slug="SLYK" />);
        // F16: Modal uses aria-labelledby (→ the visible <h2>) instead of aria-label.
        expect(screen.getByRole('dialog', { name: 'Create ticket' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Create ticket' })).toBeInTheDocument();
    });

    it('submit calls mutateAsync with full DTO + statusColumn then onClose', async () => {
        const onClose = vi.fn();
        mutateAsync.mockResolvedValueOnce({});
        render(<CreateTicketModal open={true} onClose={onClose} slug="SLYK" columnId="TODO" />);
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'My ticket' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
        await waitFor(() => {
            expect(mutateAsync).toHaveBeenCalledTimes(1);
        });
        expect(mutateAsync).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'My ticket',
                statusColumn: 'TODO',
                priority: 'MEDIUM',
            }),
        );
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('cancel calls onClose without mutation', () => {
        const onClose = vi.fn();
        render(<CreateTicketModal open={true} onClose={onClose} slug="SLYK" />);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalled();
        expect(mutateAsync).not.toHaveBeenCalled();
    });
});
