import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updatePlatformAdmin, setUserBlocked } from '@/api/users';

// F25: admin user-management mutations. Both invalidate the ['users'] cache so the
// management roster refetches on success (and the F13 user picker stays fresh).
export function useUpdatePlatformAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, isPlatformAdmin }: { userId: string; isPlatformAdmin: boolean }) =>
      updatePlatformAdmin(userId, isPlatformAdmin),
    meta: { revertMessage: "Couldn't update platform-admin status" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useSetUserBlocked() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, blocked }: { userId: string; blocked: boolean }) =>
      setUserBlocked(userId, blocked),
    meta: { revertMessage: "Couldn't change user status" },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
}
