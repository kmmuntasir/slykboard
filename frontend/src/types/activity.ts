// F19 D3: enriched activity row (backend getTicketActivity response shape).
// Backend resolves all ids server-side (actor, column, assignee names); the FE is
// a dumb sentence-switch over actionType (describeActivity) and never resolves ids.
export type ActivityAction =
  | 'CREATED'
  | 'STATUS_CHANGED'
  | 'PRIORITY_CHANGED'
  | 'ASSIGNEE_CHANGED'
  | 'LABELS_CHANGED'
  | 'CONTENT_UPDATED'
  | 'COMMENT_EDITED'
  | 'COMMENT_DELETED';

export interface ActivityActor {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface ActivityEntry {
  id: string;
  createdAt: string; // ISO
  actionType: ActivityAction;
  actor: ActivityActor | null; // null = deleted user (FK ON DELETE SET NULL)
  from: string | null; // resolved name (column/assignee) or passthrough (priority enum)
  to: string | null;
  message: string | null; // LABELS_CHANGED readable string passthrough
}

export interface ActivityResponse {
  entries: ActivityEntry[];
}
