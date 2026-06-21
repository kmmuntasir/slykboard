import { Router } from 'express';
import { success } from '../utils/envelope';
import { validateRequest } from '../middleware/validateRequest';
import { authenticate } from '../middleware/auth';
import { signJwt } from '../utils/jwt';
import { exchangeCodeForUser } from '../services/googleOAuth';
import { upsertByGoogleId } from '../services/userService';
import { authCodeSchema } from './auth.schema';

export const authRouter = Router();

// POST /api/auth/google — exchange Google auth code for our JWT + user.
authRouter.post(
  '/google',
  validateRequest({ body: authCodeSchema }),
  async (req, res): Promise<void> => {
    const { code } = req.body as { code: string };
    const info = await exchangeCodeForUser(code);
    const user = await upsertByGoogleId(info);
    const token = await signJwt({ sub: user.id, email: user.email, role: user.role });
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

// GET /api/auth/me — requires valid Bearer token; re-signs a fresh 8h JWT.
authRouter.get('/me', authenticate, async (req, res): Promise<void> => {
  const user = req.user!;
  const token = await signJwt({ sub: user.id, email: user.email, role: user.role });
  res.json(success({ token, user }));
});

// POST /api/auth/logout — D10: stateless JWT, logout is client-side. No denylist.
authRouter.post('/logout', (_req, res): void => {
  res.json(success({ success: true }));
});
