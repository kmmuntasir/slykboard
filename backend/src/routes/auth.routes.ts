import { Router } from 'express';
import { success, ErrorCode } from '../utils/envelope';
import { AppError } from '../utils/appError';
import { signJwt } from '../utils/jwt';
import { validateRequest } from '../middleware/validateRequest';
import { authenticate } from '../middleware/auth';
import { exchangeCodeForUser } from '../services/googleOAuth';
import { findUserByEmail, findUserById, linkGoogleId } from '../services/userService';
import { bumpTokenVersion } from '../services/tokenVersion';
import { authCodeSchema } from './auth.schema';

export const authRouter = Router();

// POST /api/auth/google — exchange Google auth code for our JWT + user.
// SLYK-01 Task H: login resolves an EXISTING account by email and links the
// googleId on first login. No user provisioning happens here — accounts are
// created by the bootstrap service or Member Management, never via ad-hoc
// Google login. ALLOWED_DOMAIN is NOT re-checked on the login path (the
// account already exists; domain gating only applies at creation time).
authRouter.post(
  '/google',
  validateRequest({ body: authCodeSchema }),
  async (req, res): Promise<void> => {
    const { code } = req.body as { code: string };
    const info = await exchangeCodeForUser(code);

    // Lookup by email (not googleId) — email is the stable account identity.
    const found = await findUserByEmail(info.email);
    if (!found) {
      throw new AppError(ErrorCode.UNAUTHENTICATED, 'No account for this email');
    }

    // F25 D6: deactivation gate. Blocked users must not obtain a fresh JWT.
    if (found.blocked === true) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Account deactivated');
    }

    // First-login googleId link (race-safe) + identity-mismatch defense. On a
    // not-yet-linked account this sets googleId; on an already-linked account
    // it re-reads and either returns the row (same googleId) or throws
    // FORBIDDEN 'Account identity mismatch' (different googleId bound).
    const user = await linkGoogleId(found.id, info.googleId);

    const token = await signJwt({
      sub: user.id,
      email: user.email,
      pa: user.isPlatformAdmin,
      ver: user.tokenVersion,
    });
    res.json(
      success({
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          isPlatformAdmin: user.isPlatformAdmin,
        },
      }),
    );
  },
);

// GET /api/auth/me — requires valid Bearer token. D4: re-fetch the DB row by
// req.user.id (DB-authoritative isPlatformAdmin, future-proofs against admin
// changes) and re-sign a fresh 8h JWT. Returns the FULL user row to preserve
// the AuthResponseUser contract {id, email, fullName, displayName, avatarUrl,
// isPlatformAdmin}.
authRouter.get('/me', authenticate, async (req, res): Promise<void> => {
  const user = await findUserById(req.user!.id);
  if (!user) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'User no longer exists');
  }
  const token = await signJwt({
    sub: user.id,
    email: user.email,
    pa: user.isPlatformAdmin,
    ver: user.tokenVersion,
  });
  res.json(
    success({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        isPlatformAdmin: user.isPlatformAdmin,
      },
    }),
  );
});

// POST /api/auth/logout — F07 D4: bump tokenVersion to hard-expire outstanding
// JWTs for this user (defense-in-depth; client-side clear is authoritative for UX).
// Server reports failure (500) if the version bump did not persist; the client
// must still clear locally for UX regardless of the response. Google token
// revocation deferred to F29.
authRouter.post('/logout', authenticate, async (req, res): Promise<void> => {
  await bumpTokenVersion(req.user!.id);
  res.json(success({ success: true }));
});
