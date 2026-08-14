import { env } from './env';

// SLYK-0160: dual-mode runtime config (docs/agentic-automation/02-dual-mode.md
// Layer 3). Derived once from the validated env (SLYK-0130) — never re-read
// process.env at request time. Served to the frontend via /api/auth/me `config`
// and to ops via /api/health `agentMode`. dispatcherUrl maps undefined → null
// so the frontend store's `string | null` contract holds in plain mode.
export interface RuntimeConfig {
  agentMode: boolean;
  dispatcherUrl: string | null;
}

export const runtimeConfig: Readonly<RuntimeConfig> = Object.freeze({
  agentMode: env.agentMode,
  dispatcherUrl: env.dispatcherUrl ?? null,
});
