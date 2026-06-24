import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Toaster } from './Toaster';

describe('Toaster', () => {
    it('renders without crashing', () => {
        const { container } = render(<Toaster />);
        expect(container).toBeTruthy();
    });

    it('mounts sonner live region', () => {
        render(<Toaster />);
        // Sonner renders a <section> with aria-label="Notifications ..." as its
        // toasts container / live region at mount. A named section maps to the
        // implicit "region" role.
        const region = screen.getByRole('region', { name: /Notifications/i });
        expect(region.tagName).toBe('SECTION');
        expect(region).toHaveAttribute('aria-live', 'polite');
    });
});
