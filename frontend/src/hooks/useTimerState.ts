import { useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchTimerState } from '@/api/timer';
import { timerKeys } from '@/api/queryKeys';
import { POLL_INTERVAL_MS } from '@/config/env';
import { useBoardUiStore } from '@/stores/useBoardUiStore';
import type { TimerStateResponse } from '@/types/timer';

// CR-09 / CR-15: the caller's global timer state. Polls on the board interval so
// a start/stop from any surface (ticket page, top bar, another tab) lands in the
// UI without a manual refresh; mid-drag polls are deferred like the board.
export function useTimerState() {
  return useQuery({
    queryKey: timerKeys.state(),
    queryFn: fetchTimerState,
    refetchInterval: () => (useBoardUiStore.getState().dragInProgress ? false : POLL_INTERVAL_MS),
    refetchIntervalInBackground: false,
  });
}

/** Invalidate the timer state after any start/stop mutation. */
export function useInvalidateTimerState() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: timerKeys.state() });
    void qc.invalidateQueries({ queryKey: timerKeys.active() });
  };
}

export type { TimerStateResponse };
