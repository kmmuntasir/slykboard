import { env } from '@/config/env';
import { useAuthStore } from '@/stores/useAuthStore';
import type { ApiErrorBody, Envelope, ErrorCodeValue } from '@/types/api';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ErrorCodeValue | 'NETWORK_ERROR';
  readonly details?: unknown;

  constructor(
    message: string,
    status: number,
    code: ErrorCodeValue | 'NETWORK_ERROR',
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

export async function apiFetch<T>(path: string, init?: FetchInit): Promise<T> {
  const url = `${env.apiBaseUrl}${path}`;
  const user = useAuthStore.getState().user;

  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (init?.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (user?.token) {
    headers.set('Authorization', `Bearer ${user.token}`);
  }

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch (err) {
    throw new ApiClientError(
      err instanceof Error ? err.message : 'Network request failed',
      0,
      'NETWORK_ERROR',
    );
  }

  if (!response.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // Non-JSON error (e.g. proxy 502). Synthesize a generic body.
    }
    const code = body?.error?.code ?? 'INTERNAL_ERROR';
    throw new ApiClientError(
      body?.error?.message ?? `Request failed: ${response.status}`,
      response.status,
      code,
      body?.error?.details,
    );
  }

  const body = (await response.json()) as Envelope<T> | ApiErrorBody;
  if ('error' in body) {
    throw new ApiClientError(
      body.error.message,
      response.status,
      body.error.code,
      body.error.details,
    );
  }
  return body.data;
}
