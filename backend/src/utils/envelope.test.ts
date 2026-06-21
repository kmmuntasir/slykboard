import { describe, it, expect } from 'vitest';
import { success, error, codeToStatus, ErrorCode } from './envelope';
import { HttpStatus } from './httpStatus';

describe('envelope', () => {
  const successCases = [
    { name: 'wraps an object', input: { a: 1 }, expected: { data: { a: 1 } } },
    { name: 'wraps an array', input: [1, 2], expected: { data: [1, 2] } },
    { name: 'wraps null', input: null, expected: { data: null } },
    { name: 'wraps a scalar', input: 'ok', expected: { data: 'ok' } },
  ];

  successCases.forEach(({ name, input, expected }) => {
    it(name, () => {
      expect(success(input)).toEqual(expected);
    });
  });

  it('error() omits details when not provided', () => {
    expect(error(ErrorCode.NOT_FOUND, 'Resource not found')).toEqual({
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
  });

  it('error() includes details when provided', () => {
    const details = { fieldErrors: { email: ['Invalid'] } };
    expect(error(ErrorCode.VALIDATION_FAILED, 'bad', details)).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'bad',
        details,
      },
    });
  });

  const mapCases: Array<[keyof typeof codeToStatus, number]> = [
    ['VALIDATION_FAILED', HttpStatus.BAD_REQUEST],
    ['UNAUTHENTICATED', HttpStatus.UNAUTHORIZED],
    ['FORBIDDEN', HttpStatus.FORBIDDEN],
    ['NOT_FOUND', HttpStatus.NOT_FOUND],
    ['CONFLICT', HttpStatus.CONFLICT],
    ['INTERNAL_ERROR', HttpStatus.INTERNAL_SERVER_ERROR],
  ];

  mapCases.forEach(([code, status]) => {
    it(`codeToStatus[${code}] === ${status}`, () => {
      expect(codeToStatus[code]).toBe(status);
    });
  });
});
