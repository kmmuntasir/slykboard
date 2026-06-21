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
});
