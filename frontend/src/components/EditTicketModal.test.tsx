import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';

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
            <option value="11111111-1111-1111-1111-111111111111">Ada</option>
        </select>
    ),
}));

const fetchTicket = vi.fn();
const updateMutateAsync = vi.fn();

vi.mock('@/api/tickets', () => ({
    fetchTicket: (...args: unknown[]) => fetchTicket(...(args as [string])),
}));
vi.mock('@/hooks/useUpdateTicket', () => ({
    useUpdateTicket: () => ({ mutateAsync: updateMutateAsync }),
}));

import { EditTicketModal } from './EditTicketModal';
import type { Ticket } from '@/types/ticket';

const TICKET: Ticket = {
    id: 't1',
    ticketNumber: 101,
    title: 'Edit me',
    description: '<p>body</p>',
    statusColumn: 'TODO',
    position: 0,
    priority: 'HIGH',
    labels: [],
    assignee: { id: '11111111-1111-1111-1111-111111111111', fullName: 'Ada', avatarUrl: null },
    creatorId: 'c1',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
};

function renderWithClient(ui: ReactElement) {
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('EditTicketModal', () => {
    beforeEach(() => {
        fetchTicket.mockReset();
        updateMutateAsync.mockReset();
    });

    it('renders nothing when open=false', () => {
        const { container } = renderWithClient(
            <EditTicketModal open={false} onClose={vi.fn()} ticketId="t1" slug="SLYK" />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('renders nothing when ticketId is null', () => {
        const { container } = renderWithClient(
            <EditTicketModal open={true} onClose={vi.fn()} ticketId={null} slug="SLYK" />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('fetches ticket and prefills form when open=true', async () => {
        fetchTicket.mockResolvedValueOnce(TICKET);
        renderWithClient(
            <EditTicketModal open={true} onClose={vi.fn()} ticketId="t1" slug="SLYK" />,
        );
        await waitFor(() => expect(fetchTicket).toHaveBeenCalledWith('t1'));
        await waitFor(() => {
            expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Edit me');
        });
    });

    it('submit calls updateMutateAsync with {ticketId, dto, slug} then onClose', async () => {
        fetchTicket.mockResolvedValueOnce(TICKET);
        updateMutateAsync.mockResolvedValueOnce({});
        const onClose = vi.fn();
        renderWithClient(
            <EditTicketModal open={true} onClose={onClose} ticketId="t1" slug="SLYK" />,
        );
        await waitFor(() =>
            expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Edit me'),
        );
        fireEvent.change(screen.getByLabelText('Title'), {
            target: { value: 'Updated title' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        await waitFor(() => expect(updateMutateAsync).toHaveBeenCalledTimes(1));
        expect(updateMutateAsync).toHaveBeenCalledWith({
            ticketId: 't1',
            dto: expect.objectContaining({ title: 'Updated title' }),
            slug: 'SLYK',
        });
        await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    it('cancel calls onClose without mutation', async () => {
        fetchTicket.mockResolvedValueOnce(TICKET);
        const onClose = vi.fn();
        renderWithClient(
            <EditTicketModal open={true} onClose={onClose} ticketId="t1" slug="SLYK" />,
        );
        await waitFor(() =>
            expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Edit me'),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onClose).toHaveBeenCalled();
        expect(updateMutateAsync).not.toHaveBeenCalled();
    });
});
