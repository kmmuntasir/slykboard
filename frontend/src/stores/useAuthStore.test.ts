import { describe, it, expect, beforeEach } from 'vitest';
import { useAuthStore } from './useAuthStore';

describe('useAuthStore', () => {
  beforeEach(() => useAuthStore.getState().clear());

  it('starts with null user', () => {
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('setUser stores the user', () => {
    useAuthStore.getState().setUser({
      token: 't',
      email: 'e',
      name: 'n',
    });
    expect(useAuthStore.getState().user?.token).toBe('t');
  });

  it('clear nulls the user', () => {
    useAuthStore.getState().setUser({
      token: 't',
      email: 'e',
      name: 'n',
    });
    useAuthStore.getState().clear();
    expect(useAuthStore.getState().user).toBeNull();
  });
});
