/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    env: {
      FRONTEND_URL: 'http://localhost:5173',
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      // F05 test env (inert values — tests mock jose/google-auth-library)
      JWT_SECRET: 'test-secret-at-least-32-characters-long-aaaa',
      GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      GOOGLE_CALLBACK_URL: 'postmessage',
    },
  },
});
