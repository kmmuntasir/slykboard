import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';

// --- Leaf-editor mocks (reuse the TicketAttributeForm.test.tsx pattern) ------
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
    }: {
        projectSlug: string;
        value: string[];
        onChange: (ids: string[]) => void;
    }) => (
        <div aria-label="Labels">
            <span data-testid="label-value">{value.join(',')}</span>
        </div>
    ),
}));

vi.mock('@/api/tickets');

import { TicketDetailModal } from './TicketDetailModal';
import { fetchTicket } from '@/api/tickets';
import { ticketKeys } from '@/api/queryKeys';
import type { Ticket } from '@/types/ticket';

// --- Fixtures ---------------------------------------------------------------

const TICKET_ID = 't101';

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
    return {
        id: TICKET_ID,
        ticketNumber: 101,
        title: 'Render board',
        description: '<p>steps</p>',
        statusColumn: 'TODO',
        position: 0,
        priority: 'HIGH',
        labels: [],
        checklist: [],
        assignee: null,
        creator: { id: 'u1', fullName: 'Ada Lovelace', avatarUrl: 'https://example.com/a.png' },
        creatorId: 'u1',
        createdAt: '2026-06-01T00:00:00.000Z',
        updatedAt: '2026-06-02T00:00:00.000Z',
        ...overrides,
    };
}

// --- Harness ----------------------------------------------------------------

function newQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
}

// useBlocker requires a data router, so wrap in createMemoryRouter.
function Providers({
    client,
    children,
}: {
    client: QueryClient;
    children: ReactNode;
}) {
    const router = createMemoryRouter([
        {
            path: '/',
            element: <>{children}</>,
        },
    ]);
    return createElement(QueryClientProvider, { client }, createElement(RouterProvider, { router }));
}

function renderModal(
    overrides: { ticket?: Ticket; onSubmit?: (dto: unknown) => Promise<void> } = {},
) {
    const ticket = overrides.ticket ?? makeTicket();
    const onClose = vi.fn();
    const onSubmit = overrides.onSubmit ?? vi.fn().mockResolvedValue(undefined);
    vi.mocked(fetchTicket).mockResolvedValue(ticket);

    const client = newQueryClient();
    const utils = render(
        <Providers client={client}>
            <TicketDetailModal
                slug="SLYK"
                ticketId={TICKET_ID}
                onClose={onClose}
                onSubmit={onSubmit}
            />
        </Providers>,
    );
    return { ...utils, onClose, onSubmit, client, ticket };
}

describe('TicketDetailModal', () => {
    let appRoot: HTMLElement;

    beforeEach(() => {
        vi.clearAllMocks();
        appRoot = document.createElement('main');
        appRoot.id = 'app-root';
        document.body.appendChild(appRoot);
    });

    afterEach(() => {
        appRoot.remove();
        cleanup();
    });

    it('renders the modal title as the display ID (SLUG-NNN)', async () => {
        renderModal();
        expect(await screen.findByRole('dialog', { name: 'SLYK-101' })).toBeInTheDocument();
    });

    it('renders "Created by {creator.fullName}" and the creator avatar', async () => {
        renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });
        expect(screen.getByText('Created by Ada Lovelace')).toBeInTheDocument();
        // The avatar <img> has alt="" (decorative), so it is NOT in the a11y tree;
        // assert via the document-level element instead.
        const avatar = document.querySelector('img[src="https://example.com/a.png"]');
        expect(avatar).not.toBeNull();
    });

    it('renders Created/Updated timestamp rows', async () => {
        renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });
        // formatDate renders both rows with a leading label.
        const rows = screen.getAllByText(/^(Created|Updated):/);
        expect(rows).toHaveLength(2);
        expect(rows[0]!.textContent).toMatch(/^Created:/);
        expect(rows[1]!.textContent).toMatch(/^Updated:/);
    });

    it('renders the embedded TicketAttributeForm with the title seeded', async () => {
        renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });
        expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Render board');
        expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    });

    it('returns null (no dialog) while the ticket is loading', () => {
        // Never-resolving fetchTicket so the query stays pending.
        vi.mocked(fetchTicket).mockReturnValue(new Promise(() => {}));
        const client = newQueryClient();
        const { container } = render(
            <Providers client={client}>
                <TicketDetailModal
                    slug="SLYK"
                    ticketId={TICKET_ID}
                    onClose={vi.fn()}
                    onSubmit={vi.fn()}
                />
            </Providers>,
        );
        // No dialog yet; the only rendered output is the (unportalled) null branch.
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(container).toBeEmptyDOMElement();
    });

    it('submit: editing the title + Save calls onSubmit with the new title, then onClose', async () => {
        const { onSubmit, onClose } = renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });

        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New title' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(onSubmit).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'New title' }),
        );
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it('clean form: close button closes immediately (no confirm dialog)', async () => {
        const { onClose } = renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });

        fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('dialog', { name: 'Discard changes?' })).not.toBeInTheDocument();
    });

    it('dirty guard: after editing, the close button opens the confirm dialog instead of closing', async () => {
        const { onClose } = renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });

        // Edit a field → form becomes dirty → guard engages.
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Edited' } });
        await waitFor(() => {
            expect(screen.getByLabelText('Title')).toHaveValue('Edited');
        });

        fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
        // onClose is NOT called yet; the confirm surfaces.
        expect(onClose).not.toHaveBeenCalled();
        expect(await screen.findByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument();
    });

    it('dirty guard: Escape routes through the guard too', async () => {
        const { onClose } = renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });

        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Edited' } });
        await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Edited'));

        // Escape is intercepted by the modal (onEsc = requestClose) → confirm.
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();
        expect(await screen.findByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument();
    });

    it('dirty guard: Discard closes both dialogs and calls onClose', async () => {
        const { onClose } = renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });

        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Edited' } });
        fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
        await screen.findByRole('dialog', { name: 'Discard changes?' });

        fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        // Confirm dismissed.
        expect(screen.queryByRole('dialog', { name: 'Discard changes?' })).not.toBeInTheDocument();
    });

    it('dirty guard: Cancel dismisses the confirm and keeps the modal open', async () => {
        const { onClose } = renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });

        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Edited' } });
        fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
        // Scope to the confirm dialog: both the form and the confirm expose a
        // "Cancel" button, so query within the confirm's dialog node.
        const confirm = await screen.findByRole('dialog', { name: 'Discard changes?' });
        fireEvent.click(
            within(confirm).getByRole('button', { name: 'Cancel' }),
        );

        // Confirm gone, the detail modal stays open, onClose not called.
        expect(screen.queryByRole('dialog', { name: 'Discard changes?' })).not.toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'SLYK-101' })).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('drift: the detail query is configured with refetchInterval 30000', async () => {
        const client = newQueryClient();

        render(
            <Providers client={client}>
                <TicketDetailModal
                    slug="SLYK"
                    ticketId={TICKET_ID}
                    onClose={vi.fn()}
                    onSubmit={vi.fn()}
                />
            </Providers>,
        );
        await screen.findByRole('dialog', { name: 'SLYK-101' });

        // The QueryObserver created by useQuery carries the per-query options
        // (refetchInterval). Inspect the registered observer for our key.
        const cache = client.getQueryCache();
        const observer = cache.find({ queryKey: ticketKeys.detail(TICKET_ID) });
        expect(observer).toBeDefined();
        // refetchInterval is the value the component passed (mirrors the F16
        // drift-reconciliation contract). jsdom can't drive a 30s interval, so
        // assert the option rather than the side effect.
        expect((observer?.options as { refetchInterval?: number }).refetchInterval).toBe(30_000);
        expect((observer?.options as { refetchOnMount?: boolean }).refetchOnMount).toBe(true);
        expect(
            (observer?.options as { refetchOnWindowFocus?: boolean }).refetchOnWindowFocus,
        ).toBe(true);
    });
});
