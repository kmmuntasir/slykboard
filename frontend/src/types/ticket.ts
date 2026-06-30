import type { Label } from './label';

// F09 D-Priority-Enum: SCREAMING_SNAKE storage; Title-Case display via map.
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT' | 'CRITICAL';

// PRD REQ-3.2 display labels (Title-Case). Storage stays SCREAMING_SNAKE.
export const PRIORITY_DISPLAY: Readonly<Record<Priority, string>> = Object.freeze({
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
  CRITICAL: 'Critical',
});

export interface Assignee {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

// F16: resolved ticket creator (left-joined in getTicket). Mirrors Assignee.
// null when the creator's user row is missing/deleted (FK-dangle guard).
export interface Creator {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

// F15 D1: checklist sub-items on a ticket. id is client-generated (crypto.randomUUID);
// backend validates uuid + text cap + max count. Whole array replaced on save (D4).
export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

// F09 D-Assignee-Shape: assignee nullable (unassigned). creatorId returned but
// not rendered on the card (F09 acceptance lists title/ID/assignee/priority/labels).
export interface Ticket {
  id: string;
  ticketNumber: number;
  title: string;
  description: string | null;
  statusColumn: string;
  position: number;
  priority: Priority;
  labels: Label[]; // F14: hydrated { id, name, color }[] (was bare string[])
  checklist: ChecklistItem[]; // F15: sub-items { id, text, done }[]
  assignee: Assignee | null;
  creator: Creator | null; // F16: resolved creator (null if user deleted)
  creatorId: string;
  // DEL-01: nullable due date (full ISO datetime; null = no due date).
  dueDate?: string | null;
  createdAt: string; // ISO
  updatedAt: string;
  deletedAt?: string | null; // F17: soft-delete tombstone (absent on board payload; set on detail for soft-deleted)
}

export interface UpdateTicketDto {
  title?: string;
  description?: string | null;
  priority?: Priority;
  assigneeId?: string | null;
  labelIds?: string[]; // F14: replace a ticket's label set
  checklist?: ChecklistItem[]; // F15: replace the checklist array (full-array replace)
  dueDate?: string | null; // DEL-01: nullable ISO datetime; backend z.string().datetime().nullable().optional()
}
