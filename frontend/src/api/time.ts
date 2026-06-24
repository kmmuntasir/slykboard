import { apiFetch } from './client';
import type { ServerTimeResponse } from '../types/timer';

// F20 T4: server wall-clock probe — used to compute a client/server clock offset
// so the live elapsed display tracks server-authoritative startTime.
export async function fetchServerTime(): Promise<ServerTimeResponse> {
  return apiFetch<ServerTimeResponse>('/time');
}
