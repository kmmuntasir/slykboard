// SLYK-0260 — per-ticket SSE emit seam. SLYK-0270 owns the /api/v1/me SSE
// route and the real per-ticket EventEmitter; this module is the service-level
// call site that 0270 wires up (ticket § behavior step 7). Until then the
// default sink is a no-op so the pipeline state write has zero runtime
// dependency on unmerged code.

export interface SseStateEvent {
  ticketId: string;
  fromState: string;
  toState: string;
  detail: unknown;
  traceId: string | null;
}

export type SseStateSink = (event: SseStateEvent) => void;

let stateSink: SseStateSink = () => {};

/**
 * Swap the state-event sink (SLYK-0270 registers the real per-ticket
 * EventEmitter here). Tests use it to observe emissions.
 */
export function setStateSink(sink: SseStateSink): void {
  stateSink = sink;
}

/** Emit a pipeline `state` event on the per-ticket channel. Never throws. */
export function sseEmit(event: SseStateEvent): void {
  try {
    stateSink(event);
  } catch {
    // SSE delivery must never fail the dispatcher's state write.
  }
}
