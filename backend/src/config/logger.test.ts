import { describe, it, expect } from 'vitest';
import { logger, isProd } from './logger';

describe('logger config', () => {
  it('exports a pino logger', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('isProd reflects NODE_ENV !== development', () => {
    // vitest.config.ts sets NODE_ENV=test → isProd === true here.
    expect(isProd).toBe(true);
  });

  it('logger.level is info when isProd', () => {
    // test env → isProd true → level 'info'
    expect(logger.level).toBe('info');
  });
});
