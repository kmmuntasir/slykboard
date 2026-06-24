import { create } from 'zustand';

// F10 D4: cross-tree board-UI state. F10 consumes dragInProgress to defer
// polls mid-drag (useBoard refetchInterval). F11 wires onDragStart/onDragEnd.
// dragInProgress defaults false -> F10 read-only behavior unaffected.
//
// F26: board filter state — server-side filtering via board query string.
interface BoardUiState {
  dragInProgress: boolean;
  setDragInProgress: (value: boolean) => void;
  searchQuery: string;
  assigneeFilter: string | null; // user id, or null = All
  priorityFilter: string | null; // 'LOW'|'MEDIUM'|'HIGH'|'URGENT'|'CRITICAL', or null
  labelFilter: string | null; // label id, or null
  setSearchQuery: (q: string) => void;
  setAssigneeFilter: (id: string | null) => void;
  setPriorityFilter: (p: string | null) => void;
  setLabelFilter: (id: string | null) => void;
  clearFilters: () => void;
}

export const useBoardUiStore = create<BoardUiState>((set) => ({
  dragInProgress: false,
  setDragInProgress: (value) => set({ dragInProgress: value }),
  searchQuery: '',
  assigneeFilter: null,
  priorityFilter: null,
  labelFilter: null,
  setSearchQuery: (q) => set({ searchQuery: q }),
  setAssigneeFilter: (id) => set({ assigneeFilter: id }),
  setPriorityFilter: (p) => set({ priorityFilter: p }),
  setLabelFilter: (id) => set({ labelFilter: id }),
  clearFilters: () =>
    set({
      searchQuery: '',
      assigneeFilter: null,
      priorityFilter: null,
      labelFilter: null,
    }),
}));
