import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

const { TEST_ENV } = vi.hoisted(() => ({
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
}));

vi.mock('../config', () => ({ env: TEST_ENV }));
vi.mock('../services/tokenVersion', () => ({
  findUserTokenVersion: vi.fn(),
  bumpTokenVersion: vi.fn(),
}));
vi.mock('../services/labelService', () => ({
  listLabels: vi.fn(),
  createLabel: vi.fn(),
  updateLabel: vi.fn(),
  deleteLabel: vi.fn(),
}));

import { app } from '../index';
import { signJwt } from '../utils/jwt';
import { AppError } from '../utils/appError';
import { ErrorCode } from '../utils/envelope';
import { findUserTokenVersion } from '../services/tokenVersion';
import * as labelService from '../services/labelService';

const mockedFindVersion = vi.mocked(findUserTokenVersion);
const mockedList = vi.mocked(labelService.listLabels);
const mockedCreate = vi.mocked(labelService.createLabel);
const mockedUpdate = vi.mocked(labelService.updateLabel);
const mockedDelete = vi.mocked(labelService.deleteLabel);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  TEST_ENV.allowedDomain = undefined;
});

function tokenFor(isPlatformAdmin: boolean) {
  return signJwt({ sub: 'u1', email: 'user@example.com', pa: isPlatformAdmin, ver: 0 });
}

// RFC 9562 v4 (Zod 4 enforces version+variant digits — all-1s is invalid).
const VALID_LABEL_ID = '00000000-0000-4000-8000-000000000000';
const SLUG = 'SLYK';

describe('GET /api/projects/:slug/labels', () => {
  it('returns 401 UNAUTHENTICATED without Bearer', async () => {
    const res = await request(app).get(`/api/projects/${SLUG}/labels`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(mockedList).not.toHaveBeenCalled();
  });

  it('returns 200 + sorted labels for ADMIN', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedList.mockResolvedValue([
      { id: 'l1', name: 'Bug', color: '#FF0000' },
      { id: 'l2', name: 'Feature', color: '#00FF00' },
    ]);
    const res = await request(app)
      .get(`/api/projects/${SLUG}/labels`)
      .set('Authorization', `Bearer ${await tokenFor(true)}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(mockedList).toHaveBeenCalledWith(SLUG);
  });

  it('returns 200 for MEMBER (no role gate)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedList.mockResolvedValue([]);
    const res = await request(app)
      .get(`/api/projects/${SLUG}/labels`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`);
    expect(res.status).toBe(200);
  });

  it('returns 400 VALIDATION_FAILED on invalid slug', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const res = await request(app)
      .get('/api/projects/slyk/labels')
      .set('Authorization', `Bearer ${await tokenFor(true)}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedList).not.toHaveBeenCalled();
  });
});

describe('POST /api/projects/:slug/labels', () => {
  it('returns 401 UNAUTHENTICATED without Bearer', async () => {
    const res = await request(app)
      .post(`/api/projects/${SLUG}/labels`)
      .send({ name: 'Bug', color: '#FF0000' });
    expect(res.status).toBe(401);
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('returns 403 FORBIDDEN for MEMBER', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const res = await request(app)
      .post(`/api/projects/${SLUG}/labels`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ name: 'Bug', color: '#FF0000' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('returns 201 + created label for ADMIN', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedCreate.mockResolvedValue({
      id: VALID_LABEL_ID,
      projectId: 'p1',
      name: 'Bug',
      color: '#FF0000',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Awaited<ReturnType<typeof labelService.createLabel>>);
    const res = await request(app)
      .post(`/api/projects/${SLUG}/labels`)
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({ name: 'Bug', color: '#FF0000' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Bug');
    expect(mockedCreate).toHaveBeenCalledWith({
      projectSlug: SLUG,
      name: 'Bug',
      color: '#FF0000',
    });
  });

  it('returns 400 VALIDATION_FAILED for invalid hex (#GGGGGG)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const res = await request(app)
      .post(`/api/projects/${SLUG}/labels`)
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({ name: 'Bug', color: '#GGGGGG' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('normalizes 3-char hex #abc to #AABBCC (echoed by mock)', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedCreate.mockImplementation(
      async (args) =>
        ({
          id: VALID_LABEL_ID,
          projectId: 'p1',
          name: args.name,
          color: args.color,
          createdAt: new Date(),
          updatedAt: new Date(),
        }) as unknown as Awaited<ReturnType<typeof labelService.createLabel>>,
    );
    const res = await request(app)
      .post(`/api/projects/${SLUG}/labels`)
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({ name: 'Bug', color: '#abc' });
    expect(res.status).toBe(201);
    expect(res.body.data.color).toBe('#AABBCC');
    expect(mockedCreate).toHaveBeenCalledWith(expect.objectContaining({ color: '#AABBCC' }));
  });

  it('returns 409 CONFLICT on duplicate name', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedCreate.mockRejectedValue(new AppError(ErrorCode.CONFLICT, 'Label name already exists'));
    const res = await request(app)
      .post(`/api/projects/${SLUG}/labels`)
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({ name: 'Bug', color: '#FF0000' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });
});

describe('PATCH /api/labels/:id', () => {
  it('returns 401 UNAUTHENTICATED without Bearer', async () => {
    const res = await request(app).patch(`/api/labels/${VALID_LABEL_ID}`).send({ name: 'New' });
    expect(res.status).toBe(401);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('returns 403 FORBIDDEN for MEMBER', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const res = await request(app)
      .patch(`/api/labels/${VALID_LABEL_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`)
      .send({ name: 'New' });
    expect(res.status).toBe(403);
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('returns 200 for ADMIN', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedUpdate.mockResolvedValue({
      old: { id: VALID_LABEL_ID, name: 'Old', color: '#000000' },
      new: { id: VALID_LABEL_ID, name: 'New', color: '#000000' },
    } as unknown as Awaited<ReturnType<typeof labelService.updateLabel>>);
    const res = await request(app)
      .patch(`/api/labels/${VALID_LABEL_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({ name: 'New' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('New');
    expect(mockedUpdate).toHaveBeenCalledWith({ labelId: VALID_LABEL_ID, patch: { name: 'New' } });
  });

  it('returns 400 VALIDATION_FAILED for non-uuid id', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const res = await request(app)
      .patch('/api/labels/not-a-uuid')
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({ name: 'New' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 VALIDATION_FAILED for empty body', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const res = await request(app)
      .patch(`/api/labels/${VALID_LABEL_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 NOT_FOUND when label missing', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedUpdate.mockRejectedValue(new AppError(ErrorCode.NOT_FOUND, 'Label not found'));
    const res = await request(app)
      .patch(`/api/labels/${VALID_LABEL_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(true)}`)
      .send({ name: 'New' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('DELETE /api/labels/:id', () => {
  it('returns 401 UNAUTHENTICATED without Bearer', async () => {
    const res = await request(app).delete(`/api/labels/${VALID_LABEL_ID}`);
    expect(res.status).toBe(401);
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('returns 403 FORBIDDEN for MEMBER', async () => {
    mockedFindVersion.mockResolvedValue(0);
    const res = await request(app)
      .delete(`/api/labels/${VALID_LABEL_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(false)}`);
    expect(res.status).toBe(403);
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('returns 200 + { data: { id } } for ADMIN', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedDelete.mockResolvedValue({ id: VALID_LABEL_ID });
    const res = await request(app)
      .delete(`/api/labels/${VALID_LABEL_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(true)}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(VALID_LABEL_ID);
    expect(mockedDelete).toHaveBeenCalledWith(VALID_LABEL_ID);
  });

  it('returns 404 NOT_FOUND when label missing', async () => {
    mockedFindVersion.mockResolvedValue(0);
    mockedDelete.mockRejectedValue(new AppError(ErrorCode.NOT_FOUND, 'Label not found'));
    const res = await request(app)
      .delete(`/api/labels/${VALID_LABEL_ID}`)
      .set('Authorization', `Bearer ${await tokenFor(true)}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
