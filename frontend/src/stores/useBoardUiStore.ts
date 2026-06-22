import { create } from 'zustand';

// F10 D4: cross-tree board-UI state. F10 consumes dragInProgress to defer
// polls mid-drag (useBoard refetchInterval). F11 wires onDragStart/onDragEnd.
// dragInProgress defaults false -> F10 read-only behavior unaffected.
interface BoardUiState {
  dragInProgress: boolean;
  setDragInProgress: (value: boolean) => void;
}

export const useBoardUiStore = create<BoardUiState>((set) => ({
  dragInProgress: false,
  setDragInProgress: (value) => set({ dragInProgress: value }),
}));
