import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createTicket, type CreateTicketDto } from '@/api/tickets';
import { boardKeys } from '@/api/queryKeys';
import { applyCreateToBoard } from '@/utils/boardInsert';
import type { BoardPayload } from '@/types/board';

export function useCreateTicket(slug: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateTicketDto) => createTicket(slug!, dto),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: boardKeys.all });
      const previousBoard = queryClient.getQueryData<BoardPayload>(boardKeys.detail(slug!));
      return { previousBoard };
    },
    onError: (_err, _dto, ctx) => {
      if (ctx?.previousBoard) {
        queryClient.setQueryData(boardKeys.detail(slug!), ctx.previousBoard);
      }
    },
    onSuccess: (ticket) => {
      queryClient.setQueryData<BoardPayload>(boardKeys.detail(slug!), (curr) =>
        curr ? applyCreateToBoard(curr, ticket) : curr,
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: boardKeys.all });
    },
  });
}
