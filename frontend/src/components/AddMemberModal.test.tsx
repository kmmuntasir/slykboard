// SLYK-02 T6 — AddMemberModal test suite.
//
// Mocking strategy:
//  - useLookupMember / useProjectMembers are mocked (query-side, no suppression
//    concern) so each test drives the lookup result + roster directly.
//  - addMember / createAndAddMember (api/members) are mocked rather than the
//    useAddMember/useCreateAndAddMember hooks, because TanStack Query v5 only
//    honors `meta` on the MutationOptions, not per-call. The modal therefore
//    owns two local useMutation instances with meta.suppressGlobalToast. Mocking
//    the api fn lets a REAL React Query mutation run against the REAL queryClient
//    (from lib/queryClient.ts), so the suppression mechanism — the binding
//    CRITICAL requirement + the queryClient.ts edit — is exercised end-to-end
//    (a mocked hook could not test that the global toast is actually skipped).
//  - useToast is mocked so we can assert toast.success / toast.error calls.
//  - ConfirmDialog is mocked to expose explicit Confirm/Cancel triggers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';

// The real queryClient — its MutationCache.onError honors meta.suppressGlobalToast.
import { queryClient } from '@/lib/queryClient';
import { ApiClientError } from '@/api/client';
import type { LookupResult, Member } from '@/types/member';

// --- Hoisted mock state + spies (vi.mock factories are hoisted above imports,
// so any value they close over must itself be hoisted via vi.hoisted). --------
const { mocks } = vi.hoisted(() => ({
    mocks: {
        lookupResult: { data: undefined as LookupResult | undefined, isFetching: false },
        rosterData: [] as Member[],
        addMember: vi.fn(),
        createAndAddMember: vi.fn(),
        toastSuccess: vi.fn(),
        toastError: vi.fn(),
    },
}));

// Module-level handles into the hoisted mock state. `setLookup`/`setRoster`
// below mutate `mocks` in place so the mocked hooks observe new values.
const addMemberMock = mocks.addMember;
const createAndAddMemberMock = mocks.createAndAddMember;
const toastSuccess = mocks.toastSuccess;
const toastError = mocks.toastError;

vi.mock('@/api/members', () => ({
    addMember: (...args: unknown[]) => mocks.addMember(...args),
    createAndAddMember: (...args: unknown[]) => mocks.createAndAddMember(...args),
}));

vi.mock('@/hooks/useProjectMembers', () => ({
    useProjectMembers: () => ({ data: mocks.rosterData }),
    useLookupMember: () => mocks.lookupResult,
}));

vi.mock('@/hooks/useToast', () => ({
    useToast: () => ({ success: mocks.toastSuccess, error: mocks.toastError }),
    toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

// ConfirmDialog mock — exposes deterministic Confirm/Cancel triggers wired to
// the real onConfirm/onCancel so tests can drive the confirm flow.
vi.mock('./ConfirmDialog', () => ({
    ConfirmDialog: ({
        isOpen,
        onConfirm,
        onCancel,
        pending,
    }: {
        isOpen: boolean;
        onConfirm: () => void;
        onCancel: () => void;
        pending?: boolean;
    }) => {
        if (!isOpen) return null;
        return (
            <div data-testid="confirm-dialog">
                <button type="button" onClick={onConfirm} disabled={pending}>
                    DoConfirm
                </button>
                <button type="button" onClick={onCancel}>
                    DoCancel
                </button>
            </div>
        );
    },
}));

import { AddMemberModal } from './AddMemberModal';

// --- Helpers -----------------------------------------------------------------

function setLookup(result: LookupResult | undefined, isFetching = false) {
    // Mutate in place so the mocked hook (which returns mocks.lookupResult)
    // observes the new values without needing a fresh object identity.
    mocks.lookupResult.data = result;
    mocks.lookupResult.isFetching = isFetching;
}
function setRoster(members: Member[]) {
    mocks.rosterData.splice(0, mocks.rosterData.length, ...members);
}

function renderModal(props: { slug?: string; isOpen?: boolean; onClose?: () => void } = {}) {
    return render(
        <QueryClientProvider client={queryClient}>
            <AddMemberModal
                slug={props.slug ?? 'proj'}
                isOpen={props.isOpen ?? true}
                onClose={props.onClose ?? vi.fn()}
            />
        </QueryClientProvider>,
    );
}

/** Type a valid email into the modal's email field. */
function typeEmail(email: string) {
    fireEvent.change(screen.getByLabelText('Member email'), { target: { value: email } });
}

const EXISTING_USER = {
    id: 'u-1',
    email: 'ada@example.com',
    fullName: 'Ada Lovelace',
    displayName: 'Ada',
    isPlatformAdmin: false,
};
const PLATFORM_ADMIN_USER = {
    id: 'u-pa',
    email: 'boss@example.com',
    fullName: 'Boss Admin',
    displayName: null,
    isPlatformAdmin: true,
};

const ROSTER_MEMBER: Member = {
    userId: 'u-roster',
    email: 'onroster@example.com',
    fullName: 'On Roster',
    displayName: null,
    avatarUrl: null,
    role: 'MEMBER',
    createdAt: '2024-01-01T00:00:00.000Z',
};

describe('AddMemberModal', () => {
    let appRoot: HTMLElement;

    beforeEach(() => {
        appRoot = document.createElement('main');
        appRoot.id = 'app-root';
        document.body.appendChild(appRoot);

        queryClient.clear();
        mocks.lookupResult.data = undefined;
        mocks.lookupResult.isFetching = false;
        mocks.rosterData.length = 0;
        addMemberMock.mockReset();
        createAndAddMemberMock.mockReset();
        toastSuccess.mockClear();
        toastError.mockClear();
    });

    afterEach(() => {
        appRoot.remove();
        cleanup();
    });

    // --- Lookup gating -------------------------------------------------------

    it('renders nothing when isOpen is false', () => {
        const { container } = renderModal({ isOpen: false });
        expect(container).toBeEmptyDOMElement();
    });

    it('does not render a branch for an invalid/partial email and disables primary', () => {
        renderModal();
        typeEmail('not-an-email');
        expect(screen.queryByText('Already a Member')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Add Member' })).toBeDisabled();
    });

    it('shows "Searching…" while the lookup is fetching', () => {
        renderModal();
        setLookup(undefined, true);
        typeEmail('ada@example.com');
        // Force a re-render so the mock's new state is picked up.
        expect(screen.getByText('Searching…')).toBeInTheDocument();
    });

    // --- Four-branch table-driven suite --------------------------------------

    const branchCases = [
        {
            name: 'branch 1 — email already on roster → "Already a Member", primary disabled',
            email: 'onroster@example.com',
            roster: [ROSTER_MEMBER],
            lookup: { exists: true, user: EXISTING_USER } as LookupResult,
            expectPrimaryDisabled: true,
            expectStatus: 'Already a Member',
        },
        {
            name: 'branch 2 — Platform Admin → "Already a Member", primary disabled',
            email: 'boss@example.com',
            roster: [],
            lookup: { exists: true, user: PLATFORM_ADMIN_USER } as LookupResult,
            expectPrimaryDisabled: true,
            expectStatus: 'Already a Member',
        },
        {
            name: 'branch 3 — exists, addable → details + role select + Add Member primary',
            email: 'ada@example.com',
            roster: [],
            lookup: { exists: true, user: EXISTING_USER } as LookupResult,
            expectPrimaryDisabled: false,
            expectStatus: null,
        },
        {
            name: 'branch 4 — does not exist → expand create form',
            email: 'new@example.com',
            roster: [],
            lookup: { exists: false } as LookupResult,
            expectPrimaryDisabled: false,
            expectStatus: null,
        },
    ];

    branchCases.forEach(
        ({ name, email, roster, lookup, expectPrimaryDisabled, expectStatus }) => {
            it(name, () => {
                setRoster(roster);
                setLookup(lookup);
                renderModal();
                typeEmail(email);

                if (expectStatus) {
                    expect(screen.getAllByText(expectStatus).length).toBeGreaterThan(0);
                }

                // Branch 3 renders the existing user's details.
                if (email === 'ada@example.com') {
                    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
                }
                // Branch 4 expands the create form (Full Name optional field) +
                // a read-only pre-filled email field.
                if (lookup.exists === false) {
                    expect(screen.getByLabelText('Full name (optional)')).toBeInTheDocument();
                    const readOnlyEmail = document.getElementById(
                        'add-member-email-readonly',
                    ) as HTMLInputElement;
                    expect(readOnlyEmail).not.toBeNull();
                    expect(readOnlyEmail.value).toBe('new@example.com');
                }

                const primary = screen.getByRole('button', {
                    name: lookup.exists === false ? 'Create & add' : 'Add Member',
                }) as HTMLButtonElement;
                expect(primary.disabled).toBe(expectPrimaryDisabled);
            });
        },
    );

    // --- Branch 3 happy path: confirm → addMember → success toast + close ---

    it('branch 3 — confirm calls addMember({email, role}) and toasts "Member added." + onClose', async () => {
        const onClose = vi.fn();
        addMemberMock.mockResolvedValueOnce({});
        setLookup({ exists: true, user: EXISTING_USER });
        renderModal({ onClose });
        typeEmail('ada@example.com');

        fireEvent.click(screen.getByRole('button', { name: 'Add Member' }));
        const confirm = await screen.findByTestId('confirm-dialog');
        expect(confirm).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'DoConfirm' }));

        await waitFor(() => expect(addMemberMock).toHaveBeenCalledTimes(1));
        expect(addMemberMock).toHaveBeenCalledWith('proj', { email: 'ada@example.com', role: 'MEMBER' });
        await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Member added.'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // --- Branch 4 happy path: confirm → createAndAddMember (trimmed) -----------

    it('branch 4 — confirm calls createAndAddMember with trimmed names and toasts "Member created and added."', async () => {
        const onClose = vi.fn();
        createAndAddMemberMock.mockResolvedValueOnce({});
        setLookup({ exists: false });
        renderModal({ onClose });
        typeEmail('new@example.com');

        fireEvent.change(screen.getByLabelText('Full name (optional)'), {
            target: { value: '  Grace Hopper  ' },
        });
        fireEvent.change(screen.getByLabelText('Display name (optional)'), {
            target: { value: '  Grace  ' },
        });

        fireEvent.click(screen.getByRole('button', { name: 'Create & add' }));
        await screen.findByTestId('confirm-dialog');
        fireEvent.click(screen.getByRole('button', { name: 'DoConfirm' }));

        await waitFor(() => expect(createAndAddMemberMock).toHaveBeenCalledTimes(1));
        expect(createAndAddMemberMock).toHaveBeenCalledWith('proj', {
            email: 'new@example.com',
            fullName: 'Grace Hopper',
            displayName: 'Grace',
            role: 'MEMBER',
        });
        await waitFor(() =>
            expect(toastSuccess).toHaveBeenCalledWith('Member created and added.'),
        );
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // --- Inline error mapping + double-toast suppression ---------------------

    const errorMappingCases: {
        name: string;
        error: ApiClientError;
        expectedInline: string;
    }[] = [
        {
            name: 'CONFLICT "Already a member" → "Already a Member"',
            error: new ApiClientError('Already a member', 409, 'CONFLICT'),
            expectedInline: 'Already a Member',
        },
        {
            name: 'FORBIDDEN domain → "domain not allowed"',
            error: new ApiClientError('Email domain not allowed', 403, 'FORBIDDEN'),
            expectedInline: 'domain not allowed',
        },
        {
            name: 'CONFLICT "User already exists" → "already exists"',
            error: new ApiClientError('User already exists', 409, 'CONFLICT'),
            expectedInline: 'already exists',
        },
    ];

    errorMappingCases.forEach(({ name, error, expectedInline }) => {
        it(`error mapping + suppression: ${name} (no global toast)`, async () => {
            addMemberMock.mockRejectedValueOnce(error);
            setLookup({ exists: true, user: EXISTING_USER });
            renderModal();
            typeEmail('ada@example.com');

            fireEvent.click(screen.getByRole('button', { name: 'Add Member' }));
            await screen.findByTestId('confirm-dialog');
            fireEvent.click(screen.getByRole('button', { name: 'DoConfirm' }));

            // Inline role="alert" surfaces the mapped message.
            const alert = await screen.findByRole('alert');
            expect(alert).toHaveTextContent(expectedInline);

            // CRITICAL: the global toast funnel must be skipped (suppressed via
            // meta.suppressGlobalToast honored in lib/queryClient.ts).
            await waitFor(() => expect(toastError).not.toHaveBeenCalled());
        });
    });

    // --- Reset on close ------------------------------------------------------

    it('onClose resets state — reopening shows a clean form', () => {
        setLookup({ exists: false });
        const { rerender } = renderModal();
        typeEmail('new@example.com');
        fireEvent.change(screen.getByLabelText('Full name (optional)'), {
            target: { value: 'Grace' },
        });
        expect(screen.getByLabelText('Full name (optional)')).toHaveValue('Grace');

        rerender(
            <QueryClientProvider client={queryClient}>
                <AddMemberModal slug="proj" isOpen={false} onClose={vi.fn()} />
            </QueryClientProvider>,
        );

        rerender(
            <QueryClientProvider client={queryClient}>
                <AddMemberModal slug="proj" isOpen={true} onClose={vi.fn()} />
            </QueryClientProvider>,
        );

        expect(screen.getByLabelText('Member email')).toHaveValue('');
    });

    // --- a11y ----------------------------------------------------------------

    it('the modal dialog is labelled and the error region is role="alert"', async () => {
        addMemberMock.mockRejectedValueOnce(
            new ApiClientError('Already a member', 409, 'CONFLICT'),
        );
        setLookup({ exists: true, user: EXISTING_USER });
        renderModal();
        typeEmail('ada@example.com');

        expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby', 'add-member-title');
        expect(screen.getByRole('heading', { name: 'Add Member' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Add Member' }));
        await screen.findByTestId('confirm-dialog');
        fireEvent.click(screen.getByRole('button', { name: 'DoConfirm' }));

        expect(await screen.findByRole('alert')).toBeInTheDocument();
    });
});
