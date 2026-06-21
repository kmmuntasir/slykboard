import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './index';

describe('GET /api/health', () => {
  const cases = [
    { name: 'responds 200', expectStatus: 200 },
    { name: 'body status ok', expectStatus: 200, field: 'status', value: 'ok' },
  ];

  cases.forEach(({ name, expectStatus, field, value }) => {
    it(name, async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(expectStatus);
      if (field) expect(res.body[field]).toBe(value);
    });
  });

  it('returns NOT_FOUND envelope for unknown routes (F03)', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('health stays non-enveloped (documented F03 D10 exception)', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    // top-level `status`, NOT nested under `data`
    expect(res.body.status).toBe('ok');
    expect(res.body.data).toBeUndefined();
  });
});
