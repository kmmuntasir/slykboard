import { useMutation, useQueryClient } from '@tanstack/react-query';

import { startTimer, stopTimer } from '@/api/timer';
import { timerKeys } from '@/api/queryKeys';
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
      queryClient.invalidateQueries({ queryKey: timerKeys.entries(ticketId) });
      // SLYK-12: cross-ticket auto-stop — refresh the prior ticket's history.
      const priorId = data.autoStoppedEntry?.ticketId;
      if (priorId && priorId !== ticketId) {
        queryClient.invalidateQueries({ queryKey: timerKeys.entries(priorId) });
      }
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => stopTimer(ticketId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: timerKeys.active() });
      queryClient.invalidateQueries({ queryKey: timerKeys.entries(ticketId) });
    },
  });

  return {
    start: startMutation.mutateAsync,
    stop: stopMutation.mutateAsync,
    isStarting: startMutation.isPending,
    isStopping: stopMutation.isPending,
  };
}
