import { useQuery } from '@tanstack/react-query';
import { fetchBoard } from '@/api/boards';
import { boardKeys } from '@/api/queryKeys';
import { POLL_INTERVAL_MS } from '@/config/env';
import { useBoardUiStore } from '@/stores/useBoardUiStore';

// F10 D1/D3/D4: 30s refetch while visible + not dragging.
// dragInProgress (F11 seam) DEFERS (returns false) -> next tick resumes after drag-end.
// refetchIntervalInBackground:false (v5 default, explicit) pauses on document.hidden;
// existing global refetchOnWindowFocus:true resumes on focus.
//
// F26: reactive filter state drives the queryKey + queryFn so changing any
// filter refires the board query with a fresh server-side query string.
export function useBoard(slug: string | undefined) {
  const { searchQuery, assigneeFilter, priorityFilter, labelFilter } = useBoardUiStore();

  const params = new URLSearchParams();
  if (searchQuery) params.set('search', searchQuery);
  if (assigneeFilter) params.set('assignee', assigneeFilter);
  if (priorityFilter) params.set('priority', priorityFilter);
  if (labelFilter) params.set('label', labelFilter);
  const queryString = params.toString();

  return useQuery({
    queryKey: [...boardKeys.detail(slug ?? ''), queryString],
    queryFn: () => fetchBoard(slug!, queryString),
    enabled: !!slug,
    refetchInterval: () => (useBoardUiStore.getState().dragInProgress ? false : POLL_INTERVAL_MS),
    refetchIntervalInBackground: false,
  });
}
