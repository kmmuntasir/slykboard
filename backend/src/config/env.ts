import 'dotenv/config';

export interface Config {
  port: number;
  frontendUrl: string;
  nodeEnv: string;
  databaseUrl: string;
  directDatabaseUrl: string;
  runMigrationsOnStart: boolean;
  jwtSecret: string;
  jwtTtl: string; // F07 D8: env-driven JWT TTL (jose setExpirationTime string, e.g. '8h', '15m')
  googleClientId: string;
  googleClientSecret: string;
  googleCallbackUrl: string;
  allowedDomain?: string;
  bootstrapAdminEmail?: string;
  bootstrapAdminFullName?: string;
  bootstrapAdminDisplayName?: string;
}

// Parse 'true'/'1'/'yes' (case-insensitive) → true; 'false'/'0'/'no' → false; otherwise undefined.
function parseBooleanFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  return undefined;
}

export function loadConfig(envSource: NodeJS.ProcessEnv = process.env): Config {
  if (!envSource.FRONTEND_URL) {
    throw new Error('Missing required environment variable: FRONTEND_URL');
  }
  if (!envSource.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }
  if (!envSource.JWT_SECRET) {
    throw new Error('Missing JWT_SECRET');
  }
  if (envSource.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be >= 32 chars');
  }
  if (!envSource.GOOGLE_CLIENT_ID) {
    throw new Error('Missing GOOGLE_CLIENT_ID');
  }
  if (!envSource.GOOGLE_CLIENT_SECRET) {
    throw new Error('Missing GOOGLE_CLIENT_SECRET');
  }
  if (!envSource.GOOGLE_CALLBACK_URL) {
    throw new Error('Missing GOOGLE_CALLBACK_URL');
  }

  const nodeEnv = envSource.NODE_ENV ?? 'development';

  return {
    port: Number(envSource.PORT ?? 3000),
    frontendUrl: envSource.FRONTEND_URL,
    nodeEnv,
    databaseUrl: envSource.DATABASE_URL,
    jwtSecret: envSource.JWT_SECRET,
    jwtTtl: envSource.JWT_TTL || '8h', // F07 D8: default preserves F05/F06 behavior
    googleClientId: envSource.GOOGLE_CLIENT_ID,
    googleClientSecret: envSource.GOOGLE_CLIENT_SECRET,
    googleCallbackUrl: envSource.GOOGLE_CALLBACK_URL,
    allowedDomain: envSource.ALLOWED_DOMAIN || undefined,
    bootstrapAdminEmail: envSource.BOOTSTRAP_ADMIN_EMAIL?.trim() || undefined,
    bootstrapAdminFullName: envSource.BOOTSTRAP_ADMIN_FULL_NAME?.trim() || undefined,
    bootstrapAdminDisplayName: envSource.BOOTSTRAP_ADMIN_DISPLAY_NAME?.trim() || undefined,
    directDatabaseUrl: envSource.DIRECT_DATABASE_URL?.trim() || envSource.DATABASE_URL,
    runMigrationsOnStart:
      parseBooleanFlag(envSource.RUN_MIGRATIONS_ON_START) ?? nodeEnv === 'production',
  };
}

export const env: Readonly<Config> = Object.freeze(loadConfig());
