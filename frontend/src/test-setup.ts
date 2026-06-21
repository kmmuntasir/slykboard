import { vi } from 'vitest';
import '@testing-library/jest-dom';

// Default stub for tests that touch anything importing env (api client, HealthBadge, App shell).
// Individual tests may override via vi.stubEnv + dynamic import (see env.test.ts).
vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000/api');
