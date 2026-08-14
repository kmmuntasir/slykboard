import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// SLYK-0330 — fake-timer coverage for the in-memory pm_reply retry queue
// (07-dispatcher-contract.md § failure table: "Background retry every 30s
// until delivered or 10 min elapsed (then mark permanently failed)").
// postToDispatcher is mocked — dispatcherClient's own retry ladder is
// covered in dispatcherClient.test.ts.

const bag = vi.hoisted(() => ({
  postToDispatcher: vi.fn(),
}));

vi.mock('./dispatcherClient', () => ({
  postToDispatcher: bag.postToDispatcher,
}));

import {
  enqueuePmReply,
  pendingPmReplyCount,
  clearPmReplyQueue,
  PM_REPLY_RETRY_INTERVAL_MS,
  PM_REPLY_RETRY_WINDOW_MS,
} from './pmReplyDeliveryQueue';

const TICKET_ID = '11111111-1111-4111-8111-111111111111';
const KEY = '9b7c6d5e-1111-4222-8333-444455556666';

function delivery(idempotencyKey = KEY) {
  return {
    ticketId: TICKET_ID,
    messageId: '66666666-6666-4666-8666-666666666666',
    payload: {
      eventType: 'pm_reply' as const,
      ticketId: TICKET_ID,
      agentSessionId: 'cyrus-session-abc',
      body: 'Yes, add a confirm dialog.',
      idempotencyKey,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  clearPmReplyQueue();
});

afterEach(() => {
  clearPmReplyQueue();
  vi.useRealTimers();
});

describe('pmReplyDeliveryQueue — retry until delivered', () => {
  it('first retry at 30s; success removes the entry (no further POSTs)', async () => {
    bag.postToDispatcher.mockRejectedValue(new Error('down'));
    enqueuePmReply(delivery());
    expect(pendingPmReplyCount()).toBe(1);

    // Tick 1 at +30s — still failing, stays queued.
    await vi.advanceTimersByTimeAsync(PM_REPLY_RETRY_INTERVAL_MS);
    expect(bag.postToDispatcher).toHaveBeenCalledTimes(1);
    expect(pendingPmReplyCount()).toBe(1);

    // Dispatcher recovers; tick 2 delivers and drains the queue.
    bag.postToDispatcher.mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(PM_REPLY_RETRY_INTERVAL_MS);
    expect(bag.postToDispatcher).toHaveBeenCalledTimes(2);
    expect(pendingPmReplyCount()).toBe(0);

    // No timer left — later ticks fire nothing.
    await vi.advanceTimersByTimeAsync(PM_REPLY_RETRY_INTERVAL_MS * 3);
    expect(bag.postToDispatcher).toHaveBeenCalledTimes(2);
  });

  it('every retry sends the SAME payload (idempotencyKey fixed) to the contract path', async () => {
    bag.postToDispatcher.mockRejectedValue(new Error('down'));
    enqueuePmReply(delivery());

    await vi.advanceTimersByTimeAsync(PM_REPLY_RETRY_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(PM_REPLY_RETRY_INTERVAL_MS);

    expect(bag.postToDispatcher.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [path, payload] of bag.postToDispatcher.mock.calls) {
      expect(path).toBe('/webhooks/ticket-events');
      expect(payload).toEqual(delivery().payload);
    }
  });
});

describe('pmReplyDeliveryQueue — 10 min permanent failure', () => {
  it('window elapsed with the dispatcher still down → dropped, no more attempts', async () => {
    bag.postToDispatcher.mockRejectedValue(new Error('down'));
    enqueuePmReply(delivery());

    // 30s cadence across the full window: the tick that finds the entry
    // expired drops it without another POST (the "permanently failed" mark).
    await vi.advanceTimersByTimeAsync(PM_REPLY_RETRY_WINDOW_MS + PM_REPLY_RETRY_INTERVAL_MS);

    // ~20 attempts in-window, then silence after the drop.
    const attempts = bag.postToDispatcher.mock.calls.length;
    expect(attempts).toBeGreaterThan(0);
    expect(attempts).toBeLessThanOrEqual(
      Math.ceil(PM_REPLY_RETRY_WINDOW_MS / PM_REPLY_RETRY_INTERVAL_MS),
    );
    expect(pendingPmReplyCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(PM_REPLY_RETRY_INTERVAL_MS * 3);
    expect(bag.postToDispatcher.mock.calls.length).toBe(attempts);
  });
});
