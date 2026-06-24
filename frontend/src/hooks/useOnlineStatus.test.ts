import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOnlineStatus } from './useOnlineStatus';

function setNavigatorOnline(value: boolean): void {
    Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        value,
    });
}

describe('useOnlineStatus', () => {
    afterEach(() => {
        setNavigatorOnline(true);
    });

    it.each([
        { name: 'online → true', value: true, expected: true },
        { name: 'offline → false', value: false, expected: false },
    ])('initial state reflects navigator.onLine ($name)', ({ value, expected }) => {
        setNavigatorOnline(value);
        const { result } = renderHook(() => useOnlineStatus());
        expect(result.current).toBe(expected);
    });

    it('flips to false on a window offline event', () => {
        setNavigatorOnline(true);
        const { result } = renderHook(() => useOnlineStatus());
        expect(result.current).toBe(true);

        act(() => {
            window.dispatchEvent(new Event('offline'));
        });
        expect(result.current).toBe(false);
    });

    it('flips to true on a window online event', () => {
        setNavigatorOnline(false);
        const { result } = renderHook(() => useOnlineStatus());
        expect(result.current).toBe(false);

        act(() => {
            window.dispatchEvent(new Event('online'));
        });
        expect(result.current).toBe(true);
    });

    it('unsubscribes on unmount (no state updates afterward)', () => {
        setNavigatorOnline(true);
        const { result, unmount } = renderHook(() => useOnlineStatus());
        unmount();

        act(() => {
            window.dispatchEvent(new Event('offline'));
        });
        // Still the initial value — the listener was removed.
        expect(result.current).toBe(true);
    });
});
