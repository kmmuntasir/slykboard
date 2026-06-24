import { Router } from 'express';
import { success, ErrorCode } from '../utils/envelope';
import { AppError } from '../utils/appError';
import { signJwt } from '../utils/jwt';
import { validateRequest } from '../middleware/validateRequest';
import { authenticate } from '../middleware/auth';
import { exchangeCodeForUser } from '../services/googleOAuth';
import { upsertByGoogleId, findUserById, findUserByGoogleId } from '../services/userService';
import { bumpTokenVersion } from '../services/tokenVersion';
import { assertDomainAllowed } from '../services/accessControl';
import { authCodeSchema } from './auth.schema';

export const authRouter = Router();

// POST /api/auth/google — exchange Google auth code for our JWT + user.
authRouter.post(
  '/google',
  validateRequest({ body: authCodeSchema }),
  async (req, res): Promise<void> => {
    const { code } = req.body as { code: string };
    const info = await exchangeCodeForUser(code);
    // D3 + D1 — workspace gate. Runs ONLY on the insert (signup) path.
    // Existing users matched by googleId are grandfathered in so tightening
    // ALLOWED_DOMAIN never locks out current members. assertDomainAllowed
    // no-ops when env.allowedDomain is unset (D13). Runs AFTER Google
    // verifies the email (D2) and BEFORE we persist a new row. errorHandler
    // turns the throw into 403.
    const existing = await findUserByGoogleId(info.googleId);
    if (!existing) {
      assertDomainAllowed(info.email);
    }
    const user = await upsertByGoogleId(info);
    // F25 D6: deactivation gate. Blocked users must not obtain a fresh JWT.
    // Already-issued tokens are invalidated by setUserBlocked -> bumpTokenVersion
    // (authenticate 401s on ver mismatch); this gate stops new logins.
    if (user.blocked === true) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Account deactivated');
    }
    const token = await signJwt({
      sub: user.id,
      email: user.email,
      role: user.role,
      ver: user.tokenVersion,
    });
    res.json(
      success({
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          avatarUrl: user.avatarUrl,
          role: user.role,
        },
      }),
    );
  },
);

// GET /api/auth/me — requires valid Bearer token. D4: re-fetch the DB row by
// req.user.id (DB-authoritative role, future-proofs against role changes) and
// re-sign a fresh 8h JWT. Returns the FULL user row (note b) to preserve F05's
// AuthResponseUser contract {id, email, fullName, avatarUrl, role}.
authRouter.get('/me', authenticate, async (req, res): Promise<void> => {
  const user = await findUserById(req.user!.id);
  if (!user) {
    throw new AppError(ErrorCode.UNAUTHENTICATED, 'User no longer exists');
  }
  const token = await signJwt({
    sub: user.id,
    email: user.email,
    role: user.role,
    ver: user.tokenVersion,
  });
  res.json(
    success({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
        role: user.role,
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
