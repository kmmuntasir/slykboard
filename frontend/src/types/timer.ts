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
