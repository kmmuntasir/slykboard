import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { OfflineBanner } from './OfflineBanner';

// Avoid sonner noise from the offline → online toast path.
vi.mock('@/hooks/useToast', () => ({
    useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function setNavigatorOnline(value: boolean): void {
    Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value,
    });
}

describe('OfflineBanner', () => {
    afterEach(() => {
        setNavigatorOnline(true);
    });

    it('renders nothing when online', () => {
        setNavigatorOnline(true);
        render(<OfflineBanner />);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('renders the offline banner when navigator.onLine is false', () => {
        setNavigatorOnline(false);
        render(<OfflineBanner />);
        const banner = screen.getByRole('alert');
        expect(banner).toBeInTheDocument();
        expect(banner).toHaveTextContent(
            "You're offline — changes will sync when you reconnect.",
        );
    });

    it('shows the banner when an offline event fires after mount', () => {
        setNavigatorOnline(true);
        render(<OfflineBanner />);
        expect(screen.queryByRole('alert')).toBeNull();

        setNavigatorOnline(false);
        act(() => {
            window.dispatchEvent(new Event('offline'));
        });
        expect(screen.getByRole('alert')).toBeInTheDocument();
    });
});
