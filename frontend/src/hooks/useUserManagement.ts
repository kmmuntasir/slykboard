import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateUserRole, setUserBlocked } from '@/api/users';

// F25: admin user-management mutations. Both invalidate the ['users'] cache so the
// SettingsPage roster refetches on success (and the F13 user picker stays fresh).
export function useUpdateUserRole() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ userId, role }: { userId: string; role: 'ADMIN' | 'MEMBER' }) =>
            updateUserRole(userId, role),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    });
}

export function useSetUserBlocked() {
    const qc = useQueryClient();
    return useMutation({
        mutationFn: ({ userId, blocked }: { userId: string; blocked: boolean }) =>
            setUserBlocked(userId, blocked),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
    });
}
