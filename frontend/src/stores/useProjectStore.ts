import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ProjectState {
  lastSelectedSlug: string | null;
  setLastSelectedSlug: (slug: string) => void;
  clear: () => void;
}

// F08 D-Current-Project: URL param is primary; this store records the last
// selected slug so '/' can redirect to the last board (UX convenience).
export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      lastSelectedSlug: null,
      setLastSelectedSlug: (slug) => set({ lastSelectedSlug: slug }),
      clear: () => set({ lastSelectedSlug: null }),
    }),
    { name: 'slyk-project' },
  ),
);
