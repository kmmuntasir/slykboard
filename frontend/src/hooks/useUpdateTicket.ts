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
      // F14 T8: labelIds patches cannot be applied optimistically — the patch
      // carries IDs but Ticket.labels is the hydrated { id, name, color }[]
      // from the server join. We refetch on settle for correct colors, so skip
      // the optimistic board/detail writes when labelIds is the only change.
      // Title/description/priority keep their F13 optimistic path below.
      const hasAttributeFields =
        vars.dto.title !== undefined ||
        vars.dto.description !== undefined ||
        vars.dto.priority !== undefined;
      if (previousBoard && hasAttributeFields) {
        queryClient.setQueryData<BoardPayload>(boardKeys.detail(vars.slug), (curr) =>
          curr ? applyPatchToBoard(curr, vars.ticketId, vars.dto) : curr,
        );
      }
      if (previousTicket && hasAttributeFields) {
        queryClient.setQueryData<Ticket>(ticketKeys.detail(vars.ticketId), {
          ...previousTicket,
          title: vars.dto.title ?? previousTicket.title,
          description: vars.dto.description ?? previousTicket.description,
          priority: vars.dto.priority ?? previousTicket.priority,
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
      // F14 T8: labelIds patches require a board refetch — the hydrated label
      // colors/names come from the server join, not the ID-only patch. The
      // boardKeys.all invalidation above already covers this; the explicit
      // check documents the intent (no optimistic label rendering).
      if (vars.dto.labelIds !== undefined) {
        queryClient.invalidateQueries({ queryKey: boardKeys.all });
      }
    },
  });
}
