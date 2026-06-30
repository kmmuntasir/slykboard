// SLYK-03: ComingSoonPage test.
// Pure presentational leaf — no providers needed (Card is surface-only, no
// hooks). Covers the default heading + muted copy, and the title override.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComingSoonPage } from './ComingSoonPage';

describe('ComingSoonPage', () => {
    it('renders the default heading and the muted description', () => {
        render(<ComingSoonPage />);

        expect(
            screen.getByRole('heading', { name: 'Coming Soon' }),
        ).toBeInTheDocument();
        expect(
            screen.getByText("This section isn't available yet."),
        ).toBeInTheDocument();
    });

    it('renders a custom title and not the default', () => {
        render(<ComingSoonPage title="Settings" />);

        expect(
            screen.getByRole('heading', { name: 'Settings' }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole('heading', { name: 'Coming Soon' }),
        ).toBeNull();
    });
});
