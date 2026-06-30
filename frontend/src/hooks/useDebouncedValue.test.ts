import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns the initial value immediately (before the delay)', () => {
        const { result } = renderHook(() => useDebouncedValue('first', 300));
        expect(result.current).toBe('first');
    });

    it('surfaces only the last value after rapid successive changes', () => {
        const { result, rerender } = renderHook(
            ({ value }) => useDebouncedValue(value, 300),
            { initialProps: { value: 'a' } },
        );

        rerender({ value: 'b' });
        rerender({ value: 'c' });
        rerender({ value: 'd' });

        // Still the initial value mid-debounce.
        expect(result.current).toBe('a');

        act(() => {
            vi.advanceTimersByTime(300);
        });

        expect(result.current).toBe('d');
    });

    it('does not flush until the full delay elapses after the last change', () => {
        const { result, rerender } = renderHook(
            ({ value }) => useDebouncedValue(value, 300),
            { initialProps: { value: 'a' } },
        );

        rerender({ value: 'b' });

        act(() => {
            vi.advanceTimersByTime(299);
        });
        expect(result.current).toBe('a');

        act(() => {
            vi.advanceTimersByTime(1);
        });
        expect(result.current).toBe('b');
    });

    it('clears the pending timer on unmount (no state update afterward)', () => {
        const { result, unmount } = renderHook(() => useDebouncedValue('a', 300));
        unmount();

        // Advancing timers after unmount must not throw a state-update warning
        // (the cleanup cleared the pending setTimeout).
        act(() => {
            vi.advanceTimersByTime(300);
        });
        expect(result.current).toBe('a');
    });

    it('honors a custom delay', () => {
        const { result, rerender } = renderHook(
            ({ value }) => useDebouncedValue(value, 500),
            { initialProps: { value: 'a' } },
        );

        rerender({ value: 'b' });

        act(() => {
            vi.advanceTimersByTime(300);
        });
        expect(result.current).toBe('a');

        act(() => {
            vi.advanceTimersByTime(200);
        });
        expect(result.current).toBe('b');
    });
});
