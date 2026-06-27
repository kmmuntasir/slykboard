// F23: per-user aggregated time report shapes. Mirrors the backend
// GET /reports/time response (envelope's inner `data`).
export interface ReportUser {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  totalMs: number; // milliseconds tracked in the window
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
