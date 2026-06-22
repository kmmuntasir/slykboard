import { useQuery } from '@tanstack/react-query';
import { fetchBoard } from '@/api/boards';
import { boardKeys } from '@/api/queryKeys';

export function useBoard(slug: string | undefined) {
  return useQuery({
    queryKey: boardKeys.detail(slug ?? ''),
    queryFn: () => fetchBoard(slug!),
    enabled: !!slug,
  });
}
