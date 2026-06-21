import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      FRONTEND_URL: 'http://localhost:5173',
      NODE_ENV: 'test',
    },
  },
});
