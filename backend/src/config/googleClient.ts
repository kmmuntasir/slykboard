import { OAuth2Client } from 'google-auth-library';
import { env } from './env';

// Singleton — reuses TLS connection pool. Tests vi.mock this module.
export const googleClient = new OAuth2Client(
  env.googleClientId,
  env.googleClientSecret,
  env.googleCallbackUrl, // 'postmessage' per D6 (GIS popup flow)
);
