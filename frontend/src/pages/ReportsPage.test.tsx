import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ReportsPage } from './ReportsPage';

describe('ReportsPage', () => {
    it('renders the heading', () => {
        render(
            <MemoryRouter initialEntries={['/reports']}>
                <Routes>
                    <Route path="/reports" element={<ReportsPage />} />
                </Routes>
            </MemoryRouter>,
        );
        expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    });
});
