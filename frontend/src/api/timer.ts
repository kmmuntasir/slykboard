import { apiFetch } from './client';
import type {
  StartTimerResponse,
  StopTimerResponse,
  ActiveTimerResponse,
  TimeEntriesResponse,
  TimeEntryWithDuration,
} from '../types/timer';

// F20 T4: server-authoritative timer HTTP client.
// Start: POST /tickets/:ticketId/timer/start -> { entry, serverNow }
// Stop:  POST /tickets/:ticketId/timer/stop  -> { entry, serverNow }
// Active: GET  /timer/active                 -> { activeTimer: TimeEntry | null }

export async function startTimer(ticketId: string): Promise<StartTimerResponse> {
  return apiFetch<StartTimerResponse>(`/tickets/${ticketId}/timer/start`, {
    method: 'POST',
  });
}

export async function stopTimer(ticketId: string): Promise<StopTimerResponse> {
  return apiFetch<StopTimerResponse>(`/tickets/${ticketId}/timer/stop`, {
    method: 'POST',
  });
}

export async function fetchActiveTimer(): Promise<ActiveTimerResponse> {
  return apiFetch<ActiveTimerResponse>('/timer/active');
}

// F20: time-tracking log for a ticket (reverse-chrono entries + total).
export async function fetchTimeEntries(ticketId: string): Promise<TimeEntriesResponse> {
  return apiFetch<TimeEntriesResponse>(`/tickets/${ticketId}/timer/entries`);
}

// F21: log time without running the timer (manual entry).
export async function addManualEntry(
  ticketId: string,
  body: { minutes: number; description?: string },
): Promise<TimeEntryWithDuration> {
  return apiFetch<TimeEntryWithDuration>(`/tickets/${ticketId}/timer/manual`, {
    method: 'POST',
    body: JSON.stringify({ minutes: body.minutes, description: body.description }),
  });
}
