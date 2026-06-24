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
