// SLYK-02 T6 — Add-Member modal (the CORE of SLYK-02).
//
// Single email TextInput auto-searches as the user types via useLookupMember
// (T4; enabled + debounced, keyed on [slug, debouncedEmail] so stale lookups are
// discarded). Once a valid email resolves, exactly one of four branches renders:
//   (1) Already a project member        → "Already a Member", primary disabled
//   (2) Platform Admin                  → "Already a Member", primary disabled
//   (3) Exists on platform (not PA)     → details + Project Role + confirm → addMember
//   (4) Does not exist                  → expand form + Project Role + confirm → createAndAddMember
//
// ERROR HANDLING (CRITICAL): all mutation errors map to an INLINE role="alert"
// region inside the dialog and NEVER to a generic toast. To avoid the global
// MutationCache.onError double-toasting, both modal mutations pass
// meta: { suppressGlobalToast: true }, honored in lib/queryClient.ts
// (the chosen project-wide mechanism — see the top-of-file comment there). The
// local handlers in this file own the full error UX.
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { addMember, createAndAddMember } from '@/api/members';
import { ApiClientError } from '@/api/client';
import { memberKeys, projectKeys } from '@/api/queryKeys';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';
import { Avatar } from './ui/Avatar';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { SelectInput } from './ui/SelectInput';
import { TextInput } from './ui/TextInput';
import { useToast } from '@/hooks/useToast';
import { useLookupMember, useProjectMembers } from '@/hooks/useProjectMembers';
import type { LookupUser, MemberRole } from '@/types/member';

export interface AddMemberModalProps {
    slug: string;
    isOpen: boolean;
    onClose: () => void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TITLE_ID = 'add-member-title';
const CONFIRM_TITLE_ID = 'add-member-confirm-title';

export function AddMemberModal({ slug, isOpen, onClose }: AddMemberModalProps) {
    const toast = useToast();
    const queryClient = useQueryClient();
    const { data: roster } = useProjectMembers(slug);

    const [email, setEmail] = useState('');
    const [fullName, setFullName] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [role, setRole] = useState<MemberRole>('MEMBER');
    const [inlineError, setInlineError] = useState<string | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);

    // NOTE on suppression mechanism: TanStack Query v5 only honors `meta` set on
    // the MutationOptions (useMutation config), NOT per-call via mutateAsync's
    // MutateOptions. The shared useAddMember/useCreateAndAddMember hooks (T4) do
    // not accept meta and are out of this task's file-scope, so this modal owns
    // two local mutation instances configured with `meta: { suppressGlobalToast:
    // true }`. That flag is honored by lib/queryClient.ts's MutationCache.onError
    // so the global toast funnel is skipped for THESE mutations only — this file
    // owns the error UX inline (role="alert"). Invalidations mirror the shared
    // hooks (roster + project detail) so cache behavior is identical.
    const invalidateMembership = () => {
        void queryClient.invalidateQueries({ queryKey: memberKeys.forProject(slug) });
        void queryClient.invalidateQueries({ queryKey: projectKeys.detail(slug) });
    };
    const addMemberMutation = useMutation({
        mutationFn: (body: { email?: string; userId?: string; role?: MemberRole }) =>
            addMember(slug, body),
        meta: { suppressGlobalToast: true },
        onSuccess: invalidateMembership,
    });
    const createAndAddMemberMutation = useMutation({
        mutationFn: (body: {
            email: string;
            fullName?: string;
            displayName?: string | null;
            role?: MemberRole;
        }) => createAndAddMember(slug, body),
        meta: { suppressGlobalToast: true },
        onSuccess: invalidateMembership,
    });

    const trimmedEmail = email.trim();
    const emailValid = EMAIL_PATTERN.test(trimmedEmail);

    // useLookupMember debounces + validity-gates internally (T4). It is enabled
    // only for a valid email; partial/invalid typing never fires a request.
    const lookup = useLookupMember(slug, trimmedEmail);

    // Honor only the response for the CURRENT trimmed email — a stale lookup
    // (e.g. the user kept typing) is ignored via key equality in React Query,
    // but we also guard here against any late-arriving data.
    const lookupMatchesCurrent =
        emailValid && lookup.data !== undefined && trimmedEmail.length > 0;
    const lookupUser = lookupMatchesCurrent ? lookup.data!.user : undefined;
    const lookupExists = lookupMatchesCurrent ? lookup.data!.exists : false;

    // Branch 1 — client-side already-member check FIRST so a stale/late lookup
    // cannot override it. Case-insensitive email match against the roster.
    const alreadyMember = useMemo(() => {
        if (!emailValid) return false;
        const lower = trimmedEmail.toLowerCase();
        return (roster ?? []).some((m) => m.email.toLowerCase() === lower);
    }, [roster, emailValid, trimmedEmail]);

    const isPlatformAdmin = lookupExists && lookupUser?.isPlatformAdmin === true;

    // Branch classification (1 = alreadyMember, 2 = PA, 3 = exists+addable,
    // 4 = not-found, undefined = still resolving / invalid).
    const branch: 1 | 2 | 3 | 4 | undefined = alreadyMember
        ? 1
        : isPlatformAdmin
            ? 2
            : lookupExists
                ? 3
                : lookupMatchesCurrent
                    ? 4
                    : undefined;

    const isFetching = emailValid && lookup.isFetching;
    const isPending = addMemberMutation.isPending || createAndAddMemberMutation.isPending;

    // The branch-4 create form is "dirty" when any optional name has been typed.
    // While dirty we block backdrop close; Esc still works (Modal's X/onClose).
    const createFormDirty = fullName.trim().length > 0 || displayName.trim().length > 0;

    const primaryDisabled =
        !emailValid || isFetching || isPending || branch === undefined || branch === 1 || branch === 2;

    // Reset all local state — invoked on close and after a successful mutation.
    const resetState = () => {
        setEmail('');
        setFullName('');
        setDisplayName('');
        setRole('MEMBER');
        setInlineError(null);
        setConfirmOpen(false);
    };

    const handleClose = () => {
        resetState();
        onClose();
    };

    // Reset whenever the modal is closed from the outside (isOpen → false).
    useEffect(() => {
        if (!isOpen) resetState();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // --- Mutation handlers ----------------------------------------------------

    const mapMutationError = (err: unknown): string => {
        if (err instanceof ApiClientError) {
            const msg = err.message ?? '';
            if (err.code === 'CONFLICT' && msg.includes('Already a member')) {
                return 'Already a Member';
            }
            if (err.code === 'FORBIDDEN' && (msg.includes('allowed') || msg.includes('domain'))) {
                return 'domain not allowed';
            }
            if (err.code === 'CONFLICT' && msg.includes('already exists')) {
                return 'already exists';
            }
            return msg || 'Something went wrong.';
        }
        return 'Something went wrong.';
    };

    const handleAddExisting = async () => {
        setInlineError(null);
        try {
            await addMemberMutation.mutateAsync({ email: trimmedEmail, role });
            toast.success('Member added.');
            handleClose();
        } catch (err) {
            setInlineError(mapMutationError(err));
            setConfirmOpen(false);
        }
    };

    const handleCreateAndAdd = async () => {
        setInlineError(null);
        try {
            await createAndAddMemberMutation.mutateAsync({
                email: trimmedEmail,
                fullName: fullName.trim() || undefined,
                displayName: displayName.trim() || null,
                role,
            });
            toast.success('Member created and added.');
            handleClose();
        } catch (err) {
            setInlineError(mapMutationError(err));
            setConfirmOpen(false);
        }
    };

    // Primary action: open the appropriate confirm dialog.
    const openConfirm = () => {
        if (primaryDisabled) return;
        setInlineError(null);
        setConfirmOpen(true);
    };

    // Confirm-dialog wiring differs per branch.
    const confirmMessage =
        branch === 3
            ? `Add ${lookupUser ? nameFor(lookupUser) : trimmedEmail} to this project as ${roleLabel(role)}?`
            : `Create ${trimmedEmail} and add them to this project as ${roleLabel(role)}?`;

    const onConfirmDialogConfirm = () => {
        if (branch === 3) void handleAddExisting();
        else if (branch === 4) void handleCreateAndAdd();
    };

    const confirmPending = addMemberMutation.isPending || createAndAddMemberMutation.isPending;

    // Render-time branch copy for the inline status regions.
    const branchStatus = (() => {
        if (isFetching) return 'Searching…';
        if (branch === 1 || branch === 2) return 'Already a Member';
        return null;
    })();

    return (
        <Modal
            isOpen={isOpen}
            onClose={handleClose}
            onEsc={createFormDirty ? () => {} : handleClose}
            titleId={TITLE_ID}
            title="Add Member"
            size="md"
            blockBackdropClose={createFormDirty}
        >
            <div className="space-y-4">
                {/* Email input — the only always-present field. */}
                <Field label="Email" htmlFor="add-member-email">
                    <TextInput
                        id="add-member-email"
                        type="email"
                        autoComplete="off"
                        value={email}
                        onChange={(e) => {
                            setEmail(e.target.value);
                            setInlineError(null);
                        }}
                        aria-label="Member email"
                        placeholder="name@example.com"
                        className="w-full"
                        disabled={isPending}
                    />
                </Field>

                {branchStatus ? (
                    <p
                        role="status"
                        aria-live="polite"
                        className="text-sm text-muted-foreground"
                    >
                        {branchStatus}
                    </p>
                ) : null}

                {/* Branch 3 — existing, addable user: read-only details + role. */}
                {branch === 3 && lookupUser ? (
                    <div className="space-y-4">
                        <div className="flex items-center gap-3 rounded-md border border-border p-3">
                            <Avatar
                                size="sm"
                                name={nameFor(lookupUser)}
                            />
                            <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{nameFor(lookupUser)}</p>
                                <p className="truncate text-sm text-muted-foreground">
                                    {lookupUser.email}
                                </p>
                            </div>
                        </div>
                        <Field label="Project Role" htmlFor="add-member-role-existing">
                            <SelectInput
                                id="add-member-role-existing"
                                aria-label="Project role"
                                value={role}
                                onChange={(e) => setRole(e.target.value as MemberRole)}
                                disabled={isPending}
                                className="w-full"
                            >
                                <option value="MEMBER">Member</option>
                                <option value="PROJECT_ADMIN">Project Admin</option>
                            </SelectInput>
                        </Field>
                    </div>
                ) : null}

                {/* Branch 4 — does not exist: expand create form. */}
                {branch === 4 ? (
                    <div className="space-y-4">
                        <Field label="Full Name (optional)" htmlFor="add-member-full-name">
                            <TextInput
                                id="add-member-full-name"
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                aria-label="Full name (optional)"
                                className="w-full"
                                disabled={isPending}
                            />
                        </Field>
                        <Field label="Display Name (optional)" htmlFor="add-member-display-name">
                            <TextInput
                                id="add-member-display-name"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                aria-label="Display name (optional)"
                                className="w-full"
                                disabled={isPending}
                            />
                        </Field>
                        <Field label="Email" htmlFor="add-member-email-readonly">
                            <TextInput
                                id="add-member-email-readonly"
                                value={trimmedEmail}
                                readOnly
                                aria-label="Email"
                                className="w-full"
                            />
                        </Field>
                        <Field label="Project Role" htmlFor="add-member-role-new">
                            <SelectInput
                                id="add-member-role-new"
                                aria-label="Project role"
                                value={role}
                                onChange={(e) => setRole(e.target.value as MemberRole)}
                                disabled={isPending}
                                className="w-full"
                            >
                                <option value="MEMBER">Member</option>
                                <option value="PROJECT_ADMIN">Project Admin</option>
                            </SelectInput>
                        </Field>
                    </div>
                ) : null}

                {/* Inline error region — role="alert", never a generic toast. */}
                {inlineError ? (
                    <p role="alert" className="text-sm text-destructive">
                        {inlineError}
                    </p>
                ) : null}

                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={handleClose}>
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={openConfirm}
                        disabled={primaryDisabled}
                    >
                        {isPending ? 'Adding…' : primaryLabel(branch)}
                    </Button>
                </div>
            </div>

            <ConfirmDialog
                isOpen={confirmOpen}
                title={branch === 4 ? 'Create & add member?' : 'Add member?'}
                titleId={CONFIRM_TITLE_ID}
                message={confirmMessage}
                confirmLabel={branch === 4 ? 'Create & add' : 'Add'}
                cancelLabel="Cancel"
                pending={confirmPending}
                onConfirm={onConfirmDialogConfirm}
                onCancel={() => setConfirmOpen(false)}
            />
        </Modal>
    );
}

// Display name for an existing lookup user (full name → display name → email).
function nameFor(user: LookupUser): string {
    return user.fullName || user.displayName || user.email;
}

function roleLabel(role: MemberRole): string {
    return role === 'PROJECT_ADMIN' ? 'Project Admin' : 'Member';
}

function primaryLabel(branch: 1 | 2 | 3 | 4 | undefined): string {
    if (branch === 4) return 'Create & add';
    return 'Add Member';
}
