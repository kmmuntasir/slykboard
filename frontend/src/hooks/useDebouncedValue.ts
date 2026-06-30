import { useEffect, useState } from 'react';

// SLYK-02 T4 — tiny reusable debounce helper. Replaces the hand-rolled
// setTimeout-300ms pattern duplicated across filters/inputs (e.g. BoardFilters).
// Returns `value` unchanged until `delayMs` has elapsed without a change, then
// flushes the latest value. The pending timer is cleared on change and on
// unmount so no state update fires after the component is gone.
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
    const [debounced, setDebounced] = useState<T>(value);

    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delayMs);
        return () => clearTimeout(timer);
    }, [value, delayMs]);

    return debounced;
}
