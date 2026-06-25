import type { ReactNode } from 'react';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { Retry } from './Retry';

export function RouteErrorFallback({ resetErrorBoundary }: FallbackProps) {
    return <Retry onRetry={resetErrorBoundary} />;
}

interface RouteErrorBoundaryProps {
    children: ReactNode;
}

export function RouteErrorBoundary({ children }: RouteErrorBoundaryProps) {
    return (
        <QueryErrorResetBoundary>
            {({ reset }) => (
                <ErrorBoundary onReset={reset} FallbackComponent={RouteErrorFallback}>
                    {children}
                </ErrorBoundary>
            )}
        </QueryErrorResetBoundary>
    );
}

export default RouteErrorBoundary;
