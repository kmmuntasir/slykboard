import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { SettingsPage } from './SettingsPage';

describe('SettingsPage', () => {
    it('renders the heading', () => {
        render(
            <MemoryRouter initialEntries={['/settings']}>
                <Routes>
                    <Route path="/settings" element={<SettingsPage />} />
                </Routes>
            </MemoryRouter>,
        );
        expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    });
});
