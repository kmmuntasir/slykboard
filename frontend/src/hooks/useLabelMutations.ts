import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createLabel, updateLabel, deleteLabel } from '@/api/labels';
import { labelKeys, boardKeys } from '@/api/queryKeys';
import type { Label, CreateLabelDto, UpdateLabelDto } from '@/types/label';

// F14 T6: optimistic label catalog mutations.
// Create is settle-invalidate only (new id is server-assigned, cannot patch cache optimistically).
// Update + Delete snapshot + patch/remove the labelKeys.forProject(slug) cache, roll back on error,
// and invalidate labelKeys.forProject(slug) AND boardKeys.all on settle so board chips re-render
// (rename/recolor/cascade-untag all affect rendered chips).

export function useCreateLabel(projectSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateLabelDto) => createLabel(projectSlug, dto),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: labelKeys.forProject(projectSlug) });
    },
  });
}

export function useUpdateLabel(projectSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ labelId, dto }: { labelId: string; dto: UpdateLabelDto }) =>
      updateLabel(labelId, dto),
    onMutate: async ({ labelId, dto }) => {
      await qc.cancelQueries({ queryKey: labelKeys.forProject(projectSlug) });
      const prev = qc.getQueryData<Label[]>(labelKeys.forProject(projectSlug));
      if (prev) {
        qc.setQueryData<Label[]>(labelKeys.forProject(projectSlug), (curr) =>
          (curr ?? []).map((l) => (l.id === labelId ? { ...l, ...dto } : l)),
        );
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(labelKeys.forProject(projectSlug), ctx.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: labelKeys.forProject(projectSlug) });
      qc.invalidateQueries({ queryKey: boardKeys.all });
    },
    meta: { revertMessage: 'Label update reverted' },
  });
}

export function useDeleteLabel(projectSlug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (labelId: string) => deleteLabel(labelId),
    onMutate: async (labelId) => {
      await qc.cancelQueries({ queryKey: labelKeys.forProject(projectSlug) });
      const prev = qc.getQueryData<Label[]>(labelKeys.forProject(projectSlug));
      if (prev) {
        qc.setQueryData<Label[]>(labelKeys.forProject(projectSlug), (curr) =>
          (curr ?? []).filter((l) => l.id !== labelId),
        );
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(labelKeys.forProject(projectSlug), ctx.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: labelKeys.forProject(projectSlug) });
      qc.invalidateQueries({ queryKey: boardKeys.all });
    },
    meta: { revertMessage: 'Label delete reverted' },
  });
}
