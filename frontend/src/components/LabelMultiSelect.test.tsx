import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { useLabels } from '@/hooks/useLabels';
import { useRequirePlatformAdmin } from '@/hooks/useRequirePlatformAdmin';
import { useCurrentProjectMembership } from '@/hooks/useProjectMembers';
import type { UseQueryResult } from '@tanstack/react-query';
import type { Label } from '@/types/label';
import { LabelMultiSelect } from './LabelMultiSelect';

// --- Mocks ------------------------------------------------------------------

vi.mock('@/hooks/useLabels', () => ({
    useLabels: vi.fn(),
}));
vi.mock('@/hooks/useRequirePlatformAdmin', () => ({
    useRequirePlatformAdmin: vi.fn(() => false),
}));
vi.mock('@/hooks/useProjectMembers', () => ({
    // Only the membership-derived bits are needed by the component.
    useCurrentProjectMembership: vi.fn(() => ({ membership: undefined, isProjectAdmin: false })),
}));

const navigateMock = vi.fn();
vi.mock('react-router', async () => {
    const actual = await vi.importActual<typeof import('react-router')>('react-router');
    return { ...actual, useNavigate: () => navigateMock };
});

// --- Fixtures ---------------------------------------------------------------

const labelsFixture: Label[] = [
    { id: 'l1', name: 'Bug', color: '#FF0000' },
    { id: 'l2', name: 'Urgent', color: '#FFA500' },
];

function mockUseLabels(overrides: Partial<UseQueryResult<Label[]>> = {}): UseQueryResult<Label[]> {
    return {
        data: labelsFixture,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        ...overrides,
    } as unknown as UseQueryResult<Label[]>;
}

// SLYK-08 B2-2: error-state fixture. useLabels (TanStack Query) exposes
// isError + refetch; the B2-1 production component surfaces them as a distinct
// Retry control under the disabled trigger.
function mockUseLabelsError(overrides: Partial<UseQueryResult<Label[]>> = {}): UseQueryResult<Label[]> {
    return {
        data: undefined,
        isLoading: false,
        isError: true,
        error: new Error('Failed to load labels'),
        refetch: vi.fn(),
        ...overrides,
    } as unknown as UseQueryResult<Label[]>;
}

interface RoleState {
    isPlatformAdmin: boolean;
    isProjectAdmin: boolean;
}

function setRole({ isPlatformAdmin, isProjectAdmin }: RoleState) {
    vi.mocked(useRequirePlatformAdmin).mockReturnValue(isPlatformAdmin);
    vi.mocked(useCurrentProjectMembership).mockReturnValue({
        membership: undefined,
        isProjectAdmin,
    });
}

function renderSelect(props?: { projectSlug?: string; value?: string[]; onChange?: () => void }) {
    return render(
        <MemoryRouter>
            <LabelMultiSelect
                projectSlug={props?.projectSlug ?? 'proj'}
                value={props?.value ?? []}
                onChange={props?.onChange ?? vi.fn()}
            />
        </MemoryRouter>,
    );
}

describe('LabelMultiSelect', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default to a plain Member role; role-aware tests override per-case.
        setRole({ isPlatformAdmin: false, isProjectAdmin: false });
    });

    // --- Trigger / open behavior --------------------------------------------

    it('renders an accessible Labels trigger button', () => {
        vi.mocked(useLabels).mockReturnValue(mockUseLabels());
        renderSelect();
        expect(screen.getByRole('button', { name: 'Labels' })).toBeInTheDocument();
    });

    it('aria-expanded reflects open state after click', () => {
        vi.mocked(useLabels).mockReturnValue(mockUseLabels());
        renderSelect();
        const trigger = screen.getByRole('button', { name: 'Labels' });
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });

    it('lists all labels from useLabels when opened', () => {
        vi.mocked(useLabels).mockReturnValue(mockUseLabels());
        renderSelect();
        fireEvent.click(screen.getByRole('button', { name: 'Labels' }));
        expect(screen.getByRole('checkbox', { name: 'Bug' })).toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Urgent' })).toBeInTheDocument();
    });

    it('renders selected labels as LabelChips in the trigger', () => {
        vi.mocked(useLabels).mockReturnValue(mockUseLabels());
        renderSelect({ value: ['l1'] });
        // Selected chip renders in the trigger button by name; the popover is closed.
        expect(screen.getByText('Bug')).toBeInTheDocument();
        expect(screen.queryByText('Urgent')).toBeNull();
    });

    it('toggling a checkbox fires onChange with the added id', () => {
        const onChange = vi.fn();
        vi.mocked(useLabels).mockReturnValue(mockUseLabels());
        renderSelect({ value: [], onChange });
        fireEvent.click(screen.getByRole('button', { name: 'Labels' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Bug' }));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(['l1']);
    });

    it('toggling a checked checkbox fires onChange with the id removed', () => {
        const onChange = vi.fn();
        vi.mocked(useLabels).mockReturnValue(mockUseLabels());
        renderSelect({ value: ['l1', 'l2'], onChange });
        fireEvent.click(screen.getByRole('button', { name: 'Labels' }));
        fireEvent.click(screen.getByRole('checkbox', { name: 'Bug' }));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith(['l2']);
    });

    it('closes the popover on outside click', () => {
        vi.mocked(useLabels).mockReturnValue(mockUseLabels());
        render(
            <MemoryRouter>
                <div>
                    <span data-testid="outside">outside</span>
                    <LabelMultiSelect projectSlug="proj" value={[]} onChange={vi.fn()} />
                </div>
            </MemoryRouter>,
        );
        const trigger = screen.getByRole('button', { name: 'Labels' });
        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-expanded', 'true');
        fireEvent.mouseDown(screen.getByTestId('outside'));
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    // --- Loading ------------------------------------------------------------

    it('disables the trigger while labels are loading', () => {
        vi.mocked(useLabels).mockReturnValue(mockUseLabels({ data: undefined, isLoading: true }));
        renderSelect();
        expect(screen.getByRole('button', { name: 'Labels' })).toBeDisabled();
    });

    // --- Success list (B2-2) ------------------------------------------------

    it('renders the label rows for a populated label array', () => {
        vi.mocked(useLabels).mockReturnValue(mockUseLabels());
        renderSelect();
        fireEvent.click(screen.getByRole('button', { name: 'Labels' }));
        expect(screen.getByRole('listbox')).toBeInTheDocument();
        expect(screen.getByText('Bug')).toBeInTheDocument();
        expect(screen.getByText('Urgent')).toBeInTheDocument();
    });

    // --- Genuine empty (B2-2) ----------------------------------------------

    it('renders EmptyState (not "No labels defined") for a genuine empty array', () => {
        vi.mocked(useLabels).mockReturnValue(mockUseLabels({ data: [] }));
        renderSelect();
        fireEvent.click(screen.getByRole('button', { name: 'Labels' }));
        // EmptyState is a role=status element distinct from any error/label text.
        expect(screen.getByRole('status')).toBeInTheDocument();
        expect(screen.queryByText('No labels defined')).toBeNull();
        expect(screen.getByText('No labels yet')).toBeInTheDocument();
    });

    // --- Error state (B2-2) -------------------------------------------------

    it('renders a distinct "Couldn\'t load labels" error (not the empty copy)', () => {
        vi.mocked(useLabels).mockReturnValue(mockUseLabelsError());
        renderSelect();
        // Retry alert region carries the distinct error message.
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText("Couldn't load labels")).toBeInTheDocument();
        // Empty copy must NOT leak through in the error branch.
        expect(screen.queryByText('No labels yet')).toBeNull();
    });

    it('fires refetch exactly once when the Retry button is clicked', () => {
        const refetch = vi.fn();
        vi.mocked(useLabels).mockReturnValue(mockUseLabelsError({ refetch }));
        renderSelect();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(refetch).toHaveBeenCalledTimes(1);
    });

    // --- Trigger gating while loading / error (B2-2) ------------------------

    it.each([
        ['isLoading', () => mockUseLabels({ data: undefined, isLoading: true })],
        ['isError', () => mockUseLabelsError()],
    ])('disables the trigger while %s', (_label, factory) => {
        vi.mocked(useLabels).mockReturnValue(factory());
        renderSelect();
        expect(screen.getByRole('button', { name: 'Labels' })).toBeDisabled();
    });

    // --- Role-aware EmptyState (B2-2) ---------------------------------------

    it.each([
        ['platform-admin', { isPlatformAdmin: true, isProjectAdmin: false }],
        ['project-admin', { isPlatformAdmin: false, isProjectAdmin: true }],
    ])('shows a "Create labels" CTA for %s and navigates to settings on click', (_role, role) => {
        setRole(role);
        vi.mocked(useLabels).mockReturnValue(mockUseLabels({ data: [] }));
        renderSelect({ projectSlug: 'acme' });
        fireEvent.click(screen.getByRole('button', { name: 'Labels' }));

        const cta = screen.getByRole('button', { name: 'Create labels' });
        expect(cta).toBeInTheDocument();

        fireEvent.click(cta);
        expect(navigateMock).toHaveBeenCalledTimes(1);
        expect(navigateMock).toHaveBeenCalledWith('/projects/acme/settings');
    });

    it('shows a hint-only empty state (no "Create labels" CTA) for a plain Member', () => {
        setRole({ isPlatformAdmin: false, isProjectAdmin: false });
        vi.mocked(useLabels).mockReturnValue(mockUseLabels({ data: [] }));
        renderSelect();
        fireEvent.click(screen.getByRole('button', { name: 'Labels' }));

        // Member gets the hint copy but never a management CTA.
        expect(screen.getByText('Ask a project admin to create labels.')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Create labels' })).toBeNull();
    });
});
