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

// F07 D6: 401 interceptor callbacks. Registered by the app shell (main.tsx or a
// provider) to break the circular dep between client (low-level) and the
// router/store/queryClient (high-level). The client calls these on a hard 401.
interface LogoutHandlers {
  refresh: () => Promise<boolean>; // attempt /me refresh; true if a fresh token landed
  logout: () => void; // clear + broadcast + queryClient.clear + navigate
}
let logoutHandlers: LogoutHandlers | null = null;
export function registerLogoutHandlers(handlers: LogoutHandlers): void {
  logoutHandlers = handlers;
}

// F07 D6: dedupe — N concurrent 401s fire ONE logout.
let isLoggingOut = false;

export async function apiFetch<T>(path: string, init?: FetchInit): Promise<T> {
  const url = `${env.apiBaseUrl}${path}`;

  const doFetch = async (currentInit: FetchInit): Promise<Response> => {
    const user = useAuthStore.getState().user;
    const headers = new Headers(currentInit.headers);
    headers.set('Accept', 'application/json');
    if (currentInit.body) {
      headers.set('Content-Type', 'application/json');
    }
    if (user?.token) {
      headers.set('Authorization', `Bearer ${user.token}`);
    }
    try {
      return await fetch(url, { ...currentInit, headers });
    } catch (err) {
      throw new ApiClientError(
        err instanceof Error ? err.message : 'Network request failed',
        0,
        'NETWORK_ERROR',
      );
    }
  };

  let response = await doFetch(init ?? {});

  // F07 D6: 401 interceptor. Exempt /auth/* to avoid infinite loops (supertokens #113).
  // Attempt ONE refresh before hard-logout. Deduped via isLoggingOut — set
  // before the await so N concurrent 401s collapse into a single refresh/logout.
  if (
    response.status === 401 &&
    !path.startsWith('/auth/') &&
    logoutHandlers &&
    !isLoggingOut
  ) {
    isLoggingOut = true;
    try {
      const refreshed = await logoutHandlers.refresh();
      if (refreshed) {
        // Fresh token in store — retry the original request once.
        response = await doFetch(init ?? {});
      } else {
        // Refresh failed → single hard logout.
        logoutHandlers.logout();
      }
    } finally {
      isLoggingOut = false;
    }
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
