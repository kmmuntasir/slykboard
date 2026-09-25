import {
  PRIORITY_DISPLAY,
  TICKET_TYPE_DISPLAY,
  type Priority,
  type TicketType,
} from '@/types/ticket';
import type { ActivityEntry } from '@/types/activity';

// CR-03 FR-03.7: PARENT_CHANGED / TYPE_CHANGED ride the same enriched envelope
// but types/activity.ts predates them and sits outside this change's scope —
// widen the action union locally so the switch can match the backend actions.
type HierarchyActivityAction = 'PARENT_CHANGED' | 'TYPE_CHANGED';

// Enriched entry whose actionType may also be a hierarchy action.
export interface DescribableActivityEntry extends Omit<ActivityEntry, 'actionType'> {
  actionType: ActivityEntry['actionType'] | HierarchyActivityAction;
}

// F19 D7: PURE sentence-switch over actionType. REQ-5.2 grammar:
//   {actor} {action} {field} from {old} to {new}
// REQ-5.3: CONTENT_UPDATED → generic "updated the description" (no diff).
// Returns the action clause; the caller (ActivityItem) prepends the actor name
// and appends the time.
export interface ActivitySentence {
  clause: string; // e.g. "changed Priority from Low to High"
}

const UNKNOWN_USER = 'Unknown user';
const ROOT_PARENT = 'root';

// F19 D4: actor label — null actor (deleted user) → "Unknown user".
export function actorLabel(entry: ActivityEntry): string {
  return entry.actor?.fullName ?? UNKNOWN_USER;
}

export function describeActivity(entry: DescribableActivityEntry): ActivitySentence {
  return { clause: describeClause(entry) };
}

function describeClause(entry: DescribableActivityEntry): string {
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
    case 'PARENT_CHANGED':
      // from/to are resolved '<SLUG>-<n>' refs; null = root. A first attach has
      // no previous parent — "moved under X"; otherwise mirror STATUS grammar.
      if (entry.from === null && entry.to !== null) {
        return `moved under ${entry.to}`;
      }
      return `moved from ${entry.from ?? ROOT_PARENT} to ${entry.to ?? ROOT_PARENT}`;
    case 'TYPE_CHANGED':
      // Backend passes the raw uppercase enum; humanize via TICKET_TYPE_DISPLAY.
      return `changed type from ${displayType(entry.from)} to ${displayType(entry.to)}`;
    default:
      return 'updated the ticket';
  }
}

function displayPriority(value: string | null): string {
  if (value === null) return UNKNOWN_USER;
  // noUncheckedIndexedAccess: index yields string | undefined → fall back to raw value.
  return PRIORITY_DISPLAY[value as Priority] ?? value;
}

// CR-03 FR-03.7: mirrors displayPriority — unknown/null values degrade to the
// "Unknown user" sentinel per the file's existing convention.
function displayType(value: string | null): string {
  if (value === null) return UNKNOWN_USER;
  return TICKET_TYPE_DISPLAY[value as TicketType] ?? value;
}
