// Always re-export core.
export * from './core';

// Re-export agent schema unconditionally. Type definitions and Drizzle
// table objects are inert (no side effects at import). Migration
// gating (02-dual-mode.md Layer 1) + route gating (Layer 2) + frontend
// gating (Layer 3) keep plain mode clean. Bundle analysis verifies.
export * from './agent';
