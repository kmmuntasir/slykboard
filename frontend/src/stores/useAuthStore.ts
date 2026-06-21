import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

// D2: persist user (incl. token) to localStorage. Accepted XSS tradeoff — F07 hardens.
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      setUser: (user) => set({ user }),
      clear: () => set({ user: null }),
    }),
    {
      name: 'slyk-auth',
      partialize: (state) => ({ user: state.user }),
    },
  ),
);
