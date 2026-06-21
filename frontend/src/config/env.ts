interface EnvConfig {
  readonly apiBaseUrl: string;
}

function loadEnv(): EnvConfig {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
  if (!apiBaseUrl) {
    throw new Error('Missing VITE_API_BASE_URL — set it in frontend/.env (see .env.example)');
  }
  return { apiBaseUrl };
}

export const env: EnvConfig = Object.freeze(loadEnv());
