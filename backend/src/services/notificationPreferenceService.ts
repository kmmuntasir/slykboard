import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { notificationPreferences } from '../db/schema';

// SLYK-0390 — per-user per-project email opt-ins (04-schema.md §
// NotificationPreferences). Lazy-default semantics: NO row means all three
// flags true, so the GET never creates one — the first PUT materializes the
// row (composite PK user×project keeps it a single row thereafter).

/** The three booleans, camelCase wire shape shared by GET and PUT. */
export interface NotificationPreferenceValues {
  notifyOnDone: boolean;
  notifyOnBlockedHuman: boolean;
  notifyOnAgentWaiting: boolean;
}

/** Lazy default — what an absent row reads as (schema defaults, all true). */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferenceValues = {
  notifyOnDone: true,
  notifyOnBlockedHuman: true,
  notifyOnAgentWaiting: true,
};

function toValues(row: typeof notificationPreferences.$inferSelect): NotificationPreferenceValues {
  return {
    notifyOnDone: row.notifyOnDone,
    notifyOnBlockedHuman: row.notifyOnBlockedHuman,
    notifyOnAgentWaiting: row.notifyOnAgentWaiting,
  };
}

/**
 * Read the (userId, projectId) preference row WITHOUT creating it — absent row
 * returns DEFAULT_NOTIFICATION_PREFERENCES (lazy default per 04-schema.md).
 */
export async function getNotificationPreferences(
  userId: string,
  projectId: string,
): Promise<NotificationPreferenceValues> {
  const [row] = await db
    .select()
    .from(notificationPreferences)
    .where(
      and(
        eq(notificationPreferences.userId, userId),
        eq(notificationPreferences.projectId, projectId),
      ),
    )
    .limit(1);
  return row ? toValues(row) : { ...DEFAULT_NOTIFICATION_PREFERENCES };
}

/**
 * Upsert the (userId, projectId) row. onConflictDoUpdate on the composite PK
 * makes a second PUT update in place — always exactly one row per pair.
 * Returns the persisted values.
 */
export async function saveNotificationPreferences(
  userId: string,
  projectId: string,
  values: NotificationPreferenceValues,
): Promise<NotificationPreferenceValues> {
  const [row] = await db
    .insert(notificationPreferences)
    .values({ userId, projectId, ...values })
    .onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.projectId],
      set: { ...values },
    })
    .returning();
  return toValues(row!);
}
