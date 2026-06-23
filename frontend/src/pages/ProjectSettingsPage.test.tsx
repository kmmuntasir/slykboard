// F14 T9: ProjectSettingsPage test.
// Renders LabelManager with the slug extracted from the route via MemoryRouter.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ProjectSettingsPage } from './ProjectSettingsPage';

// Capture the slug prop the page passes to LabelManager.
const { captured } = vi.hoisted(() => ({
    captured: { slug: '' as string },
}));

vi.mock('@/components/LabelManager', () => ({
    LabelManager: ({ projectSlug }: { projectSlug: string }) => {
        captured.slug = projectSlug;
        return <div data-testid="label-manager">LabelManager for {projectSlug}</div>;
    },
}));

function renderAt(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/projects/:slug/settings" element={<ProjectSettingsPage />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe('ProjectSettingsPage', () => {
    it('renders the heading + LabelManager', () => {
        renderAt('/projects/SLYK/settings');

        expect(
            screen.getByRole('heading', { name: 'Project Settings' }),
        ).toBeInTheDocument();
        expect(screen.getByTestId('label-manager')).toBeInTheDocument();
    });

    it('threads the slug from the route into LabelManager', () => {
        renderAt('/projects/ACME/settings');

        expect(captured.slug).toBe('ACME');
        expect(screen.getByText('LabelManager for ACME')).toBeInTheDocument();
    });
});
