import { db } from '../db/client';
import { users } from '../db/schema';
import type { GoogleUserInfo } from './googleOAuth';

export type UpsertUserInput = GoogleUserInfo;

export type UserRow = typeof users.$inferSelect;

// D9: insert-or-update on googleId. Refreshes email/fullName/avatarUrl every login.
// Returns the full row (including id, role, timestamps) for JWT signing.
export async function upsertByGoogleId(input: UpsertUserInput): Promise<UserRow> {
  const [row] = await db
    .insert(users)
    .values({
      googleId: input.googleId,
      email: input.email,
      fullName: input.fullName,
      avatarUrl: input.avatarUrl,
    })
    .onConflictDoUpdate({
      target: users.googleId,
      set: {
        email: input.email,
        fullName: input.fullName,
        avatarUrl: input.avatarUrl,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row!;
}
