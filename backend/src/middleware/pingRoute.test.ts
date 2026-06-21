import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express, { type Express } from 'express';
import { pingRouter } from './pingRoute';
import { notFound } from './notFound';
import { errorHandler } from './errorMiddleware';

// Minimal app that mirrors the F03 mount order for this slice.
function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api', pingRouter);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

describe('GET /api/ping', () => {
  it('returns success envelope with default name', async () => {
    const res = await request(buildApp()).get('/api/ping');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { message: 'pong, world' } });
  });

  it('returns success envelope with provided name', async () => {
    const res = await request(buildApp()).get('/api/ping?name=munta');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { message: 'pong, munta' } });
  });

  it('returns VALIDATION_FAILED 400 when name is empty', async () => {
    const res = await request(buildApp()).get('/api/ping?name=');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details).toBeDefined();
  });

  it('hits NOT_FOUND for unknown sub-routes', async () => {
    const res = await request(buildApp()).get('/api/unknown');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
