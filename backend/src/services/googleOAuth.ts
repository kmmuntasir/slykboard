import { googleClient } from '../config/googleClient';
import { env } from '../config';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';

export interface GoogleUserInfo {
  googleId: string;
  email: string;
  fullName: string;
  avatarUrl: string | null; // nullable per schema.ts
}

export async function exchangeCodeForUser(code: string): Promise<GoogleUserInfo> {
  try {
    const { tokens } = await googleClient.getToken(code);
    const idToken = tokens.id_token;
    if (!idToken) throw new Error('No id_token in Google response');

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: env.googleClientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload?.email) {
      throw new Error('Google payload missing sub or email');
    }
    return {
      googleId: payload.sub,
      email: payload.email,
      fullName: payload.name ?? payload.email.split('@')[0]!,
      avatarUrl: payload.picture ?? null,
    };
  } catch (cause) {
    // D7: never leak Google's error to the client — generic message.
    throw new AppError(ErrorCode.INTERNAL_ERROR, 'Authentication failed', { cause });
  }
}
