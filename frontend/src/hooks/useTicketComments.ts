import { useQuery } from '@tanstack/react-query';
import { fetchTicketComments } from '@/api/comments';
import { ticketKeys } from '@/api/queryKeys';

// SLYK-13 T10: per-ticket comment thread read hook.
// keyed on ticketKeys.comments(ticketId) so mutations can invalidate the thread.
// disabled until ticketId is known to avoid a fetch with an empty id segment.
export function useTicketComments(ticketId: string) {
  return useQuery({
    queryKey: ticketKeys.comments(ticketId),
    queryFn: () => fetchTicketComments(ticketId),
    enabled: Boolean(ticketId),
  });
}
