import { useMutation, useQueryClient } from '@tanstack/react-query';

import { startTimer, stopTimer } from '@/api/timer';
import { timerKeys } from '@/api/queryKeys';
import { useServerTime } from '@/hooks/useServerTime';

// F20 T5: start/stop mutations for a ticket's server-authoritative timer.
// Both invalidate the active-timer cache on success so every TimerControls
// instance across the app re-renders (only one open timer per user).
// useServerTime() primes the offset probe so the live display is accurate.
export function useTimer(ticketId: string) {
  useServerTime();

  const queryClient = useQueryClient();

  const startMutation = useMutation({
    mutationFn: () => startTimer(ticketId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: timerKeys.active() });
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => stopTimer(ticketId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: timerKeys.active() });
    },
  });

  return {
    start: startMutation.mutateAsync,
    stop: stopMutation.mutateAsync,
    isStarting: startMutation.isPending,
    isStopping: stopMutation.isPending,
  };
}
