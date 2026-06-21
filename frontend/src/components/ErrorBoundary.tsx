import { ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';
import type { PropsWithChildren } from 'react';
import { ErrorFallback } from './ErrorFallback';

export function ErrorBoundary({ children }: PropsWithChildren) {
    return <ReactErrorBoundary FallbackComponent={ErrorFallback}>{children}</ReactErrorBoundary>;
}
