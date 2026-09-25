import type { Ticket } from './ticket';
import type { Column } from './project';

// F09 D-Unsorted-Bucket: must match backend UNSORTED_BUCKET_ID exactly
// (backend/src/services/boardService.ts exports '__unsorted__'). Frontend uses
// it to render the unsorted bucket distinctly (e.g. muted styling).
export const UNSORTED_BUCKET_ID = '__unsorted__' as const;

export interface BoardColumn {
  id: string;
  name: string;
  isUnsorted: boolean;
  tickets: Ticket[];
}

// CR-03 FR-03.8: epic roll-up row for the Epics view.
export interface EpicSummary {
  id: string;
  ticketNumber: number;
  title: string;
  descendantCount: number;
  doneDescendantCount: number;
  trackedTotalMs: number; // all-time adjusted tracked time, epic + descendants
}

export interface BoardPayload {
  project: { id: string; name: string; slug: string };
  columns: BoardColumn[];
  epics: EpicSummary[];
}

// Re-export for ergonomics (BoardColumn already overlaps Column id/name).
export type { Column };
