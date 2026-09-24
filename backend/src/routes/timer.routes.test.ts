import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

// CR-09 / CR-15: GET /api/timer/state feeds the start-confirmation guard and the
// top-bar widget (active session + last tracked ticket, with ticket refs).

const { TEST_ENV, getTimerState } = vi.hoisted(() => ({
  TEST_ENV: {
    port: 3000,
    frontendUrl: 'http://localhost:5173',
    nodeEnv: 'test',
    databaseUrl: 'postgresql://test:test@localhost:5432/test',
    jwtSecret: 'test-jwt-secret-test-jwt-secret-0000',
    jwtTtl: '8h',
    googleClientId: 'test-client-id.apps.googleusercontent.com',
    googleClientSecret: 'test-client-secret',
    googleCallbackUrl: 'http://localhost:3000/api/auth/google/callback',
    allowedDomain: undefined as string | undefined,
  },
  getTimerState: vi.fn(),
}));

vi.mock('../config', () => ({ env: TEST_ENV }));
vi.mock('../services/tokenVersion', () => ({
  findUserTokenVersion: vi.fn(),
  bumpTokenVersion: vi.fn(),
}));
vi.mock('../services/timerService', () => ({
  getActiveTimer: vi.fn(),
  getTimerState,
}));

import { app } from '../index';
import { signJwt } from '../utils/jwt';
import { findUserTokenVersion } from '../services/tokenVersion';

const mockedFindVersion = vi.mocked(findUserTokenVersion);

const TICKET = {
  id: 't1',
  ticketNumber: 7,
  title: 'Nightly export',
  projectId: 'p1',
  projectSlug: 'SLYK',
  projectName: 'Slyk',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockedFindVersion.mockResolvedValue(0);
});

function token() {
  return signJwt({ sub: 'u1', email: 'user@example.com', pa: false, ver: 0 });
}

describe('GET /api/timer/state (CR-09/CR-15)', () => {
  it('200 returns the active session with its ticket', async () => {
    getTimerState.mockResolvedValue({
      active: { entryId: 'e1', startTime: '2026-01-01T10:00:00.000Z', ticket: TICKET },
      lastTracked: null,
    });

    const res = await request(app)
      .get('/api/timer/state')
      .set('Authorization', `Bearer ${await token()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.active.ticket.title).toBe('Nightly export');
    expect(getTimerState).toHaveBeenCalledWith('u1');
  });

  it('200 returns the last tracked ticket when idle', async () => {
    getTimerState.mockResolvedValue({
      active: null,
      lastTracked: { ...TICKET, endedAt: '2026-01-01T11:00:00.000Z', durationMs: 3_600_000 },
    });

    const res = await request(app)
      .get('/api/timer/state')
      .set('Authorization', `Bearer ${await token()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.active).toBeNull();
    expect(res.body.data.lastTracked.ticketNumber).toBe(7);
    expect(res.body.data.lastTracked.durationMs).toBe(3_600_000);
  });

  it('401 without a Bearer token', async () => {
    const res = await request(app).get('/api/timer/state');
    expect(res.status).toBe(401);
    expect(getTimerState).not.toHaveBeenCalled();
  });
});
