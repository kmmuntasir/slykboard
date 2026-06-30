import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { ProjectPicker } from './ProjectPicker';
import type { Project } from '@/types/project';

// --- Mocks ------------------------------------------------------------------

vi.mock('@/hooks/useProjects', () => ({
    useProjects: vi.fn(),
}));
vi.mock('@/hooks/useRequirePlatformAdmin', () => ({
    useRequirePlatformAdmin: vi.fn(() => true),
}));

const navigateMock = vi.fn();
vi.mock('react-router', async () => {
    const actual = await vi.importActual<typeof import('react-router')>('react-router');
    return { ...actual, useNavigate: () => navigateMock };
});

import { useProjects } from '@/hooks/useProjects';
import { useRequirePlatformAdmin } from '@/hooks/useRequirePlatformAdmin';
import { useProjectStore } from '@/stores/useProjectStore';

// --- Fixtures ---------------------------------------------------------------

const adminProject: Project = {
    id: 'p1',
    name: 'Acme Board',
    slug: 'acme',
    columns: [],
    creatorId: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isActive: true,
};

const secondProject: Project = {
    ...adminProject,
    id: 'p2',
    name: 'Beta Board',
    slug: 'beta',
};

const LOADED = [adminProject, secondProject];

function setProjects(over: Partial<ReturnType<typeof useProjects>> = {}) {
    vi.mocked(useProjects).mockReturnValue({
        data: LOADED,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
        ...over,
    } as ReturnType<typeof useProjects>);
}

function renderPicker(initialEntry = '/') {
    // RR v7 useParams only populates from a matched <Route>; wrap the picker so
    // /projects/:slug drives the controlled value (named test b). '/' and
    // '/projects' match the catch-all / listing routes → no slug → placeholder.
    return render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
                <Route path="/projects/:slug" element={<ProjectPicker />} />
                <Route path="/projects" element={<ProjectPicker />} />
                <Route path="*" element={<ProjectPicker />} />
            </Routes>
        </MemoryRouter>,
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRequirePlatformAdmin).mockReturnValue(true);
    useProjectStore.getState().clear();
});

// --- Table-driven 4-state matrix (D3, :19 regression) -----------------------

describe('ProjectPicker — distinct states', () => {
    const cases = [
        {
            name: 'loading → skeleton trigger (no "No projects")',
            setup: () => setProjects({ data: undefined, isLoading: true }),
            expects: (open: () => void) => {
                open();
                expect(screen.getByText('Loading…')).toBeInTheDocument();
                expect(screen.queryByText('No projects')).not.toBeInTheDocument();
            },
        },
        {
            name: 'error → "Couldn\'t load projects" + retry (NOT "No projects")',
            setup: () =>
                setProjects({
                    data: undefined,
                    isLoading: false,
                    isError: true,
                    refetch: vi.fn(),
                }),
            expects: (open: () => void) => {
                open();
                expect(screen.getByText("Couldn't load projects")).toBeInTheDocument();
                expect(screen.queryByText('No projects')).not.toBeInTheDocument();
                expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
            },
        },
        {
            name: 'empty array → "No projects yet — create one" create link',
            setup: () => setProjects({ data: [] }),
            expects: (open: () => void) => {
                open();
                expect(screen.getByText('No projects yet — create one')).toBeInTheDocument();
            },
        },
        {
            name: 'loaded → lists project names',
            setup: () => setProjects(),
            expects: (open: () => void) => {
                open();
                expect(screen.getByText('Acme Board')).toBeInTheDocument();
                expect(screen.getByText('Beta Board')).toBeInTheDocument();
            },
        },
    ] as const;

    cases.forEach(({ name, setup, expects }) => {
        it(name, () => {
            setup();
            renderPicker();
            const open = () => {
                fireEvent.pointerDown(screen.getByLabelText('Select project'), { button: 0 });
            };
            expects(open);
        });
    });
});

// --- PRD §8 named test (a): retry on error, NOT "No projects" ---------------

it('error state shows a Retry button that calls refetch (regression: :19 "No Projects on error")', () => {
    const refetch = vi.fn();
    setProjects({ data: undefined, isLoading: false, isError: true, refetch });
    renderPicker();
    fireEvent.pointerDown(screen.getByLabelText('Select project'), { button: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
});

// --- PRD §8 named test (b): reflects slug from URL --------------------------

it('reflects the current slug from the URL (controlled value, no defaultValue)', () => {
    setProjects();
    // Direct nav to /projects/acme — params.slug = 'acme' → trigger shows "Acme Board".
    renderPicker('/projects/acme');
    fireEvent.pointerDown(screen.getByLabelText('Select project'), { button: 0 });
    // Radix portals the menu to document.body → getByText finds both trigger + list.
    // Use getAllByRole('menuitem') + textContent to scope to the list only.
    const menuitems = screen.getAllByRole('menuitem');
    const acmeItem = menuitems.find((el) => el.textContent?.includes('Acme Board'));
    expect(acmeItem).toBeTruthy();
    expect(menuitems.some((el) => el.textContent?.includes('Beta Board'))).toBe(true);
    // Check mark is on the selected (Acme) row only.
    const checkItems = menuitems.filter((el) => el.querySelector('svg.lucide-check'));
    expect(checkItems.length).toBe(1);
    expect(checkItems[0]).toBe(acmeItem);
});

// --- PRD §8 named test (c): empty-state offers create link ------------------

it('empty-state offers a create link that navigates to /projects', () => {
    setProjects({ data: [] });
    renderPicker();
    fireEvent.pointerDown(screen.getByLabelText('Select project'), { button: 0 });
    fireEvent.click(screen.getByText('No projects yet — create one'));
    expect(navigateMock).toHaveBeenCalledWith('/projects');
});

// --- F37 contract: aria-label preserved -------------------------------------

it('preserves aria-label="Select project" on the trigger (F37 TopNav test contract)', () => {
    setProjects();
    renderPicker();
    expect(screen.getByLabelText('Select project')).toBeInTheDocument();
});

// --- D3 listing placeholder -------------------------------------------------

it('shows "Select a project" placeholder on the /projects listing (no slug)', () => {
    setProjects();
    renderPicker('/projects');
    fireEvent.pointerDown(screen.getByLabelText('Select project'), { button: 0 });
    // No project is selected → neither row has a Check; trigger shows placeholder.
    const trigger = screen.getByLabelText('Select project');
    expect(trigger).toHaveTextContent('Select a project');
});

// --- Selecting persists + navigates (D6) ------------------------------------

it('selecting a project persists lastSelectedSlug and navigates', () => {
    setProjects();
    renderPicker();
    fireEvent.pointerDown(screen.getByLabelText('Select project'), { button: 0 });
    fireEvent.click(screen.getByText('Beta Board'));
    expect(navigateMock).toHaveBeenCalledWith('/projects/beta');
    expect(useProjectStore.getState().lastSelectedSlug).toBe('beta');
});

// --- ADMIN-gated footer -----------------------------------------------------

it('shows "+ Create project" footer for ADMIN', () => {
    vi.mocked(useRequirePlatformAdmin).mockReturnValue(true);
    setProjects();
    renderPicker();
    fireEvent.pointerDown(screen.getByLabelText('Select project'), { button: 0 });
    expect(screen.getByText('+ Create project')).toBeInTheDocument();
});

it('hides "+ Create project" footer for MEMBER', () => {
    vi.mocked(useRequirePlatformAdmin).mockReturnValue(false);
    setProjects();
    renderPicker();
    fireEvent.pointerDown(screen.getByLabelText('Select project'), { button: 0 });
    expect(screen.queryByText('+ Create project')).not.toBeInTheDocument();
});

it('"+ Create project" footer navigates to /projects', () => {
    setProjects();
    renderPicker();
    fireEvent.pointerDown(screen.getByLabelText('Select project'), { button: 0 });
    fireEvent.click(screen.getByText('+ Create project'));
    expect(navigateMock).toHaveBeenCalledWith('/projects');
});

// --- SLYK-04: Deactivated badge (admin-only, inactive projects) -------------

it('shows a Deactivated badge for an inactive project when ADMIN', () => {
    const inactive: Project = { ...adminProject, id: 'p3', slug: 'dead', isActive: false };
    vi.mocked(useProjects).mockReturnValue({
        data: [inactive],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjects>);
    vi.mocked(useRequirePlatformAdmin).mockReturnValue(true);
    renderPicker();
    fireEvent.pointerDown(screen.getByLabelText('Select project'), { button: 0 });
    expect(screen.getByText('Deactivated')).toBeInTheDocument();
});

it('does NOT show a Deactivated badge when the project is active', () => {
    setProjects(); // both projects isActive:true
    vi.mocked(useRequirePlatformAdmin).mockReturnValue(true);
    renderPicker();
    fireEvent.pointerDown(screen.getByLabelText('Select project'), { button: 0 });
    expect(screen.queryByText('Deactivated')).not.toBeInTheDocument();
});

// --- SLYK-06 T5 — trigger icon token/contrast className assertions -----------

it('LOADED trigger FolderKanban icon uses text-muted-foreground (no bare text-muted)', () => {
    setProjects(); // LOADED → trigger renders the FolderKanban + ChevronDown affordances
    renderPicker();
    const trigger = screen.getByLabelText('Select project');
    const folderIcon = trigger.querySelector('svg.lucide-folder-kanban');
    expect(folderIcon).not.toBeNull();
    // svg.className is an SVGAnimatedString — read the class attribute directly.
    expect(folderIcon!.getAttribute('class')).toContain('text-muted-foreground');
    expect(folderIcon!.getAttribute('class')).not.toMatch(/\btext-muted\b(?![-\w])/);
});

it('LOADED trigger ChevronDown caret uses text-muted-foreground (no bare text-muted)', () => {
    setProjects();
    renderPicker();
    const trigger = screen.getByLabelText('Select project');
    const caret = trigger.querySelector('svg.lucide-chevron-down');
    expect(caret).not.toBeNull();
    expect(caret!.getAttribute('class')).toContain('text-muted-foreground');
    expect(caret!.getAttribute('class')).not.toMatch(/\btext-muted\b(?![-\w])/);
});

it('does NOT show a Deactivated badge for a non-admin even when inactive', () => {
    const inactive: Project = { ...adminProject, id: 'p3', slug: 'dead', isActive: false };
    vi.mocked(useProjects).mockReturnValue({
        data: [inactive],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProjects>);
    vi.mocked(useRequirePlatformAdmin).mockReturnValue(false);
    renderPicker();
    fireEvent.pointerDown(screen.getByLabelText('Select project'), { button: 0 });
    expect(screen.queryByText('Deactivated')).not.toBeInTheDocument();
});
