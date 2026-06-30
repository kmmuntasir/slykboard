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

// SLYK-11 T4: the Time Tracking tab (forceMount → mounted even when hidden)
// drives these queries. Mock them so the panel renders deterministically
// without real network calls (jsdom) or React Query error noise.
vi.mock('@/api/timer', () => ({
    startTimer: vi.fn().mockResolvedValue({
        entry: { id: 'e1' },
        serverNow: new Date().toISOString(),
    }),
    stopTimer: vi.fn().mockResolvedValue({
        entry: { id: 'e1', startTime: new Date().toISOString(), endTime: new Date().toISOString() },
        serverNow: new Date().toISOString(),
    }),
    fetchActiveTimer: vi.fn().mockResolvedValue({ activeTimer: null }),
    fetchTimeEntries: vi.fn().mockResolvedValue({ entries: [], totalMs: 0 }),
    addManualEntry: vi.fn().mockResolvedValue({ id: 'e1' }),
}));
vi.mock('@/api/time', () => ({
    fetchServerTime: vi.fn().mockResolvedValue({ now: new Date().toISOString() }),
}));

// --- F17 role-gate + delete mutation mocks ---------------------------------
// useRequirePlatformAdmin() controls the delete-button render; useDeleteTicket is
// the delete mutation. Both are module-level vi.fn returns so individual tests
// can flip admin/member and the delete path.
vi.mock('@/hooks/useRequirePlatformAdmin', () => ({
    useRequirePlatformAdmin: vi.fn(() => false),
}));
vi.mock('@/hooks/useDeleteTicket', () => ({
    useDeleteTicket: vi.fn(() => ({
        mutate: vi.fn(),
        mutateAsync: vi.fn().mockResolvedValue(undefined),
        isPending: false,
        isError: false,
        error: null,
    })),
}));

import { TicketDetailModal } from './TicketDetailModal';
import { useRequirePlatformAdmin } from '@/hooks/useRequirePlatformAdmin';
import { useDeleteTicket } from '@/hooks/useDeleteTicket';
import { fetchTicket, fetchTicketActivity } from '@/api/tickets';
import { ticketKeys } from '@/api/queryKeys';
import { formatDate } from '@/utils/formatDate';
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
function Providers({ client, children }: { client: QueryClient; children: ReactNode }) {
    const router = createMemoryRouter([
        {
            path: '/',
            element: <>{children}</>,
        },
    ]);
    return createElement(
        QueryClientProvider,
        { client },
        createElement(RouterProvider, { router }),
    );
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
        // Activity tab default: an empty feed. The @/api/tickets auto-mock
        // returns undefined, which React Query v5 treats as an error; resolve a
        // real shape so the Activity panel renders its (empty) success state.
        vi.mocked(fetchTicketActivity).mockResolvedValue({ entries: [] });
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

    it('renders the dialog at the full width preset (SLYK-09)', async () => {
        renderModal();
        const dialog = await screen.findByRole('dialog', { name: 'SLYK-101' });
        // 'full' preset from Modal.tsx -> max-w-[min(95vw,1400px)] on the [role="dialog"] panel.
        expect(dialog).toHaveClass('max-w-[min(95vw,1400px)]');
        // Guard: the old 'xl' preset class must be gone.
        expect(dialog).not.toHaveClass('max-w-4xl');
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

    it('renders two inline <time> elements with clock icons', async () => {
        renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });
        const times = document.querySelectorAll('time[dateTime]');
        expect(times).toHaveLength(2);
        // First <time> is the createdAt timestamp from the makeTicket fixture.
        expect(times[0]!.getAttribute('dateTime')).toBe('2026-06-01T00:00:00.000Z');
        expect(times[0]!.getAttribute('title')).toBe(formatDate('2026-06-01T00:00:00.000Z'));
        // Second <time> is the updatedAt timestamp.
        expect(times[1]!.getAttribute('dateTime')).toBe('2026-06-02T00:00:00.000Z');
        expect(times[1]!.getAttribute('title')).toBe(formatDate('2026-06-02T00:00:00.000Z'));
        // Each <time> is preceded by a Clock (lucide) icon.
        expect(document.querySelectorAll('svg.lucide-clock').length).toBe(2);
    });

    it('renders Created by Unknown and Unassigned avatar when creator is null', async () => {
        renderModal({ ticket: makeTicket({ creator: null }) });
        await screen.findByRole('dialog', { name: 'SLYK-101' });
        expect(screen.getByText('Created by Unknown')).toBeInTheDocument();
        // Avatar (no src, no name) renders aria-label='Unassigned'.
        expect(document.querySelector('[aria-label="Unassigned"]')).not.toBeNull();
        // No creator avatar <img> renders.
        expect(document.querySelector('img[src="https://example.com/a.png"]')).toBeNull();
        // Timestamps are unaffected by the missing creator.
        expect(document.querySelectorAll('time[dateTime]')).toHaveLength(2);
    });

    it('renders the embedded TicketAttributeForm with the title seeded', async () => {
        renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });
        expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Render board');
        expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    });

    it('renders the TicketModalSkeleton while the ticket is loading', () => {
        // Never-resolving fetchTicket so the query stays pending (isLoading).
        vi.mocked(fetchTicket).mockReturnValue(new Promise(() => {}));
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
        // The shell renders immediately; the body is the loading skeleton. The
        // title falls back to the loading label while the ticket is absent.
        expect(screen.getByRole('dialog', { name: 'Loading ticket…' })).toBeInTheDocument();
        // TicketModalSkeleton renders decorative (aria-hidden) pulse placeholders.
        expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
        // The edit form is NOT rendered while loading.
        expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    });

    it('renders the "Ticket not found" block when the detail resolves absent', async () => {
        // Resolve to null → query succeeds with falsy data (e.g. deleted server-side
        // after the board last resolved it). React Query v5 forbids undefined data
        // (treats it as an error), so null is the way to exercise the absent branch.
        vi.mocked(fetchTicket).mockResolvedValue(null as unknown as Ticket);
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

        expect(await screen.findByText('Ticket not found')).toBeInTheDocument();
        expect(screen.getByText(/deleted or no longer exists/i)).toBeInTheDocument();
        // The not-found block offers a Close button (distinct from the modal's
        // aria-label "Close dialog" close affordance).
        expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
        // The edit form is NOT rendered for an absent ticket.
        expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    });

    it('renders Retry (role=alert) on a detail-query error and refetches on retry', async () => {
        vi.mocked(fetchTicket).mockRejectedValue(new Error('Server boom'));
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

        // Initial rejection → Retry surfaces inside the modal body.
        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(screen.getByText('Server boom')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();

        // Retry re-runs the query (onRetry -> refetch -> queryFn).
        fireEvent.click(screen.getByRole('button', { name: /retry/i }));
        await waitFor(() => expect(fetchTicket).toHaveBeenCalledTimes(2));
    });

    it('submit: editing the title + Save calls onSubmit with the new title, then onClose', async () => {
        const { onSubmit, onClose } = renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });

        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New title' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
        expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ title: 'New title' }));
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
        fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));

        // Confirm gone, the detail modal stays open, onClose not called.
        expect(screen.queryByRole('dialog', { name: 'Discard changes?' })).not.toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'SLYK-101' })).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    // --- F17: admin-only delete button gate ---------------------------------

    it('F17 ADMIN: renders the "Delete ticket" button', async () => {
        // beforeEach's clearAllMocks reset the mock fn; re-stub admin = true.
        vi.mocked(useRequirePlatformAdmin).mockReturnValue(true);
        renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });
        expect(screen.getByRole('button', { name: 'Delete ticket' })).toBeInTheDocument();
    });

    it('F17 ADMIN: clicking "Delete ticket" opens the DeleteTicketConfirm dialog', async () => {
        vi.mocked(useRequirePlatformAdmin).mockReturnValue(true);
        renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });

        fireEvent.click(screen.getByRole('button', { name: 'Delete ticket' }));
        expect(await screen.findByRole('dialog', { name: 'Delete ticket?' })).toBeInTheDocument();
    });

    it('F17 MEMBER: does NOT render the "Delete ticket" button', async () => {
        vi.mocked(useRequirePlatformAdmin).mockReturnValue(false);
        renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });
        expect(screen.queryByRole('button', { name: 'Delete ticket' })).not.toBeInTheDocument();
    });

    it('F17 ADMIN on a soft-deleted ticket: shows the Deleted badge + hides the Delete button', async () => {
        vi.mocked(useRequirePlatformAdmin).mockReturnValue(true);
        renderModal({ ticket: makeTicket({ deletedAt: '2026-06-24T00:00:00.000Z' }) });
        await screen.findByRole('dialog', { name: 'SLYK-101' });
        // Deleted badge banner is present.
        expect(screen.getByText('Deleted')).toBeInTheDocument();
        // Delete button hidden (can't delete an already-deleted ticket).
        expect(screen.queryByRole('button', { name: 'Delete ticket' })).not.toBeInTheDocument();
    });

    // Reference the mock so the import is used (satisfies the unused-import
    // concern while keeping the hook module mocked for the gate tests).
    void useDeleteTicket;

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
        expect((observer?.options as { refetchOnWindowFocus?: boolean }).refetchOnWindowFocus).toBe(
            true,
        );
    });

    // --- SLYK-11 T4: tabbed modal coverage --------------------------------
    //
    // The modal body is split into three Radix tabs (Details / Time Tracking /
    // Activity). T3 made the Tabs root CONTROLLED and gave every TabsContent
    // `forceMount` + `hidden` so React Hook Form state (and isDirty) survives
    // tab switches. These tests lock that contract in place.

    it('renders the correct child content in each tab panel (Details / Time Tracking / Activity)', async () => {
        vi.mocked(useRequirePlatformAdmin).mockReturnValue(true);
        renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });

        // --- Details (active by default) ---
        const details = screen.getByRole('tabpanel', { name: /details/i });
        // Metadata header.
        expect(within(details).getByText('Created by Ada Lovelace')).toBeInTheDocument();
        // Embedded TicketAttributeForm with the title seeded.
        expect(within(details).getByLabelText('Title')).toHaveValue('Render board');
        // Comments placeholder (SLYK-13 not yet implemented).
        expect(within(details).getByText(/coming soon/i)).toBeInTheDocument();
        // Admin-only delete entry point lives on the Details panel.
        expect(within(details).getByRole('button', { name: 'Delete ticket' })).toBeInTheDocument();

        // --- Time Tracking ---
        fireEvent.mouseDown(screen.getByRole('tab', { name: /time tracking/i }));
        const time = await screen.findByRole('tabpanel', { name: /time tracking/i });
        // TimerControls (no active timer → Start affordance).
        expect(within(time).getByRole('button', { name: 'Start' })).toBeInTheDocument();
        // TimeLog (total + entries list).
        expect(within(time).getByText(/total:/i)).toBeInTheDocument();
        // ManualEntryForm (duration input + submit).
        expect(within(time).getByRole('button', { name: 'Log Time' })).toBeInTheDocument();
        expect(within(time).getByLabelText('Duration')).toBeInTheDocument();

        // --- Activity ---
        fireEvent.mouseDown(screen.getByRole('tab', { name: /activity/i }));
        const activity = await screen.findByRole('tabpanel', { name: /activity/i });
        expect(within(activity).getByText('Activity')).toBeInTheDocument();
    });

    // (b) RHF unmount-reset regression guard. This is the single most important
    // test: it MUST fail if T3 had omitted `forceMount` (switching away would
    // unmount the Details panel → RHF form instance destroyed → edited values
    // reset to defaults on remount). Table-driven across the four attribute
    // fields so every editable input is covered.
    //
    // NOTE on scope: this table asserts VALUE PRESERVATION (the forceMount
    // contract) for all four fields. The companion `isDirty` survival is
    // covered by the dedicated test below using the `title` field: only `title`
    // is registered with RHF (`register('title')`), so only it flips `isDirty`.
    // `description`/`priority`/`assigneeId` are written via `setValue(...)` in
    // TicketAttributeForm WITHOUT `{ shouldDirty: true }`, so the source does
    // not mark the form dirty for those edits (pre-existing source behavior;
    // out of scope for this test-only task). Value preservation is the
    // forceMount regression that MUST hold for every field.
    const FIELD_PRESERVATION_CASES: Array<{
        name: string;
        ticket?: Ticket;
        edit: () => void;
        assertPreserved: () => void;
    }> = [
        {
            name: 'title',
            edit: () => {
                fireEvent.change(screen.getByLabelText('Title'), {
                    target: { value: 'Tab-safe title' },
                });
            },
            assertPreserved: () => {
                expect(screen.getByLabelText('Title')).toHaveValue('Tab-safe title');
            },
        },
        {
            name: 'description',
            edit: () => {
                // Scoped: ManualEntryForm also exposes an aria-label='Description'
                // input on the (forceMount, hidden) Time Tracking panel, so target
                // the editor inside the visible Details panel specifically.
                const details = screen.getByRole('tabpanel', { name: /details/i });
                fireEvent.change(within(details).getByLabelText('Description'), {
                    target: { value: '<p>tab-safe</p>' },
                });
            },
            assertPreserved: () => {
                const details = screen.getByRole('tabpanel', { name: /details/i });
                expect(within(details).getByLabelText('Description')).toHaveValue(
                    '<p>tab-safe</p>',
                );
            },
        },
        {
            name: 'priority',
            edit: () => {
                fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'LOW' } });
            },
            assertPreserved: () => {
                expect(screen.getByLabelText('Priority')).toHaveValue('LOW');
            },
        },
        {
            name: 'assignee',
            // Seed an assignee so the Unassigned option is a real change → dirty.
            ticket: makeTicket({
                assignee: { id: 'u1', fullName: 'Ada Lovelace', avatarUrl: null },
            }),
            edit: () => {
                fireEvent.change(screen.getByLabelText('Assignee'), { target: { value: '' } });
            },
            assertPreserved: () => {
                expect(screen.getByLabelText('Assignee')).toHaveValue('');
            },
        },
    ];

    it.each(FIELD_PRESERVATION_CASES)(
        'preserves edited $name value across Details → Time Tracking → Details (forceMount guard)',
        async ({ ticket, edit, assertPreserved }) => {
            renderModal({ ticket });
            await screen.findByRole('dialog', { name: 'SLYK-101' });

            // Details is active — edit the field.
            edit();
            // Let RHF flush the new value.
            await waitFor(() => assertPreserved());

            // Switch AWAY to Time Tracking. Without forceMount this unmounts
            // the Details panel (and the RHF form with it) → value lost.
            fireEvent.mouseDown(screen.getByRole('tab', { name: /time tracking/i }));
            await waitFor(() =>
                expect(screen.getByRole('tab', { name: /time tracking/i })).toHaveAttribute(
                    'data-state',
                    'active',
                ),
            );

            // Switch back to Details.
            fireEvent.mouseDown(screen.getByRole('tab', { name: /details/i }));
            await waitFor(() =>
                expect(screen.getByRole('tab', { name: /details/i })).toHaveAttribute(
                    'data-state',
                    'active',
                ),
            );

            // The edited value survived the round-trip. (This is the assertion
            // that fails if T3 had omitted forceMount — for ALL four fields.)
            assertPreserved();
        },
    );

    // (b-cont) isDirty survival across the same round-trip. Uses the `title`
    // field — the only field registered with RHF, hence the only edit the
    // source currently marks dirty (see NOTE above). Proves the unsaved-changes
    // guard trio (useBlocker/isDirty + requestClose + blockBackdropClose)
    // stays armed after switching tabs and back.
    it('keeps isDirty true across Details → Time Tracking → Details (title edit)', async () => {
        renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });

        // Edit the registered title field → form becomes dirty.
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Tab-safe title' } });
        await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Tab-safe title'));

        // Round-trip through Time Tracking and back.
        fireEvent.mouseDown(screen.getByRole('tab', { name: /time tracking/i }));
        await waitFor(() =>
            expect(screen.getByRole('tab', { name: /time tracking/i })).toHaveAttribute(
                'data-state',
                'active',
            ),
        );
        fireEvent.mouseDown(screen.getByRole('tab', { name: /details/i }));
        await waitFor(() =>
            expect(screen.getByRole('tab', { name: /details/i })).toHaveAttribute(
                'data-state',
                'active',
            ),
        );

        // Value preserved …
        expect(screen.getByLabelText('Title')).toHaveValue('Tab-safe title');
        // … AND isDirty still true → close surfaces the discard confirm.
        fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
        expect(await screen.findByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument();
    });

    // (c) The active tab is controlled state in the component, so a background
    // detail-query refetch (drift reconciliation) must not reset it.
    it('keeps the active tab across a detail-query refetch while the modal is open', async () => {
        const { client } = renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });

        // Move off the default Details tab.
        fireEvent.mouseDown(screen.getByRole('tab', { name: /activity/i }));
        await waitFor(() =>
            expect(screen.getByRole('tab', { name: /activity/i })).toHaveAttribute(
                'data-state',
                'active',
            ),
        );

        // Trigger the drift-refetch path (same key the component polls).
        await client.refetchQueries({ queryKey: ticketKeys.detail(TICKET_ID) });

        // Active tab unchanged after the refetch re-render.
        expect(screen.getByRole('tab', { name: /activity/i })).toHaveAttribute(
            'data-state',
            'active',
        );
        expect(screen.getByRole('tab', { name: /details/i })).not.toHaveAttribute(
            'data-state',
            'active',
        );
    });

    // (d) Soft-deleted tickets are archived: the form is read-only and the
    // Time Tracking panel renders no controls (content gated behind
    // !ticket.deletedAt).
    it('soft-deleted ticket: Time Tracking tab trigger is disabled, panel controls are hidden, and the Details form is read-only', async () => {
        renderModal({ ticket: makeTicket({ deletedAt: '2026-06-24T00:00:00.000Z' }) });
        await screen.findByRole('dialog', { name: 'SLYK-101' });

        // Details form is read-only: the <fieldset disabled> disables every
        // input and the submit button is hidden (footer shows Close).
        expect(screen.getByLabelText('Title')).toBeDisabled();
        expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
        // Read-only description renders the sanitized HTML (not the editor).
        expect(screen.getByText('steps')).toBeInTheDocument();

        // SLYK-11 gap-fix: the Time Tracking tab TRIGGER itself is disabled at
        // the tablist level (not just the panel content gated behind
        // !ticket.deletedAt). Radix Tabs marks a disabled trigger with BOTH
        // the `data-disabled` attribute and the native `disabled` attribute
        // (aria-disabled is intentionally NOT set so the trigger stays in the
        // tab sequence for roving-tabindex announcements).
        const timeTrackingTab = screen.getByRole('tab', { name: /time tracking/i });
        expect(timeTrackingTab).toHaveAttribute('data-disabled');
        expect((timeTrackingTab as HTMLButtonElement).disabled).toBe(true);
        // The trigger is disabled, so activating it is a no-op — confirm a
        // pointer interaction does NOT switch the active tab to it.
        fireEvent.mouseDown(timeTrackingTab);
        expect(timeTrackingTab).not.toHaveAttribute('data-state', 'active');
        expect(screen.getByRole('tab', { name: /details/i })).toHaveAttribute(
            'data-state',
            'active',
        );
        // The companion (non-soft-deleted) triggers are NOT disabled.
        expect(screen.getByRole('tab', { name: /details/i })).not.toHaveAttribute(
            'data-disabled',
        );
        expect(screen.getByRole('tab', { name: /activity/i })).not.toHaveAttribute(
            'data-disabled',
        );

        // Time Tracking panel content: the timer/log/manual controls are all
        // gated behind !ticket.deletedAt, so they simply don't render anywhere
        // in the modal body for a soft-deleted ticket (regardless of whether the
        // now-disabled trigger could be activated).
        expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Log Time' })).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Duration')).not.toBeInTheDocument();
    });

    // (e) isDirty survives a tab switch (forceMount), so a close attempt issued
    // WHILE on the Time Tracking tab still routes through the discard guard.
    it('dirty Details + active Time Tracking tab: close attempt surfaces ConfirmDiscardDialog', async () => {
        renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });

        // Edit on Details → dirty.
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Edited' } });
        await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Edited'));

        // Switch to Time Tracking (form stays mounted via forceMount → isDirty lives).
        fireEvent.mouseDown(screen.getByRole('tab', { name: /time tracking/i }));
        await waitFor(() =>
            expect(screen.getByRole('tab', { name: /time tracking/i })).toHaveAttribute(
                'data-state',
                'active',
            ),
        );

        // Close while on the Time Tracking tab → guard engages.
        fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
        expect(await screen.findByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument();
    });

    // (f) SLYK-11 gap-fix acceptance: on a live (non-soft-deleted) ticket the
    // Time Tracking trigger is ENABLED (no data-disabled / not disabled) and
    // activates normally.
    it('live ticket: the Time Tracking tab trigger is enabled and activates on click', async () => {
        renderModal();
        await screen.findByRole('dialog', { name: 'SLYK-101' });

        const timeTrackingTab = screen.getByRole('tab', { name: /time tracking/i });
        expect(timeTrackingTab).not.toHaveAttribute('data-disabled');
        expect((timeTrackingTab as HTMLButtonElement).disabled).toBe(false);

        fireEvent.mouseDown(timeTrackingTab);
        await waitFor(() => expect(timeTrackingTab).toHaveAttribute('data-state', 'active'));
    });
});
