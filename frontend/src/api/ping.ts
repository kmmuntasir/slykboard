import { apiFetch } from './client';

export interface PingResponse {
  message: string;
}

export async function ping(name?: string): Promise<PingResponse> {
  const query = name ? `?name=${encodeURIComponent(name)}` : '';
  return apiFetch<PingResponse>(`/ping${query}`);
}
