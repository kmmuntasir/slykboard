import { eq } from 'drizzle-orm';
import { env } from '../config';
import { logger } from '../config/logger';
import { db } from '../db/client';
import { users } from '../db/schema';
import { normalizeEmailDomain } from './accessControl';

// SLYK-01 Task E: boot-time, env-driven, idempotent Platform Admin creator.
// Replaces the removed signup-time first-user-admin heuristic. The Tx alias
// mirrors userService.ts:19 so the inner transaction client is typed the same
// way across services.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Ensures exactly one Platform Admin exists per `BOOTSTRAP_ADMIN_EMAIL`.
 *
 * Behavior:
 *  - `BOOTSTRAP_ADMIN_EMAIL` unset/empty → log + return (bootstrap disabled).
 *  - `ALLOWED_DOMAIN` set and the email's domain does not match → log error +
 *    `process.exit(1)` (boot hard-stops; no row is inserted).
 *  - All DB work runs inside ONE `db.transaction`:
 *      • no row → INSERT a Platform Admin;
 *      • row with `isPlatformAdmin=true` → no-op (idempotent);
 *      • row with `isPlatformAdmin=false` → promote to `true`.
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  const bootstrapEmail = env.bootstrapAdminEmail?.trim();
  if (!bootstrapEmail) {
    logger.info('Bootstrap admin disabled (BOOTSTRAP_ADMIN_EMAIL not set)');
    return;
  }

  // Domain gate: enforce ALLOWED_DOMAIN at the bootstrap path. A mismatch is a
  // deploy-time configuration error, so the process hard-stops rather than
  // inserting a platform admin outside the allowed workspace.
  if (env.allowedDomain) {
    const emailDomain = normalizeEmailDomain(bootstrapEmail);
    const allowedDomain = normalizeEmailDomain(`x@${env.allowedDomain}`);
    if (!emailDomain || emailDomain !== allowedDomain) {
      logger.error(
        { bootstrapAdminEmail: bootstrapEmail, allowedDomain: env.allowedDomain },
        'Bootstrap admin email domain does not match ALLOWED_DOMAIN; refusing to start',
      );
      process.exit(1);
    }
  }

  await db.transaction(async (tx: Tx) => {
    const [existing] = await tx
      .select()
      .from(users)
      .where(eq(users.email, bootstrapEmail))
      .limit(1);

    if (!existing) {
      await tx.insert(users).values({
        email: bootstrapEmail,
        fullName: env.bootstrapAdminFullName ?? bootstrapEmail,
        displayName: env.bootstrapAdminDisplayName ?? undefined,
        googleId: null,
        isPlatformAdmin: true,
        blocked: false,
      });
      logger.info(
        { email: bootstrapEmail },
        'Bootstrap platform admin created',
      );
      return;
    }

    if (existing.isPlatformAdmin) {
      logger.info(
        { email: bootstrapEmail, userId: existing.id },
        'Bootstrap platform admin already configured (no-op)',
      );
      return;
    }

    await tx
      .update(users)
      .set({ isPlatformAdmin: true })
      .where(eq(users.id, existing.id));
    logger.info(
      { email: bootstrapEmail, userId: existing.id },
      'Existing user promoted to platform admin',
    );
  });
}
