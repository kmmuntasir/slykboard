import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Default stub for tests that touch anything importing env (api client, HealthBadge, App shell).
// Individual tests may override via vi.stubEnv + dynamic import (see env.test.ts).
vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000/api');
vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-google-client-id.apps.googleusercontent.com');

// jsdom lacks PointerEvent (jsdom#2527); Radix primitives open on pointerdown.
// Polyfill so fireEvent.pointerDown works in Dropdown/Tooltip tests (F36+).
// Ref: https://github.com/radix-ui/primitives/issues/1220
if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  window.PointerEvent = class PointerEvent
    extends window.MouseEvent {} as unknown as typeof PointerEvent;
}

// jsdom lacks ResizeObserver; Radix Popper (Tooltip/Dropdown Content positioning) needs it.
// Polyfill with a no-op so positioning code doesn't throw in tests (F36+).
if (typeof window !== 'undefined' && typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
