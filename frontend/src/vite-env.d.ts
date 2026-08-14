/// <reference types="vite/client" />

// SLYK-0120: build-time constant injected by vite.config.ts `define` from
// SLYKBOARD_AGENT_MODE. Lets `if (__AGENT_MODE__)` statically prune agent
// branches at build time.
declare const __AGENT_MODE__: boolean;

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_GOOGLE_CLIENT_ID: string;
  readonly VITE_POLL_INTERVAL_SECONDS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
