import { EventEmitter } from 'node:events';

// SLYK-0260 opened this module as the state-write emit seam (setStateSink /
// sseEmit); SYK-0270 owns the rest — the per-ticket fan-out channel and the
// wiring that turns pipeline state writes into SSE frames on
// GET /api/v1/me/tickets/:id/events.
//
// v1 HA invariant (docs/agentic-automation/11-existing-patterns.md § SSE):
// in-memory EventEmitter ⇒ single-pod deployment only. The public surface
// below is deliberately transport-shaped (emit/on/off per ticketId) so
// Phase 6.5 can swap the backing store for Redis pub/sub without touching
// callers.

/** One SSE frame pushed to every subscriber of a ticket's channel. */
export interface SseEvent {
  type: string;
  data: unknown;
}

/** State events specifically — the shape SLYK-0260's seam produces. */
export interface SseStateEvent {
  ticketId: string;
  fromState: string;
  toState: string;
  detail: unknown;
  traceId: string | null;
}

export type SseStateSink = (event: SseStateEvent) => void;
export type SseListener = (event: SseEvent) => void;

// Per-ticket fan-out. Constructed with captureRejections so a throwing
// listener can't take down the process (mirrors sseEmit's swallow-below).
const channels = new EventEmitter({ captureRejections: true });

// Node warns above 11 listeners on one channel. A busy PM legitimately holds
// several tabs on the same ticket; the leak guard is the route's un-subscribe
// on req.close (asserted in sseEmitter/route tests), not this ceiling.
channels.setMaxListeners(0);

/** Subscribe to every event on a ticket's channel. */
export function on(ticketId: string, listener: SseListener): void {
  channels.on(ticketId, listener);
}

/** Unsubscribe (idempotent — off on a removed listener is a no-op). */
export function off(ticketId: string, listener: SseListener): void {
  channels.off(ticketId, listener);
}

/** Push a frame to every subscriber of a ticket's channel. Never throws. */
export function emit(ticketId: string, event: SseEvent): void {
  try {
    channels.emit(ticketId, event);
  } catch {
    // A dead subscriber socket must never fail the caller's write path (same
    // swallow as sseEmit below). Node's EventEmitter aborts the listener
    // loop at the first synchronous throw — listeners registered before the
    // failing one were already invoked, later ones miss this one frame.
  }
}

/** Listener count for a ticket's channel — the no-leak assertion surface. */
export function listenerCount(ticketId: string): number {
  return channels.listenerCount(ticketId);
}

// ── SLYK-0260 seam ─────────────────────────────────────────────────────────
// pipelineJobService calls sseEmit after commit. The default sink fans the
// state write out as an `event: state` frame with the wire shape pinned in
// 05-backend-routes.md § /api/v1/me/tickets/:id/events:
//   data: {"state":"CI_RUNNING","traceId":"9b7c..."}
// Tests swap the sink via setStateSink to observe emissions in isolation.

let stateSink: SseStateSink = (event) => {
  emit(event.ticketId, {
    type: 'state',
    data: { state: event.toState, traceId: event.traceId },
  });
};

/**
 * Swap the state-event sink (tests use it to observe emissions; restores
 * with resetStateSink).
 */
export function setStateSink(sink: SseStateSink): void {
  stateSink = sink;
}

/** Restore the default fan-out sink. */
export function resetStateSink(): void {
  stateSink = (event) => {
    emit(event.ticketId, {
      type: 'state',
      data: { state: event.toState, traceId: event.traceId },
    });
  };
}

/** Emit a pipeline `state` event on the per-ticket channel. Never throws. */
export function sseEmit(event: SseStateEvent): void {
  try {
    stateSink(event);
  } catch {
    // SSE delivery must never fail the dispatcher's state write.
  }
}
