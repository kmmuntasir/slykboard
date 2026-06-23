import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateTicket } from '@/api/tickets';
import { boardKeys, ticketKeys } from '@/api/queryKeys';
import { applyPatchToBoard } from '@/utils/boardPatch';
import type { BoardPayload } from '@/types/board';
import type { Ticket, UpdateTicketDto } from '@/types/ticket';

export interface UpdateTicketVariables {
  ticketId: string;
  dto: UpdateTicketDto;
  slug: string;
}

export function useUpdateTicket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (vars: UpdateTicketVariables) => updateTicket(vars.ticketId, vars.dto),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: boardKeys.all });
      await queryClient.cancelQueries({ queryKey: ticketKeys.detail(vars.ticketId) });
      const previousBoard = queryClient.getQueryData<BoardPayload>(boardKeys.detail(vars.slug));
      const previousTicket = queryClient.getQueryData<Ticket>(ticketKeys.detail(vars.ticketId));
      if (previousBoard) {
        queryClient.setQueryData<BoardPayload>(boardKeys.detail(vars.slug), (curr) =>
          curr ? applyPatchToBoard(curr, vars.ticketId, vars.dto) : curr,
        );
      }
      if (previousTicket) {
        queryClient.setQueryData<Ticket>(ticketKeys.detail(vars.ticketId), {
          ...previousTicket,
          ...vars.dto,
        });
      }
      return { previousBoard, previousTicket, ticketId: vars.ticketId, slug: vars.slug };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx) return;
      if (ctx.previousBoard) {
        queryClient.setQueryData(boardKeys.detail(ctx.slug), ctx.previousBoard);
      }
      if (ctx.previousTicket) {
        queryClient.setQueryData(ticketKeys.detail(ctx.ticketId), ctx.previousTicket);
      }
    },
    onSettled: (_data, _err, vars) => {
      queryClient.invalidateQueries({ queryKey: boardKeys.all });
      queryClient.invalidateQueries({ queryKey: ticketKeys.detail(vars.ticketId) });
    },
  });
}
