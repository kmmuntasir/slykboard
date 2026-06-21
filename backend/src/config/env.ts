import 'dotenv/config';

export interface Config {
  port: number;
  frontendUrl: string;
  nodeEnv: string;
  databaseUrl: string;
}

export function loadConfig(envSource: NodeJS.ProcessEnv = process.env): Config {
  if (!envSource.FRONTEND_URL) {
    throw new Error('Missing required environment variable: FRONTEND_URL');
  }
  if (!envSource.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  return {
    port: Number(envSource.PORT ?? 3000),
    frontendUrl: envSource.FRONTEND_URL,
    nodeEnv: envSource.NODE_ENV ?? 'development',
    databaseUrl: envSource.DATABASE_URL,
  };
}

export const env: Readonly<Config> = Object.freeze(loadConfig());
