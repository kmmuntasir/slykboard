import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { LoginPage } from './LoginPage';
import { BoardPage } from './BoardPage';
import { useAuthStore } from '@/stores/useAuthStore';

describe('LoginPage', () => {
    beforeEach(() => useAuthStore.getState().clear());

    it('renders the sign-in heading', () => {
        render(
            <MemoryRouter initialEntries={['/login']}>
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                </Routes>
            </MemoryRouter>,
        );
        expect(screen.getByRole('heading', { name: /sign in to slykboard/i })).toBeInTheDocument();
    });

    it('shows the Continue (demo) button', () => {
        render(
            <MemoryRouter initialEntries={['/login']}>
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                </Routes>
            </MemoryRouter>,
        );
        expect(screen.getByRole('button', { name: /continue \(demo\)/i })).toBeInTheDocument();
    });

    it('sets the auth user and navigates on demo click', () => {
        render(
            <MemoryRouter initialEntries={['/login']}>
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/" element={<BoardPage />} />
                </Routes>
            </MemoryRouter>,
        );
        fireEvent.click(screen.getByRole('button', { name: /continue \(demo\)/i }));
        expect(useAuthStore.getState().user?.email).toBe('demo@slykboard.local');
        expect(screen.getByRole('heading', { name: 'Board' })).toBeInTheDocument();
    });
});
