import { create } from 'zustand';

// SLYK-0120: dual-mode runtime config (docs/agentic-automation/02-dual-mode.md
// Layer 3). Populated from the backend (e.g. /me response.config) once Phase 0
// wires the source; defaults keep plain mode fully inert. Not persisted — the
// server is the source of truth on every boot.
interface RuntimeConfigState {
  agentMode: boolean;
  dispatcherUrl: string | null;
  set: (cfg: { agentMode: boolean; dispatcherUrl: string | null }) => void;
}

export const useRuntimeConfigStore = create<RuntimeConfigState>((set) => ({
  agentMode: false,
  dispatcherUrl: null,
  set: (cfg) => set(cfg),
}));
