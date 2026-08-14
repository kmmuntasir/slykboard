import { describe, it, expect, beforeEach } from 'vitest';
import { useRuntimeConfigStore } from './useRuntimeConfigStore';

describe('useRuntimeConfigStore', () => {
  beforeEach(() => {
    useRuntimeConfigStore.setState({ agentMode: false, dispatcherUrl: null });
  });

  const defaults = [
    { name: 'agentMode defaults to false', key: 'agentMode' as const, expected: false },
    { name: 'dispatcherUrl defaults to null', key: 'dispatcherUrl' as const, expected: null },
  ];

  defaults.forEach(({ name, key, expected }) => {
    it(name, () => {
      expect(useRuntimeConfigStore.getState()[key]).toBe(expected);
    });
  });

  it('set stores agentMode + dispatcherUrl', () => {
    useRuntimeConfigStore
      .getState()
      .set({ agentMode: true, dispatcherUrl: 'http://localhost:4001' });
    const state = useRuntimeConfigStore.getState();
    expect(state.agentMode).toBe(true);
    expect(state.dispatcherUrl).toBe('http://localhost:4001');
  });

  it('set replaces the whole config (dispatcherUrl back to null)', () => {
    useRuntimeConfigStore
      .getState()
      .set({ agentMode: true, dispatcherUrl: 'http://localhost:4001' });
    useRuntimeConfigStore.getState().set({ agentMode: false, dispatcherUrl: null });
    const state = useRuntimeConfigStore.getState();
    expect(state.agentMode).toBe(false);
    expect(state.dispatcherUrl).toBeNull();
  });
});
