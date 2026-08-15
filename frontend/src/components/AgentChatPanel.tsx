import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { agentChatApi, agentChatKeys } from '@/api/agentChat';
import { ApiClientError } from '@/api/client';
import { useTicketSse, type SseMessagePayload } from '@/hooks/useTicketSse';
import { type PipelineState } from '@/constants/pipelineStates';
import { formatRelativeTime } from '@/utils/formatRelativeTime';
import type { AgentMessage, ChatThreadView } from '@/types/agentChat';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Textarea } from './ui/Textarea';
import { SanitizedMarkdown } from './SanitizedMarkdown';

// SLYK-0340 — PM ↔ Agent chat tab body (06-frontend-ui.md § <AgentChatPanel>).
// Thread: PM right-aligned, AGENT left with the "Cyrus" label (+"waiting" tag
// on the last AGENT message while AGENT_WAITING), SYSTEM centered with a
// subtle background. Input enabled only while ticketState ∈ {AGENT_RUNNING,
// AGENT_WAITING} — Enter sends, Shift+Enter newlines, 4000-char counter.
//
// Data flow:
//   • Thread cache: agentChatKeys.thread(ticketId), appended to directly —
//     by our own POST (optimistic, replaced by the 201 row) and by SSE
//     `message` frames (SLYK-0270) — so live arrival never flickers through a
//     refetch. `state` frames invalidate the thread too, so a state change
//     refreshes the gate + waiting tag; the append path itself never
//     round-trips.
//   • delivered:false on a PM row → "not delivered" indicator next to the
//     bubble. It clears when the retry succeeds: the pm_reply queue's success
//     path is invisible to this tab, but ANY later thread refresh (SSE state
//     frame / remount / window refocus) refetches without the flag, so the
//     indicator self-heals without user action. Cleared on refetch = the
//     documented "SSE or refetch" contract.
//   • 409 CONFLICT (agent moved past listening between load and send) →
//     inline error under the input; the thread refetch re-gates the box.

/** Backend body cap (agent-chat.schema.ts z.string().min(1).max(4000)). */
const MAX_BODY_LENGTH = 4000;

/** Input-gate states — the agent process can still receive a reply. */
const INPUT_ENABLED_STATES: ReadonlySet<PipelineState> = new Set([
    'AGENT_RUNNING',
    'AGENT_WAITING',
]);

/** Why the box is disabled, per state family (shown under the input). */
function disabledReason(state: PipelineState | null): string {
    if (state === null) return 'This ticket is not queued for agent work.';
    if (isTerminalChatState(state)) return 'The agent has finished — chat is closed.';
    return 'Chat opens once the agent starts working on this ticket.';
}

/** Terminal states: no further agent turn can arrive. */
function isTerminalChatState(state: PipelineState): boolean {
    return state === 'DONE' || state.startsWith('FAILED_') || state === 'BLOCKED_HUMAN';
}

/**
 * Client-side visibility gate for the Chat tab: visible while the agent is
 * running/waiting, or once any message exists (terminal-with-history per the
 * 06 sketch). Kept exported so TicketDetailModal applies the identical rule.
 */
export function isChatTabVisible(state: PipelineState | null, messageCount: number): boolean {
    return state === 'AGENT_RUNNING' || state === 'AGENT_WAITING' || messageCount > 0;
}

interface AgentChatPanelProps {
    ticketId: string;
}

export function AgentChatPanel({ ticketId }: AgentChatPanelProps) {
    const queryClient = useQueryClient();
    const [draft, setDraft] = useState('');
    const [sendError, setSendError] = useState<string | null>(null);

    const { data, isLoading, isError, error } = useQuery({
        queryKey: agentChatKeys.thread(ticketId),
        queryFn: () => agentChatApi.getThread(ticketId),
        enabled: !!ticketId,
        retry: false,
    });

    const messages = useMemo(() => data?.messages ?? [], [data]);
    const ticketState = (data?.ticketState ?? null) as PipelineState | null;
    const inputEnabled = ticketState !== null && INPUT_ENABLED_STATES.has(ticketState);

    // SSE `message` frames append to the cached thread (no refetch → no
    // flicker). useCallback keeps the handler referentially stable so
    // useTicketSse's effect (which lists onMessage in its deps) does not
    // reconnect on every render.
    const appendMessage = useCallback(
        (message: AgentMessage) => {
            queryClient.setQueryData<ChatThreadView>(agentChatKeys.thread(ticketId), (prev) => {
                if (!prev) return prev;
                if (prev.messages.some((m) => m.id === message.id)) return prev;
                return { ...prev, messages: [...prev.messages, message] };
            });
        },
        [queryClient, ticketId],
    );
    const handleSseMessage = useCallback(
        (payload: SseMessagePayload) => {
            appendMessage({
                id: payload.id,
                ticketId,
                authorRole: payload.authorRole,
                authorUserId: null,
                body: payload.body,
                agentSessionId: null,
                idempotencyKey: null,
                readAt: null,
                createdAt: payload.createdAt,
            });
        },
        [appendMessage, ticketId],
    );
    useTicketSse({ ticketId, onMessage: handleSseMessage });

    const replyMutation = useMutation({
        mutationFn: (body: string) => agentChatApi.postReply(ticketId, body),
        // Optimistic append: a temp row renders instantly; onSsettled replaces
        // it with the durable 201 row (or drops it on error). Both dedupe by
        // id against the cache, so the SSE frame for our own reply (emitted
        // on both delivery paths) is idempotent.
        onMutate: (body) => {
            const tempId = `optimistic-${crypto.randomUUID()}`;
            queryClient.setQueryData<ChatThreadView>(agentChatKeys.thread(ticketId), (prev) =>
                prev
                    ? {
                          ...prev,
                          messages: [
                              ...prev.messages,
                              {
                                  id: tempId,
                                  ticketId,
                                  authorRole: 'PM',
                                  authorUserId: null,
                                  body,
                                  agentSessionId: null,
                                  idempotencyKey: null,
                                  readAt: null,
                                  createdAt: new Date().toISOString(),
                              },
                          ],
                      }
                    : prev,
            );
            return { tempId };
        },
        onSuccess: (row, _body, context) => {
            const tempId = context?.tempId;
            queryClient.setQueryData<ChatThreadView>(agentChatKeys.thread(ticketId), (prev) => {
                if (!prev || !tempId) return prev;
                const withoutTemp = prev.messages.filter((m) => m.id !== tempId);
                if (withoutTemp.some((m) => m.id === row.id))
                    return { ...prev, messages: withoutTemp };
                return { ...prev, messages: [...withoutTemp, row] };
            });
        },
        onError: (err, _body, context) => {
            // Roll the optimistic bubble back; surface the reason inline.
            const tempId = context?.tempId;
            queryClient.setQueryData<ChatThreadView>(agentChatKeys.thread(ticketId), (prev) =>
                prev && tempId
                    ? { ...prev, messages: prev.messages.filter((m) => m.id !== tempId) }
                    : prev,
            );
            setSendError(
                err instanceof ApiClientError && err.status === 409
                    ? 'Agent is not listening on this ticket anymore — refresh to see the latest state.'
                    : 'Failed to send the message. Try again.',
            );
            // A 409 means the state moved under us — refetch re-gates the box.
            if (err instanceof ApiClientError && err.status === 409) {
                void queryClient.invalidateQueries({ queryKey: agentChatKeys.thread(ticketId) });
            }
        },
    });

    const trimmed = draft.trim();
    const canSend = inputEnabled && trimmed.length > 0 && !replyMutation.isPending;

    const handleSend = () => {
        if (!canSend) return;
        setSendError(null);
        replyMutation.mutate(trimmed);
        setDraft('');
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter sends; Shift+Enter (and any modifier-held Enter) newlines.
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            handleSend();
        }
    };

    // The last AGENT message gets the "waiting" tag while AGENT_WAITING.
    const lastAgentId = useMemo(() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i]!.authorRole === 'AGENT') return messages[i]!.id;
        }
        return null;
    }, [messages]);

    // Keep the newest message in view as the thread grows (initial load + SSE
    // appends). Ref-based, so a passive reader scrolling up is not fought
    // until a new message actually lands. (scrollIntoView is jsdom-absent —
    // guard so tests don't crash on the no-op.)
    const bottomRef = useRef<HTMLDivElement>(null);
    const messageCountRef = useRef(0);
    useEffect(() => {
        if (messages.length === messageCountRef.current) return;
        messageCountRef.current = messages.length;
        bottomRef.current?.scrollIntoView?.({ block: 'end' });
    }, [messages.length]);

    if (isLoading) {
        return <p className="text-sm text-muted-foreground">Loading chat…</p>;
    }

    if (isError) {
        return (
            <p className="text-sm text-destructive" role="alert">
                {error instanceof Error ? error.message : 'Failed to load chat.'}
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-3" aria-label="Agent chat">
            <ol className="flex flex-col gap-3" aria-label="Chat messages">
                {messages.length === 0 && (
                    <li className="py-6 text-center text-sm text-muted-foreground">
                        No messages yet — the agent will check in here once it starts.
                    </li>
                )}
                {messages.map((message) => (
                    <ChatMessageRow
                        key={message.id}
                        message={message}
                        waiting={message.id === lastAgentId && ticketState === 'AGENT_WAITING'}
                        notDelivered={
                            message.authorRole === 'PM' &&
                            (message as AgentMessage & { delivered?: boolean }).delivered === false
                        }
                    />
                ))}
                <div ref={bottomRef} />
            </ol>

            <div className="flex flex-col gap-1 border-t border-border pt-3">
                <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    aria-label="Message the agent"
                    placeholder={
                        inputEnabled ? 'Reply to the agent…' : 'Chat is closed for this ticket'
                    }
                    maxLength={MAX_BODY_LENGTH}
                    rows={3}
                    disabled={!inputEnabled}
                    className="text-sm"
                />
                <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground" aria-live="polite">
                        {inputEnabled ? sendError : disabledReason(ticketState)}
                    </span>
                    <span className="flex items-center gap-3">
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {draft.length}/{MAX_BODY_LENGTH}
                        </span>
                        <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            onClick={handleSend}
                            disabled={!canSend}
                        >
                            Send
                        </Button>
                    </span>
                </div>
            </div>
        </div>
    );
}

interface ChatMessageRowProps {
    message: AgentMessage;
    /** "Waiting" tag on the last AGENT message while AGENT_WAITING. */
    waiting: boolean;
    /** PM rows created with delivered:false (dispatcher webhook failed). */
    notDelivered: boolean;
}

function ChatMessageRow({ message, waiting, notDelivered }: ChatMessageRowProps) {
    if (message.authorRole === 'SYSTEM') {
        return (
            <li className="flex justify-center">
                <div className="max-w-[85%] rounded-md bg-muted px-3 py-1.5 text-center text-xs text-muted-foreground">
                    <SanitizedMarkdown>{message.body}</SanitizedMarkdown>
                </div>
            </li>
        );
    }

    if (message.authorRole === 'PM') {
        return (
            <li className="flex flex-col items-end gap-0.5">
                <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-primary-foreground">
                    <SanitizedMarkdown>{message.body}</SanitizedMarkdown>
                </div>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {notDelivered && (
                        <span className="text-warning" role="status">
                            ⚠ Not delivered — will retry automatically
                        </span>
                    )}
                    <time dateTime={message.createdAt}>
                        {formatRelativeTime(message.createdAt)}
                    </time>
                </span>
            </li>
        );
    }

    // AGENT — left-aligned with the agent label (+waiting tag).
    return (
        <li className="flex flex-col items-start gap-0.5">
            <span className="flex items-center gap-1.5">
                <Badge variant="secondary">Cyrus</Badge>
                {waiting && <Badge variant="warning">waiting</Badge>}
            </span>
            <div className="max-w-[85%] rounded-lg border border-border bg-card px-3 py-2">
                <SanitizedMarkdown>{message.body}</SanitizedMarkdown>
            </div>
            <time dateTime={message.createdAt} className="text-xs text-muted-foreground">
                {formatRelativeTime(message.createdAt)}
            </time>
        </li>
    );
}

// Re-export for the modal's tab-visibility wiring (single source of truth).
export { INPUT_ENABLED_STATES };
