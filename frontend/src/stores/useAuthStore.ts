import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { AUTH_STORAGE_KEY } from '@/constants/auth';

export interface AuthUser {
  token: string;
  id: string;
  email: string;
  name: string; // maps from backend fullName
  role: 'ADMIN' | 'MEMBER';
  avatarUrl: string | null;
}

interface AuthState {
  user: AuthUser | null;
  setUser: (user: AuthUser | null) => void;
  clear: () => void;
}

type PersistedAuthState = { user: AuthUser | null };

// Zustand 5 has no `removeOnNull` option. Wrap the default JSON storage so that when
// the persisted user becomes null (clear()), the key is REMOVED rather than overwritten
// with a {state:{user:null}} envelope. Only a real key removal emits a cross-tab storage
// event with newValue===null, which the useCrossTabLogout storage listener relies on.
const baseStorage = createJSONStorage<PersistedAuthState>(() => window.localStorage)!;

const authPersistStorage: PersistStorage<PersistedAuthState> = {
  getItem: baseStorage.getItem,
  setItem: (name: string, newValue: StorageValue<PersistedAuthState>) => {
    if (newValue?.state?.user === null) return baseStorage.removeItem(name);
    return baseStorage.setItem(name, newValue);
  },
  removeItem: baseStorage.removeItem,
};

// D2: persist user (incl. token) to localStorage. Accepted XSS tradeoff — F07 hardens.
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      setUser: (user) => set({ user }),
      clear: () => set({ user: null }),
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: authPersistStorage,
      partialize: (state) => ({ user: state.user }),
    },
  ),
);
