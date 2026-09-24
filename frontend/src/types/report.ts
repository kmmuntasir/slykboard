import type { TicketType } from './ticket';

// F23: per-user aggregated time report shapes. Mirrors the backend
// GET /reports/time response (envelope's inner `data`).
// CR-06: where a member's time went (one row per ticket, sorted totalMs DESC).
export interface ReportUserTicketRow {
  id: string;
  ticketNumber: number;
  title: string;
  type: TicketType;
  epic: { id: string; ticketNumber: number; title: string } | null;
  totalMs: number;
  autoMs: number;
  manualMs: number;
  entryCount: number;
}

export interface ReportUser {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  totalMs: number; // milliseconds tracked in the window
  autoMs: number; // CR-06: auto/manual split of totalMs
  manualMs: number;
  entryCount: number;
  tickets: ReportUserTicketRow[]; // CR-06: per-ticket breakdown
}

export interface TimeReportResponse {
  users: ReportUser[]; // sorted by totalMs DESC (server-side)
  window: { start: string; end: string; label: string };
}

// F24: resolved-ticket counts grouped by priority per user. Mirrors the
// backend GET /reports/tickets response (envelope's inner `data`).
export interface TicketCountByPriority {
  LOW: number;
  MEDIUM: number;
  HIGH: number;
  URGENT: number;
  CRITICAL: number;
  total: number;
}

export interface TicketSummaryUser {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  counts: TicketCountByPriority;
}

export interface TicketSummaryResponse {
  users: TicketSummaryUser[];
  window: { start: string; end: string; label: string };
}

// ---------------------------------------------------------------------------
// CR-04 / CR-05: hierarchy roll-up + drill-down shapes. Mirrors the backend
// GET /reports/time/{rollup,breakdown,entries} responses.
// ---------------------------------------------------------------------------

export interface HierarchyNodeRef {
  id: string;
  ticketNumber: number;
  title: string;
  type: TicketType;
}

export interface NodeRollupResponse {
  node: HierarchyNodeRef;
  window: { start: string; end: string; label: string };
  totalMs: number; // node + all live descendants
  autoMs: number; // timer-tracked portion
  manualMs: number; // manually logged portion
  entryCount: number; // closed entries in the window (running timers excluded)
}

export interface NodeMemberTotal {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  totalMs: number;
  autoMs: number;
  manualMs: number;
  entryCount: number;
}

export interface NodeBreakdownRow {
  id: string;
  ticketNumber: number;
  title: string;
  type: TicketType;
  ownMs: number; // tracked on this ticket itself
  ownAutoMs: number; // CR-11: source split of ownMs
  ownManualMs: number;
  rollupMs: number; // this ticket + its descendants (subtree fold)
  rollupAutoMs: number; // CR-11: source split of rollupMs
  rollupManualMs: number;
  entryCount: number;
  members: Array<{ id: string; totalMs: number }>;
}

export interface NodeBreakdownResponse extends NodeRollupResponse {
  members: NodeMemberTotal[]; // sorted by totalMs DESC (server-side)
  rows: NodeBreakdownRow[]; // sorted by rollupMs DESC (server-side)
}

export interface NodeTimeEntry {
  id: string;
  ticketId: string;
  ticketNumber: number;
  ticketTitle: string;
  ticketType: TicketType;
  userId: string | null;
  userFullName: string | null;
  userAvatarUrl: string | null;
  startTime: string;
  endTime: string | null;
  durationMs: number;
  type: 'manual' | 'timer';
  description: string | null;
  /** CR-14 hook — false until time adjustments ship. */
  adjusted: boolean;
  adjustmentReason: string | null;
}

export interface NodeEntriesResponse {
  node: HierarchyNodeRef;
  window: { start: string; end: string; label: string };
  entries: NodeTimeEntry[];
}

// CR-08: per-column time for a single ticket.
export interface ColumnTimeRow {
  columnId: string;
  columnName: string;
  residenceMs: number;
  trackedMs: number;
  visits: number;
  sharePct: number;
}

export interface ColumnTimeReport {
  ticket: {
    id: string;
    ticketNumber: number;
    title: string;
    type: TicketType;
    statusColumn: string;
    deletedAt: string | null;
  };
  columns: ColumnTimeRow[];
  totalResidenceMs: number;
  totalTrackedMs: number;
  window: { start: string; end: string; label: string } | null;
  filters: { memberId: string | null; source: 'auto' | 'manual' | null };
}
