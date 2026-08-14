import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // SLYK-0120: build-time agent-mode switch (docs/agentic-automation/02-dual-mode.md
  // Layer 3). Statically replaces `if (__AGENT_MODE__)` with true/false so the
  // bundler prunes agent branches (and their React.lazy chunks) in plain builds.
  define: {
    __AGENT_MODE__: JSON.stringify(process.env.SLYKBOARD_AGENT_MODE === 'true'),
  },
  server: {
    allowedHosts: ['kzkc.prod.bd'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
});
