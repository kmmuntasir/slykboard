import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './index';
import { runtimeConfig, SCHEMA_VERSION } from './config';

describe('GET /api/health', () => {
  const cases = [
    { name: 'responds 200', expectStatus: 200 },
    { name: 'body status ok', expectStatus: 200, field: 'status', value: 'ok' },
    {
      name: 'body agentMode matches runtime config',
      expectStatus: 200,
      field: 'agentMode',
      value: runtimeConfig.agentMode,
    },
    {
      name: 'body schemaVersion is SCHEMA_VERSION',
      expectStatus: 200,
      field: 'schemaVersion',
      value: SCHEMA_VERSION,
    },
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

  // SLYK-0160: pre-existing fields must survive the agentMode/schemaVersion
  // extension (11-existing-patterns.md § /api/health schemaVersion).
  it('keeps every pre-existing field after the SLYK-0160 extension', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.service).toBe('slykboard-backend');
    expect(typeof res.body.uptime).toBe('number');
    expect(typeof res.body.timestamp).toBe('string');
  });
});
