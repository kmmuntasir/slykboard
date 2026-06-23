import { activityLogs } from '../db/schema';
import { db } from '../db/client';

// Canonical tx alias (mirrors ticketService.ts:14). Defined locally so this
// module has no circular dependency on ticketService; the derivation is stable.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ActivityAction =
  | 'CREATED'
  | 'STATUS_CHANGED'
  | 'PRIORITY_CHANGED'
  | 'ASSIGNEE_CHANGED'
  | 'LABELS_CHANGED'
  | 'CONTENT_UPDATED';

export interface ActivityLogEntry {
  action: ActivityAction;
  oldValue: string | null;
  newValue: string | null;
}

export interface LabelDiff {
  added: string[];
  removed: string[];
}

interface RecordActivityArgs {
  ticketId: string;
  actorId: string;
  action: ActivityAction;
  oldValue?: string | null;
  newValue?: string | null;
}

/**
 * Insert one ActivityLogs row. MUST run inside the caller's db.transaction so the
 * log never diverges from the data. Mirrors allocateTicketNumber(tx, ...) idiom.
 */
export async function recordActivity(
  tx: Tx,
  { ticketId, actorId, action, oldValue = null, newValue = null }: RecordActivityArgs,
): Promise<void> {
  await tx.insert(activityLogs).values({
    ticketId,
    userId: actorId,
    actionType: action,
    oldValue,
    newValue,
  });
}

/**
 * PURE decision fn -> the activity entries to write for a ticket update. Empty
 * array = no-op (write zero rows). No DB access -> table-testable.
 * NOTE: emits PRIORITY_CHANGED / ASSIGNEE_CHANGED / CONTENT_UPDATED / LABELS_CHANGED
 * only — STATUS_CHANGED belongs to moveTicket (T4), CREATED to createTicket (T3).
 * Checklist changes are NOT audited (D10).
 */
export function diffTicketChanges(
  old: { title: string; description: string | null; priority: string; assigneeId: string | null },
  next: { title: string; description: string | null; priority: string; assigneeId: string | null },
  labelDiff: LabelDiff | null,
): ActivityLogEntry[] {
  const entries: ActivityLogEntry[] = [];

  if (old.priority !== next.priority) {
    entries.push({ action: 'PRIORITY_CHANGED', oldValue: old.priority, newValue: next.priority });
  }

  if (old.assigneeId !== next.assigneeId) {
    entries.push({
      action: 'ASSIGNEE_CHANGED',
      oldValue: old.assigneeId ?? 'unassigned',
      newValue: next.assigneeId ?? 'unassigned',
    });
  }

  if (old.title !== next.title || old.description !== next.description) {
    entries.push({ action: 'CONTENT_UPDATED', oldValue: null, newValue: null });
  }

  if (labelDiff !== null && (labelDiff.added.length > 0 || labelDiff.removed.length > 0)) {
    entries.push({
      action: 'LABELS_CHANGED',
      oldValue: null,
      newValue: formatLabelDiff(labelDiff),
    });
  }

  return entries;
}

/** "added: Bug, UI; removed: API" — D9 readable NAMES string; empty parts omitted. */
export function formatLabelDiff(diff: LabelDiff): string {
  const parts: string[] = [];
  if (diff.added.length > 0) {
    parts.push(`added: ${diff.added.join(', ')}`);
  }
  if (diff.removed.length > 0) {
    parts.push(`removed: ${diff.removed.join(', ')}`);
  }
  return parts.join('; ');
}
