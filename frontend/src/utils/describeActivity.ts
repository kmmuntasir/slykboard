import { PRIORITY_DISPLAY, type Priority } from '@/types/ticket';
import type { ActivityEntry } from '@/types/activity';

// F19 D7: PURE sentence-switch over actionType. REQ-5.2 grammar:
//   {actor} {action} {field} from {old} to {new}
// REQ-5.3: CONTENT_UPDATED → generic "updated the description" (no diff).
// Returns the action clause; the caller (ActivityItem) prepends the actor name
// and appends the time.
export interface ActivitySentence {
  clause: string; // e.g. "changed Priority from Low to High"
}

const UNKNOWN_USER = 'Unknown user';

// F19 D4: actor label — null actor (deleted user) → "Unknown user".
export function actorLabel(entry: ActivityEntry): string {
  return entry.actor?.fullName ?? UNKNOWN_USER;
}

export function describeActivity(entry: ActivityEntry): ActivitySentence {
  return { clause: describeClause(entry) };
}

function describeClause(entry: ActivityEntry): string {
  switch (entry.actionType) {
    case 'CREATED':
      return 'created the ticket';
    case 'STATUS_CHANGED':
      // from/to are resolved column names; defensive null → "Unknown user".
      return `moved from ${entry.from ?? UNKNOWN_USER} to ${entry.to ?? UNKNOWN_USER}`;
    case 'PRIORITY_CHANGED':
      // Backend passes the raw uppercase enum; Title-Case via PRIORITY_DISPLAY.
      return `changed Priority from ${displayPriority(entry.from)} to ${displayPriority(entry.to)}`;
    case 'ASSIGNEE_CHANGED':
      // from/to are resolved names (or "Unassigned"); defensive null → "Unknown user".
      return `changed assignee from ${entry.from ?? UNKNOWN_USER} to ${entry.to ?? UNKNOWN_USER}`;
    case 'LABELS_CHANGED':
      // Backend passthrough readable string ("added: Bug; removed: API").
      return entry.message ?? 'updated labels';
    case 'CONTENT_UPDATED':
      // REQ-5.3: generic, no diff — message carries the field name(s).
      return `updated the ${entry.message ?? 'description'}`;
    case 'COMMENT_EDITED':
      return 'edited a comment';
    case 'COMMENT_DELETED':
      return 'deleted a comment';
    default:
      return 'updated the ticket';
  }
}

function displayPriority(value: string | null): string {
  if (value === null) return UNKNOWN_USER;
  // noUncheckedIndexedAccess: index yields string | undefined → fall back to raw value.
  return PRIORITY_DISPLAY[value as Priority] ?? value;
}
