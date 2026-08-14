import { createHmac } from 'node:crypto';

// SLYK-0150 — HMAC test helpers per docs/agentic-automation/11-existing-patterns.md
// § Test patterns. Mirrors the dispatcher's signing scheme: hex HMAC-SHA256
// over JSON.stringify(body) with the shared SLYKBOARD_DISPATCHER_TOKEN.

export const TEST_DISPATCHER_TOKEN = 'a'.repeat(64);

export function signPayload(body: unknown, token: string): string {
  return createHmac('sha256', token).update(JSON.stringify(body)).digest('hex');
}

export function dispatcherHeaders(body: unknown, token: string) {
  return {
    'Content-Type': 'application/json',
    'X-Dispatcher-Signature': signPayload(body, token),
  };
}
