import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { NotFoundPage } from './NotFoundPage';

describe('NotFoundPage', () => {
    it('renders the 404 heading', () => {
        render(
            <MemoryRouter initialEntries={['/anywhere']}>
                <Routes>
                    <Route path="*" element={<NotFoundPage />} />
                </Routes>
            </MemoryRouter>,
        );
        expect(screen.getByRole('heading', { name: '404' })).toBeInTheDocument();
    });
});
