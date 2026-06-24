import { useMutation, useQueryClient } from '@tanstack/react-query';
import { moveTicket } from '@/api/tickets';
import { boardKeys, ticketKeys } from '@/api/queryKeys';
import { applyMoveToBoard, type MoveDescriptor } from '@/utils/boardReorder';
import type { BoardPayload } from '@/types/board';

export interface MoveTicketVariables extends MoveDescriptor {
  ticketId: string;
  position: number;
}

export function useMoveTicket(slug: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (vars: MoveTicketVariables) =>
      moveTicket(vars.ticketId, {
        statusColumn: vars.dstColumnId,
        position: vars.position,
      }),
    onMutate: async (vars) => {
      // Guard: no slug -> no board query to optimistically update.
      if (!slug) {
        return { previousBoard: undefined };
      }
      await queryClient.cancelQueries({ queryKey: boardKeys.all });
      const previousBoard = queryClient.getQueryData<BoardPayload>(boardKeys.detail(slug));
      queryClient.setQueryData<BoardPayload>(boardKeys.detail(slug), (curr) =>
        curr ? applyMoveToBoard(curr, vars) : curr,
      );
      return { previousBoard };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previousBoard && slug) {
        queryClient.setQueryData(boardKeys.detail(slug), ctx.previousBoard);
      }
    },
    onSettled: (_data, _err, vars) => {
      queryClient.invalidateQueries({ queryKey: boardKeys.all });
      queryClient.invalidateQueries({ queryKey: ticketKeys.activity(vars.ticketId) });
    },
  });
}
