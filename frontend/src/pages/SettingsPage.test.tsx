import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsPage } from './SettingsPage';

vi.mock('@/api/users', () => ({
    fetchUsers: vi.fn().mockResolvedValue([]),
}));

function wrapper() {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <MemoryRouter initialEntries={['/settings']}>
                <Routes>
                    <Route path="/settings" element={children} />
                </Routes>
            </MemoryRouter>
        </QueryClientProvider>
    );
}

describe('SettingsPage', () => {
    it('renders the heading', () => {
        render(<SettingsPage />, { wrapper: wrapper() });
        expect(screen.getByRole('heading', { name: 'User Management' })).toBeInTheDocument();
    });
});
