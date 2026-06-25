import type { ComponentProps } from 'react';
import { Toaster as SonnerToaster } from 'sonner';

// Thin wrapper around sonner's Toaster. Sonner renders its own portal and
// provides the aria-live region / role="status" container for a11y — no
// redundant aria attributes are added here.
export type ToasterProps = ComponentProps<typeof SonnerToaster>;

export function Toaster(props: ToasterProps) {
    return <SonnerToaster position="top-right" richColors closeButton {...props} />;
}
