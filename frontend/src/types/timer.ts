export interface TimeEntry {
    id: string;
    ticketId: string;
    userId: string | null;
    startTime: string; // ISO
    endTime: string | null; // null = running
    manualEntryMinutes: number | null;
    description: string | null;
    createdAt: string;
}

export interface StartTimerResponse {
    entry: TimeEntry;
    serverNow: string;
}

export interface StopTimerResponse {
    entry: TimeEntry;
    serverNow: string;
}

export interface ActiveTimerResponse {
    activeTimer: TimeEntry | null;
}

export interface ServerTimeResponse {
    now: string;
}

// F20: time-tracking log — per-entry row with computed duration + total payload.
export interface TimeEntryWithDuration {
    id: string;
    startTime: string; // ISO
    endTime: string | null; // null = still running
    durationMs: number | null; // null if running; else end - start
    description: string | null;
}

export interface TimeEntriesResponse {
    entries: TimeEntryWithDuration[];
    totalMs: number; // sum of all closed durations (running entry excluded)
}
