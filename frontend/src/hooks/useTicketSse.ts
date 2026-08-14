import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { env } from '@/config/env';
import { boardKeys, pipelineKeys } from '@/api/queryKeys';
import { useAuthStore } from '@/stores/useAuthStore';
import type { PipelineState } from '@/constants/pipelineStates';

// SLYK-0310 — per-ticket SSE subscription (SLYK-0270 endpoint).
// GET /api/v1/me/tickets/:id/events, one EventSource per ticket-detail mount,
// closed on unmount. EventSource cannot send an Authorization header, so the
// JWT rides the `access_token` query param (accepted by the backend
// authenticate middleware alongside Bearer). Reconnect is native EventSource
// driven by the server's `retry: 5000` hint — no client-side retry loop.
//
// Events:
//   state   — {"state": <to>, "traceId": <uuid|null>} (SLYK-0260 seam).
//             Invalidates the pipeline query; DONE also invalidates the board
//             queries (the backend moved the ticket to the Done column, so the
//             kanban must re-render without waiting for the next poll).
//   message — {"id","authorRole","body","createdAt"} — Phase 2 consumer
//             (agent chat); typed now, handled as a no-op until then.

/** `state` frame payload — sseEmitter.ts default sink wire shape. */
export interface SseStatePayload {
  state: PipelineState;
  traceId: string | null;
}

/** `message` frame payload — 05-backend-routes.md § events (Phase 2). */
export interface SseMessagePayload {
  id: string;
  authorRole: 'PM' | 'AGENT' | 'SYSTEM';
  body: string;
  createdAt: string;
}

export type SseEventHandler = (payload: SseMessagePayload) => void;

interface UseTicketSseArgs {
  ticketId: string;
  /** Extra board keys (e.g. the project slug) invalidated when state → DONE. */
  boardSlug?: string;
  /** Phase 2 seam: optional `message` handler. Unused today (typed no-op). */
  onMessage?: SseEventHandler;
}

export function useTicketSse({ ticketId, boardSlug, onMessage }: UseTicketSseArgs): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!ticketId) return;
    const token = useAuthStore.getState().user?.token;
    if (!token) return;

    // env.apiBaseUrl already carries the /api prefix (e.g. http://host/api) —
    // agent routes live under /api/v1/*, so only /v1 is appended here.
    const url = `${env.apiBaseUrl}/v1/me/tickets/${ticketId}/events?access_token=${encodeURIComponent(token)}`;
    const source = new EventSource(url);

    source.addEventListener('state', (event) => {
      let payload: SseStatePayload | null = null;
      try {
        payload = JSON.parse((event as MessageEvent<string>).data) as SseStatePayload;
      } catch {
        return; // Malformed frame — the refetch-on-reconnect covers the gap.
      }
      void queryClient.invalidateQueries({ queryKey: pipelineKeys.detail(ticketId) });
      if (payload.state === 'DONE' && boardSlug) {
        void queryClient.invalidateQueries({ queryKey: boardKeys.detail(boardSlug) });
      }
    });

    // Phase 2: typed but not yet surfaced (no chat UI consumes it today).
    source.addEventListener('message', (event) => {
      if (!onMessage) return;
      try {
        onMessage(JSON.parse((event as MessageEvent<string>).data) as SseMessagePayload);
      } catch {
        // Malformed frame — ignore; Phase 2 owns the error surface.
      }
    });

    return () => {
      source.close();
    };
  }, [ticketId, boardSlug, onMessage, queryClient]);
}
