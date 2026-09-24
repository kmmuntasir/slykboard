import { useCallback, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { startTimer, stopTimer } from '@/api/timer';
import { timerKeys } from '@/api/queryKeys';
import { fetchTimerState } from '@/api/timer';
import { useServerTime } from '@/hooks/useServerTime';
import type { StartTimerResponse } from '@/types/timer';

// F20 T5: start/stop mutations for a ticket's server-authoritative timer.
// Both invalidate the active-timer cache on success so every TimerControls
// instance across the app re-renders (only one open timer per user).
// SLYK-12: per-ticket history is invalidated too so the log refreshes without
// a manual reload. If starting this timer auto-stopped a DIFFERENT ticket's
// timer, that ticket's history is invalidated as well.
// useServerTime() primes the offset probe so the live display is accurate.
export function useTimer(ticketId: string) {
  useServerTime();

  const queryClient = useQueryClient();

  const startMutation = useMutation({
    mutationFn: () => startTimer(ticketId),
    onSuccess: (data: StartTimerResponse) => {
      queryClient.invalidateQueries({ queryKey: timerKeys.active() });
      queryClient.invalidateQueries({ queryKey: timerKeys.state() });
      queryClient.invalidateQueries({ queryKey: timerKeys.entries(ticketId) });
      // SLYK-12: cross-ticket auto-stop — refresh the prior ticket's history.
      const priorId = data.autoStoppedEntry?.ticketId;
      if (priorId && priorId !== ticketId) {
        queryClient.invalidateQueries({ queryKey: timerKeys.entries(priorId) });
      }
    },
  });

  // CR-09: the auto-stop stays, but it is never SILENT. Starting while another
  // ticket is tracked raises `pendingConfirm` with that ticket; the host renders
  // a confirmation and calls `confirmStart` (or `cancelConfirm`).
  const [pendingConfirm, setPendingConfirm] = useState<{
    ticketId: string;
    title: string;
    displayId: string;
  } | null>(null);

  const requestStart = useCallback(async () => {
    if (startMutation.isPending) return;
    if (pendingConfirm) {
      // Confirmed: run the real start (the server auto-stops the old session).
      setPendingConfirm(null);
      await startMutation.mutateAsync();
      return;
    }
    const state = await fetchTimerState();
    const active = state.active;
    if (active && active.ticket.id !== ticketId) {
      setPendingConfirm({
        ticketId: active.ticket.id,
        title: active.ticket.title,
        displayId: `${active.ticket.projectSlug}-${active.ticket.ticketNumber}`,
      });
      return;
    }
    await startMutation.mutateAsync();
  }, [pendingConfirm, startMutation, ticketId]);

  const cancelConfirm = useCallback(() => setPendingConfirm(null), []);

  const stopMutation = useMutation({
    mutationFn: () => stopTimer(ticketId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: timerKeys.active() });
      queryClient.invalidateQueries({ queryKey: timerKeys.state() });
      queryClient.invalidateQueries({ queryKey: timerKeys.entries(ticketId) });
    },
  });

  return {
    /** CR-09: guarded start — may raise a confirmation instead of starting. */
    start: requestStart,
    stop: stopMutation.mutateAsync,
    isStarting: startMutation.isPending,
    isStopping: stopMutation.isPending,
    /** Non-null when a cross-ticket switch needs an explicit confirmation. */
    pendingConfirm,
    confirmStart: requestStart,
    cancelConfirm,
  };
}
