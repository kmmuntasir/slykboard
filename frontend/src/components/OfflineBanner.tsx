import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useToast } from '@/hooks/useToast';

// F28 T8: full-width sticky banner shown when the browser reports offline. On a
// offline → online transition it surfaces a "Back online" toast; it stays silent
// on initial mount so loading the app while already online fires nothing.
export function OfflineBanner(): JSX.Element | null {
    const online = useOnlineStatus();
    const toast = useToast();
    const previous = useRef<boolean>(online);

    useEffect(() => {
        const wasOnline = previous.current;
        previous.current = online;
        if (!wasOnline && online) {
            toast.success('Back online');
        }
    }, [online, toast]);

    if (online) return null;

    return (
        <div
            role="alert"
            aria-live="assertive"
            className="sticky top-0 z-50 bg-red-600 px-4 py-2 text-center text-sm text-white"
        >
            You're offline — changes will sync when you reconnect.
        </div>
    );
}
