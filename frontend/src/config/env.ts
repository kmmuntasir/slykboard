interface EnvConfig {
  readonly apiBaseUrl: string;
  readonly googleClientId: string;
}

function loadEnv(): EnvConfig {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL;
  if (!apiBaseUrl) {
    throw new Error('Missing VITE_API_BASE_URL — set it in frontend/.env (see .env.example)');
  }
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!googleClientId) {
    throw new Error('Missing VITE_GOOGLE_CLIENT_ID — set it in frontend/.env (see .env.example)');
  }
  return { apiBaseUrl, googleClientId };
}

export const env: EnvConfig = Object.freeze(loadEnv());
