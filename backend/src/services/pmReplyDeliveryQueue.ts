import { logger } from '../config/logger';
import { postToDispatcher } from './dispatcherClient';

// SLYK-0330 — background delivery for PM chat replies the dispatcher never
// acknowledged (07-dispatcher-contract.md § failure table: "Dispatcher
// unreachable on PM chat reply → reply persists … Background retry every 30s
// until delivered or 10 min elapsed (then mark permanently failed)").
//
// Deliberately in-memory (ticket decision: "pick the in-memory queue, DB
// columns stay as-is") — a restart drops pending deliveries; the PM's own tab
// already rendered `delivered: false`, and v1 is single-pod (11-existing-
// patterns.md § SSE invariant), so there is exactly one queue instance.

/** Retry cadence — 07 § failure table: "every 30s". */
export const PM_REPLY_RETRY_INTERVAL_MS = 30_000;

/** Give-up horizon — 07 § failure table: "until delivered or 10 min elapsed". */
export const PM_REPLY_RETRY_WINDOW_MS = 10 * 60_000;

/** A reply awaiting delivery. `payload` carries the caller-fixed idempotencyKey. */
export interface PmReplyDelivery {
  ticketId: string;
  messageId: string;
  payload: {
    eventType: 'pm_reply';
    ticketId: string;
    agentSessionId: string | null;
    body: string;
    idempotencyKey: string;
  };
}

interface PendingEntry extends PmReplyDelivery {
  enqueuedAt: number;
}

const pending: PendingEntry[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let draining = false;

function removeFromQueue(entry: PendingEntry): void {
  const index = pending.indexOf(entry);
  if (index !== -1) pending.splice(index, 1);
}

/** Attempt every queued reply; drop the delivered and the expired. */
async function drain(): Promise<void> {
  // postToDispatcher retries internally (up to ~36s of backoff unscaled), so
  // ticks can overlap the 30s interval — serialize rather than pile up.
  if (draining) return;
  draining = true;
  try {
    for (const entry of [...pending]) {
      if (Date.now() - entry.enqueuedAt >= PM_REPLY_RETRY_WINDOW_MS) {
        removeFromQueue(entry);
        logger.error(
          { ticketId: entry.ticketId, messageId: entry.messageId },
          'pm_reply permanently failed — 10 min retry window elapsed',
        );
        continue;
      }
      try {
        await postToDispatcher('/webhooks/ticket-events', entry.payload);
        removeFromQueue(entry);
        logger.info(
          { ticketId: entry.ticketId, messageId: entry.messageId },
          'pm_reply delivered on background retry',
        );
      } catch {
        // Still unreachable — stays queued for the next tick (or the window
        // check above drops it). dispatcherClient already logged the failure.
      }
    }
  } finally {
    draining = false;
    if (pending.length === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }
}

/** Queue a failed reply for background delivery (idempotent per message). */
export function enqueuePmReply(delivery: PmReplyDelivery): void {
  pending.push({ ...delivery, enqueuedAt: Date.now() });
  if (timer === null) {
    timer = setInterval(() => {
      void drain();
    }, PM_REPLY_RETRY_INTERVAL_MS);
    // A pending retry must never hold the event loop open at shutdown.
    timer.unref();
  }
}

/** Queue depth — the assertion surface for tests and admin diagnostics. */
export function pendingPmReplyCount(): number {
  return pending.length;
}

/** Test hook — drop everything and cancel the timer. */
export function clearPmReplyQueue(): void {
  pending.length = 0;
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}
