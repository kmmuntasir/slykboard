import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchPipeline, queueTicketForAgent } from '@/api/pipeline';
import { boardKeys, pipelineKeys } from '@/api/queryKeys';
import type { PipelineJob } from '@/types/pipeline';

// SLYK-0310 — Pipeline tab data hook (11-existing-patterns.md § usePipeline).
// usePipeline: GET /api/v1/me/tickets/:id/pipeline. A 404 ("is not in the
// pipeline") is a legitimate state, not an error to toast — PipelinePanel
// reads pipelineAbsent for the empty state, so suppress the global mutation/
// query error surface by treating it via `isError` + error.status.
// useQueueForAgent: POST /queue from the empty state; on success seed the
// pipeline cache with the returned QUEUED job (the events list is refetched
// by invalidation) and refresh the board so the card state stays in sync.

export function usePipeline(ticketId: string) {
  return useQuery({
    queryKey: pipelineKeys.detail(ticketId),
    queryFn: () => fetchPipeline(ticketId),
    enabled: !!ticketId,
    retry: false,
  });
}

export interface UseQueueForAgentArgs {
  slug: string;
  ticketId: string;
}

export function useQueueForAgent({ slug, ticketId }: UseQueueForAgentArgs) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => queueTicketForAgent(ticketId),
    onSuccess: (job: PipelineJob) => {
      // Optimistically seed the panel: the job row is authoritative from the
      // POST response; events ({ id, ticketId, fromState… }) are refetched
      // by the invalidateQueries below.
      queryClient.setQueryData(pipelineKeys.detail(ticketId), {
        job,
        events: [],
      });
      void queryClient.invalidateQueries({ queryKey: pipelineKeys.detail(ticketId) });
      void queryClient.invalidateQueries({ queryKey: boardKeys.detail(slug) });
    },
  });
}
