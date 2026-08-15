// SLYK-0390 — notification-preferences domain types mirrored from the
// backend endpoints (06-frontend-ui.md § Notifications). Three booleans per
// (user, project); absent row reads as all-true (lazy default).

export interface NotificationPreferences {
  notifyOnDone: boolean;
  notifyOnBlockedHuman: boolean;
  notifyOnAgentWaiting: boolean;
}
