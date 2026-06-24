import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReportsPage } from './ReportsPage';

describe('ReportsPage', () => {
    it('renders the heading', () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        render(
            <QueryClientProvider client={queryClient}>
                <MemoryRouter initialEntries={['/reports']}>
                    <Routes>
                        <Route path="/reports" element={<ReportsPage />} />
                    </Routes>
                </MemoryRouter>
            </QueryClientProvider>,
        );
        expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    });
});
