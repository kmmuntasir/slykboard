import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTimer } from '@/hooks/useTimer';
import { startTimer, stopTimer, fetchTimerState } from '@/api/timer';
import { fetchServerTime } from '@/api/time';
import { timerKeys } from '@/api/queryKeys';
import type {
  StartTimerResponse,
  StopTimerResponse,
  TimeEntry,
  TimerStateResponse,
  TimerTicketRef,
} from '@/types/timer';

// Mock the timer API at module scope; per-test mockResolvedValueOnce supplies
// the start/stop responses. fetchServerTime is mocked so useServerTime's
// background query (fired on useTimer mount) doesn't hit the network.
vi.mock('@/api/timer');
vi.mock('@/api/time');

const TICKET_ID = 't1';
const PRIOR_ID = 't2';

function makeEntry(ticketId: string, id = 'e1'): TimeEntry {
  return {
    id,
    ticketId,
    userId: 'u1',
    startTime: '2026-01-01T00:00:00.000Z',
    endTime: null,
    manualEntryMinutes: null,
    description: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

// CR-09: the guard probes GET /timer/state; the active ticket ref feeds the
// pendingConfirm payload (displayId = `${projectSlug}-${ticketNumber}`).
const FOREIGN_TICKET: TimerTicketRef = {
  id: PRIOR_ID,
  ticketNumber: 7,
  title: 'Nightly export',
  projectId: 'p1',
  projectSlug: 'SLYK',
  projectName: 'Slyk',
};

function stateWithActive(ticket: TimerTicketRef): TimerStateResponse {
  return {
    active: { entryId: 'e9', startTime: '2026-01-01T00:00:00.000Z', ticket },
    lastTracked: null,
  };
}

// --- Harness ---------------------------------------------------------------
// Matches the createWrapper / newQueryClient pattern from useMoveTicket.test.ts
// (gcTime: 0, retry: false) so cache invalidations are observable in isolation.

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
}

function newQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
}

// --- Tests -----------------------------------------------------------------

describe('useTimer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchServerTime).mockResolvedValue({ now: '2026-01-01T00:00:00.000Z' });
    // CR-09 guard: no other timer running by default.
    vi.mocked(fetchTimerState).mockResolvedValue({ active: null, lastTracked: null });
  });

  it('start invalidates active() and entries(currentTicketId)', async () => {
    const resp: StartTimerResponse = {
      entry: makeEntry(TICKET_ID),
      serverNow: '2026-01-01T00:00:00.000Z',
      autoStoppedEntry: null,
    };
    vi.mocked(startTimer).mockResolvedValueOnce(resp);

    const queryClient = newQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useTimer(TICKET_ID), {
      wrapper: createWrapper(queryClient),
    });

    await result.current.start();

    await waitFor(() => expect(startTimer).toHaveBeenCalledTimes(1));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: timerKeys.active() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: timerKeys.entries(TICKET_ID) });
    // No cross-ticket entries invalidation.
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: timerKeys.entries(PRIOR_ID) });
  });

  it('start with autoStoppedEntry on a different ticket also invalidates entries(priorId)', async () => {
    const resp: StartTimerResponse = {
      entry: makeEntry(TICKET_ID, 'e1'),
      serverNow: '2026-01-01T00:00:00.000Z',
      autoStoppedEntry: makeEntry(PRIOR_ID, 'e2'),
    };
    vi.mocked(startTimer).mockResolvedValueOnce(resp);

    const queryClient = newQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useTimer(TICKET_ID), {
      wrapper: createWrapper(queryClient),
    });

    await result.current.start();

    await waitFor(() => expect(startTimer).toHaveBeenCalledTimes(1));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: timerKeys.active() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: timerKeys.entries(TICKET_ID) });
    // Cross-ticket auto-stop: prior ticket's history invalidated too.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: timerKeys.entries(PRIOR_ID) });
  });

  it('start with autoStoppedEntry null only invalidates active() and entries(currentTicketId)', async () => {
    const resp: StartTimerResponse = {
      entry: makeEntry(TICKET_ID),
      serverNow: '2026-01-01T00:00:00.000Z',
      autoStoppedEntry: null,
    };
    vi.mocked(startTimer).mockResolvedValueOnce(resp);

    const queryClient = newQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useTimer(TICKET_ID), {
      wrapper: createWrapper(queryClient),
    });

    await result.current.start();

    await waitFor(() => expect(startTimer).toHaveBeenCalledTimes(1));

    // Exactly the two invalidations for the current ticket; no other entries() call.
    const entriesCalls = invalidateSpy.mock.calls.filter((c) => {
      const key = (c[0] as { queryKey: unknown }).queryKey;
      return JSON.stringify(key) === JSON.stringify(timerKeys.entries(PRIOR_ID));
    });
    expect(entriesCalls).toHaveLength(0);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: timerKeys.entries(TICKET_ID) });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: timerKeys.active() });
  });

  it('stop invalidates active() and entries(currentTicketId) with no third entries call', async () => {
    const resp: StopTimerResponse = {
      entry: makeEntry(TICKET_ID),
      serverNow: '2026-01-01T00:00:00.000Z',
    };
    vi.mocked(stopTimer).mockResolvedValueOnce(resp);

    const queryClient = newQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useTimer(TICKET_ID), {
      wrapper: createWrapper(queryClient),
    });

    await result.current.stop();

    await waitFor(() => expect(stopTimer).toHaveBeenCalledTimes(1));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: timerKeys.active() });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: timerKeys.entries(TICKET_ID) });
    // No prior-ticket entries invalidation on stop.
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: timerKeys.entries(PRIOR_ID) });
    // Sanity: stop path fires exactly two invalidations (no extras).
    // active() + state() (CR-15) + entries(current).
    expect(invalidateSpy).toHaveBeenCalledTimes(3);
  });

  // --- CR-09 guard flow ------------------------------------------------------

  it('start while another ticket is active raises pendingConfirm and does not start', async () => {
    vi.mocked(fetchTimerState).mockResolvedValue(stateWithActive(FOREIGN_TICKET));

    const queryClient = newQueryClient();
    const { result } = renderHook(() => useTimer(TICKET_ID), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.start();
    });

    expect(startTimer).not.toHaveBeenCalled();
    expect(result.current.pendingConfirm).toEqual({
      ticketId: PRIOR_ID,
      title: 'Nightly export',
      displayId: 'SLYK-7',
    });
  });

  it('cancelConfirm clears pendingConfirm and the timer still does not start', async () => {
    vi.mocked(fetchTimerState).mockResolvedValue(stateWithActive(FOREIGN_TICKET));

    const queryClient = newQueryClient();
    const { result } = renderHook(() => useTimer(TICKET_ID), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      result.current.cancelConfirm();
    });

    expect(result.current.pendingConfirm).toBeNull();
    expect(startTimer).not.toHaveBeenCalled();
  });

  it('confirmStart after the guard is raised starts the timer exactly once', async () => {
    vi.mocked(fetchTimerState).mockResolvedValue(stateWithActive(FOREIGN_TICKET));
    const resp: StartTimerResponse = {
      entry: makeEntry(TICKET_ID),
      serverNow: '2026-01-01T00:00:00.000Z',
      // Confirming auto-stops the foreign session server-side.
      autoStoppedEntry: makeEntry(PRIOR_ID, 'e2'),
    };
    vi.mocked(startTimer).mockResolvedValueOnce(resp);

    const queryClient = newQueryClient();
    const { result } = renderHook(() => useTimer(TICKET_ID), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.confirmStart();
    });

    expect(startTimer).toHaveBeenCalledTimes(1);
    // The confirmed path short-circuits: no second state probe.
    expect(fetchTimerState).toHaveBeenCalledTimes(1);
    expect(result.current.pendingConfirm).toBeNull();
  });

  it('start when this same ticket is already active starts immediately without a confirm', async () => {
    vi.mocked(fetchTimerState).mockResolvedValue(
      stateWithActive({ ...FOREIGN_TICKET, id: TICKET_ID, ticketNumber: 1 }),
    );
    const resp: StartTimerResponse = {
      entry: makeEntry(TICKET_ID),
      serverNow: '2026-01-01T00:00:00.000Z',
      autoStoppedEntry: null,
    };
    vi.mocked(startTimer).mockResolvedValueOnce(resp);

    const queryClient = newQueryClient();
    const { result } = renderHook(() => useTimer(TICKET_ID), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.start();
    });

    expect(startTimer).toHaveBeenCalledTimes(1);
    expect(result.current.pendingConfirm).toBeNull();
  });

  it('start with no active timer starts immediately', async () => {
    const resp: StartTimerResponse = {
      entry: makeEntry(TICKET_ID),
      serverNow: '2026-01-01T00:00:00.000Z',
      autoStoppedEntry: null,
    };
    vi.mocked(startTimer).mockResolvedValueOnce(resp);

    const queryClient = newQueryClient();
    const { result } = renderHook(() => useTimer(TICKET_ID), {
      wrapper: createWrapper(queryClient),
    });

    await act(async () => {
      await result.current.start();
    });

    expect(startTimer).toHaveBeenCalledTimes(1);
    expect(result.current.pendingConfirm).toBeNull();
  });
});
