import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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

const mutateAsync = vi.fn();
vi.mock('@/hooks/useCreateTicket', () => ({
    useCreateTicket: () => ({ mutateAsync, mutate: mutateAsync }),
}));

import { NewTicketButton } from './NewTicketButton';

describe('NewTicketButton', () => {
    beforeEach(() => mutateAsync.mockReset());

    it('renders trigger button and no dialog by default', () => {
        render(<NewTicketButton slug="SLYK" />);
        expect(screen.getByRole('button', { name: 'New ticket' })).toBeInTheDocument();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('clicking trigger opens CreateTicketModal dialog', () => {
        render(<NewTicketButton slug="SLYK" />);
        fireEvent.click(screen.getByRole('button', { name: 'New ticket' }));
        expect(screen.getByRole('dialog', { name: 'Create ticket' })).toBeInTheDocument();
    });
});
