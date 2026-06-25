import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ForbiddenPage } from './ForbiddenPage';

describe('ForbiddenPage', () => {
    it('renders the 403 heading and a back link', () => {
        render(
            <MemoryRouter initialEntries={['/forbidden']}>
                <Routes>
                    <Route path="/forbidden" element={<ForbiddenPage />} />
                </Routes>
            </MemoryRouter>,
        );
        expect(screen.getByRole('heading', { name: '403 — Forbidden' })).toBeInTheDocument();
        const link = screen.getByRole('link', { name: 'Back to board' });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', '/');
    });
});
