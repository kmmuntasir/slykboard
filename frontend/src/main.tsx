import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { queryClient } from '@/lib/queryClient';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Toaster } from '@/components/Toaster';
import { ThemeProvider } from '@/components/ThemeProvider';
import { TooltipProvider } from '@/components/ui/Tooltip';
import { router } from '@/routes';
import { env } from '@/config/env';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error('Missing #root element in index.html');
}

createRoot(rootElement).render(
    <StrictMode>
        <GoogleOAuthProvider clientId={env.googleClientId}>
            <ErrorBoundary>
                <QueryClientProvider client={queryClient}>
                    <ThemeProvider>
                        {/* F41 (D3) — mount TooltipProvider app-wide (F36 canonical mount point).
                            F37 was supposed to do this but skipped it; F41 fixes the debt and
                            unblocks F42 (nav scoping tooltips). Inside ThemeProvider so Tooltip
                            Portal content inherits theme tokens (bg-primary etc.). */}
                        <TooltipProvider delayDuration={300}>
                            <RouterProvider router={router} />
                            <Toaster />
                        </TooltipProvider>
                    </ThemeProvider>
                </QueryClientProvider>
            </ErrorBoundary>
        </GoogleOAuthProvider>
    </StrictMode>,
);
