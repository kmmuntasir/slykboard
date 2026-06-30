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
  logout: () => void | Promise<void>; // clear + broadcast + queryClient.clear + navigate
}
let logoutHandlers: LogoutHandlers | null = null;
export function registerLogoutHandlers(handlers: LogoutHandlers): void {
  logoutHandlers = handlers;
}

// SLYK-01 Task N: centralized non-revealing 403 handler. A project-access denial
// (requireProjectMember / requireProjectAdmin / resolveProject) is byte-identical
// FORBIDDEN 'You do not have access to this project' (anti-oracle: unknown slug
// and non-member are indistinguishable). Registered by useAuthSync (which has the
// router's navigate + the toast surface) so the low-level client stays free of
// router/sonator imports. The client invokes this BEFORE rejecting the caller's
// promise; the caller still sees an ApiClientError so query/mutation handlers
// resolve normally. This does NOT touch the 401 refresh cycle — 403 is an
// authorization failure, not an authentication one.
const PROJECT_ACCESS_DENIED_MESSAGE = 'You do not have access to this project';

interface ForbiddenHandler {
  onProjectAccessDenied: (message: string) => void;
}
let forbiddenHandler: ForbiddenHandler | null = null;
export function registerForbiddenHandler(handler: ForbiddenHandler | null): void {
  forbiddenHandler = handler;
}

// Project-scoped request path (/api is the apiFetch prefix; `path` here is the
// suffix passed to apiFetch, e.g. '/projects/:slug/members'). Matches any
// /projects/:slug... route so member/label/report/board denials all funnel here.
function isProjectScopedPath(path: string): boolean {
  return /^\/projects\/[^/]+/.test(path);
}

// F07 T2 (H2): coalesced refresh — N concurrent 401s await ONE refresh promise.
// On success every waiter retries once; on failure the first loser triggers a
// single logout() and all throw. logoutFired resets per refresh cycle so a later
// session's genuine 401 still logs out.
let refreshPromise: Promise<boolean> | null = null;
let logoutFired = false;

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

  // F07 T2 (H2/L8): 401 interceptor. Exempt /auth/* to avoid infinite loops.
  // Coalesce concurrent 401s onto a single refresh promise: the first 401 starts
  // it, the rest await it. On success every waiter retries once (preserving the
  // caller's init incl. AbortSignal). On failure only the first loser fires
  // logout(); all throw a 401.
  if (response.status === 401 && !path.startsWith('/auth/') && logoutHandlers) {
    if (!refreshPromise) {
      // New refresh cycle — reset the logout guard for this cycle.
      logoutFired = false;
      refreshPromise = logoutHandlers.refresh().finally(() => {
        refreshPromise = null;
      });
    }
    const sharedRefresh = refreshPromise;

    let refreshed: boolean;
    try {
      refreshed = await sharedRefresh;
    } catch {
      refreshed = false;
    }

    if (refreshed) {
      // Fresh token in store — retry the original request once, passing init
      // through (preserves signal/headers/body — fixes L8).
      response = await doFetch(init ?? {});
    } else if (!logoutFired) {
      // First loser of this cycle → single hard logout. Concurrent losers observe
      // logoutFired === true and skip.
      logoutFired = true;
      await logoutHandlers.logout();
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
    const message = body?.error?.message ?? `Request failed: ${response.status}`;

    // SLYK-01 Task N: central non-revealing 403 redirect. ONLY the byte-identical
    // project-access-denial message triggers the bounce — other project-scoped
    // 403s (wrong-domain email on member create, platform-admin-required) carry
    // different messages and MUST propagate so callers surface them inline. This
    // runs AFTER the 401 interceptor (unchanged) and never invokes the refresh
    // cycle; 403 ≠ 401.
    if (
      response.status === 403 &&
      code === 'FORBIDDEN' &&
      message === PROJECT_ACCESS_DENIED_MESSAGE &&
      isProjectScopedPath(path) &&
      forbiddenHandler
    ) {
      forbiddenHandler.onProjectAccessDenied(message);
    }

    throw new ApiClientError(message, response.status, code, body?.error?.details);
  }

  // F17 D10: 204 No Content has an empty body — do NOT JSON-parse.
  if (response.status === 204) {
    return null as T;
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
