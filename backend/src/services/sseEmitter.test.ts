import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  emit,
  listenerCount,
  off,
  on,
  resetStateSink,
  setStateSink,
  sseEmit,
  type SseEvent,
  type SseListener,
} from './sseEmitter';

// SLYK-0270 — unit tests for the per-ticket fan-out channel. The seam side
// (setStateSink/sseEmit swallowing) is covered in pipelineJobService.test.ts;
// here we lock the transport surface Phase 6.5 must keep stable
// (emit/on/off/listenerCount keyed by ticketId) plus the default sink's
// state→frame mapping.

afterEach(() => {
  resetStateSink();
});

describe('per-ticket channel — emit/on/off', () => {
  it('delivers an emit to the subscribed listener', () => {
    const listener = vi.fn<SseListener>();
    on('t-1', listener);

    emit('t-1', { type: 'state', data: { state: 'QUEUED' } });

    expect(listener).toHaveBeenCalledWith({ type: 'state', data: { state: 'QUEUED' } });
    off('t-1', listener);
  });

  it('fans out to every listener on the same ticket', () => {
    const a = vi.fn<SseListener>();
    const b = vi.fn<SseListener>();
    on('t-1', a);
    on('t-1', b);

    emit('t-1', { type: 'state', data: { state: 'DONE' } });

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    off('t-1', a);
    off('t-1', b);
  });

  it('does not cross tickets — emit on t-1 never reaches t-2', () => {
    const other = vi.fn<SseListener>();
    on('t-2', other);

    emit('t-1', { type: 'state', data: null });

    expect(other).not.toHaveBeenCalled();
    expect(listenerCount('t-2')).toBe(1);
    off('t-2', other);
  });

  it('off unsubscribes — listener count drops to zero and emit is a no-op', () => {
    const listener = vi.fn<SseListener>();
    on('t-1', listener);
    expect(listenerCount('t-1')).toBe(1);

    off('t-1', listener);
    emit('t-1', { type: 'state', data: null });

    expect(listenerCount('t-1')).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it('off is idempotent — removing an already-removed listener is a no-op', () => {
    const listener = vi.fn<SseListener>();
    on('t-1', listener);
    off('t-1', listener);
    off('t-1', listener);

    expect(listenerCount('t-1')).toBe(0);
  });

  it('listenerCount for a ticket with no subscribers is 0', () => {
    expect(listenerCount('never-subscribed')).toBe(0);
  });

  it('a throwing listener is contained — siblings registered BEFORE it still delivered, emit never throws', () => {
    // Node's EventEmitter aborts the listener loop at the first synchronous
    // throw, so ordering matters: a sibling registered after the bad listener
    // misses that frame (acceptable — the route's res.write thrower is the
    // only realistic failure and its connection is dead anyway). What must
    // hold is containment: the throw never escapes emit() and never kills
    // delivery for listeners that ran before the failure.
    const early = vi.fn<SseListener>();
    const throwing: SseListener = () => {
      throw new Error('subscriber socket gone');
    };
    const late = vi.fn<SseListener>();
    on('t-1', early);
    on('t-1', throwing);
    on('t-1', late);

    expect(() => emit('t-1', { type: 'state', data: null })).not.toThrow();
    expect(early).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled();

    // The channel stays usable after the failure.
    off('t-1', throwing);
    emit('t-1', { type: 'state', data: null });
    expect(late).toHaveBeenCalledTimes(1);

    off('t-1', early);
    off('t-1', late);
    expect(listenerCount('t-1')).toBe(0);
  });
});

describe('default state sink — state write → SSE frame', () => {
  it('sseEmit fans the state write out as event: state with {state, traceId}', () => {
    const seen: SseEvent[] = [];
    const listener: SseListener = (e) => seen.push(e);
    on('t-9', listener);

    sseEmit({
      ticketId: 't-9',
      fromState: 'BACKLOG',
      toState: 'QUEUED',
      detail: null,
      traceId: '9b7c6d5e-1111-4222-8333-444455556666',
    });

    // Wire shape pinned by 05-backend-routes.md § /api/v1/me/tickets/:id/events.
    expect(seen).toEqual([
      {
        type: 'state',
        data: { state: 'QUEUED', traceId: '9b7c6d5e-1111-4222-8333-444455556666' },
      },
    ]);
    off('t-9', listener);
  });

  it('null traceId passes through verbatim', () => {
    const seen: SseEvent[] = [];
    const listener: SseListener = (e) => seen.push(e);
    on('t-9', listener);

    sseEmit({
      ticketId: 't-9',
      fromState: 'QUEUED',
      toState: 'AGENT_RUNNING',
      detail: { hint: 'go' },
      traceId: null,
    });

    expect(seen).toEqual([{ type: 'state', data: { state: 'AGENT_RUNNING', traceId: null } }]);
    off('t-9', listener);
  });

  it('resetStateSink restores fan-out after a test sink swap', () => {
    setStateSink(() => {});
    sseEmit({
      ticketId: 't-9',
      fromState: 'BACKLOG',
      toState: 'QUEUED',
      detail: null,
      traceId: null,
    });
    expect(listenerCount('t-9')).toBe(0); // swallowed by the test sink

    resetStateSink();
    const listener = vi.fn<SseListener>();
    on('t-9', listener);
    sseEmit({
      ticketId: 't-9',
      fromState: 'QUEUED',
      toState: 'DONE',
      detail: null,
      traceId: null,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    off('t-9', listener);
  });
});
