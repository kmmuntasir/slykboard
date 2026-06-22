import { useQuery } from '@tanstack/react-query';
import { fetchBoard } from '@/api/boards';
import { boardKeys } from '@/api/queryKeys';
import { POLL_INTERVAL_MS } from '@/config/env';
import { useBoardUiStore } from '@/stores/useBoardUiStore';

// F10 D1/D3/D4: 30s refetch while visible + not dragging.
// dragInProgress (F11 seam) DEFERS (returns false) -> next tick resumes after drag-end.
// refetchIntervalInBackground:false (v5 default, explicit) pauses on document.hidden;
// existing global refetchOnWindowFocus:true resumes on focus.
export function useBoard(slug: string | undefined) {
  return useQuery({
    queryKey: boardKeys.detail(slug ?? ''),
    queryFn: () => fetchBoard(slug!),
    enabled: !!slug,
    refetchInterval: () =>
      useBoardUiStore.getState().dragInProgress ? false : POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}
