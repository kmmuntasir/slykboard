import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgentChatPanel } from './AgentChatPanel';
import { agentChatApi, agentChatKeys } from '@/api/agentChat';
import { ApiClientError } from '@/api/client';
import type { AgentMessage, ChatThreadView, PmReplyResult } from '@/types/agentChat';
import type { SseEventHandler } from '@/hooks/useTicketSse';

// SLYK-0340 — AgentChatPanel contract (06-frontend-ui.md § <AgentChatPanel> +
// 03-security.md markdown rule):
//   • thread alignment: PM right / AGENT left with label / SYSTEM centered
//   • "waiting" tag on the last AGENT message while AGENT_WAITING
//   • input gating: enabled only AGENT_RUNNING/AGENT_WAITING, disabled with a
//     reason otherwise (DONE + not-queued tested)
//   • Enter sends, Shift+Enter newlines; 4000-char counter
//   • optimistic append; delivered:false indicator; clears on refetch
//   • adversarial markdown: <script> inert, javascript: link neutralized
//   • SSE `message` frame appends without a refetch (cache append, no flicker)

vi.mock('@/api/agentChat', () => ({
    agentChatApi: {
        getThread: vi.fn(),
        postReply: vi.fn(),
    },
    agentChatKeys: {
        all: ['agent-chat'] as const,
        thread: (ticketId: string) => ['agent-chat', 'thread', ticketId] as const,
    },
}));

// Capture the SSE onMessage handler so tests can push live frames. The real
// hook's behavior is covered by useTicketSse.test.tsx.
let sseHandlers: SseEventHandler[] = [];
vi.mock('@/hooks/useTicketSse', () => ({
    useTicketSse: ({ onMessage }: { onMessage?: SseEventHandler }) => {
        sseHandlers.push(onMessage ?? (() => {}));
    },
}));

const TICKET_ID = '11111111-1111-1111-1111-111111111111';

function makeMessage(overrides: Partial<AgentMessage> & { id: string }): AgentMessage {
    return {
        ticketId: TICKET_ID,
        authorRole: 'AGENT',
        authorUserId: null,
        body: 'hello',
        agentSessionId: 'sess-1',
        idempotencyKey: null,
        readAt: null,
        createdAt: '2026-08-14T20:00:00.000Z',
        ...overrides,
    };
}

function makeThread(
    overrides: { messages?: AgentMessage[]; ticketState?: ChatThreadView['ticketState'] } = {},
): ChatThreadView {
    return {
        messages: overrides.messages ?? [],
        // Default AGENT_WAITING, but an EXPLICIT null must pass through
        // (?? would swallow it back to the default).
        ticketState: overrides.ticketState === undefined ? 'AGENT_WAITING' : overrides.ticketState,
    };
}

function newQueryClient(): QueryClient {
    return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function renderPanel(
    overrides: { messages?: AgentMessage[]; ticketState?: ChatThreadView['ticketState'] } = {},
    client?: QueryClient,
) {
    vi.mocked(agentChatApi.getThread).mockResolvedValue(makeThread(overrides));
    const queryClient = client ?? newQueryClient();
    const utils = render(
        <QueryClientProvider client={queryClient}>
            <AgentChatPanel ticketId={TICKET_ID} />
        </QueryClientProvider>,
    );
    return { ...utils, queryClient };
}

/** Read the panel's cached thread from the most recent render's client. */
function cachedThread(queryClient: QueryClient): ChatThreadView | undefined {
    return queryClient.getQueryData<ChatThreadView>(agentChatKeys.thread(TICKET_ID));
}

function pushSseMessage(payload: {
    id: string;
    authorRole: 'PM' | 'AGENT' | 'SYSTEM';
    body: string;
}) {
    act(() => {
        for (const handler of sseHandlers) {
            handler({
                id: payload.id,
                authorRole: payload.authorRole,
                body: payload.body,
                createdAt: '2026-08-14T20:01:00.000Z',
            });
        }
    });
}

describe('AgentChatPanel (SLYK-0340)', () => {
    let appRoot: HTMLElement;

    beforeEach(() => {
        vi.clearAllMocks();
        sseHandlers = [];
        appRoot = document.createElement('main');
        appRoot.id = 'app-root';
        document.body.appendChild(appRoot);
    });

    afterEach(() => {
        appRoot.remove();
        cleanup();
    });

    // --- Thread rendering -------------------------------------------------

    it('renders PM right-aligned, AGENT left with the Cyrus label, SYSTEM centered', async () => {
        renderPanel({
            ticketState: 'AGENT_RUNNING',
            messages: [
                makeMessage({ id: 'm1', authorRole: 'PM', body: 'Should this delete cascade?' }),
                makeMessage({ id: 'm2', authorRole: 'AGENT', body: 'Yes, cascade is safe.' }),
                makeMessage({ id: 'm3', authorRole: 'SYSTEM', body: 'Pull request #123 opened' }),
            ],
        });

        expect(await screen.findByText('Should this delete cascade?')).toBeInTheDocument();
        expect(screen.getByText('Yes, cascade is safe.')).toBeInTheDocument();
        expect(screen.getByText('Pull request #123 opened')).toBeInTheDocument();

        // Alignment variants by author role.
        const pmRow = screen.getByText('Should this delete cascade?').closest('li')!;
        expect(pmRow).toHaveClass('items-end');
        const agentRow = screen.getByText('Yes, cascade is safe.').closest('li')!;
        expect(agentRow).toHaveClass('items-start');
        const systemRow = screen.getByText('Pull request #123 opened').closest('li')!;
        expect(systemRow).toHaveClass('justify-center');
        expect(screen.getByText('Cyrus')).toBeInTheDocument();
    });

    it('shows the waiting tag on the last AGENT message while AGENT_WAITING', async () => {
        renderPanel({
            ticketState: 'AGENT_WAITING',
            messages: [
                makeMessage({ id: 'm1', authorRole: 'AGENT', body: 'first answer' }),
                makeMessage({ id: 'm2', authorRole: 'PM', body: 'a reply' }),
                makeMessage({ id: 'm3', authorRole: 'AGENT', body: 'Should I add a dialog?' }),
            ],
        });

        expect(await screen.findByText('waiting')).toBeInTheDocument();
    });

    it('omits the waiting tag while AGENT_RUNNING', async () => {
        renderPanel({
            ticketState: 'AGENT_RUNNING',
            messages: [makeMessage({ id: 'm1', authorRole: 'AGENT', body: 'working on it' })],
        });

        await screen.findByText('working on it');
        expect(screen.queryByText('waiting')).not.toBeInTheDocument();
    });

    // --- Sanitized markdown (03-security.md adversarial cases) -----------

    it('renders a script-tag body inert — the tag is stripped, no script node exists', async () => {
        renderPanel({
            ticketState: 'AGENT_RUNNING',
            messages: [
                makeMessage({
                    id: 'm1',
                    authorRole: 'AGENT',
                    body: 'harmless <script>alert(1)</script> after',
                }),
            ],
        });

        // react-markdown parses the inline HTML; rehype-sanitize drops the
        // unknown node entirely — only the surrounding text survives, and no
        // <script> element (or its content executing) reaches the DOM.
        expect(await screen.findByText(/harmless.*after/)).toBeInTheDocument();
        expect(screen.queryByText(/<script>/)).not.toBeInTheDocument();
        expect(document.querySelectorAll('script').length).toBe(0);
    });

    it('neutralizes a javascript: markdown link — href is stripped, text kept', async () => {
        renderPanel({
            ticketState: 'AGENT_RUNNING',
            messages: [
                makeMessage({
                    id: 'm1',
                    authorRole: 'AGENT',
                    body: '[click me](javascript:alert(1))',
                }),
            ],
        });

        // The anchor element survives with its label but NO href attribute —
        // the sanitize schema's protocol allow-list drops javascript: URIs,
        // and an href-less <a> exposes no link role (not navigable at all).
        // (jsdom: an <a> without href does not match role=link.)
        const label = await screen.findByText('click me');
        expect(label.tagName).toBe('A');
        expect(label.getAttribute('href')).toBe(null);
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('keeps a safe https link navigable', async () => {
        renderPanel({
            ticketState: 'AGENT_RUNNING',
            messages: [
                makeMessage({
                    id: 'm1',
                    authorRole: 'AGENT',
                    body: '[the PR](https://github.com/example/pr/1)',
                }),
            ],
        });

        const link = await screen.findByRole('link', { name: 'the PR' });
        expect(link).toHaveAttribute('href', 'https://github.com/example/pr/1');
    });

    it('renders markdown formatting (bold + code) from an AGENT body', async () => {
        renderPanel({
            ticketState: 'AGENT_RUNNING',
            messages: [makeMessage({ id: 'm1', authorRole: 'AGENT', body: '**safe** and `code`' })],
        });

        expect(await screen.findByText('safe')).toBeInTheDocument();
        expect(screen.getByText('code').tagName).toBe('CODE');
    });

    // --- Input gating by ticketState --------------------------------------

    it('enables the input while AGENT_WAITING', async () => {
        renderPanel({ ticketState: 'AGENT_WAITING', messages: [] });
        const input = await screen.findByRole('textbox', { name: /message the agent/i });
        expect(input).toBeEnabled();
    });

    it('enables the input while AGENT_RUNNING', async () => {
        renderPanel({ ticketState: 'AGENT_RUNNING', messages: [] });
        const input = await screen.findByRole('textbox', { name: /message the agent/i });
        expect(input).toBeEnabled();
    });

    it('disables the input with a reason when DONE', async () => {
        renderPanel({
            ticketState: 'DONE',
            messages: [makeMessage({ id: 'm1', authorRole: 'AGENT', body: 'done here' })],
        });
        const input = await screen.findByRole('textbox', { name: /message the agent/i });
        expect(input).toBeDisabled();
        expect(screen.getByText(/agent has finished/i)).toBeInTheDocument();
    });

    it('disables the input when the ticket has no pipeline row (state null)', async () => {
        renderPanel({ ticketState: null, messages: [] });
        const input = await screen.findByRole('textbox', { name: /message the agent/i });
        expect(input).toBeDisabled();
        expect(screen.getByText(/not queued for agent work/i)).toBeInTheDocument();
    });

    it('disables the input before the agent starts (QUEUED)', async () => {
        renderPanel({ ticketState: 'QUEUED', messages: [] });
        const input = await screen.findByRole('textbox', { name: /message the agent/i });
        expect(input).toBeDisabled();
        expect(screen.getByText(/once the agent starts/i)).toBeInTheDocument();
    });

    it('disables the input on terminal failure (BLOCKED_HUMAN)', async () => {
        renderPanel({ ticketState: 'BLOCKED_HUMAN', messages: [] });
        const input = await screen.findByRole('textbox', { name: /message the agent/i });
        expect(input).toBeDisabled();
    });

    // --- Composer mechanics ----------------------------------------------

    it('Enter sends the trimmed draft; Shift+Enter inserts a newline', async () => {
        const row: PmReplyResult = {
            ...makeMessage({ id: 'row-1', authorRole: 'PM', body: 'previous' }),
            delivered: true,
        };
        vi.mocked(agentChatApi.postReply).mockResolvedValue(row);
        renderPanel({ ticketState: 'AGENT_WAITING', messages: [] });
        const input = (await screen.findByRole('textbox', {
            name: /message the agent/i,
        })) as HTMLTextAreaElement;

        // Shift+Enter does NOT send (newline instead).
        fireEvent.change(input, { target: { value: 'line one' } });
        fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
        expect(agentChatApi.postReply).not.toHaveBeenCalled();

        // Plain Enter sends the trimmed body.
        fireEvent.change(input, { target: { value: '  hello agent  ' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() =>
            expect(agentChatApi.postReply).toHaveBeenCalledWith(TICKET_ID, 'hello agent'),
        );
        // Draft cleared after send.
        await waitFor(() => expect(input.value).toBe(''));
    });

    it('shows the character counter capped at 4000', async () => {
        renderPanel({ ticketState: 'AGENT_WAITING', messages: [] });
        await screen.findByRole('textbox', { name: /message the agent/i });
        expect(screen.getByText('0/4000')).toBeInTheDocument();
    });

    // --- Optimistic send + delivered flag ---------------------------------

    it('optimistically appends the PM message, then replaces it with the 201 row', async () => {
        const row = {
            ...makeMessage({ id: 'row-9', authorRole: 'PM', body: 'live reply' }),
            delivered: true,
        };
        vi.mocked(agentChatApi.postReply).mockImplementation(
            () => new Promise((resolve) => setTimeout(() => resolve(row as PmReplyResult), 30)),
        );
        const { queryClient } = renderPanel({ ticketState: 'AGENT_WAITING', messages: [] });
        const input = await screen.findByRole('textbox', { name: /message the agent/i });

        fireEvent.change(input, { target: { value: 'live reply' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));

        // Optimistic bubble is there BEFORE the POST resolves.
        expect(await screen.findByText('live reply')).toBeInTheDocument();

        await waitFor(() => {
            expect(cachedThread(queryClient)?.messages.map((m) => m.id)).toContain('row-9');
        });
        // Exactly one bubble for the body (temp replaced, not duplicated).
        expect(screen.getAllByText('live reply')).toHaveLength(1);
    });

    it('shows the not-delivered indicator on a delivered:false PM row', async () => {
        renderPanel({
            ticketState: 'AGENT_WAITING',
            messages: [
                makeMessage({
                    id: 'm1',
                    authorRole: 'PM',
                    body: 'queued reply',
                    ...({ delivered: false } as Partial<AgentMessage>),
                }),
            ],
        });

        expect(await screen.findByText(/not delivered/i)).toBeInTheDocument();
    });

    it('clears the not-delivered indicator after a refetch without the flag', async () => {
        const { queryClient } = renderPanel({
            ticketState: 'AGENT_WAITING',
            messages: [
                makeMessage({
                    id: 'm1',
                    authorRole: 'PM',
                    body: 'queued reply',
                    ...({ delivered: false } as Partial<AgentMessage>),
                }),
            ],
        });
        expect(await screen.findByText(/not delivered/i)).toBeInTheDocument();

        // Refetch path: the retried fetch returns the row without the flag
        // (delivery queue succeeded) — indicator clears.
        vi.mocked(agentChatApi.getThread).mockResolvedValue(
            makeThread({
                ticketState: 'AGENT_WAITING',
                messages: [makeMessage({ id: 'm1', authorRole: 'PM', body: 'queued reply' })],
            }),
        );
        await act(async () => {
            await queryClient.invalidateQueries({ queryKey: agentChatKeys.thread(TICKET_ID) });
        });
        await waitFor(() => expect(screen.queryByText(/not delivered/i)).not.toBeInTheDocument());
        expect(screen.getByText('queued reply')).toBeInTheDocument();
    });

    it('rolls back the optimistic message and shows an inline error on 409', async () => {
        vi.mocked(agentChatApi.postReply).mockRejectedValue(
            new ApiClientError('Agent is not listening on this ticket', 409, 'CONFLICT'),
        );
        const { queryClient } = renderPanel({ ticketState: 'AGENT_WAITING', messages: [] });
        const input = await screen.findByRole('textbox', { name: /message the agent/i });

        fireEvent.change(input, { target: { value: 'too late' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));

        await waitFor(() =>
            expect(screen.getByText(/not listening on this ticket anymore/i)).toBeInTheDocument(),
        );
        await waitFor(() => expect(screen.queryByText('too late')).not.toBeInTheDocument());
        expect(queryClient.getQueryData(agentChatKeys.thread(TICKET_ID))).toBeTruthy();
    });

    // --- SSE live updates ---------------------------------------------------

    it('appends an SSE message frame to the thread without a refetch', async () => {
        const { queryClient } = renderPanel({
            ticketState: 'AGENT_RUNNING',
            messages: [makeMessage({ id: 'm1', authorRole: 'AGENT', body: 'first' })],
        });
        await screen.findByText('first');

        const refetchSpy = vi.spyOn(queryClient, 'refetchQueries');
        const invalidateSpy = vi
            .spyOn(queryClient, 'invalidateQueries')
            .mockResolvedValue(undefined);

        pushSseMessage({ id: 'sse-1', authorRole: 'AGENT', body: 'live from the agent' });

        expect(await screen.findByText('live from the agent')).toBeInTheDocument();
        // Appended straight into the cache — no refetch/invalidate flicker.
        expect(refetchSpy).not.toHaveBeenCalled();
        expect(invalidateSpy).not.toHaveBeenCalledWith({
            queryKey: agentChatKeys.thread(TICKET_ID),
        });

        refetchSpy.mockRestore();
        invalidateSpy.mockRestore();
    });

    it('does not duplicate an SSE frame whose id is already cached (own PM reply echo)', async () => {
        renderPanel({
            ticketState: 'AGENT_WAITING',
            messages: [makeMessage({ id: 'm1', authorRole: 'PM', body: 'mine' })],
        });
        await screen.findByText('mine');

        pushSseMessage({ id: 'm1', authorRole: 'PM', body: 'mine' });

        expect(screen.getAllByText('mine')).toHaveLength(1);
    });

    it('renders an empty thread with a hint', async () => {
        renderPanel({ ticketState: 'AGENT_RUNNING', messages: [] });
        expect(await screen.findByText(/no messages yet/i)).toBeInTheDocument();
    });

    it('shows a failure line when the thread fetch errors', async () => {
        // renderPanel re-queues a resolved value on every call; after it, wipe
        // the mock's queue so the single query call rejects.
        renderPanel({ ticketState: 'AGENT_WAITING', messages: [] });
        vi.mocked(agentChatApi.getThread)
            .mockReset()
            .mockRejectedValue(new ApiClientError('Failed to load', 500, 'INTERNAL_ERROR'));
        // Re-render with a fresh client so the reset mock is actually called.
        cleanup();
        render(
            <QueryClientProvider client={newQueryClient()}>
                <AgentChatPanel ticketId={TICKET_ID} />
            </QueryClientProvider>,
        );
        expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load');
    });
});
