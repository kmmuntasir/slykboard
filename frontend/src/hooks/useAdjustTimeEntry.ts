import { useMutation, useQueryClient } from '@tanstack/react-query';

import { adjustTimeEntry } from '@/api/timer';
import { timerKeys, boardKeys } from '@/api/queryKeys';

// CR-14: one entry at a time (FR-14.7). On success the entry list, the activity
// feed, and every board cache that renders tracked time refresh — the effective
// duration changed everywhere it is displayed.
export function useAdjustTimeEntry(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { entryId: string; adjustmentMinutes: number; reason: string }) =>
      adjustTimeEntry(ticketId, vars.entryId, {
        adjustmentMinutes: vars.adjustmentMinutes,
        reason: vars.reason,
      }),
    meta: { revertMessage: 'Adjustment failed' },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: timerKeys.entries(ticketId) });
      void qc.invalidateQueries({ queryKey: timerKeys.adjustment(vars.entryId) });
      void qc.invalidateQueries({ queryKey: boardKeys.all });
    },
  });
}
