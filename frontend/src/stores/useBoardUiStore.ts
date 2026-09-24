import { create } from 'zustand';

// F10 D4: cross-tree board-UI state. F10 consumes dragInProgress to defer
// polls mid-drag (useBoard refetchInterval). F11 wires onDragStart/onDragEnd.
// dragInProgress defaults false -> F10 read-only behavior unaffected.
//
// F26: board filter state — server-side filtering via board query string.
// CR-03: typeFilter + epicFilter are CLIENT-side (applied in BoardPage over the
// fetched board; they don't refire the server query).
interface BoardUiState {
  dragInProgress: boolean;
  setDragInProgress: (value: boolean) => void;
  searchQuery: string;
  assigneeFilter: string | null; // user id, or null = All
  priorityFilter: string | null; // 'LOW'|'MEDIUM'|'HIGH'|'URGENT'|'CRITICAL', or null
  labelFilter: string | null; // label id, or null
  typeFilter: string | null; // CR-03: 'EPIC'|'STORY'|'TASK'|'SUBTASK', or null
  epicFilter: string | null; // CR-03: epic ticket id, or null
  setSearchQuery: (q: string) => void;
  setAssigneeFilter: (id: string | null) => void;
  setPriorityFilter: (p: string | null) => void;
  setLabelFilter: (id: string | null) => void;
  setTypeFilter: (t: string | null) => void;
  setEpicFilter: (id: string | null) => void;
  clearFilters: () => void;
}

export const useBoardUiStore = create<BoardUiState>((set) => ({
  dragInProgress: false,
  setDragInProgress: (value) => set({ dragInProgress: value }),
  searchQuery: '',
  assigneeFilter: null,
  priorityFilter: null,
  labelFilter: null,
  typeFilter: null,
  epicFilter: null,
  setSearchQuery: (q) => set({ searchQuery: q }),
  setAssigneeFilter: (id) => set({ assigneeFilter: id }),
  setPriorityFilter: (p) => set({ priorityFilter: p }),
  setLabelFilter: (id) => set({ labelFilter: id }),
  setTypeFilter: (t) => set({ typeFilter: t }),
  setEpicFilter: (id) => set({ epicFilter: id }),
  clearFilters: () =>
    set({
      searchQuery: '',
      assigneeFilter: null,
      priorityFilter: null,
      labelFilter: null,
      typeFilter: null,
      epicFilter: null,
    }),
}));
