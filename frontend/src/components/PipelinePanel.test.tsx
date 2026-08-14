import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PipelinePanel } from './PipelinePanel';
import { fetchPipeline, queueTicketForAgent } from '@/api/pipeline';
import { ApiClientError } from '@/api/client';
import type { PipelineEvent, PipelineJob, PipelineView } from '@/types/pipeline';
import { pipelineKeys } from '@/api/queryKeys';

// SLYK-0310 — PipelinePanel contract: timeline render (✓ rows, ↻ in-flight,
// ⋯ pending, duration + PR link), terminal-failure badge, and the 404 empty
// state + "Queue for agent" flow (POST /queue → panel flips to QUEUED).

vi.mock('@/api/pipeline', () => ({
    fetchPipeline: vi.fn(),
    queueTicketForAgent: vi.fn(),
}));

// useTicketSse opens an EventSource on mount; jsdom has none and the SSE
// behavior is covered by its own test file.
vi.mock('@/hooks/useTicketSse', () => ({
    useTicketSse: vi.fn(),
}));

const TICKET_ID = '11111111-1111-1111-1111-111111111111';
const SLUG = 'SLYK';

function makeJob(overrides: Partial<PipelineJob> = {}): PipelineJob {
    return {
        ticketId: TICKET_ID,
        projectId: 'p1',
        state: 'MERGING',
        priority: 0,
        attempts: 1,
        leaseOwnerId: null,
        leaseExpiresAt: null,
        agentIssueId: null,
        agentBackend: 'cyrus',
        githubPrNumber: 123,
        githubPrSha: 'abc123',
        needsPmAttention: false,
        traceId: 'tr-1',
        createdAt: '2026-08-14T20:00:00.000Z',
        updatedAt: '2026-08-14T20:10:00.000Z',
        ...overrides,
    };
}

function makeEvent(overrides: Partial<PipelineEvent> & { id: string }): PipelineEvent {
    return {
        ticketId: TICKET_ID,
        fromState: 'BACKLOG',
        toState: 'QUEUED',
        detail: null,
        traceId: null,
        createdAt: new Date(Date.now() - 2 * 60_000).toISOString(),
        ...overrides,
    };
}

function makeView(
    overrides: { job?: Partial<PipelineJob>; events?: PipelineEvent[] } = {},
): PipelineView {
    return {
        job: makeJob(overrides.job),
        events: overrides.events ?? [],
    };
}

function newQueryClient(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function renderPanel(client?: QueryClient) {
    const queryClient = client ?? newQueryClient();
    const utils = render(
        <QueryClientProvider client={queryClient}>
            <PipelinePanel ticketId={TICKET_ID} slug={SLUG} />
        </QueryClientProvider>,
    );
    return { ...utils, queryClient };
}

describe('PipelinePanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(cleanup);

    it('renders one row per event with ✓, relative time, duration, and PR link', async () => {
        vi.mocked(fetchPipeline).mockResolvedValue(
            makeView({
                job: { state: 'MERGING' },
                events: [
                    makeEvent({ id: 'e1', fromState: 'BACKLOG', toState: 'QUEUED' }),
                    makeEvent({
                        id: 'e2',
                        fromState: 'AGENT_RUNNING',
                        toState: 'PR_OPEN',
                        detail: { prNumber: 123, sha: 'abc' },
                    }),
                    makeEvent({
                        id: 'e3',
                        fromState: 'PR_OPEN',
                        toState: 'CI_RUNNING',
                        detail: { durationMs: 150_000 },
                    }),
                ],
            }),
        );

        renderPanel();

        expect(await screen.findByText('Dispatcher acknowledged')).toBeInTheDocument();
        expect(screen.getByText('Pull request opened')).toBeInTheDocument();
        expect(screen.getByText('Automated tests running')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'PR #123' })).toHaveAttribute(
            'href',
            'https://github.com/pulls/123',
        );
        expect(screen.getByText('· 2m 30s')).toBeInTheDocument();
    });

    it('renders the ↻ in-flight row for the current state and ⋯ pending successors', async () => {
        vi.mocked(fetchPipeline).mockResolvedValue(
            makeView({
                job: { state: 'AGENT_RUNNING' },
                events: [makeEvent({ id: 'e1', fromState: 'QUEUED', toState: 'AGENT_RUNNING' })],
            }),
        );

        renderPanel();

        expect(
            await screen.findByLabelText('In progress: Agent started (Cyrus session)'),
        ).toBeInTheDocument();
        // Pending successors of AGENT_RUNNING (minus the in-flight state itself).
        expect(screen.getByText('Agent has a question for you')).toBeInTheDocument();
        expect(screen.getByText('Pull request opened')).toBeInTheDocument();
        // No completed-✓ duplicates of the in-flight row's label.
        expect(
            screen.queryByLabelText('In progress: Dispatcher acknowledged'),
        ).not.toBeInTheDocument();
    });

    it('renders no in-flight or pending rows on DONE (terminal)', async () => {
        vi.mocked(fetchPipeline).mockResolvedValue(
            makeView({
                job: { state: 'DONE' },
                events: [makeEvent({ id: 'e1', fromState: 'MERGING', toState: 'DONE' })],
            }),
        );

        renderPanel();

        expect(await screen.findByText('Deployed')).toBeInTheDocument();
        expect(screen.queryByText('Task queued')).not.toBeInTheDocument();
    });

    it('renders the red failure badge on FAILED_* terminal states', async () => {
        vi.mocked(fetchPipeline).mockResolvedValue(
            makeView({
                job: { state: 'FAILED_CI', attempts: 1 },
                events: [makeEvent({ id: 'e1', fromState: 'CI_RUNNING', toState: 'FAILED_CI' })],
            }),
        );

        renderPanel();

        expect(
            await screen.findByLabelText('Pipeline failed: Automated tests failed'),
        ).toBeInTheDocument();
        expect(screen.getByText('Agent will retry up to 2 more times')).toBeInTheDocument();
    });

    it('empty state on 404: message + Queue for agent → POST /queue → flips to QUEUED', async () => {
        const notFound = new ApiClientError(
            `Ticket '${TICKET_ID}' is not in the pipeline`,
            404,
            'NOT_FOUND',
        );
        vi.mocked(fetchPipeline).mockRejectedValue(notFound);
        vi.mocked(queueTicketForAgent).mockResolvedValue(makeJob({ state: 'QUEUED', attempts: 0 }));

        const { queryClient } = renderPanel();

        expect(
            await screen.findByText("This ticket isn't queued for agent work"),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Queue for agent' }));

        await waitFor(() => expect(queueTicketForAgent).toHaveBeenCalledWith(TICKET_ID));
        // Cache seeded with the QUEUED job → panel re-renders the timeline.
        expect(queryClient.getQueryData(pipelineKeys.detail(TICKET_ID))).toMatchObject({
            job: { state: 'QUEUED' },
        });
    });

    it('non-404 errors surface the failure message (no queue button)', async () => {
        vi.mocked(fetchPipeline).mockRejectedValue(
            new ApiClientError('Something broke', 500, 'INTERNAL_ERROR'),
        );

        renderPanel();

        expect(await screen.findByRole('alert')).toHaveTextContent('Something broke');
        expect(screen.queryByRole('button', { name: 'Queue for agent' })).not.toBeInTheDocument();
    });

    it('queue failure shows an inline error', async () => {
        vi.mocked(fetchPipeline).mockRejectedValue(
            new ApiClientError(`Ticket '${TICKET_ID}' is not in the pipeline`, 404, 'NOT_FOUND'),
        );
        vi.mocked(queueTicketForAgent).mockRejectedValue(
            new ApiClientError('Dispatcher queue failed', 502, 'UPSTREAM_FAILED'),
        );

        renderPanel();

        expect(
            await screen.findByText("This ticket isn't queued for agent work"),
        ).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Queue for agent' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Dispatcher queue failed');
    });
});
