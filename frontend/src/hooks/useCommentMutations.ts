import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  createTicketComment,
  updateTicketComment,
  deleteTicketComment,
} from '@/api/comments';
import { ticketKeys } from '@/api/queryKeys';

// SLYK-13 T10: ticket-comment mutations.
// Create is settle-invalidate only (new id is server-assigned). Update + Delete
// likewise settle-invalidate (comment edits don't have a clean optimistic patch
// shape worth the complexity). Every onSettled invalidates BOTH the comments
// thread AND the activity feed for the same ticket, since edits/deletes surface
// as activity entries. Each mutation sets meta.revertMessage so the global toast
// UI can surface a user-facing failure message (see existing mutation hooks).

export function useCreateComment(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => createTicketComment(ticketId, body),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ticketKeys.comments(ticketId) });
      qc.invalidateQueries({ queryKey: ticketKeys.activity(ticketId) });
    },
    meta: { revertMessage: 'Failed to post comment' },
  });
}

export function useUpdateComment(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, body }: { commentId: string; body: string }) =>
      updateTicketComment(commentId, body),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ticketKeys.comments(ticketId) });
      qc.invalidateQueries({ queryKey: ticketKeys.activity(ticketId) });
    },
    meta: { revertMessage: 'Failed to update comment' },
  });
}

export function useDeleteComment(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => deleteTicketComment(commentId),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ticketKeys.comments(ticketId) });
      qc.invalidateQueries({ queryKey: ticketKeys.activity(ticketId) });
    },
    meta: { revertMessage: 'Failed to delete comment' },
  });
}
