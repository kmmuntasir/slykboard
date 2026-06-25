import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deleteTicket } from '@/api/tickets';
import { boardKeys, ticketKeys } from '@/api/queryKeys';
import { ApiClientError } from '@/api/client';

export interface DeleteTicketVariables {
  ticketId: string;
  slug: string;
}

export function useDeleteTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (vars: DeleteTicketVariables) => deleteTicket(vars.ticketId),
    onSuccess: (_data, vars) => {
      // Drop the detail cache (row is gone) and refetch the board list.
      queryClient.removeQueries({ queryKey: ticketKeys.detail(vars.ticketId) });
      queryClient.invalidateQueries({ queryKey: boardKeys.all });
    },
    onError: (error) => {
      // F17 D2: admin-only delete — a 403 FORBIDDEN surfaces to the caller via
      // mutation.error (an ApiClientError with code 'FORBIDDEN'). No cache
      // rollback needed: delete is invalidate-only, nothing was written.
      if (error instanceof ApiClientError && error.code === 'FORBIDDEN') {
        /* surfaced via mutation.error */
      }
    },
    meta: { revertMessage: 'Delete reverted' },
  });
}
