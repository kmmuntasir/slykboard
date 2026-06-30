import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    listMembers,
    addMember,
    createAndAddMember,
    updateMemberRole,
    removeMember,
    lookupMember,
} from '@/api/members';
import { memberKeys, projectKeys } from '@/api/queryKeys';
import { useAuthStore } from '@/stores/useAuthStore';
import { useDebouncedValue } from './useDebouncedValue';
import type { Member, MemberRole } from '@/types/member';

const STALE_TIME_MS = 30 * 1000; // 30s — matches the app's board polling cadence.

// SLYK-02 T4 — lookup debounce + validity gate. The query is enabled ONLY for
// a syntactically valid email so partial/invalid typing never hits the network.
const LOOKUP_DEBOUNCE_MS = 300;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOOKUP_STALE_TIME_MS = 15 * 1000;

// SLYK-01 Task N — TanStack Query hooks for the project member-management API.
// Mutations invalidate the roster (and the project detail cache, since membership
// affects project access) on success. The current user's own membership row is
// derived from the roster so the page can gate management controls on
// (Platform Admin OR Project Admin) without a second round-trip.

export function useProjectMembers(slug: string) {
    return useQuery({
        queryKey: memberKeys.forProject(slug),
        queryFn: () => listMembers(slug),
        staleTime: STALE_TIME_MS,
    });
}

export function useAddMember(slug: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (body: { email?: string; userId?: string; role?: MemberRole }) =>
            addMember(slug, body),
        onSuccess: () => invalidateMembership(queryClient, slug),
    });
}

export function useCreateAndAddMember(slug: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (body: {
            email: string;
            fullName?: string;
            displayName?: string | null;
            role?: MemberRole;
        }) => createAndAddMember(slug, body),
        onSuccess: () => invalidateMembership(queryClient, slug),
    });
}

export function useUpdateMemberRole(slug: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ userId, role }: { userId: string; role: MemberRole }) =>
            updateMemberRole(slug, userId, role),
        onSuccess: () => invalidateMembership(queryClient, slug),
    });
}

export function useRemoveMember(slug: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (userId: string) => removeMember(slug, userId),
        onSuccess: () => invalidateMembership(queryClient, slug),
    });
}

// Derives the current user's membership row from the roster + whether they are a
// PROJECT_ADMIN. Pair with useRequirePlatformAdmin() at call sites for the full
// management gate: Platform Admin OR Project Admin. A Platform Admin who is not a
// real member has no membership row (isProjectAdmin === false) but is still a
// manager via the platform-admin bypass.
export function useCurrentProjectMembership(slug: string): {
    membership: Member | undefined;
    isProjectAdmin: boolean;
} {
    const { data: members } = useProjectMembers(slug);
    const currentUserId = useAuthStore((s) => s.user?.id);
    const membership = useMemo(
        () => members?.find((m) => m.userId === currentUserId),
        [members, currentUserId],
    );
    const isProjectAdmin = membership?.role === 'PROJECT_ADMIN';
    return { membership, isProjectAdmin };
}

function invalidateMembership(queryClient: ReturnType<typeof useQueryClient>, slug: string) {
    void queryClient.invalidateQueries({ queryKey: memberKeys.forProject(slug) });
    // Membership changes affect project access visibility — refresh project detail.
    void queryClient.invalidateQueries({ queryKey: projectKeys.detail(slug) });
}

// SLYK-02 T4 — debounced read-only email lookup powering the Add-Member modal's
// auto-search. The email is debounced (LOOKUP_DEBOUNCE_MS) and the query is
// enabled ONLY once the debounced value is a valid email, so partial/invalid
// typing never fires a request. retry:false so a 4xx (e.g. 403 access denial)
// never auto-retries. Query errors are NOT globally toasted (only mutations are
// — lib/queryClient.ts), so inline handling in the modal stays clean. Keyed on
// [slug, debouncedEmail] so React Query discards stale lookups as the user types.
export function useLookupMember(slug: string, email: string) {
    const debouncedEmail = useDebouncedValue(email.trim(), LOOKUP_DEBOUNCE_MS);
    const enabled = EMAIL_PATTERN.test(debouncedEmail);
    return useQuery({
        queryKey: memberKeys.lookup(slug, debouncedEmail),
        queryFn: () => lookupMember(slug, debouncedEmail),
        enabled,
        staleTime: LOOKUP_STALE_TIME_MS,
        retry: false,
    });
}
